import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchEdition, fetchIndex, primeEdition } from "../api/client.js";
import { normalizeEdition, normalizeIndex, summarize } from "../api/normalize.js";
import { K } from "../defaults.js";
import { load, save } from "./storage.js";

/**
 * Owns the archive manifest and the currently open edition.
 *
 * One fetch for the manifest, then one fetch per edition actually opened. If the wire is down we
 * fall back to the last manifest and edition we cached — the paper still prints, just yesterday's.
 * Hand-imported editions (The Desk) live in localStorage and shadow anything of the same date.
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
    if (current?.date === targetDate) return;

    const local = importedByDate.get(targetDate);
    if (local) {
      setCurrent(local);
      return;
    }

    wanted.current = targetDate;
    setEditionLoading(true);
    fetchEdition(targetDate)
      .then((raw) => {
        if (wanted.current !== targetDate) return; // a newer request won
        const ed = normalizeEdition(raw);
        if (!ed) throw new Error("edition JSON did not match the contract");
        save(K.editionCache, ed);
        setCurrent(ed);
        setStale(false);
        setError((e) => (e?.scope === "edition" ? null : e));
      })
      .catch((err) => {
        if (wanted.current !== targetDate) return;
        const cached = normalizeEdition(load(K.editionCache, null));
        if (cached) {
          setCurrent(cached);
          setStale(true);
        }
        setError({ scope: "edition", message: err.message, cached: !!cached });
      })
      .finally(() => {
        if (wanted.current === targetDate) setEditionLoading(false);
      });
  }, [targetDate, current?.date, importedByDate]);

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
    retry,
    importEditions,
    clearImported,
    importedCount: imported.length,
  };
}
