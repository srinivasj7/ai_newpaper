import { archiveDate } from "../format.js";

/**
 * "Past snapshots / past sheets" under the market tables. Built from the manifest summary fields
 * so the tab costs one fetch, not one per edition; when an older manifest lacks them we still
 * offer the row, just without the one-line summary.
 */
export default function SnapshotList({ entries, currentDate, kind, onOpen }) {
  const flag = kind === "stocks" ? "hasStocks" : "hasOptions";
  const past = entries.filter((e) => e.date !== currentDate && e[flag]);
  if (!past.length) return null;

  const noun = kind === "stocks" ? "picks tracked" : "directional ideas";

  return (
    <div className="dc-snaps">
      <div className="dc-section-h">
        <span>Past {kind === "stocks" ? "snapshots" : "sheets"}</span>
      </div>
      <ul className="dc-arch">
        {past.map((e) => {
          const s = e[kind];
          const parts = [];
          parts.push(s?.count != null ? `${s.count} ${noun}` : kind === "stocks" ? "Stocks snapshot" : "Options sheet");
          if (s?.lean) parts.push(`lean ${s.lean}`);
          if (s?.highConviction?.length) parts.push(`${s.highConviction.join(", ")} high-conviction`);
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
