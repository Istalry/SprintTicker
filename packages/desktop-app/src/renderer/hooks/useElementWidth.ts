import { useEffect, useRef, useState } from 'react';

/**
 * Measures the content width of an element, tracking it as the window resizes.
 *
 * Returns a ref to attach and the current width in CSS pixels. The width is 0
 * until the first observation lands, so callers must handle 0 as "not measured
 * yet" rather than as a real width.
 *
 * **The observed element must be sized by its container, not by its children.**
 * Attach this to a flex item carrying `flex-1 min-w-0` -- something whose width
 * the layout decides. Observing an element that a canvas inside it sizes creates
 * a feedback loop: the observation resizes the canvas, which resizes the
 * element, which fires the observer again. The browser breaks that cycle by
 * dropping a frame and logging `ResizeObserver loop completed with undelivered
 * notifications`, which is a warning nobody reads and a visible stutter while
 * the window is dragged.
 */
// The return type is inferred rather than annotated on purpose: React 18 and 19
// disagree about whether `useRef`'s result is a `MutableRefObject` or a
// `RefObject`, and naming either one here would have to be edited during the
// React 19 upgrade. Inference is correct under both.
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        // contentRect excludes padding and border, which is what the caller is
        // trying to fill.
        const next = Math.floor(entry.contentRect.width);
        // Only commit real changes: a state update per observed pixel would
        // re-render the emulator on every frame of a window drag.
        setWidth(prev => (prev === next ? prev : next));
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}
