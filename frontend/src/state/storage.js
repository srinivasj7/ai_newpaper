/* localStorage, encrypted at rest.
 *
 * Every value the app persists is written as AES-GCM ciphertext. The key is a 256-bit AES-GCM
 * CryptoKey generated NON-EXTRACTABLE and kept in IndexedDB: the browser can encrypt/decrypt with
 * it but never hands its raw bytes to JavaScript, and it lives in a different store from the
 * ciphertext — so nothing sensitive is ever written to localStorage in the clear, and the key
 * cannot simply be read back out of storage.
 *
 * Threat model: at-rest exposure of the WebView's storage — a shared or rooted device, a device
 * backup, forensic access. It is NOT a defence against script running on the page (which can use
 * the key by definition); that is what the CSP and the same-origin model are for.
 *
 * Web Crypto is async but the app reads these values synchronously during render, so initStorage()
 * — awaited before the first paint — decrypts everything into an in-memory cache. load()/save()
 * then work against that cache synchronously; save() writes back asynchronously, encrypting. If
 * crypto or IndexedDB is unavailable, values live in memory for the session only and are NEVER
 * persisted unencrypted.
 */

const PREFIX = "dtb-";
const ENVELOPE = "enc:v1:"; // marks our ciphertext; anything else is treated as legacy plaintext
const DB_NAME = "dtb-secure";
const STORE = "keys";
const KEY_ID = "master";

const cache = new Map();
let cryptoKey = null;
let ready = null;

const canCrypto = () => Boolean(globalThis.crypto?.subtle && globalThis.indexedDB);

// --- the non-extractable AES key, in IndexedDB ---
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db, id) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db, id, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getOrCreateKey() {
  const db = await openDb();
  const existing = await idbGet(db, KEY_ID);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await idbPut(db, KEY_ID, key); // stored as a non-extractable handle — bytes never leave the browser
  return key;
}

// --- AES-GCM, iv prepended, base64 in an envelope ---
const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function encrypt(plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, new TextEncoder().encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return ENVELOPE + toB64(out);
}

async function decrypt(envelope) {
  const bytes = fromB64(envelope.slice(ENVELOPE.length));
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ct);
  return new TextDecoder().decode(pt);
}

// Parse a stored JSON value, tolerating a legacy raw string (the old plaintext token was not JSON).
const parseValue = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

async function persist(key, value) {
  if (!cryptoKey) return; // no key ⇒ never write plaintext; the value stays in memory only
  try {
    localStorage.setItem(key, await encrypt(JSON.stringify(value)));
  } catch {
    /* quota / private mode — in-memory only */
  }
}

/**
 * Decrypt existing values into the in-memory cache and set up the key. Idempotent; awaited once
 * before the app renders. Always resolves — a failure just leaves an empty cache and the app
 * re-fetches. Any legacy plaintext found is migrated to ciphertext in place.
 */
export function initStorage() {
  if (ready) return ready;
  ready = (async () => {
    try {
      if (canCrypto()) cryptoKey = await getOrCreateKey().catch(() => null);

      // Snapshot our keys first — writing during an index-based scan is unsafe.
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIX)) keys.push(k);
      }

      const legacy = [];
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (raw == null) continue;
        if (cryptoKey && raw.startsWith(ENVELOPE)) {
          try {
            cache.set(k, parseValue(await decrypt(raw)));
          } catch {
            /* corrupt or wrong key — drop it */
          }
        } else {
          cache.set(k, parseValue(raw)); // legacy plaintext, or crypto unavailable
          if (!raw.startsWith(ENVELOPE)) legacy.push(k);
        }
      }

      // Re-encrypt anything that was still plaintext, now that it is cached.
      if (cryptoKey) for (const k of legacy) await persist(k, cache.get(k));
    } catch {
      /* degrade to whatever made it into the cache */
    }
  })();
  return ready;
}

export function load(key, fallback) {
  return cache.has(key) ? cache.get(key) : fallback;
}

export function save(key, value) {
  cache.set(key, value);
  void persist(key, value);
  return true;
}

export function remove(key) {
  cache.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to do */
  }
}
