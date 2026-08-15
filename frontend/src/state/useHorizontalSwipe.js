import { useRef } from "react";

const THRESHOLD = 60; // px of horizontal travel before it counts as a swipe
const RATIO = 1.4; // horizontal must dominate vertical, so a diagonal scroll doesn't switch sections

/**
 * Touch handlers to spread onto a container. A mostly-horizontal swipe past the threshold calls
 * onNext (swipe left, i.e. move forward) or onPrev (swipe right). Gestures that begin inside a
 * horizontally scrollable element — the section rail, wide tables — are ignored so they keep
 * scrolling as intended. A tap has zero travel, so buttons inside still click normally.
 */
export function useHorizontalSwipe(onPrev, onNext) {
  const start = useRef(null);

  const onTouchStart = (e) => {
    if (e.touches.length !== 1 || e.target?.closest?.(".dc-tablewrap, .dc-nav, [data-hscroll]")) {
      start.current = null;
      return;
    }
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
  };

  const onTouchEnd = (e) => {
    const s = start.current;
    start.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < THRESHOLD || Math.abs(dx) < Math.abs(dy) * RATIO) return;
    if (dx < 0) onNext?.();
    else onPrev?.();
  };

  return { onTouchStart, onTouchEnd };
}
