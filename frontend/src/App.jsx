import { useCallback, useState } from "react";
import "./styles/theme.css";
import ErrorBanner from "./components/ErrorBanner.jsx";
import ArchiveView from "./views/ArchiveView.jsx";
import DeskView from "./views/DeskView.jsx";
import EditionView from "./views/EditionView.jsx";
import OptionsView from "./views/OptionsView.jsx";
import StocksView from "./views/StocksView.jsx";
import { useConfig } from "./state/useConfig.js";
import { useEditions } from "./state/useEditions.js";
import { useFeedback } from "./state/useFeedback.js";
import { todayShort } from "./format.js";

const TABS = [
  ["today", "Today's Edition"],
  ["stocks", "Stocks"],
  ["options", "Options"],
  ["archive", "Archive"],
  ["desk", "The Desk"],
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
          <p className="dc-mast-sub">Three models write · one judge decides · you get the paper</p>
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
          <p className="dc-empty">Setting the type…</p>
        ) : (
          <>
            {view === "today" &&
              (current ? (
                <EditionView edition={current} config={config} feedback={feedback} onVote={onVote} />
              ) : (
                <p className="dc-empty">{editionLoading ? "Setting the type…" : "No edition to print yet."}</p>
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
          </>
        )}

        <footer className="dc-foot">
          {entries.length} feed briefs · {stocksCount} stock snapshots · {optionsCount} options sheets · auto-generated ·
          multi-model pipeline · AI research, not investment advice
        </footer>
      </div>
    </div>
  );
}
