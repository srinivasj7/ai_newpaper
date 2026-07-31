import { useCallback, useState } from "react";
import "./styles/theme.css";
import ErrorBanner from "./components/ErrorBanner.jsx";
import ArchiveView from "./views/ArchiveView.jsx";
import DeskView from "./views/DeskView.jsx";
import DisclaimerView from "./views/DisclaimerView.jsx";
import EditionView from "./views/EditionView.jsx";
import OptionsView from "./views/OptionsView.jsx";
import StocksView from "./views/StocksView.jsx";
import { useConfig } from "./state/useConfig.js";
import { useEditions } from "./state/useEditions.js";
import { useFeedback } from "./state/useFeedback.js";
import { todayShort } from "./format.js";

/** "1 edition", "3 editions" — the counts in the footer are user-visible prose, not debug output. */
const count = (n, noun) => `${n} ${n === 1 ? noun : `${noun}s`}`;

const TABS = [
  ["today", "Current Edition"],
  ["stocks", "Equities"],
  ["options", "Options"],
  ["archive", "Archive"],
  ["desk", "Settings"],
];

export default function App() {
  const [view, setView] = useState("today");
  const { config, setConfig, saveState } = useConfig();
  const { feedback, vote } = useFeedback();
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
            <span>{todayShort()}</span>
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
                <EditionView edition={current} config={config} feedback={feedback} onVote={onVote} />
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
                feedback={feedback}
                onImport={onImport}
                importedCount={importedCount}
                onClearImported={clearImported}
              />
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
    </div>
  );
}
