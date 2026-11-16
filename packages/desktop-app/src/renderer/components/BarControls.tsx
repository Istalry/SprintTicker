import React from 'react';
import { BarWord } from '../../shared/words';
import { BAR_MENU_IDLE_MS, BAR_STOP_AGAIN_MS } from '../../shared/render-constants';

const seconds = (ms: number): string => `${Math.round(ms / 1000)} s`;

/** A word as the bar writes it; `font-mono` is for task keys and times only. */
const Word: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="font-semibold text-text-primary">{children}</span>
);

/**
 * What each of the bar's controls does (Settings › Desk devices), asked for
 * on 2026-11-16: the mapping lived in the user guide alone, and a user
 * holding the bar had no way to find "turn, Pause, Pause" for Done. The
 * words and the waits come from where the bar takes them, so this cannot
 * drift from what the bar does.
 */
export const BarControls: React.FC = () => (
  <div className="space-y-3 text-xs">
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2">
      <dt className="font-semibold text-text-primary">Pause</dt>
      <dd className="text-text-secondary">
        Yes: pauses, resumes, answers a question, dismisses a notification. With nothing running, opens the task
        picker on the computer.
      </dd>

      <dt className="font-semibold text-text-primary">Pause twice</dt>
      <dd className="text-text-secondary">
        Stop, within {seconds(BAR_STOP_AGAIN_MS)} of pausing (the bar shows <Word>{BarWord.AGAIN_STOP}</Word>): the time
        is logged, the task stays open. An interruption pauses and stops the same way, and its stop takes you back to
        the task it interrupted.
      </dd>

      <dt className="font-semibold text-text-primary">Wheel click</dt>
      <dd className="text-text-secondary">
        Interrupt; during an interruption, the next one (<Word>{BarWord.ANOTHER}</Word>). On a question or a
        notification: no.
      </dd>

      <dt className="font-semibold text-text-primary">Wheel turn</dt>
      <dd className="text-text-secondary">
        The menu: <Word>{BarWord.DONE}</Word>, <Word>{BarWord.DISCARD}</Word>, your previous and recent tasks.
        Pause picks the entry shown; a click, or {seconds(BAR_MENU_IDLE_MS)} untouched, closes it.
      </dd>

      <dt className="font-semibold text-text-primary">Back</dt>
      <dd className="text-text-secondary">Nothing.</dd>
    </dl>

    <p className="text-text-secondary">
      <span className="font-semibold text-text-primary">To stop a task and mark it done:</span> turn the wheel to{' '}
      <Word>{BarWord.DONE}</Word>, press Pause, then Pause again at <Word>{BarWord.DONE}?</Word>{' '}
      (<Word>{BarWord.AGAIN_YES}</Word>). Undo is in the app for 10 s.
    </p>
  </div>
);
