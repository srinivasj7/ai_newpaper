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
  const [needsUnlock, setNeedsUnlock] = useState(false);

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
    ).then((results) => {
      save(K.outbox, left);
      // Locked, not offline: the queue is intact but no amount of retrying will empty it, so
      // say so rather than flushing silently into a wall on every load.
      if (results.some((r) => r.status === "rejected" && r.reason?.unauthorized)) setNeedsUnlock(true);
    });
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
      postFeedback(event).catch((err) => {
        // The vote still shows locally either way. A 401 is queued too — unlock, reload, and it
        // flushes — but it also raises the dialog, because otherwise the vote looks recorded
        // when nothing has left the browser.
        save(K.outbox, [...load(K.outbox, []), event]);
        if (err?.unauthorized) setNeedsUnlock(true);
      });
      return next;
    });
  }, []);

  const clearNeedsUnlock = useCallback(() => setNeedsUnlock(false), []);

  return { feedback, vote, needsUnlock, clearNeedsUnlock };
}
