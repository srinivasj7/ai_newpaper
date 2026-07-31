import { Fragment, useState } from "react";
import SnapshotList from "../components/SnapshotList.jsx";

const DIR_ICON = { bull: "▲", bear: "▼", vol: "◆" };
const DIR_CLASS = { bull: "bullish", bear: "bearish", vol: "neutral" };

const rationale = (direction) =>
  direction === "vol"
    ? "Profits from a large move in either direction; loses to time decay if the underlying stays put."
    : direction === "bear"
      ? "Defined-risk bet the underlying falls toward the lower strike by expiry."
      : "Thesis-driven upside exposure keyed to the stocks pipeline's 12m midpoint.";

export default function OptionsView({ edition, entries, onOpenDate }) {
  const [open, setOpen] = useState(null);
  const ideas = edition?.options?.ideas;
  if (!ideas) {
    return (
      <>
        <p className="dc-empty">No options sheet in this edition.</p>
        <SnapshotList entries={entries} currentDate={edition?.date} kind="options" onOpen={onOpenDate} />
      </>
    );
  }

  return (
    <div>
      <div className="dc-mkt-head">
        <h2>Directional Ideas</h2>
        <span className="tag">{edition.options.updated}</span>
      </div>
      <div className="dc-tablewrap">
        <table className="dc-tab">
          <thead>
            <tr>
              <th>#</th>
              <th>Ticker</th>
              <th>Strategy</th>
              <th>Dir</th>
              <th>DTE</th>
              <th>Spot</th>
              <th>Strike (framing)</th>
              <th>Max loss</th>
              <th>Aggressive case</th>
              <th>Prob</th>
            </tr>
          </thead>
          <tbody>
            {ideas.map((o, i) => (
              <Fragment key={`${o.ticker}-${o.strategy}-${i}`}>
                <tr className="dc-exp-toggle" onClick={() => setOpen(open === i ? null : i)}>
                  <td className="num">{i + 1}</td>
                  <td className="tick">
                    {o.ticker}
                    <small>{o.company}</small>
                  </td>
                  <td>
                    {o.strategy}
                    <div
                      style={{
                        fontFamily: "var(--label)",
                        fontSize: 10.5,
                        letterSpacing: ".1em",
                        textTransform: "uppercase",
                        color: "var(--ink-soft)",
                      }}
                    >
                      {o.tag}
                    </div>
                  </td>
                  <td className={`dc-sent ${DIR_CLASS[o.direction]}`}>
                    {DIR_ICON[o.direction]} {o.direction}
                  </td>
                  <td className="num">{o.dte != null ? `~${o.dte}` : "—"}</td>
                  <td className="num">{o.spot != null ? `$${o.spot.toFixed(2)}` : "—"}</td>
                  <td className="num">{o.framing}</td>
                  <td className="num">{o.maxLoss}</td>
                  <td className="num pos">{o.aggressiveCase}</td>
                  <td className="num">{o.probability}</td>
                </tr>
                {open === i && (
                  <tr className="dc-exp">
                    <td colSpan={10}>
                      <span className="why">
                        {rationale(o.direction)} Max loss for long options is 100% of premium. Verify live premiums before
                        acting.
                      </span>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dc-mkt-note">
        Aggressive-case multiples are hypothetical, model-derived best cases — low probability, not expected returns.
        Premiums and strikes are approximations; verify live. Not investment advice.
      </p>
      <SnapshotList entries={entries} currentDate={edition.date} kind="options" onOpen={onOpenDate} />
    </div>
  );
}
