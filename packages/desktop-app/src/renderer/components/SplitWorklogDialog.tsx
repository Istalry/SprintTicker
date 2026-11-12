import React, { useState } from 'react';
import type { TaskDTO, WorklogDTO } from '../../shared/dtos';
import { closedWeekWarning, isInClosedWeek } from '../../shared/closed-week';
import { splitPieces } from '../../shared/worklog-correction';
import { formatHoursAndMinutes, formatHoursMinutes, ipcErrorMessage } from '../utils/formatters';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';
import { TaskPicker } from './TaskPicker';

/** The slider moves by the minute: nobody remembers the second they switched. */
const SPLIT_STEP_SECONDS = 60;

/** The smallest entry that has a minute either side of a split. */
export const SPLIT_MIN_SECONDS = 2 * SPLIT_STEP_SECONDS;

export interface SplitWorklogDialogProps {
  worklog: WorklogDTO;
  /** The Monday of the last week closed: splitting time up to its Sunday is warned about. */
  lastWeekClosed: string | null;
  onClose: () => void;
  /** Called once main has split it. */
  onDone: () => void;
}

/**
 * Split in two (S16c, P9e): for the time the user forgot to switch. The
 * entry ends at the moment chosen and the rest goes on the task picked --
 * nothing is preselected. Main shortens the first, then sends the second
 * once the first has arrived (`worklog:split`), with ten seconds to undo.
 * The note is kept on both. A closed week is warned about, never refused.
 *
 * Mounted only while open, so each opening starts at the middle with no task.
 */
export const SplitWorklogDialog: React.FC<SplitWorklogDialogProps> = ({ worklog, lastWeekClosed, onClose, onDone }) => {
  const total = worklog.durationSeconds;
  const lastCut = Math.floor((total - 1) / SPLIT_STEP_SECONDS) * SPLIT_STEP_SECONDS;
  const [firstSeconds, setFirstSeconds] = useState(() => Math.max(SPLIT_STEP_SECONDS, Math.round(total / 2 / SPLIT_STEP_SECONDS) * SPLIT_STEP_SECONDS));
  const [task, setTask] = useState<TaskDTO | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { providerName } = useProviderCapabilities();

  const startMs = Date.parse(worklog.startedAtUtc);
  const endMs = startMs + total * 1000;
  const atMs = startMs + firstSeconds * 1000;
  const atUtc = new Date(atMs).toISOString();
  const pieces = splitPieces(worklog, atUtc);
  const refusal = typeof pieces === 'string' ? pieces : null;
  const clock = (ms: number) => formatHoursMinutes(new Date(ms));
  const key = worklog.taskKey ?? worklog.taskId;

  const split = () => {
    if (!task || refusal) return;
    setBusy(true);
    setError(null);
    window.electronAPI.splitWorklog(worklog.id, atUtc, task.id).then(onDone, err => {
      setError(ipcErrorMessage(err));
      setBusy(false);
    });
  };

  const cell = 'py-2 pr-3 whitespace-nowrap';
  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
        <div
          role="dialog"
          aria-label="Split in two"
          className="w-full max-w-lg bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6 space-y-4"
          onKeyDown={e => { if (e.key === 'Escape' && !picking) onClose(); }}
        >
          <h3 className="text-sm font-bold text-white">
            Split <span className="font-mono">{key}</span> · {clock(startMs)} – {clock(endMs)} · {formatHoursAndMinutes(total)}
          </h3>

          <div className="space-y-1">
            <label htmlFor="split-at" className="text-xs text-text-secondary">Split at</label>
            <input
              id="split-at"
              type="range"
              min={SPLIT_STEP_SECONDS}
              max={lastCut}
              step={SPLIT_STEP_SECONDS}
              value={firstSeconds}
              aria-valuetext={clock(atMs)}
              onChange={e => setFirstSeconds(Number(e.target.value))}
              className="w-full accent-white"
            />
            <div className="flex justify-between text-[11px] text-text-secondary font-mono">
              <span>{clock(startMs)}</span>
              <span className="font-bold text-white">{clock(atMs)}</span>
              <span>{clock(endMs)}</span>
            </div>
          </div>

          <table className="w-full text-xs">
            <tbody className="divide-y divide-border-dark">
              <tr>
                <td className={`${cell} font-mono text-text-primary`}>{clock(startMs)} – {clock(atMs)}</td>
                <td className={`${cell} font-mono text-white`}>{formatHoursAndMinutes(firstSeconds)}</td>
                <td className="py-2 pr-3 text-text-primary">
                  <span className="font-mono font-bold">{key}</span>{' '}
                  <span className="text-text-secondary">{worklog.taskTitle}</span>
                </td>
                <td className="py-2 text-right text-text-secondary">stays</td>
              </tr>
              <tr>
                <td className={`${cell} font-mono text-text-primary`}>{clock(atMs)} – {clock(endMs)}</td>
                <td className={`${cell} font-mono text-white`}>{formatHoursAndMinutes(total - firstSeconds)}</td>
                <td className="py-2 pr-3" colSpan={2}>
                  <button
                    type="button"
                    onClick={() => setPicking(true)}
                    className="px-2.5 py-1 rounded-lg border border-border-dark text-text-primary hover:text-white hover:border-focus"
                  >
                    {task ? <><span className="font-mono font-bold">{task.key}</span> {task.title} ▾</> : 'Choose a task ▾'}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          <p className="text-[11px] text-text-secondary leading-relaxed">
            The note is kept on both.{' '}
            {worklog.syncState === 'local' || worklog.syncState === undefined
              ? 'The first entry is kept in SprintTicker only.'
              : `${providerName || 'Your provider'} gets the first entry shortened, then the second as a new one.`}
          </p>
          {isInClosedWeek(worklog.startedAtUtc, lastWeekClosed) && (
            <p role="note" className="text-[11px] text-accent-amber leading-relaxed">{closedWeekWarning(providerName)}</p>
          )}
          {(error || refusal) && <p role="alert" className="text-xs text-accent-red">{error ?? refusal}</p>}

          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-dark-700 text-text-secondary hover:text-white rounded-lg text-xs font-semibold border border-border-dark">
              Cancel
            </button>
            <button
              type="button"
              onClick={split}
              disabled={!task || busy || refusal !== null}
              className="px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-dark-900 rounded-lg text-xs font-semibold"
            >
              {task ? 'Split' : 'Choose a task'}
            </button>
          </div>
        </div>
      </div>
      <TaskPicker
        isOpen={picking}
        mode="move"
        title="Put the rest on a task"
        subtitle={`${clock(atMs)} – ${clock(endMs)}, ${formatHoursAndMinutes(total - firstSeconds)}: its time goes to the task you pick`}
        onClose={() => setPicking(false)}
        onPick={picked => {
          if (picked.task) setTask(picked.task);
          setPicking(false);
        }}
      />
    </>
  );
};
