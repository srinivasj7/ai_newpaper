import { Fragment, useState } from "react";
import SnapshotList from "../components/SnapshotList.jsx";

/**
 * The release calendar. Structurally the market pages' twin — a scrollable table with a sticky
 * first column and tap-to-expand rows — because it answers the same shape of question: a list
 * of things, each with a date and a reason.
 */

const STATUS_LABEL = {
  confirmed: "confirmed",
  delayed: "delayed",
  moved: "moved",
  rumoured: "rumoured",
  released: "out now",
};

// Only two of these carry meaning worth colouring: a delay is bad news for a viewer waiting,
// a confirmed date is good. The rest stay neutral.
const STATUS_CLASS = {
  confirmed: "bullish",
  released: "bullish",
  delayed: "bearish",
  moved: "neutral",
  rumoured: "neutral",
};

const WINDOW_LABEL = {
  theatrical: "In cinemas",
  streaming: "Streaming",
  both: "Cinemas + streaming",
  festival: "Festival",
};

export default function MoviesView({ edition, entries, onOpenDate }) {
  const [open, setOpen] = useState(null);
  const movies = edition?.movies;

  if (!movies) {
    return (
      <>
        <p className="dc-empty">This edition contains no release calendar.</p>
        <SnapshotList entries={entries} currentDate={edition?.date} kind="movies" onOpen={onOpenDate} />
      </>
    );
  }

  return (
    <div>
      <div className="dc-mkt-head">
        <h2>Release Calendar</h2>
        <span className="tag">{movies.updated}</span>
      </div>

      {movies.summary && <p className="dc-movie-summary">{movies.summary}</p>}

      {movies.releases.length === 0 ? (
        <p className="dc-empty">No release dates moved today.</p>
      ) : (
        <>
          <p className="hint" style={{ fontStyle: "italic", color: "var(--ink-soft)", marginBottom: 10 }}>
            Dates as announced, at the precision they were announced. Select a row for what changed.
          </p>
          <div className="dc-tablewrap">
            <table className="dc-tab">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Studio</th>
                  <th>Date</th>
                  <th>Where</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {movies.releases.map((r, i) => {
                  const key = `${r.title}-${i}`;
                  return (
                    <Fragment key={key}>
                      <tr className="dc-exp-toggle" onClick={() => setOpen(open === key ? null : key)}>
                        <td className="tick">{r.title}</td>
                        <td>{r.studio || "—"}</td>
                        <td className="num">{r.date || "TBA"}</td>
                        <td>{WINDOW_LABEL[r.window] || r.window}</td>
                        <td>
                          <span className={`dc-conv ${r.status === "confirmed" ? "high" : r.status === "rumoured" ? "low" : ""}`}>
                            {STATUS_LABEL[r.status] || r.status}
                          </span>
                        </td>
                      </tr>
                      {open === key && (
                        <tr className="dc-exp">
                          <td colSpan={5}>
                            <span className="why">{r.note}</span>{" "}
                            {r.sourceUrl && (
                              <a href={r.sourceUrl} target="_blank" rel="noreferrer">
                                source ↗
                              </a>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="dc-mkt-note">
        Release dates are reported by studios and trade press and change often. Machine-generated
        from the day's headlines and unverified — check the linked source before making plans.
      </p>

      <SnapshotList entries={entries} currentDate={edition.date} kind="movies" onOpen={onOpenDate} />
    </div>
  );
}
