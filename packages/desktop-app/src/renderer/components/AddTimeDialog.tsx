import React, { useEffect, useState } from 'react';
import { TaskDTO, WorklogDTO } from '../../shared/dtos';
import { checkManualWorklog, ManualWorklogDTO, WORKLOG_COMMENT_MAX_CHARS } from '../../shared/worklog-correction';
import { closedWeekWarning, isInClosedWeek } from '../../shared/closed-week';
import { findOverlaps } from '../../shared/overlap';
import { localDateKey } from '../../shared/local-date';
import { formatHoursAndMinutes, formatHoursMinutes, ipcErrorMessage } from '../utils/formatters';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';
import { TaskPicker } from './TaskPicker';

/** What Add time opens on when nothing says otherwise: half an hour. */
export const ADD_TIME_DEFAULT_SECONDS = 30 * 60;
/** Minutes a default start is rounded down to, so it reads as a time someone would type. */
const DEFAULT_START_STEP_MINUTES = 5;
/** A past day's default start, when nothing better is known. */
const PAST_DAY_DEFAULT_START = '09:00';

/** `YYYY-MM-DDTHH:MM` in local time, as a datetime-local input holds it. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Where Add time starts on a day: today, the default length ending now,
 * rounded down; another day, the morning.
 */
export function defaultStartFor(dateKey: string, nowMs: number, durationSeconds: number = ADD_TIME_DEFAULT_SECONDS): string {
  if (dateKey !== localDateKey(new Date(nowMs))) return `${dateKey}T${PAST_DAY_DEFAULT_START}`;
  const start = new Date(nowMs - durationSeconds * 1000);
  start.setMinutes(start.getMinutes() - (start.getMinutes() % DEFAULT_START_STEP_MINUTES), 0, 0);
  return toLocalInput(start);
}

/** What Add time opens with: the day it was opened from, or a gap's times (P9b). */
export interface AddTimeStart {
  dateKey: string;
  /** A local `YYYY-MM-DDTHH:MM`; the day's default otherwise. */
  start?: string;
  durationSeconds?: number;
}

interface AddTimeDialogProps {
  opening: AddTimeStart | null;
  onClose: () => void;
  /** Called once main has added it. */
  onAdded: (added: WorklogDTO) => void;
}

/**
 * Add time you didn't time (S16b, P9a): a task, a length, a start and a note,
 * sent like any entry and undone like one. An overlap and a closed week are
 * said before it is added, never refused: the queue holds an overlapping
 * entry until one of the two is fixed.
 *
 * Mounted only while open, so each opening starts from its own times.
 */
export const AddTimeDialog: React.FC<AddTimeDialogProps> = props =>
  props.opening ? <AddTimeForm {...props} opening={props.opening} /> : null;

