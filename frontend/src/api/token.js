/* The shared secret that every write must present.
   Held through the encrypted store (see state/storage.js) so it survives a reload as ciphertext,
   and nowhere else — it is never put in a URL, never in a query string, and never sent with a
   read. As the most sensitive value in the app, it must never touch localStorage in the clear. */

import { K } from "../defaults.js";
import { load, remove, save } from "../state/storage.js";

const listeners = new Set();

export function getToken() {
  return load(K.token, "") || "";
}

export function setToken(value) {
  const next = (value ?? "").trim();
  if (next) save(K.token, next);
  else remove(K.token);
  listeners.forEach((fn) => fn(next));
}

export const clearToken = () => setToken("");

/** Subscribe to lock/unlock so the header padlock and the Settings panel agree. */
export function onTokenChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Thrown for a 401 so callers can tell "you are locked out" from "the wire is down". */
export class Unauthorized extends Error {
  constructor(path) {
    super(`401 unauthorized — ${path}`);
    this.name = "Unauthorized";
    this.unauthorized = true;
  }
}
