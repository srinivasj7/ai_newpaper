import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchEdition, fetchIndex, primeEdition } from "../api/client.js";
import { normalizeEdition, normalizeIndex, summarize } from "../api/normalize.js";
import { K } from "../defaults.js";
import { load, save } from "./storage.js";
import { loadEdition, saveEdition } from "./editionsCache.js";
import { useOnline } from "./useOnline.js";

/**
 * Owns the archive manifest and the currently open edition.
 *
 * One fetch for the manifest, then one fetch per edition actually opened. If the wire is down we
 * fall back to the last manifest and to the per-date edition cache — the paper still prints, just
 * the saved copy. Hand-imported editions (The Desk) live in localStorage and shadow anything of the
 * same date. Coming back online refetches both, so a stale copy heals itself.
 */
export function useEditions() {
  const [entries, setEntries] = useState([]);
  const [imported, setImported] = useState(() => load(K.imported, []).map(normalizeEdition).filter(Boolean));
  const [current, setCurrent] = useState(null);
  const [openDate, setOpenDate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editionLoading, setEditionLoading] = useState(false);
  const [error, setError] = useState(null);
  const [stale, setStale] = useState(false);
  const [reloads, setReloads] = useState(0);
  const wanted = useRef(null);
  const lastFetch = useRef({ date: null, reloads: -1 });

  const online = useOnline();
  const prevOnline = useRef(online);

  const [updateAvailable, setUpdateAvailable] = useState(false);
  // The newest edition we currently hold, read inside callbacks without re-subscribing them.
  const latestKnownRef = useRef(null);
  useEffect(() => {
    latestKnownRef.current = entries[0] ?? null;
  }, [entries]);

  const importedByDate = useMemo(() => new Map(imported.map((e) => [e.date, e])), [imported]);

  // Manifest: network first, cache second.
  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchIndex()
      .then((raw) => {
        if (!live) return;
        const list = normalizeIndex(raw);
        save(K.indexCache, list);
        setEntries(list);
        setStale(false);
        setError(null);
      })
      .catch((err) => {
        if (!live) return;
        const cached = normalizeIndex(load(K.indexCache, []));
        setEntries(cached);
        setStale(cached.length > 0);
        setError({ scope: "index", message: err.message, cached: cached.length > 0 });
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [reloads]);

  // Imported editions are already in hand — seed the fetch cache so opening them is instant.
  useEffect(() => {
    for (const ed of imported) primeEdition(ed.date, ed);
  }, [imported]);

  const merged = useMemo(() => {
    const byDate = new Map(entries.map((e) => [e.date, e]));
    for (const ed of imported) byDate.set(ed.date, summarize(ed)); // imports win
    return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [entries, imported]);

  const targetDate = openDate ?? merged[0]?.date ?? null;

  // The open edition.
  useEffect(() => {
    if (!targetDate) {
      setCurrent(null);
      return;
    }

    const local = importedByDate.get(targetDate);
    if (local) {
      setCurrent(local);
      return;
    }

    // Don't refetch a date we already have unless a reload was explicitly asked for (retry or a
    // reconnect bumps `reloads`); switching tabs alone must not hit the network again.
    if (lastFetch.current.date === targetDate && lastFetch.current.reloads === reloads) return;
    lastFetch.current = { date: targetDate, reloads };

    wanted.current = targetDate;
    setEditionLoading(true);
    fetchEdition(targetDate)
      .then((raw) => {
        if (wanted.current !== targetDate) return; // a newer request won
        const ed = normalizeEdition(raw);
        if (!ed) throw new Error("edition JSON did not match the contract");
        saveEdition(ed.date, ed);
        setCurrent(ed);
        setStale(false);
        setError((e) => (e?.scope === "edition" ? null : e));
      })
      .catch((err) => {
        if (wanted.current !== targetDate) return;
        const cached = normalizeEdition(loadEdition(targetDate));
        if (cached) {
          setCurrent(cached);
          setStale(true);
        }
        setError({ scope: "edition", message: err.message, cached: !!cached });
      })
      .finally(() => {
        if (wanted.current === targetDate) setEditionLoading(false);
      });
  }, [targetDate, reloads, importedByDate]);

  // Reconnecting refetches the manifest and the open edition so a cached copy heals to fresh.
  useEffect(() => {
    if (!prevOnline.current && online) setReloads((n) => n + 1);
    prevOnline.current = online;
  }, [online]);

  const importEditions = useCallback((raws) => {
    const eds = raws.map(normalizeEdition).filter(Boolean);
    if (!eds.length) throw new Error("nothing importable in that JSON");
    setImported((prev) => {
      const next = [...prev.filter((p) => !eds.some((e) => e.date === p.date)), ...eds];
      save(K.imported, next);
      return next;
    });
    setOpenDate(eds[eds.length - 1].date);
    return eds;
  }, []);

  const clearImported = useCallback(() => {
    setImported([]);
    save(K.imported, []);
    setOpenDate(null);
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setReloads((n) => n + 1);
  }, []);

  return {
    entries: merged,
    current,
    currentDate: targetDate,
    openDate: setOpenDate,
    loading,
    editionLoading,
    error,
    stale,
    online,
    retry,
    importEditions,
    clearImported,
    importedCount: imported.length,
  };
}
