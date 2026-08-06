import { archiveDate } from "../format.js";

/**
 * "Past snapshots / past sheets" under the market tables. Built from the manifest summary fields
 * so the tab costs one fetch, not one per edition; when an older manifest lacks them we still
 * offer the row, just without the one-line summary.
 */
const FLAG = { stocks: "hasStocks", options: "hasOptions", movies: "hasMovies" };
const NOUN = { stocks: "picks tracked", options: "directional ideas", movies: "dated releases" };
const HEADING = { stocks: "snapshots", options: "sheets", movies: "calendars" };
const EMPTY = { stocks: "Stocks snapshot", options: "Options sheet", movies: "Release calendar" };

export default function SnapshotList({ entries, currentDate, kind, onOpen }) {
  const past = entries.filter((e) => e.date !== currentDate && e[FLAG[kind]]);
  if (!past.length) return null;

  const noun = NOUN[kind];

  return (
    <div className="dc-snaps">
      <div className="dc-section-h">
        <span>Past {HEADING[kind]}</span>
      </div>
      <ul className="dc-arch">
        {past.map((e) => {
          const s = e[kind];
          const parts = [];
          parts.push(s?.count != null ? `${s.count} ${noun}` : EMPTY[kind]);
          if (s?.lean) parts.push(`lean ${s.lean}`);
          if (s?.highConviction?.length) {
            parts.push(kind === "movies" ? s.highConviction.join(", ") : `${s.highConviction.join(", ")} high-conviction`);
          }
          return (
            <li key={e.date}>
              <button onClick={() => onOpen(e.date)}>
                <span className="d">{archiveDate(e.date)}</span>
                <h4 style={{ fontSize: 17 }}>{parts.join(" · ")}</h4>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
