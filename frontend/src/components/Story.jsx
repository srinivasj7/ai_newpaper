import { useState } from "react";
import Colophon from "./Colophon.jsx";

/** The lead prints in full; everything else folds down to headline + dek until asked. */
export default function Story({ story, topicLabel, feedback, onVote, lead }) {
  const [open, setOpen] = useState(!!lead);
  const H = lead ? "h2" : "h3";
  return (
    <article className={lead ? "dc-lead" : "dc-story"}>
      {!lead && (
        <div className="dc-eyebrow">
          <span className="topic">{topicLabel}</span>
        </div>
      )}
      <H>{story.headline}</H>
      {story.dek && <p className="dek">{story.dek}</p>}
      {open && (
        <>
          <div className="dc-body">
            {story.body.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          {story.whyItMatters && (
            <div className="dc-wim">
              <b>Why it matters</b>
              {story.whyItMatters}
            </div>
          )}
        </>
      )}
      {!lead && story.body.length > 0 && (
        <button className="dc-more" onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : "Read more"}
        </button>
      )}
      <Colophon story={story} feedback={feedback} onVote={onVote} />
    </article>
  );
}
