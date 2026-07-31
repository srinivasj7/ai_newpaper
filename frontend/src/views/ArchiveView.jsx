import { archiveDate } from "../format.js";

/** Renders from the manifest alone — no per-edition fetch until a row is opened. */
export default function ArchiveView({ entries, onOpen }) {
  if (!entries.length) return <p className="dc-empty">No editions have been published yet.</p>;
  return (
    <ul className="dc-arch">
      {entries.map((e) => (
        <li key={e.date}>
          <button onClick={() => onOpen(e.date)}>
            <span className="d">
              {archiveDate(e.date)} · No. {e.edition}
            </span>
            <h4>{e.leadHeadline}</h4>
            <span className="m">
              {e.storyCount != null ? `${e.storyCount} ${e.storyCount === 1 ? "story" : "stories"}` : "edition"}
              {e.candidateCount != null ? ` · ${e.candidateCount} models evaluated` : ""}
              {e.hasStocks && e.stocks?.count != null ? ` · ${e.stocks.count} stock picks` : e.hasStocks ? " · stocks" : ""}
              {e.hasOptions && e.options?.count != null
                ? ` · ${e.options.count} option ideas`
                : e.hasOptions
                  ? " · options"
                  : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
