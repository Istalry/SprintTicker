import React, { useState, useEffect } from 'react';
import { Calendar, Clock, CheckCircle2, FileText, ChevronLeft, ChevronRight, Pencil, Trash2, ArrowRightLeft } from 'lucide-react';
import { WorklogDTO } from '../../../shared/dtos';
import { WorklogSyncState } from '../../../shared/worklog-correction';
import { localDateKey, addLocalDays } from '../../../shared/local-date';
import { formatClockTime } from '../../utils/formatters';
import { EditWorklogModal } from '../../components/EditWorklogModal';
import { TaskPageButton } from '../../components/TaskPageButton';
import { InlineRename } from '../../components/InlineRename';
import { TaskPicker } from '../../components/TaskPicker';
import { countOf, formatDay, formatHoursAndMinutes, ipcErrorMessage } from '../../utils/formatters';
import { ConfirmPanel } from '../../components/ConfirmPanel';
import { closedWeekWarning, isInClosedWeek } from '../../../shared/closed-week';
import { useProviderCapabilities } from '../../hooks/useProviderCapabilities';
import { InterruptionsToPlace } from '../../components/InterruptionsToPlace';
import { StateWord } from '../../../shared/words';

/** The badge of an earlier interruption's entry, still to place. */
const TO_SORT_BADGE = 'px-1.5 py-0.5 border rounded text-[10px] text-accent-amber border-accent-amber/40';

/** How each sync state reads on a row, and what its tooltip adds. */
const SYNC_BADGE: Record<WorklogSyncState, { label: string; tone: string; hint: string }> = {
  local: { label: 'Local only', tone: 'text-text-secondary border-border-dark', hint: 'Kept in SprintTicker; never sent to a provider.' },
  pending: { label: 'Sending', tone: 'text-accent-amber border-accent-amber/40', hint: 'Queued for the provider.' },
  sent: { label: 'Sent', tone: 'text-accent-green border-accent-green/40', hint: 'At the provider.' },
  failed: { label: 'Not sent', tone: 'text-accent-red border-accent-red/40', hint: 'Parked: see Entries waiting to send, in Settings, Account.' },
  'correction-pending': { label: 'Correction pending', tone: 'text-accent-amber border-accent-amber/40', hint: 'A correction is on its way to the provider.' },
  'correction-failed': { label: 'Correction failed', tone: 'text-accent-red border-accent-red/40', hint: 'Parked: see Entries waiting to send, in Settings, Account.' },
  'held-overlap': { label: 'Waiting', tone: 'text-accent-amber border-accent-amber/40', hint: 'It overlaps an earlier entry, and is not sent until one of them is corrected.' }
};

/** "Waiting · overlaps PF-31" for an entry an overlap holds back; the state's own label otherwise. */
function syncBadgeLabel(log: WorklogDTO): string {
  const label = SYNC_BADGE[log.syncState!].label;
  return log.syncState === 'held-overlap' && log.overlapsTaskKey ? `${label} · overlaps ${log.overlapsTaskKey}` : label;
}

interface DaySummary {
  totalSeconds: number;
  tasksCount: number;
  items: Array<{ taskId: string; key: string; title: string; durationSeconds: number; comment: string }>;
}

interface DayRead {
  date: string;
  worklogs: WorklogDTO[];
  summary: DaySummary;
}

const EMPTY_SUMMARY: DaySummary = { totalSeconds: 0, tasksCount: 0, items: [] };

async function readDay(date: string): Promise<DayRead> {
  const api = window.electronAPI;
  const worklogs = api?.getWorklogsByDate ? await api.getWorklogsByDate(date) : [];
  const summary = api?.getDailyWorklogSummary ? await api.getDailyWorklogSummary(date) : EMPTY_SUMMARY;
  return { date, worklogs, summary };
}

