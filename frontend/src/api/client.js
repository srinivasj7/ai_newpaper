/* The only place that talks to the network.
   Reads come from the S3-backed /data prefix; writes go to the Lambda behind /api.
   Both bases are same-origin behind CloudFront in production. */

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

async function post(path, body) {
  const send = () =>
    fetch(`${API}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  let res;
  try {
    res = await send();
  } catch {
    res = await send(); // one retry — a flaky connection shouldn't lose a vote
  }
  if (!res.ok && res.status >= 500) res = await send();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
  return res.json().catch(() => ({ ok: true }));
}

export const postConfig = (config) => post("/config", config);
export const postFeedback = (event) => post("/feedback", event);