const AddTimeForm: React.FC<AddTimeDialogProps & { opening: AddTimeStart }> = ({ opening, onClose, onAdded }) => {
  const api = window.electronAPI;
  const { providerName } = useProviderCapabilities();
  const provider = providerName || 'your provider';
  const initialSeconds = opening.durationSeconds ?? ADD_TIME_DEFAULT_SECONDS;
  // Read when the dialog opens and again as the times change: the clock is
  // not read during render.
  const [now, setNow] = useState(() => Date.now());
  const [task, setTask] = useState<TaskDTO | null>(null);
  const [picking, setPicking] = useState(false);
  const [hours, setHours] = useState(String(Math.floor(initialSeconds / 3600)));
  const [minutes, setMinutes] = useState(String(Math.floor((initialSeconds % 3600) / 60)));
  const [start, setStart] = useState(() => opening.start ?? defaultStartFor(opening.dateKey, now, initialSeconds));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastWeekClosed, setLastWeekClosed] = useState<string | null>(null);
  // The entries of the day the start is on, read as it moves: an overlap is with them.
  const [sameDay, setSameDay] = useState<{ dateKey: string; entries: WorklogDTO[] } | null>(null);

  const startDate = new Date(start);
  const startValid = Number.isFinite(startDate.getTime());
  const startDay = startValid ? localDateKey(startDate) : null;

  useEffect(() => {
    let live = true;
    api?.getLastWeekClosed?.().then(
      monday => { if (live) setLastWeekClosed(monday); },
      err => console.warn('[AddTimeDialog] Reading the last week closed failed:', err)
    );
    return () => { live = false; };
  }, [api]);

  useEffect(() => {
    if (!startDay || !api?.getWorklogsByDate) return undefined;
    let live = true;
    api.getWorklogsByDate(startDay).then(
      entries => { if (live) setSameDay({ dateKey: startDay, entries }); },
      err => console.warn('[AddTimeDialog] Reading the day failed:', err)
    );
    return () => { live = false; };
  }, [api, startDay]);

  const h = Number(hours);
  const m = Number(minutes);
  const fieldsValid = hours !== '' && minutes !== '' && Number.isInteger(h) && Number.isInteger(m) && h >= 0 && m >= 0 && m < 60;
  const durationSeconds = fieldsValid ? h * 3600 + m * 60 : 0;
  const entry: ManualWorklogDTO = {
    taskId: task?.id ?? '',
    durationSeconds,
    startedAtUtc: startValid ? startDate.toISOString() : '',
    comment: note
  };
  const refusal = !fieldsValid
    ? 'Hours and minutes must be whole numbers, minutes under 60.'
    : checkManualWorklog({ ...entry, taskId: entry.taskId || 'chosen-below' }, now);

  // Only ever shortens an entry, so the clock need not be read again.
  const setDuration = (seconds: number) => {
    setHours(String(Math.floor(seconds / 3600)));
    setMinutes(String(Math.floor((seconds % 3600) / 60)));
  };

  // S16b: the first entry it overlaps, and the one change that clears it.
  const entries = sameDay?.dateKey === startDay ? sameDay.entries : [];
  const proposed = { id: '~new', startedAtUtc: entry.startedAtUtc, durationSeconds };
  const clash = refusal ? null : findOverlaps([proposed, ...entries]).find(o => o.earlier.id === proposed.id || o.later.id === proposed.id) ?? null;
  const other = clash ? (clash.earlier.id === proposed.id ? clash.later : clash.earlier) as WorklogDTO : null;
  let overlapNote: React.ReactNode = null;
  if (clash && other) {
    const otherStart = new Date(other.startedAtUtc);
    const otherEnd = new Date(Date.parse(other.startedAtUtc) + other.durationSeconds * 1000);
    const key = <span className="font-mono">{other.taskKey ?? other.taskId}</span>;
    const fix = 'text-accent-amber underline underline-offset-2 hover:text-white';
    const startsBefore = Date.parse(entry.startedAtUtc) < otherStart.getTime();
    const shortened = Math.floor((otherStart.getTime() - Date.parse(entry.startedAtUtc)) / 1000);
    const newEnd = Date.parse(entry.startedAtUtc) + durationSeconds * 1000;
    overlapNote = (
      <p role="note" className="text-[11px] text-accent-amber leading-relaxed">
        {startsBefore ? (
          <>
            Overlaps {key}, which starts at {formatHoursMinutes(otherStart)}.{' '}
            <button type="button" className={fix} onClick={() => setDuration(shortened)}>
              End it at {formatHoursMinutes(otherStart)} ({formatHoursAndMinutes(shortened)})
            </button>{' '}
            or change the times.
          </>
        ) : (
          <>
            Overlaps {key}, which ends at {formatHoursMinutes(otherEnd)}.{' '}
            {newEnd > otherEnd.getTime() ? (
              <button
                type="button"
                className={fix}
                onClick={() => {
                  setStart(toLocalInput(otherEnd));
                  setDuration(Math.floor((newEnd - otherEnd.getTime()) / 1000));
                }}
              >
                Start it at {formatHoursMinutes(otherEnd)}
              </button>
            ) : 'Choose another time'}{' '}
            or change the times.
          </>
        )}{' '}
        Added like this, the later one waits and is not sent until it is fixed.
      </p>
    );
  }
  const closedWeek = entry.startedAtUtc !== '' && isInClosedWeek(entry.startedAtUtc, lastWeekClosed);

  const add = () => {
    if (!task || refusal) return;
    setBusy(true);
    setError(null);
    api.addWorklog(entry).then(onAdded, err => {
      console.warn('[AddTimeDialog] The entry was refused:', err);
      setError(ipcErrorMessage(err));
      setBusy(false);
    });
  };

  const field = 'w-full bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-focus';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
      <div role="dialog" aria-label="Add time" className="w-full max-w-lg bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-white border-b border-border-dark pb-3">Add time</h3>

        <div className="space-y-1 text-xs">
          <span className="text-text-secondary">Task</span>
          <button type="button" onClick={() => setPicking(true)} className={`${field} text-left`}>
            {task
              ? <><span className="font-mono font-bold">{task.key}</span> <span className="text-text-secondary">{task.title}</span></>
              : <span className="text-text-secondary">⌕ Search, or pick a recent task</span>}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="space-y-1">
            <span className="text-text-secondary">Duration</span>
            <div className="flex items-center gap-2">
              <input aria-label="Hours" type="number" min={0} value={hours} onChange={e => { setHours(e.target.value); setNow(Date.now()); }} className={field} />
              <span className="text-text-secondary">h</span>
              <input aria-label="Minutes" type="number" min={0} max={59} value={minutes} onChange={e => { setMinutes(e.target.value); setNow(Date.now()); }} className={field} />
              <span className="text-text-secondary">min</span>
            </div>
          </div>
          <label className="space-y-1">
            <span className="text-text-secondary">Started</span>
            <input type="datetime-local" value={start} onChange={e => { setStart(e.target.value); setNow(Date.now()); }} className={field} />
          </label>
          <label className="space-y-1 col-span-2">
            <span className="text-text-secondary">Note, shown in {provider}</span>
            <input
              type="text"
              value={note}
              maxLength={WORKLOG_COMMENT_MAX_CHARS}
              placeholder="What you did"
              onChange={e => setNote(e.target.value)}
              className={field}
            />
          </label>
        </div>

        {overlapNote}
        {closedWeek && <p role="note" className="text-[11px] text-accent-amber leading-relaxed">{closedWeekWarning(provider)}</p>}
        {(error || (refusal && task)) && <p role="alert" className="text-xs text-accent-red">{error ?? refusal}</p>}

        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-text-secondary hover:text-white rounded-lg text-xs font-semibold border border-border-dark"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={add}
            disabled={!task || refusal !== null || busy}
            className="px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-dark-900 rounded-lg text-xs font-semibold"
          >
            Add {fieldsValid && durationSeconds > 0 ? formatHoursAndMinutes(durationSeconds) : 'time'}
          </button>
        </div>
      </div>

      <TaskPicker
        isOpen={picking}
        mode="move"
        title="Add time to a task"
        subtitle="The time is sent there like any entry."
        onClose={() => setPicking(false)}
        onPick={picked => {
          setPicking(false);
          if (picked.task) setTask(picked.task);
        }}
      />
    </div>
  );
};
