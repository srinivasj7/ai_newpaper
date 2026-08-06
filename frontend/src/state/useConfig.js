import { useCallback, useEffect, useRef, useState } from "react";
import { fetchConfig, postConfig } from "../api/client.js";
import { normalizeConfig } from "../api/normalize.js";
import { DEFAULT_CONFIG, K } from "../defaults.js";
import { load, save } from "./storage.js";

const DEBOUNCE_MS = 800;

/**
 * The config is edited locally and pushed to the Lambda on a debounce — pill-tapping in The Desk
 * shouldn't fire a PUT per tap. Last write wins; bucket versioning is the undo. If the API is
 * unreachable the edits still stick locally and the export payload is the escape hatch.
 */
export function useConfig() {
  const [config, setConfigState] = useState(() => normalizeConfig(load(K.config, DEFAULT_CONFIG)));
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | failed | locked
  const timer = useRef(null);
  const pending = useRef(null);

  // Server config wins on load, unless we have never reached it.
  useEffect(() => {
    let live = true;
    fetchConfig()
      .then((raw) => {
        if (!live) return;
        const next = normalizeConfig(raw);
        setConfigState(next);
        save(K.config, next);
      })
      .catch(() => {
        /* keep whatever is in localStorage; the site is readable either way */
      });
    return () => {
      live = false;
    };
  }, []);

  const flush = useCallback(() => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setSaveState("saving");
    postConfig({ ...next, version: (next.version ?? 1) + 1, exportedAt: new Date().toISOString() })
      .then(() => setSaveState("saved"))
      // "Locked" is not "failed": the edit is intact locally and one unlock away from saving,
      // which is a different thing to tell someone than "the save broke".
      .catch((err) => setSaveState(err?.unauthorized ? "locked" : "failed"));
  }, []);

  const setConfig = useCallback(
    (next) => {
      setConfigState(next);
      save(K.config, next);
      pending.current = next;
      setSaveState("saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, DEBOUNCE_MS);
    },
    [flush],
  );

  // Don't lose an in-flight edit when the tab goes away.
  useEffect(() => {
    const onHide = () => {
      if (pending.current) {
        clearTimeout(timer.current);
        flush();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      clearTimeout(timer.current);
    };
  }, [flush]);

  return { config, setConfig, saveState };
}
