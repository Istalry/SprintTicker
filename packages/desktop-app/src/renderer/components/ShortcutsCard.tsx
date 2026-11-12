import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ShortcutsStatusDTO } from '../../shared/dtos';
import { SHORTCUT_ACTIONS, ShortcutAction } from '../../shared/flow-settings';
import {
  acceleratorFromKeyEvent,
  chordCaution,
  chordProblem,
  describeAccelerator
} from '../../shared/interrupt-shortcut';
import { Verb } from '../../shared/words';
import { ipcErrorMessage } from '../utils/formatters';

/** Each shortcut's name and what it does, in the words of the rest of the app. */
const ROWS: Record<ShortcutAction, { name: string; does: string }> = {
  interrupt: {
    name: Verb.INTERRUPT,
    does: 'Starts a timer now; the task waits, paused. During an interruption it is Another.'
  },
  switch: { name: `${Verb.SWITCH} task`, does: 'Opens the task picker over whatever app you are in.' },
  previous: { name: `${Verb.PREVIOUS} task`, does: 'Goes back to the task you timed before this one.' },
  back: { name: Verb.BACK, does: 'Ends the interruption and resumes the task it holds; nothing otherwise.' }
};

/**
 * The global shortcuts (redesign P12e, S19): Interrupt, Switch, Previous
 * and Back, each on by default, on a chord the user may record here.
 *
 * Main lets go of every chord while one is recorded, or Windows would hand
 * the press to the shortcut and never to this window. Recording ends on the
 * first chord with a key, on Escape, or when the field loses the focus --
 * each gives the chords back.
 */
export const ShortcutsCard: React.FC = () => {
  const [status, setStatus] = useState<ShortcutsStatusDTO | null>(null);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [refusal, setRefusal] = useState<{ action: ShortcutAction; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI?.getShortcuts().then(setStatus, (err: unknown) => setError(ipcErrorMessage(err)));
  }, []);

  const apply = async (action: ShortcutAction, enabled: boolean, accelerator: string): Promise<void> => {
    setError(null);
    try {
      setStatus(await window.electronAPI.setShortcut(action, { enabled, accelerator }));
    } catch (err) {
      setRefusal({ action, text: ipcErrorMessage(err) });
    }
  };

  const startRecording = async (action: ShortcutAction): Promise<void> => {
    setRefusal(null);
    setError(null);
    setRecording(action);
    try {
      await window.electronAPI.setShortcutsRecording(true);
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  };

  const stopRecording = async (): Promise<void> => {
    setRecording(null);
    try {
      setStatus(await window.electronAPI.setShortcutsRecording(false));
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  };

  const onKeyDown = (action: ShortcutAction) => (event: React.KeyboardEvent<HTMLElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      void stopRecording();
      return;
    }
    const accelerator = acceleratorFromKeyEvent(event);
    if (!accelerator) return;
    const problem = chordProblem(accelerator);
    if (problem) {
      setRefusal({ action, text: `${describeAccelerator(accelerator)}: ${problem}` });
      return;
    }
    setRefusal(null);
    // Stored while main still holds off, then registered as recording ends.
    void (async () => {
      await apply(action, status?.[action].enabled ?? true, accelerator);
      await stopRecording();
    })();
  };

  return (
    <div className="rounded-lg border border-border-dark bg-dark-800 p-5">
      <h3 className="text-sm font-semibold text-text-primary">Shortcuts</h3>
      <p className="mt-1 text-xs text-text-secondary">
        From any app, without opening SprintTicker. Windows does not pass them on while an app run as
        administrator has the focus.
      </p>

      <ul className="mt-4 space-y-4">
        {SHORTCUT_ACTIONS.map(action => {
          const row = status?.[action] ?? null;
          const accelerator = row?.accelerator ?? '';
          const caution = accelerator ? chordCaution(accelerator) : null;
          const { name, does } = ROWS[action];
          return (
            <li key={action} aria-label={name}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-text-primary">{name}</div>
                  <div className="text-xs text-text-secondary">{does}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  {recording === action ? (
                    <span
                      role="textbox"
                      aria-label={`Press the new shortcut for ${name}`}
                      tabIndex={0}
                      autoFocus
                      onKeyDown={onKeyDown(action)}
                      onBlur={() => void stopRecording()}
                      className="rounded border border-focus bg-dark-900 px-3 py-1.5 text-text-primary outline-none"
                    >
                      Press the keys… (Escape cancels)
                    </span>
                  ) : (
                    <>
                      <kbd className="rounded border border-border-dark bg-dark-900 px-3 py-1.5 font-mono text-text-primary">
                        {accelerator ? describeAccelerator(accelerator) : '…'}
                      </kbd>
                      <button
                        type="button"
                        aria-label={`Change the shortcut for ${name}`}
                        disabled={!status || recording !== null}
                        onClick={() => void startRecording(action)}
                        className="rounded border border-border-dark px-3 py-1.5 text-text-secondary hover:text-white disabled:opacity-50"
                      >
                        Change
                      </button>
                    </>
                  )}
                  <label className="flex items-center gap-1.5 text-text-secondary">
                    <input
                      type="checkbox"
                      aria-label={`Use the shortcut for ${name}`}
                      checked={row?.enabled ?? false}
                      disabled={!row || recording !== null}
                      onChange={e => void apply(action, e.target.checked, accelerator)}
                      className="h-4 w-4 accent-primary disabled:opacity-50"
                    />
                    <span>On</span>
                  </label>
                </div>
              </div>

              {refusal?.action === action && <p role="alert" className="mt-2 text-xs text-accent-red">{refusal.text}</p>}

              {row?.problem === 'taken' && (
                <p role="alert" className="mt-2 flex items-center gap-1.5 text-xs text-accent-amber">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>Not active: another app holds {describeAccelerator(accelerator)}. Choose another shortcut.</span>
                </p>
              )}

              {caution && recording !== action && <p className="mt-2 text-xs text-text-secondary">{caution}</p>}
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-accent-amber">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Could not change them: {error}</span>
        </p>
      )}
    </div>
  );
};
