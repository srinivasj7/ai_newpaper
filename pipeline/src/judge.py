"""Choosing what goes to print.

With one candidate the judge is a pass-through: the sole writer's edition is the edition, and
`judgeScore` stays null rather than inventing a number nobody computed. With two or more, the
rubric in prompts/judge.md scores every story and the best version of each wins.

The switch between the two is the number of candidates that succeeded, not a code path anyone
has to remember to change.
"""

from __future__ import annotations

import json
import logging

from .adapters import Adapter, AdapterError
from .models import Edition, FeedbackTally, Story

log = logging.getLogger("judge")


def passthrough(candidate_id: str, edition: Edition) -> Edition:
    """Single-writer path: publish as written, attributed, unscored."""
    if edition.lead:
        edition.lead.model = candidate_id
        edition.lead.judge_score = None
    for story in edition.stories:
        story.model = candidate_id
        story.judge_score = None
    log.info("judge: pass-through (%s is the only candidate) — stories published unscored", candidate_id)
    return edition


def _payload(candidates: dict[str, Edition], feedback: FeedbackTally) -> str:
    entries = []
    for cid, edition in candidates.items():
        entries.append(
            {
                "candidate": cid,
                "lead": edition.lead.model_dump(by_alias=True, exclude_none=True) if edition.lead else None,
                "stories": [s.model_dump(by_alias=True, exclude_none=True) for s in edition.stories],
            }
        )
    return json.dumps(
        {"candidates": entries, "feedback": feedback.model_dump(by_alias=True)},
        ensure_ascii=False,
        indent=1,
    )


def adjudicate(
    adapter: Adapter | None,
    rubric: str,
    candidates: dict[str, Edition],
    feedback: FeedbackTally,
) -> Edition:
    """Score every candidate's stories and stitch the winners into one edition.

    With a single candidate, or no judge configured, this is the pass-through above.
    """
    if adapter is None or len(candidates) == 1:
        cid, edition = next(iter(candidates.items()))
        return passthrough(cid, edition)

    prompt = f"{rubric}\n\n## Candidates\n\n{_payload(candidates, feedback)}"
    try:
        verdict = adapter.complete_json(prompt)
    except AdapterError as e:
        # A judge that cannot be reached must not cost us the edition.
        first = next(iter(candidates))
        log.error("judge failed (%s) — falling back to the first candidate, %s", e, first)
        return passthrough(first, candidates[first])

    scores: dict[tuple[str, str, int], tuple[float, str]] = {}
    for row in verdict.get("scores", []):
        try:
            key = (row["candidate"], row["kind"], int(row["index"]))
            scores[key] = (float(row["score"]), str(row.get("note", "")))
        except (KeyError, TypeError, ValueError):
            continue

    def best(kind: str, index: int) -> tuple[str, Story, float | None] | None:
        ranked = []
        for cid, edition in candidates.items():
            story = edition.lead if kind == "lead" else (edition.stories[index] if index < len(edition.stories) else None)
            if story is None:
                continue
            score, _ = scores.get((cid, kind, index), (0.0, ""))
            ranked.append((score, cid, story))
        if not ranked:
            return None
        ranked.sort(key=lambda r: r[0], reverse=True)
        score, cid, story = ranked[0]
        return cid, story, (score if score > 0 else None)

    winner = Edition(date=next(iter(candidates.values())).date)

    lead_pick = best("lead", 0)
    if lead_pick:
        cid, story, score = lead_pick
        story.model, story.judge_score = cid, score
        winner.lead = story

    longest = max(len(e.stories) for e in candidates.values())
    for index in range(longest):
        pick = best("story", index)
        if not pick:
            continue
        cid, story, score = pick
        story.model, story.judge_score = cid, score
        winner.stories.append(story)

    log.info(
        "judge: chose from %d candidates — lead by %s, %d stories",
        len(candidates),
        winner.lead.model if winner.lead else "?",
        len(winner.stories),
    )
    return winner
