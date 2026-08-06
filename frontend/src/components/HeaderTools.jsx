import { ageLabel, daysOld, shortDate } from "../format.js";

/* Both URLs are account-specific and stay out of the repo, the same way the contact link on the
   Terms page does. Unset simply hides that control. */
const OWNER_URL = import.meta.env.VITE_SITE_OWNER_URL ?? null;
const REPO_URL = import.meta.env.VITE_REPO_URL ?? null;

const THEME_GLYPH = { auto: "◐", light: "☀", dark: "☾" };
const THEME_TITLE = { auto: "Theme: follows your system", light: "Theme: light", dark: "Theme: dark" };

/** A paper is meant to arrive daily; two days without one is the reader's cue that it stopped. */
const STALE_AFTER_DAYS = 2;

/*
 * Inline SVG rather than an icon font or a sprite: two glyphs do not justify a dependency, and
 * `currentColor` makes them follow the theme with no extra rules. aria-hidden on the art, the
 * accessible name on the control itself.
 */
function PersonIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <circle cx="8" cy="5" r="3" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.5 14c0-3 2.5-4.6 5.5-4.6s5.5 1.6 5.5 4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
      />
    </svg>
  );
}

/**
 * The utility rail in the masthead: how fresh the paper is, then the controls.
 *
 * Deliberately quiet — mono, small, low-contrast. Nothing here is content, and it should never
 * compete with the nameplate directly beneath it.
 */
export default function HeaderTools({ editionDate, theme, onCycleTheme, unlocked, onLockClick }) {
  const stale = editionDate ? daysOld(editionDate) >= STALE_AFTER_DAYS : false;

  return (
    <div className="dc-tools">
      {editionDate && (
        <span className={`dc-fresh${stale ? " stale" : ""}`} title={`Latest edition: ${shortDate(editionDate)}`}>
          <i className="dot" aria-hidden="true" />
          {ageLabel(editionDate)}
        </span>
      )}

      <button
        type="button"
        className="dc-tool"
        onClick={onCycleTheme}
        title={THEME_TITLE[theme]}
        aria-label={THEME_TITLE[theme]}
      >
        <span aria-hidden="true">{THEME_GLYPH[theme]}</span>
      </button>

      <button
        type="button"
        className={`dc-tool${unlocked ? " on" : ""}`}
        onClick={onLockClick}
        title={unlocked ? "Editing unlocked — click to lock" : "Locked — click to unlock editing"}
        aria-label={unlocked ? "Editing unlocked. Lock it." : "Editing locked. Unlock it."}
      >
        <span aria-hidden="true">{unlocked ? "🔓" : "🔒"}</span>
      </button>

      {REPO_URL && (
        <a className="dc-tool" href={REPO_URL} target="_blank" rel="noopener noreferrer" title="Source code on GitHub">
          <GitHubIcon />
          <span className="sr-only">Source code on GitHub</span>
        </a>
      )}

      {OWNER_URL && (
        <a className="dc-tool" href={OWNER_URL} target="_blank" rel="noopener noreferrer" title="About the author">
          <PersonIcon />
          <span className="sr-only">About the author</span>
        </a>
      )}
    </div>
  );
}
