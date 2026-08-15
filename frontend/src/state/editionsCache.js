/* Per-date edition cache for offline reading.
 *
 * The single-slot cache this replaces could only ever hold one edition, so opening a second date
 * offline showed the wrong paper. This keeps the last N opened editions keyed by date, evicting the
 * least-recently-saved when full. Object key order is insertion order for these (non-integer) date
 * strings, so re-inserting on save gives a simple LRU without a separate order list.
 */

import { K } from "../defaults.js";
import { load, save } from "./storage.js";

const CAP = 15;

export function saveEdition(date, edition) {
  if (!date || !edition) return;
  const store = load(K.editionsCache, {}) || {};
  delete store[date]; // re-insert at the end so it counts as most-recently-used
  store[date] = edition;
  const dates = Object.keys(store);
  while (dates.length > CAP) delete store[dates.shift()]; // drop the oldest
  save(K.editionsCache, store);
}

export function loadEdition(date) {
  if (!date) return null;
  const store = load(K.editionsCache, {}) || {};
  return store[date] ?? null;
}
