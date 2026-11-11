import React, { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { ActiveSessionDTO } from '../../shared/dtos';
import { Verb } from '../../shared/words';
import { formatClockTime, formatHoursAndMinutes, ipcErrorMessage } from '../utils/formatters';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';
import { TaskPicker } from './TaskPicker';

/** Where "Keep timing on it" is remembered, for this session and this reason: the window reopened does not ask again. */
const keptKey = (session: ActiveSessionDTO) => `task-left-kept:${session.sessionId}:${session.taskLeftBecause ?? 'reassigned'}`;

function wasKept(session: ActiveSessionDTO): boolean {
  try {
    return window.sessionStorage.getItem(keptKey(session)) === '1';
  } catch {
    // Storage refused (a sandboxed test page): the card shows, which is the safe side.
    return false;
  }
}

/** "MG-12 was given to Rin Okada at 14:32": the heading, by why the task left. */
export function taskLeftHeading(session: ActiveSessionDTO, providerName: string): string {
  const key = session.taskKey;
  const where = providerName || 'the provider';
  const at = session.taskLeftAtUtc ? ` at ${formatClockTime(new Date(session.taskLeftAtUtc))}` : '';
  switch (session.taskLeftBecause) {
    case 'closed':
      return `${key} was closed in ${where}${at}`;
    case 'gone':
      return `${key} is no longer on ${where}${at}`;
    default:
      return session.taskOwnerName?.trim()
        ? `${key} was given to ${session.taskOwnerName.trim()}${at}`
        : `${key} is no longer assigned to you${at}`;
  }
}

/**
 * The task being timed left the user's list (S5b): given to someone else,
 * closed or deleted at the provider. Shown the moment it is seen -- the
 * minute check or the sync -- not at Stop. The timer runs on, since what
 * the user is doing has not changed; the card offers to keep going, to move
 * the time so far to another task (which then runs), or to switch.
 *
 * Mounted per session and reason (its key), so "Keep timing on it" is
 * final for that one only.
 */
export const TaskLeftCard: React.FC<{ session: ActiveSessionDTO; onSwitch: () => void }> = ({ session, onSwitch }) => {
  const [kept, setKept] = useState(() => wasKept(session));
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { providerName } = useProviderCapabilities();
  if (kept) return null;

  const soFar = formatHoursAndMinutes(session.elapsedSeconds);
  const keep = () => {
    setKept(true);
    try {
      window.sessionStorage.setItem(keptKey(session), '1');
    } catch {
      // Not remembered: the card comes back if the window reopens, nothing worse.
    }
  };
  const moveTo = (taskId: string) => {
    setMoving(false);
    setError(null);
    window.electronAPI.moveSessionTo(taskId).catch(err => setError(ipcErrorMessage(err)));
  };

  const small = 'whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-semibold border border-border-dark text-text-secondary hover:text-white hover:border-focus';
  return (
    <section aria-label={taskLeftHeading(session, providerName)} className="bg-accent-amber/5 border border-accent-amber/40 rounded-xl p-5 space-y-3 select-none">
      <div className="space-y-3">
        <div className="space-y-1 min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-bold text-white">
            <AlertTriangle className="w-4 h-4 shrink-0 text-accent-amber" />
            <span>{taskLeftHeading(session, providerName)}</span>
          </h3>
          <p className="text-xs text-text-secondary">
            Your <span className="font-mono">{soFar}</span> so far stays on <span className="font-mono">{session.taskKey}</span>, where you did it.
            {session.taskLeftBecause === 'closed' ? ' Stop logs it without moving the task.' : ''} Keep going, or switch.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={small} onClick={keep}>Keep timing on it</button>
          <button type="button" className={small} onClick={() => { setError(null); setMoving(true); }}>
            ↳ {Verb.MOVE} my <span className="font-mono">{soFar}</span>…
          </button>
          <button type="button" className={small} onClick={onSwitch}>⇄ {Verb.SWITCH} task</button>
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-accent-red">Not moved: {error}</p>}

      <TaskPicker
        isOpen={moving}
        mode="move"
        subtitle={`Your ${soFar} on ${session.taskKey} goes to the task you pick, and the timer goes on there.`}
        onClose={() => setMoving(false)}
        onPick={picked => { if (picked.task) moveTo(picked.task.id); }}
      />
    </section>
  );
};
