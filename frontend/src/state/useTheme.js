import { useCallback, useEffect, useState } from "react";
import { K } from "../defaults.js";
import { load, save } from "./storage.js";

export const THEMES = ["auto", "light", "dark"];

const media = () => globalThis.matchMedia?.("(prefers-color-scheme: dark)");

/**
 * Light, dark, or follow the system.
 *
 * Only ever two values reach the CSS: the resolved one is stamped on <html data-theme>, so the
 * stylesheet needs a single dark block rather than that block plus a media-query copy of it.
 * `color-scheme` is set alongside it, which is what makes scrollbars, form controls and the
 * space beyond the page follow the theme instead of staying stubbornly white.
 */
export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const saved = load(K.theme, "auto");
    return THEMES.includes(saved) ? saved : "auto";
  });
  const [systemDark, setSystemDark] = useState(() => media()?.matches ?? false);

  useEffect(() => {
    const mq = media();
    if (!mq) return;
    const onChange = (e) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const resolved = theme === "auto" ? (systemDark ? "dark" : "light") : theme;

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", resolved);
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setTheme = useCallback((next) => {
    setThemeState(next);
    save(K.theme, next);
  }, []);

  /** The header control is one button, so it cycles rather than opening a menu. */
  const cycleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = THEMES[(THEMES.indexOf(prev) + 1) % THEMES.length];
      save(K.theme, next);
      return next;
    });
  }, []);

  return { theme, resolved, setTheme, cycleTheme };
}
