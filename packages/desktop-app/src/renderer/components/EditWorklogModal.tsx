import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import { WorklogDTO } from '../../shared/dtos';
import { checkWorklogCorrection, WORKLOG_COMMENT_MAX_CHARS, WorklogCorrectionDTO } from '../../shared/worklog-correction';
import { formatClockTime, formatDayAndTime, formatHoursAndMinutes, formatHoursMinutes, ipcErrorMessage } from '../utils/formatters';
import { findOverlaps } from '../../shared/overlap';
import { ConfirmPanel } from './ConfirmPanel';
import { closedWeekWarning, isInClosedWeek } from '../../shared/closed-week';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';
import { SPLIT_MIN_SECONDS } from './SplitWorklogDialog';

/** `YYYY-MM-DDTHH:MM` in local time, as a datetime-local input holds it. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** What a change does beyond this window, by where the worklog stands. */
function reachNote(worklog: WorklogDTO, providerName: string): string {
  return worklog.syncState === 'local' || worklog.syncState === undefined
    ? 'This worklog is kept in SprintTicker only.'
    : `The change also goes to ${providerName}, through the sync queue.`;
}

interface EditWorklogModalProps {
  worklog: WorklogDTO;
  mode: 'edit' | 'delete';
  /** The Monday of the last week closed: time up to its Sunday is warned about. */
  lastWeekClosed?: string | null;
  /** The day's other entries, so a correction that would overlap one says so before it is saved. */
  sameDay?: readonly WorklogDTO[];
  onClose: () => void;
  /** Called once main has accepted the change. */
  onDone: () => void;
  /** Opens Split in two (S16c) on this entry, instead of correcting it. */
  onSplit?: () => void;
}

/**
 * Corrects or deletes one worklog. Mounted only while open, so each opening
 * starts from the worklog as it is.
 *
 * Hours and minutes are what the user edits, but a worklog holds seconds and
 * a start to the millisecond: both are kept exactly as they were while their
 * fields are left alone, so fixing a comment does not also shave the
 * duration or move the start to the minute.
 */