export const WorklogHistoryView: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState<string>(localDateKey());
  // The last day read, which may trail the selected one while its read is in
  // flight. Loading is the gap between the two, derived rather than flagged:
  // a flag raised before the request is state set synchronously in an effect.
  const [day, setDay] = useState<DayRead | null>(null);
  // Bumped after a correction or deletion, so the day is read again.
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<{ worklog: WorklogDTO; mode: 'edit' | 'delete' } | null>(null);
  // The worklogs whose task is being picked, and the label of what moves.
  const [moving, setMoving] = useState<{ worklogIds: string[]; label: string } | null>(null);
  // A move of closed-week time, waiting for the user to say go on.
  const [askingMove, setAskingMove] = useState<{ worklogIds: string[]; label: string } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [lastWeekClosed, setLastWeekClosed] = useState<string | null>(null);
  const { providerName } = useProviderCapabilities();
  const worklogs = day?.worklogs ?? [];
  const summary = day?.summary ?? EMPTY_SUMMARY;
  const loading = day?.date !== selectedDate;

  useEffect(() => {
    // Stepping through days quickly can answer out of order; only the read
    // for the day still selected may land.
    let current = true;
    readDay(selectedDate).then(
      read => { if (current) setDay(read); },
      err => {
        // Without this the spinner never stopped: the read failed and nothing
        // ever marked the day as done.
        console.error('[WorklogHistoryView] Failed to read worklogs for', selectedDate, err);
        if (current) setDay({ date: selectedDate, worklogs: [], summary: EMPTY_SUMMARY });
      }
    );
    return () => { current = false; };
  }, [selectedDate, revision]);

  useEffect(() => {
    let current = true;
    const read = window.electronAPI?.getLastWeekClosed;
    if (!read) return undefined;
    read().then(
      monday => { if (current) setLastWeekClosed(monday); },
      err => console.error('[WorklogHistoryView] Failed to read the last week closed:', err)
    );
    return () => { current = false; };
  }, [revision]);

  /** Opens the picker for these worklogs -- after asking, when any is closed-week time. */
  const startMove = (logs: WorklogDTO[], label: string) => {
    const request = { worklogIds: logs.map(log => log.id), label };
    if (logs.some(log => isInClosedWeek(log.startedAtUtc, lastWeekClosed))) setAskingMove(request);
    else setMoving(request);
  };

  /**
   * Moves the worklogs to the task picked, one after the other: each is its
   * own deletion and send. A refusal stops there and is shown; the ones
   * moved before it stay moved.
   */
  const moveTo = async (worklogIds: string[], taskId: string) => {
    setMoving(null);
    setMoveError(null);
    try {
      for (const id of worklogIds) await window.electronAPI.moveWorklog(id, taskId);
    } catch (err) {
      setMoveError(ipcErrorMessage(err));
    } finally {
      setRevision(r => r + 1);
    }
  };

  /** Names ad-hoc work; the day and the list are read again with the name. */
  const renameTask = (taskId: string, name: string) =>
    window.electronAPI.renameAdHocTask(taskId, name).then(() => setRevision(r => r + 1));

  // Date Navigation Helpers
  const changeDateByDays = (days: number) => {
    // This used to build a Date from the key -- which parses a date-only string
    // as UTC midnight -- and then step it with local getters. West of UTC that
    // instant is still the previous day locally, so "next day" resolved back to
    // the day it started on and the control did nothing.
    setSelectedDate(addLocalDays(selectedDate, days));
  };

  const formatDuration = formatHoursAndMinutes;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 select-none">
      {/* Header & Date Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-border-dark pb-6">
        <div>
          <h2 className="text-xl font-bold text-white tracking-wide">History</h2>
          <p className="text-xs text-text-secondary mt-1">
            Historical day-by-day log of tracked tasks, work sessions, and total duration summaries.
          </p>
        </div>

        <div className="flex items-center space-x-2 bg-dark-800 border border-border-dark rounded-lg p-1.5 shadow-sm">
          <button
            onClick={() => changeDateByDays(-1)}
            className="p-1.5 text-text-secondary hover:text-white hover:bg-dark-700 rounded transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center space-x-2 px-2">
            <Calendar className="w-4 h-4 text-text-primary" />
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="bg-transparent text-xs font-bold text-white outline-none cursor-pointer"
            />
          </div>

          <button
            onClick={() => changeDateByDays(1)}
            className="p-1.5 text-text-secondary hover:text-white hover:bg-dark-700 rounded transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <InterruptionsToPlace
        hint="Put each on the task it was for, and its time is sent there. Kept off, it stays in SprintTicker only."
        onJumpToDay={setSelectedDate}
      />

      {moveError && (
        <p role="alert" className="text-xs text-accent-red">Not moved: {moveError}</p>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-dark-800 border border-border-dark rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-text-secondary text-xs">
            <span>Total Logged Time</span>
            <Clock className="w-4 h-4 text-text-primary" />
          </div>
          <div className="text-2xl font-bold text-white font-mono">
            {formatDuration(summary.totalSeconds)}
          </div>
          <div className="text-[10px] text-text-secondary">Tracked on {formatDay(selectedDate)}</div>
        </div>

        <div className="bg-dark-800 border border-border-dark rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-text-secondary text-xs">
            <span>Tasks Worked On</span>
            <CheckCircle2 className="w-4 h-4 text-accent-green" />
          </div>
          <div className="text-2xl font-bold text-white">
            {countOf(summary.tasksCount, 'task')}
          </div>
          <div className="text-[10px] text-text-secondary">Itemized task logs</div>
        </div>

        <div className="bg-dark-800 border border-border-dark rounded-xl p-5 space-y-2">
          <div className="flex items-center justify-between text-text-secondary text-xs">
            <span>Logged Sessions</span>
            <FileText className="w-4 h-4 text-text-primary" />
          </div>
          <div className="text-2xl font-bold text-white">
            {countOf(worklogs.length, 'session')}
          </div>
          <div className="text-[10px] text-text-secondary">Completed tracking sessions</div>
        </div>
      </div>

      {/* Task Summary Breakdown Section */}
      <div className="bg-dark-800 border border-border-dark rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-white">
          Task Duration Breakdown
        </h3>

        {summary.items.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {summary.items.map(item => (
              <div
                key={item.taskId}
                className="p-4 bg-dark-900/60 border border-border-dark rounded-lg flex items-center justify-between"
              >
                <div className="space-y-1">
                  <span className="px-2 py-0.5 bg-dark-700 text-text-primary text-[10px] font-mono font-bold rounded">
                    {item.key}
                  </span>
                  <div className="text-xs font-bold text-white">{item.title}</div>
                </div>

                <div className="text-xs font-mono font-bold text-accent-green bg-accent-green/10 border border-accent-green/30 px-2.5 py-1 rounded">
                  {formatDuration(item.durationSeconds)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-text-secondary">
            No work logged on {formatDay(selectedDate)}.
          </div>
        )}
      </div>

      {/* Detailed Chronological Worklog List */}
      <div className="bg-dark-800 border border-border-dark rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-white">
          Chronological Session Log ({worklogs.length})
        </h3>

        {loading ? (
          <div className="text-xs text-text-secondary py-4">Loading session history...</div>
        ) : worklogs.length > 0 ? (
          <div className="space-y-2">
            {worklogs.map(log => (
              <div
                key={log.id}
                className="flex items-center justify-between p-3.5 bg-dark-900/60 border border-border-dark rounded-lg text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-white">{log.taskKey ?? log.taskId}</span>
                    {log.taskTitle && (log.adHoc ? (
                      <InlineRename
                        title={log.taskTitle}
                        ownerId={log.taskId}
                        onRename={name => renameTask(log.taskId, name)}
                        className="text-text-secondary"
                        inputClassName="bg-dark-800 border border-focus rounded px-2 py-0.5 text-white outline-none"
                      />
                    ) : (
                      <span className="text-text-secondary">{log.taskTitle}</span>
                    ))}
                    {log.unsorted && <span className={TO_SORT_BADGE} title="An interruption not placed on a task yet.">{StateWord.TO_PLACE}</span>}
                    {log.hasTaskPage && <TaskPageButton taskId={log.taskId} taskKey={log.taskKey ?? log.taskId} />}
                    <span className="text-text-secondary">• {formatClockTime(new Date(log.startedAtUtc))}</span>
                  </div>
                  {log.comment && (
                    <div className="text-text-secondary italic text-[11px]">&quot;{log.comment}&quot;</div>
                  )}
                </div>

                <div className="flex items-center space-x-3">
                  {log.syncState && (
                    <span
                      title={SYNC_BADGE[log.syncState].hint}
                      className={`px-1.5 py-0.5 border rounded text-[10px] ${SYNC_BADGE[log.syncState].tone}`}
                    >
                      {syncBadgeLabel(log)}
                    </span>
                  )}
                  <div className="font-mono font-bold text-text-primary">
                    {formatDuration(log.durationSeconds)}
                  </div>
                  <button
                    aria-label={`Correct ${log.taskKey ?? log.taskId} at ${formatClockTime(new Date(log.startedAtUtc))}`}
                    onClick={() => setEditing({ worklog: log, mode: 'edit' })}
                    className="p-1 text-text-secondary hover:text-white hover:bg-dark-700 rounded transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    aria-label={`Move ${log.taskKey ?? log.taskId} at ${formatClockTime(new Date(log.startedAtUtc))} to another task`}
                    title="Move to another task"
                    onClick={() => startMove([log], log.taskTitle ?? log.taskKey ?? log.taskId)}
                    className="p-1 text-text-secondary hover:text-white hover:bg-dark-700 rounded transition-colors"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    aria-label={`Delete ${log.taskKey ?? log.taskId} at ${formatClockTime(new Date(log.startedAtUtc))}`}
                    onClick={() => setEditing({ worklog: log, mode: 'delete' })}
                    className="p-1 text-text-secondary hover:text-accent-red hover:bg-dark-700 rounded transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-xs text-text-secondary">
            No session records found for {formatDay(selectedDate)}.
          </div>
        )}
      </div>

      {askingMove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-dark-900/80 backdrop-blur-sm p-4 select-none">
          <div className="w-full max-w-lg bg-dark-800 border border-border-dark rounded-xl shadow-2xl p-6">
            <ConfirmPanel
              title="Move time from a closed week?"
              message={<><strong className="text-white">{askingMove.label}</strong>. {closedWeekWarning(providerName)}</>}
              confirmLabel="Choose a task"
              cancelLabel="Back"
              onConfirm={() => { setMoving(askingMove); setAskingMove(null); }}
              onCancel={() => setAskingMove(null)}
            />
          </div>
        </div>
      )}

      <TaskPicker
        isOpen={moving !== null}
        mode="move"
        subtitle={moving ? `${moving.label}: its time goes to the task you pick` : undefined}
        onClose={() => setMoving(null)}
        onPick={picked => { if (moving && picked.task) void moveTo(moving.worklogIds, picked.task.id); }}
      />

      {editing && (
        <EditWorklogModal
          key={`${editing.worklog.id}-${editing.mode}`}
          worklog={editing.worklog}
          mode={editing.mode}
          sameDay={worklogs}
          lastWeekClosed={lastWeekClosed}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            setRevision(r => r + 1);
          }}
        />
      )}
    </div>
  );
};
