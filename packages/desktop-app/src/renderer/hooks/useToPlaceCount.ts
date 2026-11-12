import { useEffect, useState } from 'react';

/**
 * Interruptions not placed on a task yet, for the ⚡ count beside Today and
 * on the mini timer. Read again whenever main says the worklogs changed:
 * placing one, or a new one ending, changes the count.
 */
export function useToPlaceCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getInterruptionsToPlace) return undefined;
    let live = true;
    const read = () => {
      api.getInterruptionsToPlace()
        .then(waiting => { if (live) setCount(waiting.length); })
        .catch(err => console.warn('[ToPlace] Could not read the interruptions to place:', err));
    };
    read();
    // Main sends the list itself when one ends or is placed.
    const off = api.onInterruptionsUpdated?.(waiting => { if (live) setCount(waiting.length); });
    return () => {
      live = false;
      off?.();
    };
  }, []);
  return count;
}
