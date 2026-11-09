import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { InterruptShortcutStatusDTO } from '../../shared/dtos';
import {
  acceleratorFromKeyEvent,
  chordCaution,
  chordProblem,
  describeAccelerator
} from '../../shared/interrupt-shortcut';
import { ipcErrorMessage } from '../utils/formatters';

/**
 * The global shortcut for Interrupt: off until turned on, on a chord the
 * user records here.
 *
 * Main lets go of the chord while this records, or Windows would hand the
 * press to the shortcut and never to this window. Recording ends on the
 * first chord with a key, on Escape, or when the field loses the focus --
 * each gives the chord back.
 */
export const InterruptShortcutCard: React.FC = () => {
  const [status, setStatus] = useState<InterruptShortcutStatusDTO | null>(null);
  const [recording, setRecording] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI?.getInterruptShortcut().then(setStatus, (err: unknown) => setError(ipcErrorMessage(err)));
  }, []);

  const apply = async (enabled: boolean, accelerator: string): Promise<void> => {
    setError(null);
    try {
      setStatus(await window.electronAPI.setInterruptShortcut({ enabled, accelerator }));
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  };

  const startRecording = async (): Promise<void> => {
    setRefusal(null);
    setError(null);
    setRecording(true);
    try {
      await window.electronAPI.setInterruptShortcutRecording(true);
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  };

  const stopRecording = async (): Promise<void> => {
    setRecording(false);
    try {
      setStatus(await window.electronAPI.setInterruptShortcutRecording(false));
    } catch (err) {
      setError(ipcErrorMessage(err));
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
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
      setRefusal(`${describeAccelerator(accelerator)}: ${problem}`);
      return;
    }
    setRefusal(null);
    // Stored while main still holds off, then registered as recording ends.
    void (async () => {
      await apply(status?.enabled ?? false, accelerator);
      await stopRecording();
    })();
  };

  const accelerator = status?.accelerator ?? '';
  const caution = accelerator ? chordCaution(accelerator) : null;

  return (
    <div className="rounded-lg border border-border-dark bg-dark-800 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Interrupt shortcut</h3>
          <p className="mt-1 text-xs text-text-secondary">
            Starts an interruption from any app: the timer switches to a new task you name later, and you are
            asked to go back to the one it stops.
          </p>
        </div>
        <label className="flex items-center space-x-2 text-xs text-text-secondary">
          <input
            type="checkbox"
            checked={status?.enabled ?? false}
            disabled={!status || recording}
            onChange={e => void apply(e.target.checked, accelerator)}
            className="h-4 w-4 accent-accent-blue disabled:opacity-50"
          />
          <span>Use the shortcut</span>
        </label>
      </div>

      <div className="mt-3 flex items-center space-x-3 text-xs">
        {recording ? (
          <span
            role="textbox"
            aria-label="Press the new shortcut"
            tabIndex={0}
            autoFocus
            onKeyDown={onKeyDown}
            onBlur={() => void stopRecording()}
            className="rounded border border-accent-blue bg-dark-900 px-3 py-1.5 font-mono text-accent-blue outline-none"
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
              disabled={!status}
              onClick={() => void startRecording()}
              className="rounded border border-border-dark px-3 py-1.5 text-text-secondary hover:text-white disabled:opacity-50"
            >
              Change
            </button>
          </>
        )}
      </div>

      {refusal && <p role="alert" className="mt-3 text-xs text-accent-red">{refusal}</p>}

      {status?.problem === 'taken' && (
        <p role="alert" className="mt-3 flex items-center space-x-1.5 text-xs text-accent-amber">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>
            Not active: another app holds {describeAccelerator(accelerator)}. Choose another shortcut.
          </span>
        </p>
      )}

      {caution && !recording && <p className="mt-3 text-xs text-text-secondary">{caution}</p>}

      <p className="mt-3 text-xs text-text-secondary">
        Windows does not pass it on while an app run as administrator has the focus.
      </p>

      {error && (
        <p className="mt-3 flex items-center space-x-1.5 text-xs text-accent-amber">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>Could not change it: {error}</span>
        </p>
      )}
    </div>
  );
};
