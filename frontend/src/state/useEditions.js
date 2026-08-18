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
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState(null); // transient: 'updated' | 'current' | 'offline'
  const noteTimer = useRef(null);
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
        // The attempt failed — clear the de-dupe guard so re-running this effect (e.g. an unrelated
        // dependency changing identity) tries the network again rather than sitting on the cache.
        lastFetch.current = { date: null, reloads: -1 };
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

  const flashNote = useCallback((note) => {
    setRefreshNote(note);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setRefreshNote(null), 2200);
  }, []);

  // Apply a refresh: re-fetch the manifest. A newer date then advances the open edition through the
  // edition effect below. A data refresh, never a page reload — scroll and app state are kept — and
  // it reports the outcome so the ↻ control can show a spinner then "updated" / "up to date".
  const refresh = useCallback(async () => {
    setRefreshing(true);
    setUpdateAvailable(false);
    try {
      const list = normalizeIndex(await fetchIndex());
      save(K.indexCache, list);
      const prev = latestKnownRef.current?.date ?? null;
      setEntries(list);
      setStale(false);
      setError(null);
      const next = list[0]?.date ?? null;
      flashNote(next && next !== prev ? "updated" : "current");
    } catch {
      flashNote("offline");
    } finally {
      setRefreshing(false);
    }
  }, [flashNote]);

  // A cheap check — the manifest only — for an edition newer than the one we hold. It raises a
  // banner rather than yanking the reader mid-read; refresh() (the banner, or the masthead button)
  // applies it. Fails quietly when offline.
  const checkForUpdate = useCallback(async () => {
    try {
      const list = normalizeIndex(await fetchIndex());
      const latest = list[0];
      const known = latestKnownRef.current;
      const isNew =
        latest &&
        (!known ||
          latest.date > known.date ||
          (latest.date === known.date && (latest.edition ?? 0) !== (known.edition ?? 0)));
      if (isNew) setUpdateAvailable(true);
    } catch {
      /* offline or transient — the check just no-ops */
    }
  }, []);

  // Reconnecting heals a cached copy straight to fresh; returning to the foreground checks cheaply
  // and raises the banner if a newer edition exists. Neither reloads the page.
  useEffect(() => {
    if (!prevOnline.current && online) refresh();
    prevOnline.current = online;
  }, [online, refresh]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && checkForUpdate();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [checkForUpdate]);

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
    updateAvailable,
    refreshing,
    refreshNote,
    retry,
    refresh,
    importEditions,
    clearImported,
    importedCount: imported.length,
  };
}
