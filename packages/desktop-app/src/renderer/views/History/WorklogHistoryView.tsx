import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { WorklogDTO } from '../../../shared/dtos';
import { localDateKey, addLocalDays } from '../../../shared/local-date';
import { BREAKDOWN_SHOWN, describeSends, summarizeDay } from '../../../shared/day-summary';
import { countOf, formatHoursAndMinutes, formatLongDay } from '../../utils/formatters';
import { InterruptionsToPlace } from '../../components/InterruptionsToPlace';
import { useEntryActions } from '../../components/EntryActions';
import { EntriesHead, EntryRow } from '../../components/EntryRow';
import { AddTimeDialog, AddTimeStart } from '../../components/AddTimeDialog';
import { useProviderCapabilities } from '../../hooks/useProviderCapabilities';

interface DayRead {
  date: string;
  worklogs: WorklogDTO[];
}

/** The day's entries, in the order they were worked. */
async function readDay(date: string): Promise<DayRead> {
  const api = window.electronAPI;
  const worklogs = api?.getWorklogsByDate ? await api.getWorklogsByDate(date) : [];
  return { date, worklogs: [...worklogs].sort((a, b) => a.startedAtUtc.localeCompare(b.startedAtUtc)) };
}

/**
 * History's day (S14, P9a): what the day adds up to and where its sends
 * stand, each task's share on one line, and every entry with ⋯ -- Correct,
 * ↳ Move, Delete -- plus "+ Add time" for what was never timed. The
 * interruptions still to place, of any day, sit above it.
 */
export const WorklogHistoryView: React.FC = () => {
  const [selectedDate, setSelectedDate] = useState<string>(localDateKey());
  // The last day read, which may trail the selected one while its read is in
  // flight. Loading is the gap between the two, derived rather than flagged:
  // a flag raised before the request is state set synchronously in an effect.
  const [day, setDay] = useState<DayRead | null>(null);
  // Bumped after a change, so the day is read again.
  const [revision, setRevision] = useState(0);
  const [adding, setAdding] = useState<AddTimeStart | null>(null);
  const { providerName } = useProviderCapabilities();
  const worklogs = day?.worklogs ?? [];
  const loading = day?.date !== selectedDate;
  const entries = useEntryActions(worklogs, () => setRevision(r => r + 1));
  const today = localDateKey();

  useEffect(() => {
    // Stepping through days quickly can answer out of order; only the read
    // for the day still selected may land.
    let current = true;
    readDay(selectedDate).then(
      read => { if (current) setDay(read); },
      err => {
        // Without this the list never stopped loading: the read failed and
        // nothing ever marked the day as done.
        console.error('[WorklogHistoryView] Failed to read worklogs for', selectedDate, err);
        if (current) setDay({ date: selectedDate, worklogs: [] });
      }
    );
    return () => { current = false; };
  }, [selectedDate, revision]);

  /** Names ad-hoc work; the day is read again with the name. */
  const renameTask = (taskId: string, name: string) =>
    window.electronAPI.renameAdHocTask(taskId, name).then(() => setRevision(r => r + 1));

  // Stepped by key: a Date built from a date-only string is UTC midnight,
  // which west of UTC is still the day before, and "next" went nowhere.
  const changeDateByDays = (days: number) => setSelectedDate(addLocalDays(selectedDate, days));

  const summary = summarizeDay(worklogs);
  const sends = describeSends(worklogs);
  const named = summary.tasks.slice(0, BREAKDOWN_SHOWN);
  const more = summary.tasks.length - named.length;
  const nav = 'p-1.5 text-text-secondary hover:text-white hover:bg-dark-700 rounded transition-colors';

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6 select-none">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border-dark pb-6">
        <h2 className="text-xl font-bold text-white tracking-wide">History</h2>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-dark-800 border border-border-dark rounded-lg p-1">
            <button aria-label="The day before" onClick={() => changeDateByDays(-1)} className={nav}>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <label className="relative px-2 text-sm font-bold text-white cursor-pointer">
              {formatLongDay(selectedDate)}
              <input
                type="date"
                aria-label="Day"
                value={selectedDate}
                onChange={e => { if (e.target.value) setSelectedDate(e.target.value); }}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </label>
            <button aria-label="The day after" onClick={() => changeDateByDays(1)} className={nav}>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          {selectedDate !== today && (
            <button
              type="button"
              onClick={() => setSelectedDate(today)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-border-dark text-text-secondary hover:text-white hover:border-focus"
            >
              Today
            </button>
          )}
        </div>
      </div>

      <InterruptionsToPlace
        hint="Put each on the task it was for, and its time is sent there. Kept off, it stays in SprintTicker only."
        onJumpToDay={setSelectedDate}
      />

      {entries.moveError && <p role="alert" className="text-xs text-accent-red">Not moved: {entries.moveError}</p>}

      <section aria-label="The day's entries" className="bg-dark-800 border border-border-dark rounded-xl p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-md font-bold text-white">
            <span className="font-mono">{formatHoursAndMinutes(summary.totalSeconds)}</span>
            <span className="text-text-secondary font-normal"> · {countOf(summary.tasks.length, 'task')} · {countOf(summary.entries, 'entry', 'entries')}</span>
          </h3>
          <div className="flex items-center gap-3">
            {sends && <span className="text-xs text-text-secondary">{sends}</span>}
            <button
              type="button"
              onClick={() => setAdding({ dateKey: selectedDate })}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-border-dark text-text-secondary hover:text-white hover:border-focus"
            >
              + Add time
            </button>
          </div>
        </div>

        {named.length > 0 && (
          <p aria-label="Time by task" className="text-xs text-text-secondary">
            {named.map((share, i) => (
              <React.Fragment key={share.taskId}>
                {i > 0 && ' · '}
                <span title={share.title}><span className="font-mono font-bold text-text-primary">{share.key}</span> {formatHoursAndMinutes(share.seconds)}</span>
              </React.Fragment>
            ))}
            {more > 0 && ` · + ${more}`}
          </p>
        )}

        {loading ? (
          <div className="text-xs text-text-secondary py-4">Loading the day…</div>
        ) : worklogs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <EntriesHead providerName={providerName} />
              <tbody className="divide-y divide-border-dark text-sm">
                {worklogs.map(log => (
                  <EntryRow
                    key={log.id}
                    log={log}
                    onAction={action => entries.run(log, action)}
                    onRename={name => renameTask(log.taskId, name)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-xs text-text-secondary">
            Nothing logged on {formatLongDay(selectedDate)}. + Add time puts in what you did without the timer.
          </div>
        )}
      </section>

      {entries.dialogs}
      <AddTimeDialog
        opening={adding}
        onClose={() => setAdding(null)}
        onAdded={() => {
          setAdding(null);
          setRevision(r => r + 1);
        }}
      />
    </div>
  );
};
