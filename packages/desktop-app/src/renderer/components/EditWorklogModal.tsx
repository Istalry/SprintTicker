import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import { WorklogDTO } from '../../shared/dtos';
import { checkWorklogCorrection, WORKLOG_COMMENT_MAX_CHARS, WorklogCorrectionDTO } from '../../shared/worklog-correction';
import { formatDayAndTime, formatHoursAndMinutes, formatHoursMinutes, ipcErrorMessage } from '../utils/formatters';
import { ConfirmPanel } from './ConfirmPanel';

/** `YYYY-MM-DDTHH:MM` in local time, as a datetime-local input holds it. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** What a change does beyond this window, by where the worklog stands. */
function reachNote(worklog: WorklogDTO): string {
  return worklog.syncState === 'local' || worklog.syncState === undefined
    ? 'This worklog is kept in SprintTicker only.'
    : 'The change also goes to Jira or OpenProject, through the sync queue.';
}

interface EditWorklogModalProps {
  worklog: WorklogDTO;
  mode: 'edit' | 'delete';
  onClose: () => void;
  /** Called once main has accepted the change. */
  onDone: () => void;
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
export const EditWorklogModal: React.FC<EditWorklogModalProps> = ({ worklog, mode, onClose, onDone }) => {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 font-mono select-none">
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
                  <strong className="text-white">{formatHoursAndMinutes(worklog.durationSeconds)}</strong> on{' '}
                  <span className="text-accent-blue font-bold">{key}</span>, started{' '}
                  {formatDayAndTime(new Date(worklog.startedAtUtc))}.{' '}
                  {worklog.syncState === 'local' || worklog.syncState === undefined
                    ? 'It is kept nowhere else.'
                    : 'It is also deleted in Jira or OpenProject.'}{' '}
                  This cannot be undone.
                </>
              }
              confirmLabel="Delete"
              cancelLabel="Back"
              onConfirm={() => run(() => window.electronAPI.deleteWorklog(worklog.id))}
              onCancel={onClose}
            />
            {error && <p role="alert" className="text-xs text-accent-red">{error}</p>}
          </>
        ) : (
          <>
            <div className="flex items-center space-x-2 border-b border-border-dark pb-3">
              <Pencil className="w-4 h-4 text-accent-blue" />
              <h3 className="text-sm font-bold text-white">
                Correct <span className="text-accent-blue">{key}</span>
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
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-accent-blue"
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
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-accent-blue"
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
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-accent-blue"
                />
              </label>
              <label className="space-y-1 col-span-2">
                <span className="text-text-secondary">Comment</span>
                <textarea
                  value={comment}
                  maxLength={WORKLOG_COMMENT_MAX_CHARS}
                  rows={2}
                  onChange={e => setComment(e.target.value)}
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-accent-blue resize-none"
                />
              </label>
            </div>

            <p className="text-[11px] text-text-secondary leading-relaxed">
              {endsAt && <>Ends at {formatHoursMinutes(endsAt)}. </>}
              {reachNote(worklog)} The task cannot change: a worklog is not moved between issues.
            </p>

            {(refusal || error) && (
              <p role="alert" className="text-xs text-accent-red">{error ?? refusal}</p>
            )}

            <div className="flex justify-end space-x-3 pt-1">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-dark-700 hover:bg-dark-600 text-text-secondary hover:text-white rounded-lg text-xs font-semibold border border-border-dark transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => run(() => window.electronAPI.updateWorklog(worklog.id, correction))}
                disabled={refusal !== null || busy}
                className="px-4 py-2 bg-accent-blue hover:bg-blue-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-all"
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
