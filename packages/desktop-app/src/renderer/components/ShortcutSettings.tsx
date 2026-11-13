import React, { useEffect, useRef, useState } from 'react';
import { ShortcutsStatusDTO } from '../../shared/dtos';
import { SHORTCUT_ACTIONS, ShortcutAction } from '../../shared/flow-settings';
import {
  acceleratorFromKeyEvent,
  chordCaution,
  chordProblem,
  describeAccelerator
} from '../../shared/interrupt-shortcut';
import { Verb } from '../../shared/words';
import { couldNot, ipcErrorMessage } from '../utils/formatters';
import { SettingButton, SettingProblem, SettingRow, SettingSwitch } from './SettingRow';

/** Each shortcut's name and what it does, in the words of the rest of the app. */
const ROWS: Record<ShortcutAction, { name: string; does: string }> = {
  interrupt: {
    name: Verb.INTERRUPT,
    does: 'Starts a timer now; the task waits, paused. During an interruption it is Another.'
  },
  switch: { name: `${Verb.SWITCH} task`, does: 'Opens the task picker over whatever app you are in.' },
  previous: { name: `${Verb.PREVIOUS} task`, does: 'Goes back to the task you timed before this one.' },
  back: { name: Verb.BACK, does: 'Ends the interruption and goes back to the task it interrupted, as it was; nothing otherwise.' }
};

/**
 * The global shortcuts (redesign P12e, S19): Interrupt, Switch, Previous
 * and Back, each on by default, on a chord the user may record here -- a
 * row each, the chord and Change keys in its sentence.
 *
 * Main lets go of every chord while one is recorded, or Windows would hand
 * the press to the shortcut and never to this window. Recording ends on the
 * first chord with a key, on Escape, or when the field loses the focus --
 * each gives the chords back.
 */
export const ShortcutSettings: React.FC = () => {
  const [status, setStatus] = useState<ShortcutsStatusDTO | null>(null);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [refusal, setRefusal] = useState<{ action: ShortcutAction; text: string } | null>(null);
  // The field replaces Change keys, and Change keys comes back when the
  // recording ends: the focus follows both ways (REVIEW-2026-11 A2), or the
  // chord pressed went nowhere -- `autoFocus` does nothing on a span.
  const changeButtons = useRef<Partial<Record<ShortcutAction, HTMLButtonElement | null>>>({});
  const recorded = useRef<ShortcutAction | null>(null);
  useEffect(() => {
    if (recording) {
      recorded.current = recording;
      return;
    }
    if (recorded.current) changeButtons.current[recorded.current]?.focus();
    recorded.current = null;
  }, [recording]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.electronAPI?.getShortcuts().then(setStatus, (err: unknown) => setError(couldNot('read them', err)));
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
      setError(couldNot('change them', err));
    }
  };

  const stopRecording = async (): Promise<void> => {
    setRecording(null);
    try {
      setStatus(await window.electronAPI.setShortcutsRecording(false));
    } catch (err) {
      setError(couldNot('change them', err));
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
    <>
      {SHORTCUT_ACTIONS.map(action => {
        const row = status?.[action] ?? null;
        const accelerator = row?.accelerator ?? '';
        const caution = accelerator ? chordCaution(accelerator) : null;
        const { name, does } = ROWS[action];
        return (
          <SettingRow
            key={action}
            title={`${name} shortcut`}
            description={
              <>
                <span>{does}</span>
                <span className="mt-1.5 flex items-center gap-2">
                  {recording === action ? (
                    <span
                      role="textbox"
                      aria-label={`Press the new shortcut for ${name}`}
                      tabIndex={0}
                      ref={field => field?.focus()}
                      onKeyDown={onKeyDown(action)}
                      onBlur={() => void stopRecording()}
                      className="rounded border border-focus bg-dark-900 px-2 py-0.5 text-text-primary outline-none"
                    >
                      Press the keys… (Escape cancels)
                    </span>
                  ) : (
                    <>
                      <kbd className="rounded border border-border-dark bg-dark-900 px-2 py-0.5 font-mono text-text-primary">
                        {accelerator ? describeAccelerator(accelerator) : '…'}
                      </kbd>
                      <SettingButton
                        ref={button => { changeButtons.current[action] = button; }}
                        aria-label={`Change the shortcut for ${name}`}
                        disabled={!status || recording !== null}
                        onClick={() => void startRecording(action)}
                      >
                        Change keys
                      </SettingButton>
                    </>
                  )}
                </span>
              </>
            }
            control={
              <SettingSwitch
                label={`Use the shortcut for ${name}`}
                checked={row?.enabled ?? false}
                disabled={!row || recording !== null}
                onChange={next => void apply(action, next, accelerator)}
              />
            }
          >
            {refusal?.action === action && <p role="alert" className="text-xs text-accent-red">{refusal.text}</p>}
            {row?.problem === 'taken' && (
              <SettingProblem>Not active: another app holds {describeAccelerator(accelerator)}. Choose another shortcut.</SettingProblem>
            )}
            {caution && recording !== action && <p className="text-xs text-text-secondary">{caution}</p>}
          </SettingRow>
        );
      })}
      {error && <div className="py-3"><SettingProblem>{error}</SettingProblem></div>}
      <p className="py-3 text-xs text-text-muted">
        Shortcuts work from any app, except while an app run as administrator has the focus: Windows does not pass them on then.
      </p>
    </>
  );
};