export const EditWorklogModal: React.FC<EditWorklogModalProps> = ({ worklog, mode, lastWeekClosed = null, sameDay = [], onClose, onDone, onSplit }) => {
  const initialHours = Math.floor(worklog.durationSeconds / 3600);
  const initialMinutes = Math.floor((worklog.durationSeconds % 3600) / 60);
  const initialStart = toLocalInput(new Date(worklog.startedAtUtc));

  const [hours, setHours] = useState<string>(String(initialHours));
  const [minutes, setMinutes] = useState<string>(String(initialMinutes));
  const [start, setStart] = useState<string>(initialStart);
  const [comment, setComment] = useState<string>(worklog.comment);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Read when the dialog opens and again as the start changes: the clock is
  // not read during render.
  const [now, setNow] = useState<number>(() => Date.now());
  const { providerName } = useProviderCapabilities();

  const key = worklog.taskKey ?? worklog.taskId;
  const h = Number(hours);
  const m = Number(minutes);
  const durationUnchanged = h === initialHours && m === initialMinutes;
  const durationSeconds = durationUnchanged ? worklog.durationSeconds : Math.round(h * 3600 + m * 60);
  const startDate = new Date(start);
  const correction: WorklogCorrectionDTO = {
    durationSeconds,
    startedAtUtc: start === initialStart
      ? worklog.startedAtUtc
      : Number.isFinite(startDate.getTime()) ? startDate.toISOString() : '',
    comment
  };
  const fieldsValid = Number.isInteger(h) && Number.isInteger(m) && h >= 0 && m >= 0 && m < 60;
  const refusal = fieldsValid ? checkWorklogCorrection(correction, now) : 'Hours and minutes must be whole numbers, minutes under 60.';
  const endsAt = refusal ? null : new Date(Date.parse(correction.startedAtUtc) + durationSeconds * 1000);
  // Where it is, or where the correction would put it.
  const closedWeek = isInClosedWeek(worklog.startedAtUtc, lastWeekClosed) ||
    (correction.startedAtUtc !== '' && isInClosedWeek(correction.startedAtUtc, lastWeekClosed));
  const closedWeekNote = closedWeek && (
    <p role="note" className="text-[11px] text-accent-amber leading-relaxed">{closedWeekWarning(providerName)}</p>
  );
  // S16: warned before saving; saved anyway, the later entry waits.
  const corrected = { ...worklog, durationSeconds, startedAtUtc: correction.startedAtUtc };
  const clash = refusal ? null : findOverlaps([corrected, ...sameDay.filter(other => other.id !== worklog.id)])
    .find(overlap => overlap.earlier.id === worklog.id || overlap.later.id === worklog.id) ?? null;
  const clashWith = clash ? (clash.earlier.id === worklog.id ? clash.later : clash.earlier) : null;
  const overlapNote = clash && clashWith && (
    <p role="note" className="text-[11px] text-accent-amber leading-relaxed">
      It overlaps <span className="font-mono">{clashWith.taskKey ?? clashWith.taskId}</span>{' '}
      {formatClockTime(new Date(clashWith.startedAtUtc))}–{formatClockTime(new Date(Date.parse(clashWith.startedAtUtc) + clashWith.durationSeconds * 1000))}
      {' '}by {formatHoursAndMinutes(clash.seconds)}. Saved like this, {clash.later.id === worklog.id ? 'this entry' : 'that entry'} waits
      and is not sent to {providerName} until the overlap is fixed.
    </p>
  );

  const run = (call: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    call()
      .then(onDone)
      .catch(err => {
        console.warn('[EditWorklogModal] The change was refused:', err);
        setError(ipcErrorMessage(err));
        setBusy(false);
      });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
      <div
        role="dialog"
        aria-label={mode === 'edit' ? 'Correct a worklog' : 'Delete a worklog'}
        className="w-full max-w-lg bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6 space-y-5"
      >
        {mode === 'delete' ? (
          <>
            <ConfirmPanel
              title="Delete this worklog?"
              tone="danger"
              message={
                <>
                  <strong className="font-mono text-white">{formatHoursAndMinutes(worklog.durationSeconds)}</strong> on{' '}
                  <span className="font-mono text-text-primary font-bold">{key}</span>, started{' '}
                  {formatDayAndTime(new Date(worklog.startedAtUtc))}.{' '}
                  {worklog.syncState === 'local' || worklog.syncState === undefined
                    ? 'It is kept nowhere else.'
                    : `It is also deleted in ${providerName}.`}{' '}
                  You have ten seconds to undo it.
                </>
              }
              confirmLabel="Delete"
              cancelLabel="Back"
              onConfirm={() => run(() => window.electronAPI.deleteWorklog(worklog.id))}
              onCancel={onClose}
            />
            {closedWeekNote}
            {error && <p role="alert" className="text-xs text-accent-red">{error}</p>}
          </>
        ) : (
          <>
            <div className="flex items-center space-x-2 border-b border-border-dark pb-3">
              <Pencil className="w-4 h-4 text-text-primary" />
              <h3 className="text-sm font-bold text-white">
                Correct <span className="font-mono text-text-primary">{key}</span>
                {worklog.taskTitle && <span className="text-text-secondary font-normal"> {worklog.taskTitle}</span>}
              </h3>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="space-y-1">
                <span className="text-text-secondary">Hours</span>
                <input
                  type="number"
                  min={0}
                  value={hours}
                  onChange={e => setHours(e.target.value)}
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-focus"
                />
              </label>
              <label className="space-y-1">
                <span className="text-text-secondary">Minutes</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={minutes}
                  onChange={e => setMinutes(e.target.value)}
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-focus"
                />
              </label>
              <label className="space-y-1 col-span-2">
                <span className="text-text-secondary">Started</span>
                <input
                  type="datetime-local"
                  value={start}
                  onChange={e => {
                    setStart(e.target.value);
                    setNow(Date.now());
                  }}
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-focus"
                />
              </label>
              <label className="space-y-1 col-span-2">
                <span className="text-text-secondary">Comment</span>
                <textarea
                  value={comment}
                  maxLength={WORKLOG_COMMENT_MAX_CHARS}
                  rows={2}
                  onChange={e => setComment(e.target.value)}
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-focus resize-none"
                />
              </label>
            </div>

            <p className="text-[11px] text-text-secondary leading-relaxed">
              {endsAt && <>Ends at {formatHoursMinutes(endsAt)}. </>}
              {reachNote(worklog, providerName)} To put it on another task, use Move on its row in History.
            </p>

            {closedWeekNote}
            {overlapNote}

            {(refusal || error) && (
              <p role="alert" className="text-xs text-accent-red">{error ?? refusal}</p>
            )}

            <div className="flex justify-end space-x-3 pt-1">
              {onSplit && worklog.durationSeconds >= SPLIT_MIN_SECONDS && (
                <button
                  type="button"
                  onClick={onSplit}
                  className="mr-auto px-3 py-2 text-xs font-semibold text-text-secondary hover:text-white"
                >
                  Split in two…
                </button>
              )}
              <button
                onClick={onClose}
                className="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-text-secondary hover:text-white rounded-lg text-xs font-semibold border border-border-dark transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => run(() => window.electronAPI.updateWorklog(worklog.id, correction))}
                disabled={refusal !== null || busy}
                className="px-4 py-2 bg-primary hover:bg-primary/90 disabled:opacity-50 text-dark-900 rounded-lg text-xs font-semibold transition-all"
              >
                Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
