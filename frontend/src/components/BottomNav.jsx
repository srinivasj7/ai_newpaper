/*
 * The section rail as a fixed bottom tab bar on phones (see the @media block in theme.css — this is
 * hidden on desktop, where the top .dc-nav shows instead). Same sections, same order, same view
 * keys as the top nav; App renders both and CSS chooses which is visible.
 *
 * Icons are inline SVG in the house style (16-view, currentColor, aria-hidden), so they follow the
 * theme and the active tint with no extra rules — matching HeaderTools.
 */

const common = {
  viewBox: "0 0 16 16",
  width: 20,
  height: 20,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.3,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
};

const ICONS = {
  // Front Page — a newspaper.
  today: (
    <svg {...common}>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1" />
      <line x1="4.6" y1="6" x2="8" y2="6" />
      <line x1="4.6" y1="8.2" x2="11.4" y2="8.2" />
      <line x1="4.6" y1="10.3" x2="11.4" y2="10.3" />
    </svg>
  ),
  // Equities — a rising line.
  stocks: (
    <svg {...common}>
      <polyline points="2.5 11 6 7.5 9 9.5 13.5 4.5" />
      <polyline points="10 4.5 13.5 4.5 13.5 8" />
    </svg>
  ),
  // Options — candlesticks.
  options: (
    <svg {...common}>
      <line x1="5" y1="2.8" x2="5" y2="13.2" />
      <rect x="3.6" y="5.2" width="2.8" height="4.4" />
      <line x1="11" y1="2.8" x2="11" y2="13.2" />
      <rect x="9.6" y="6.9" width="2.8" height="4.4" />
    </svg>
  ),
  // Archive — a storage box.
  archive: (
    <svg {...common}>
      <rect x="2.5" y="5" width="11" height="7.5" rx="0.8" />
      <rect x="2" y="3.2" width="12" height="2.6" rx="0.6" />
      <line x1="6.4" y1="8.7" x2="9.6" y2="8.7" />
    </svg>
  ),
  // Settings — sliders (knobs filled with the paper colour so the track reads through).
  desk: (
    <svg {...common}>
      <line x1="2.5" y1="4.5" x2="13.5" y2="4.5" />
      <line x1="2.5" y1="8" x2="13.5" y2="8" />
      <line x1="2.5" y1="11.5" x2="13.5" y2="11.5" />
      <circle cx="6" cy="4.5" r="1.6" fill="var(--paper)" />
      <circle cx="10.5" cy="8" r="1.6" fill="var(--paper)" />
      <circle cx="5" cy="11.5" r="1.6" fill="var(--paper)" />
    </svg>
  ),
  // Movies — a play button.
  movies: (
    <svg {...common}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M6.7 5.4 L11 8 L6.7 10.6 Z" fill="currentColor" stroke="none" />
    </svg>
  ),
};

export default function BottomNav({ tabs, view, onSelect }) {
  return (
    <nav className="dc-bottomnav" aria-label="Sections">
      {tabs.map(([k, label]) => (
        <button
          key={k}
          type="button"
          className={view === k ? "on" : ""}
          aria-current={view === k}
          onClick={() => onSelect(k)}
        >
          <span className="ico">{ICONS[k]}</span>
          <span className="lbl">{label}</span>
        </button>
      ))}
    </nav>
  );
}
