/* The shared secret that every write must present.
   Held in localStorage so it survives a reload, and nowhere else — it is never put in a URL,
   never in a query string, and never sent with a read. */

import { K } from "../defaults.js";

const listeners = new Set();

export function getToken() {
  try {
    return localStorage.getItem(K.token) || "";
  } catch {
    return ""; // private mode, or storage disabled — writes will simply be refused
  }
}

export function setToken(value) {
  const next = (value ?? "").trim();
  try {
    if (next) localStorage.setItem(K.token, next);
    else localStorage.removeItem(K.token);
  } catch {
    /* nothing to do — the in-memory session still works until reload */
  }
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
