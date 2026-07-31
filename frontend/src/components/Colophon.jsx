/* Provenance line under every story: which model won, what the judge gave it, where it came
   from, and the two feedback buttons. The provider registry is open-ended — an id we've never
   seen renders generically rather than disappearing. */

const MODEL_META = {
  claude: { glyph: "glyph-claude", label: "CLAUDE" },
  gpt: { glyph: "glyph-gpt", label: "GPT" },
  grok: { glyph: "glyph-grok", label: "GROK" },
};

function sourceLabel(source) {
  if (source.title) return source.title;
  try {
    return new URL(source.url).hostname;
  } catch {
    return source.url;
  }
}

export default function Colophon({ story, feedback, onVote }) {
  const m = MODEL_META[story.model] || { glyph: "glyph-gpt", label: (story.model || "?").toUpperCase() };
  const vote = feedback[story.id]?.vote;
  return (
    <div className="dc-colophon">
      <span className="dc-model" title={`Winning model · judge score ${story.judgeScore ?? "—"}`}>
        <span className={`glyph ${m.glyph}`} /> {m.label}
        {story.judgeScore != null ? ` · ${story.judgeScore.toFixed(1)}` : ""}
      </span>
      {story.sentiment && (
        <span className={`dc-sent ${story.sentiment}`}>
          {story.sentiment === "bullish" ? "▲" : story.sentiment === "bearish" ? "▼" : "►"} {story.sentiment}
        </span>
      )}
      <span className="dc-src">
        {story.sources.map((s, i) => (
          <span key={s.url + i}>
            {i > 0 && " · "}
            <a href={s.url} target="_blank" rel="noreferrer">
              {sourceLabel(s)}
            </a>
          </span>
        ))}
      </span>
      <span className="dc-fb">
        <button
          className={vote === "keep" ? "on-keep" : ""}
          onClick={() => onVote(story, "keep")}
          aria-pressed={vote === "keep"}
        >
          More like this
        </button>
        <button
          className={vote === "spike" ? "on-spike" : ""}
          onClick={() => onVote(story, "spike")}
          aria-pressed={vote === "spike"}
        >
          Spike
        </button>
      </span>
    </div>
  );
}
