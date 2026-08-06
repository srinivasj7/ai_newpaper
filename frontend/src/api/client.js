/* The only place that talks to the network.
   Reads come from the S3-backed /data prefix; writes go to the Lambda behind /api.
   Both bases are same-origin behind CloudFront in production. */

import { getToken, Unauthorized } from "./token.js";

const DATA = import.meta.env.VITE_DATA_BASE ?? "/data";
const API = import.meta.env.VITE_API_BASE ?? "/api";

const editionCache = new Map();

async function getJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

/** The manifest changes daily, so never serve it from a stale browser cache. */
export function fetchIndex() {
  return getJson(`${DATA}/editions/index.json`, { cache: "no-cache" });
}

/** Dated editions are immutable once published — cache them hard, in memory and in the browser. */
export function fetchEdition(date) {
  if (!editionCache.has(date)) {
    editionCache.set(
      date,
      getJson(`${DATA}/editions/${date}.json`).catch((err) => {
        editionCache.delete(date); // a failed fetch must not poison the cache
        throw err;
      }),
    );
  }
  return editionCache.get(date);
}

/** Seed the cache with an edition we already hold (imported by hand, or restored from cache). */
export function primeEdition(date, edition) {
  editionCache.set(date, Promise.resolve(edition));
}

export function fetchConfig() {
  return getJson(`${DATA}/config/config.json`, { cache: "no-cache" });
}

/**
 * CloudFront signs origin requests to the Lambda with SigV4, and Lambda function URLs reject
 * unsigned payloads — so any request with a body must carry the SHA-256 of that body in
 * `x-amz-content-sha256`, which CloudFront folds into the signature. Without it the write
 * comes back 403 "signature we calculated does not match".
 */
async function payloadHash(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function post(path, body) {
  const payload = JSON.stringify(body);
  const headers = { "content-type": "application/json" };

  // crypto.subtle exists in every secure context, which includes localhost.
  if (globalThis.crypto?.subtle) headers["x-amz-content-sha256"] = await payloadHash(payload);

  // Every write is gated. Read at send time, not at module load, so unlocking takes effect
  // without a reload.
  const token = getToken();
  if (token) headers["x-dtb-token"] = token;

  const send = () => fetch(`${API}${path}`, { method: "POST", headers, body: payload });

  let res;
  try {
    res = await send();
  } catch {
    res = await send(); // one retry — a flaky connection shouldn't lose a vote
  }
  if (!res.ok && res.status >= 500) res = await send();

  // A wrong secret is not a transient failure: never retry it, and never park it in the outbox
  // to be replayed forever. It needs a person to type the right thing.
  if (res.status === 401) throw new Unauthorized(path);

  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
  return res.json().catch(() => ({ ok: true }));
}

export const postConfig = (config) => post("/config", config);
export const postFeedback = (event) => post("/feedback", event);

/** Check a secret without writing anything, so Settings can say "wrong passphrase" straight away. */
export const checkToken = () => post("/session", {}).then(() => true);
