import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { UndoStateDTO } from '../../shared/dtos';
import { Verb } from '../../shared/words';

/** How often the seconds left are redrawn. */
const COUNTDOWN_TICK_MS = 250;

/**
 * The action Undo can take back, kept current from main (`undo:on-changed`),
 * and the time left on it, in whole seconds -- 0 once it has ended.
 */
export function useUndo(): { state: UndoStateDTO | null; secondsLeft: number; run: () => void } {
  const [state, setState] = useState<UndoStateDTO | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getUndo) return undefined;
    let live = true;
    // The clock is read with each new state, or the first count is taken
    // from the mount and reads a second too many.
    const take = (next: UndoStateDTO | null) => {
      setNow(Date.now());
      setState(next);
    };
    api.getUndo()
      .then(current => { if (live) take(current); })
      .catch(err => console.warn('[Undo] Could not read what can be undone:', err));
    const off = api.onUndoChanged?.(take);
    return () => {
      live = false;
      off?.();
    };
  }, []);

  useEffect(() => {
    if (!state) return undefined;
    const timer = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, [state]);

  const secondsLeft = state ? Math.max(0, Math.ceil((Date.parse(state.expiresAtUtc) - now) / 1000)) : 0;
  const run = () => {
    window.electronAPI?.runUndo?.()
      .catch(err => console.warn('[Undo] Undo failed:', err));
  };
  return { state: secondsLeft > 0 ? state : null, secondsLeft, run };
}

/**
 * The window's Undo bar (D6): what was just done, the seconds left before
 * it is sent, and Undo. At the foot of the window, over whatever place is
 * open, since a Stop from the header or the deck lands anywhere.
 */
export const UndoBar: React.FC = () => {
  const { state, secondsLeft, run } = useUndo();
  const button = useRef<HTMLButtonElement>(null);
  // The Undo toast's click (P12c): the window opens with Undo under Enter.
  useEffect(() => window.electronAPI?.onOpenRoute?.(route => {
    if (route === 'undo') button.current?.focus();
  }), []);
  if (!state) return null;
  return (
    <div
      role="status"
      aria-label="Undo"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-4 rounded-lg border border-border-dark bg-dark-700 px-4 py-2 shadow-lg"
    >
      <span className="text-sm text-text-primary">{state.label}</span>
      <span className="text-xs text-text-muted">{`Sent in ${secondsLeft}s`}</span>
      <button
        ref={button}
        type="button"
        onClick={run}
        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-sm font-semibold text-dark-900 hover:bg-white"
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        {Verb.UNDO}
      </button>
    </div>
  );
};
