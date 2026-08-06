import { useCallback, useEffect, useState } from "react";
import "./styles/theme.css";
import ErrorBanner from "./components/ErrorBanner.jsx";
import HeaderTools from "./components/HeaderTools.jsx";
import UnlockDialog from "./components/UnlockDialog.jsx";
import ArchiveView from "./views/ArchiveView.jsx";
import DeskView from "./views/DeskView.jsx";
import DisclaimerView from "./views/DisclaimerView.jsx";
import MoviesView from "./views/MoviesView.jsx";
import EditionView from "./views/EditionView.jsx";
import OptionsView from "./views/OptionsView.jsx";
import StocksView from "./views/StocksView.jsx";
import { clearToken, getToken, onTokenChange } from "./api/token.js";
import { useConfig } from "./state/useConfig.js";
import { useEditions } from "./state/useEditions.js";
import { useFeedback } from "./state/useFeedback.js";
import { useTheme } from "./state/useTheme.js";
import { todayShort } from "./format.js";

/** "1 edition", "3 editions" — the counts in the footer are user-visible prose, not debug output. */
const count = (n, noun) => `${n} ${n === 1 ? noun : `${noun}s`}`;

/* "Front Page" rather than "Current Edition": this section shows whichever edition is open,
   and an archive row opens into it — so a label that claims currency is wrong three days out
   of four. Front Page names what is on the page (the lead and the stories under it) and stays
   true for a back issue, which the edition header marks as one. */
const TABS = [
  ["today", "Front Page"],
  ["stocks", "Equities"],
  ["options", "Options"],
  ["archive", "Archive"],
  ["desk", "Settings"],
  ["movies", "Movies"],
];

export default function App() {
  const [view, setView] = useState("today");
  const { theme, cycleTheme } = useTheme();
  const [unlocked, setUnlocked] = useState(() => Boolean(getToken()));
  const [askUnlock, setAskUnlock] = useState(false);
  const { config, setConfig, saveState } = useConfig();
  const { feedback, vote, needsUnlock, clearNeedsUnlock } = useFeedback();
  const {
    entries,
    current,
    currentDate,
    openDate,
    loading,
    editionLoading,
    error,
    stale,
    retry,
    importEditions,
    clearImported,
    importedCount,
  } = useEditions();

  const onVote = useCallback((story, choice) => vote(story, choice, currentDate), [vote, currentDate]);

  // The token can also be set from the Settings panel, so the padlock follows the store rather
  // than owning the state.
  useEffect(() => onTokenChange((value) => setUnlocked(Boolean(value))), []);

  // A write came back 401 — the stored secret is gone or was never right. Ask, once.
  useEffect(() => {
    if (needsUnlock) {
      setAskUnlock(true);
      clearNeedsUnlock();
    }
  }, [needsUnlock, clearNeedsUnlock]);

  const onLockClick = useCallback(() => {
    if (getToken()) clearToken();
    else setAskUnlock(true);
  }, []);

  const openEdition = useCallback(
    (date) => {
      openDate(date);
      setView("today");
    },
    [openDate],
  );

  const onImport = useCallback(
    (raws) => {
      const kept = importEditions(raws);
      setView("today");
      return kept;
    },
    [importEditions],
  );

  const stocksCount = entries.filter((e) => e.hasStocks).length;
  const optionsCount = entries.filter((e) => e.hasOptions).length;

  return (
    <div className="dc-root">
      <div className="dc-shell">
        <header className="dc-mast">
          <div className="dc-mast-top">
            <span>
              VOL. I · {entries.length} EDITION{entries.length === 1 ? "" : "S"}
            </span>
            <div className="dc-mast-right">
              <span className="dc-mast-date">{todayShort()}</span>
              <HeaderTools
                editionDate={entries[0]?.date ?? null}
                theme={theme}
                onCycleTheme={cycleTheme}
                unlocked={unlocked}
                onLockClick={onLockClick}
              />
            </div>
          </div>
          <h1>{config.briefName || "The Daily Compile"}</h1>
          <p className="dc-mast-sub">Automated multi-model research brief · machine-generated · unverified</p>
        </header>

        <nav className="dc-nav" aria-label="Sections">
          {TABS.map(([k, label]) => (
            <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)} aria-current={view === k}>
              {label}
            </button>
          ))}
        </nav>

        <ErrorBanner error={error} stale={stale} onRetry={retry} />

        {loading ? (
          <p className="dc-empty">Loading…</p>
        ) : (
          <>
            {view === "today" &&
              (current ? (
                <EditionView
                  edition={current}
                  config={config}
                  feedback={feedback}
                  onVote={onVote}
                  isLatest={!entries.length || current.date === entries[0].date}
                />
              ) : (
                <p className="dc-empty">{editionLoading ? "Loading…" : "No edition has been published yet."}</p>
              ))}
            {view === "stocks" && <StocksView edition={current} entries={entries} onOpenDate={openEdition} />}
            {view === "options" && <OptionsView edition={current} entries={entries} onOpenDate={openEdition} />}
            {view === "archive" && <ArchiveView entries={entries} onOpen={openEdition} />}
            {view === "desk" && (
              <DeskView
                config={config}
                setConfig={setConfig}
                saveState={saveState}
                unlocked={unlocked}
                onUnlock={() => setAskUnlock(true)}
                onLock={clearToken}
                feedback={feedback}
                onImport={onImport}
                importedCount={importedCount}
                onClearImported={clearImported}
              />
            )}
            {view === "movies" && (
              <MoviesView edition={current} entries={entries} onOpenDate={openDate} />
            )}
            {view === "legal" && <DisclaimerView />}
          </>
        )}

        <footer className="dc-foot">
          <div>
            {count(entries.length, "edition")} · {count(stocksCount, "equity snapshot")} ·{" "}
            {count(optionsCount, "options sheet")} · generated automatically by language models and published without
            human review
          </div>
          <div style={{ marginTop: 6 }}>
            Not investment advice. No warranty. See{" "}
            <button className="dc-footlink" onClick={() => setView("legal")}>
              Terms &amp; Disclaimer
            </button>
            <span className="sep">·</span>
            Not indexed; automated access and model training are not permitted
          </div>
        </footer>
      </div>

      <UnlockDialog open={askUnlock} onClose={() => setAskUnlock(false)} onUnlocked={() => setUnlocked(true)} />
    </div>
  );
}
