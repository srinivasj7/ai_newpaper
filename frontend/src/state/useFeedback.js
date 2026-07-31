import { useCallback, useEffect, useState } from "react";
import { postFeedback } from "../api/client.js";
import { K } from "../defaults.js";
import { load, save } from "./storage.js";

/**
 * Keep / spike votes. The UI is optimistic and local-first; each vote also fires one event object
 * at /api/feedback. Failures park in an outbox and flush on the next load — the pipeline reads
 * the latest event per storyId, so a late delivery is harmless.
 *
 * Clicking the active vote again clears it locally only: the contract has no "unvote" event.
 */
export function useFeedback() {
  const [feedback, setFeedback] = useState(() => load(K.feedback, {}));

  useEffect(() => {
    const outbox = load(K.outbox, []);
    if (!outbox.length) return;
    let left = outbox;
    Promise.allSettled(
      outbox.map((event) =>
        postFeedback(event).then(() => {
          left = left.filter((e) => e !== event);
        }),
      ),
    ).then(() => save(K.outbox, left));
  }, []);

  const vote = useCallback((story, choice, editionDate) => {
    setFeedback((prev) => {
      const next = { ...prev };
      if (next[story.id]?.vote === choice) {
        delete next[story.id];
        save(K.feedback, next);
        return next;
      }
      const event = {
        storyId: story.id,
        vote: choice,
        topic: story.topic,
        model: story.model,
        editionDate: editionDate ?? null,
        at: new Date().toISOString(),
      };
      next[story.id] = event;
      save(K.feedback, next);
      postFeedback(event).catch(() => save(K.outbox, [...load(K.outbox, []), event]));
      return next;
    });
  }, []);

  return { feedback, vote };
}
