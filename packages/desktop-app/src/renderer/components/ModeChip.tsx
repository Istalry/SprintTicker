import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { UserMode } from '../../shared/dtos';

const MODES: readonly { id: UserMode; label: string; hint: string }[] = [
  { id: 'WORK', label: 'Work', hint: 'The normal day.' },
  { id: 'LUNCH', label: 'Lunch', hint: 'Pauses your task; after, asks if you are back.' },
  { id: 'AWAY', label: 'Away', hint: "Pauses your task. The bar shows that you're away." }
];

/**
 * The mode chip (S5, S6): Work, Lunch or Away, in the header. It replaces the
 * mode switch that sat inside Priority Rules, where nobody looked for it. It
 * reads and writes the same mode main keeps (`priority:get-user-mode`), and
 * follows it when the schedule or the bar changes it.
 */
export const ModeChip: React.FC = () => {
  const [mode, setMode] = useState<UserMode>('WORK');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getUserMode) return undefined;
    let live = true;
    api.getUserMode()
      .then(value => { if (live) setMode(value); })
      .catch(err => console.warn('[ModeChip] Could not read the mode:', err));
    const off = api.onUserModeUpdated?.(setMode);
    return () => {
      live = false;
      off?.();
    };
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const choose = (next: UserMode): void => {
    setOpen(false);
    const previous = mode;
    setMode(next);
    window.electronAPI?.setUserMode(next)
      .catch(err => {
        console.warn('[ModeChip] Could not change the mode:', err);
        setMode(previous);
      });
  };

  const current = MODES.find(m => m.id === mode) ?? MODES[0];
  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={current.hint}
        aria-label={`Mode: ${current.label}`}
        className="flex items-center gap-1.5 rounded-md border border-border-dark bg-dark-700 px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:bg-dark-600"
      >
        <span className="text-text-secondary">Mode:</span>
        <span>{current.label}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div role="menu" aria-label="Mode" className="absolute left-0 top-full z-40 mt-2 w-64 rounded-lg border border-border-dark bg-dark-800 p-1 shadow-2xl">
          {MODES.map(m => (
            <button
              key={m.id}
              type="button"
              role="menuitemradio"
              aria-checked={m.id === mode}
              onClick={() => choose(m.id)}
              className={`block w-full rounded-md px-3 py-2 text-left text-xs ${m.id === mode ? 'bg-select text-text-primary' : 'text-text-secondary hover:bg-dark-700 hover:text-text-primary'}`}
            >
              <span className="font-semibold">{m.label}</span>
              <span className="block text-text-muted">{m.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
