import { Fragment, useState } from "react";
import Pct, { SENT_ICON } from "../components/Pct.jsx";
import SnapshotList from "../components/SnapshotList.jsx";

const HORIZONS = ["3m", "6m", "12m", "18m", "24m"];

export default function StocksView({ edition, entries, onOpenDate }) {
  const [open, setOpen] = useState(null);
  const picks = edition?.stocks?.picks;
  if (!picks) {
    return (
      <>
        <p className="dc-empty">This edition contains no equities snapshot.</p>
        <SnapshotList entries={entries} currentDate={edition?.date} kind="stocks" onOpen={onOpenDate} />
      </>
    );
  }

  return (
    <div>
      <div className="dc-mkt-head">
        <h2>Equities &amp; Scenario Ranges</h2>
        <span className="tag">{edition.stocks.updated}</span>
      </div>
      <p className="hint" style={{ fontStyle: "italic", color: "var(--ink-soft)", marginBottom: 10 }}>
        Model-projected midpoints under stated assumptions. Select a row for the stated rationale and its source.
      </p>
      <div className="dc-tablewrap">
        <table className="dc-tab">
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Sector</th>
              <th>Price</th>
              {HORIZONS.map((h) => (
                <th key={h}>{h.toUpperCase()}</th>
              ))}
              <th>Conv.</th>
              <th>Sent.</th>
            </tr>
          </thead>
          <tbody>
            {picks.map((p, i) => {
              const key = `${p.ticker}-${i}`;
              return (
                <Fragment key={key}>
                  <tr className="dc-exp-toggle" onClick={() => setOpen(open === key ? null : key)}>
                    <td className="tick">
                      {p.ticker}
                      <small>{p.company}</small>
                    </td>
                    <td>{p.sector}</td>
                    <td className="num">{p.price != null ? `$${p.price.toFixed(2)}` : "—"}</td>
                    {HORIZONS.map((h) => (
                      <td key={h}>
                        <Pct v={p.scenarios[h]} />
                      </td>
                    ))}
                    <td>
                      <span className={`dc-conv ${p.conviction}`}>{p.conviction}</span>
                    </td>
                    <td className={`dc-sent ${p.sentiment}`}>
                      {SENT_ICON[p.sentiment] || ""} {p.sentiment}
                    </td>
                  </tr>
                  {open === key && (
                    <tr className="dc-exp">
                      <td colSpan={HORIZONS.length + 5}>
                        <span className="why">{p.reason}</span>{" "}
                        {p.sourceUrl && (
                          <a href={p.sourceUrl} target="_blank" rel="noreferrer">
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
      <p className="dc-mkt-note">
        Speculative, machine-generated scenarios produced under stated assumptions. They are not forecasts, price
        targets, valuations, or guarantees, and they have not been reviewed by a person. Not investment advice.
      </p>
      <SnapshotList entries={entries} currentDate={edition.date} kind="stocks" onOpen={onOpenDate} />
    </div>
  );
}
