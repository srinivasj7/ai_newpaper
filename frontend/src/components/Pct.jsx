/** Scenario midpoint, green above zero and red below — semantic colour only. */
export default function Pct({ v }) {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  return (
    <span className={`num ${n > 0 ? "pos" : n < 0 ? "neg" : ""}`}>
      {n > 0 ? "+" : ""}
      {n}%
    </span>
  );
}

export const SENT_ICON = { bullish: "▲", bearish: "▼", neutral: "►" };
