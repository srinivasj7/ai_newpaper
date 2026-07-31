import { useCallback, useMemo } from "react";
import Story from "../components/Story.jsx";
import { longDate } from "../format.js";

export default function EditionView({ edition, config, feedback, onVote }) {
  const topicLabel = useCallback(
    (slug) => config.topics.find((t) => t.slug === slug)?.label || slug?.toUpperCase() || "GENERAL",
    [config.topics],
  );

  const grouped = useMemo(() => {
    const enabled = new Set(config.topics.filter((t) => t.enabled).map((t) => t.slug));
    const g = {};
    for (const s of edition.stories) {
      if (s.topic && enabled.size && !enabled.has(s.topic)) continue;
      (g[s.topic || "general"] ||= []).push(s);
    }
    return g;
  }, [edition, config.topics]);

  return (
    <div>
      <div className="dc-edhead">
        <span>
          <b>{longDate(edition.date)}</b>
        </span>
        <span>
          No. {edition.edition} · judged by {edition.pipeline.judge || "—"}
        </span>
      </div>

      {/* The lead prints regardless of topic filters — it's the lead. */}
      {edition.lead && (
        <Story lead story={edition.lead} topicLabel={topicLabel(edition.lead.topic)} feedback={feedback} onVote={onVote} />
      )}

      {Object.entries(grouped).map(([slug, stories]) => (
        <section key={slug}>
          <div className="dc-section-h">
            <span>{topicLabel(slug)}</span>
          </div>
          <div className="dc-grid">
            {stories.map((s) => (
              <Story key={s.id} story={s} topicLabel={topicLabel(slug)} feedback={feedback} onVote={onVote} />
            ))}
          </div>
        </section>
      ))}

      {edition.stories.length === 0 && (
        <p className="dc-empty">This edition contains no stories beyond the lead.</p>
      )}
    </div>
  );
}
