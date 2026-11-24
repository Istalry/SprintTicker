import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ScheduleSettingsDTO, WorklogDTO } from '../../../shared/dtos';
import { localDateKey, addLocalDays } from '../../../shared/local-date';
import { BREAKDOWN_SHOWN, describeSends, summarizeDay } from '../../../shared/day-summary';
import { countOf, formatDayAndMonth, formatHoursAndMinutes, formatLongDay, ipcErrorMessage } from '../../utils/formatters';
import { weekStartKey } from '../../../shared/working-days';
import { WeekView } from './WeekView';
import { WeekCalendar } from './WeekCalendar';
import { InterruptionsToPlace } from '../../components/InterruptionsToPlace';
import { useEntryActions } from '../../components/EntryActions';
import { EntriesHead, EntryRow } from '../../components/EntryRow';
import { AddTimeDialog, AddTimeStart, toLocalInput } from '../../components/AddTimeDialog';
import { DayTimeline, RunningSpan } from '../../components/DayTimeline';
import { CheckWeekDialog } from '../../components/CheckWeekDialog';
import { useProviderCapabilities } from '../../hooks/useProviderCapabilities';

interface DayRead {
  date: string;
  worklogs: WorklogDTO[];
  /** Its working hours and lunch come from it (S14b); null when it could not be read. */
  schedule: ScheduleSettingsDTO | null;
  /** On today, the session running: covered time, not untracked. */
  running: RunningSpan | null;
  /** When it was read: on today, the timeline ends there. */
  readAtMs: number;
}

/** The day's entries, in the order they were worked, with what its timeline needs. */
async function readDay(date: string): Promise<DayRead> {
  const api = window.electronAPI;
  const isToday = date === localDateKey();
  const [worklogs, schedule, session] = await Promise.all([
    api?.getWorklogsByDate ? api.getWorklogsByDate(date) : Promise.resolve([]),
    // The timeline goes without hours rather than the day without entries.
    api?.getScheduleSettings ? api.getScheduleSettings().catch(() => null) : Promise.resolve(null),
    isToday && api?.getCurrentSession ? api.getCurrentSession().catch(() => null) : Promise.resolve(null)
  ]);
  const readAtMs = Date.now();
  const running = session
    ? { startMs: Date.parse(session.startTimeUtc), endMs: readAtMs, label: session.interruption ? '⚡' : session.taskKey }
    : null;
  return {
    date,
    worklogs: [...worklogs].sort((a, b) => a.startedAtUtc.localeCompare(b.startedAtUtc)),
    schedule,
    running,
    readAtMs
  };
}

/** Local midnight of a date key. */
function dayOf(dateKey: string): Date {
  const [year, month, date] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, date);
}

/**
 * History's day (S14, P9a): what the day adds up to and where its sends
 * stand, each task's share on one line, and every entry with ⋯ -- Correct,
 * ↳ Move, Delete -- plus "+ Add time" for what was never timed, and the
 * day as a timeline (S14b, P9b), whose untracked stretches open it. The
 * interruptions still to place, of any day, sit above it.
 */
export interface WorklogHistoryViewProps {
  /**
   * Opens on this week's Check my week (P9d): the notice of a week just
   * closed passes its Monday. The view is remounted for each request, so
   * the initial state is the request.
   */
  checkWeekOf?: string;
}

export const WorklogHistoryView: React.FC<WorklogHistoryViewProps> = ({ checkWeekOf }) => {
  const [selectedDate, setSelectedDate] = useState<string>(checkWeekOf ?? localDateKey());
  // The last day read, which may trail the selected one while its read is in
  // flight. Loading is the gap between the two, derived rather than flagged:
  // a flag raised before the request is state set synchronously in an effect.
  const [day, setDay] = useState<DayRead | null>(null);
  // Bumped after a change, so the day is read again.
  const [revision, setRevision] = useState(0);
  const [adding, setAdding] = useState<AddTimeStart | null>(null);
  // The day, or the week it falls in (S15) as a sheet or a calendar (T3):
  // one date for all three, so switching keeps the place.
  const [mode, setMode] = useState<'day' | 'week' | 'calendar'>(checkWeekOf ? 'week' : 'day');
  // Check my week (S15b), over the week shown.
  const [checking, setChecking] = useState(Boolean(checkWeekOf));
  const [exported, setExported] = useState<{ ok: boolean; text: string } | null>(null);
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
        if (current) setDay({ date: selectedDate, worklogs: [], schedule: null, running: null, readAtMs: 0 });
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
  const monday = weekStartKey(selectedDate);
  const openDay = (dateKey: string) => {
    setSelectedDate(dateKey);
    setMode('day');
  };
  const exportWeek = () => {
    setExported(null);
    window.electronAPI.exportWorklogsCsv(monday, addLocalDays(monday, 6)).then(
      path => setExported(path ? { ok: true, text: `Saved to ${path}` } : null),
      err => setExported({ ok: false, text: `Not exported: ${ipcErrorMessage(err)}` })
    );
  };
  const switchButton = (to: 'day' | 'week' | 'calendar', label: string) => (
    <button
      type="button"
      aria-pressed={mode === to}
      onClick={() => setMode(to)}
      className={`px-2.5 py-1 rounded-md text-xs font-semibold ${mode === to ? 'bg-dark-700 text-white' : 'text-text-secondary hover:text-white'}`}
    >
      {label}
    </button>
  );

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
            <button aria-label={mode === 'day' ? 'The day before' : 'The week before'} onClick={() => changeDateByDays(mode === 'day' ? -1 : -7)} className={nav}>
              <ChevronLeft className="w-4 h-4" />
            </button>
            <label className="relative px-2 text-sm font-bold text-white cursor-pointer">
              {mode === 'day' ? formatLongDay(selectedDate) : `Week of ${formatDayAndMonth(monday)}`}
              <input
                type="date"
                aria-label="Day"
                value={selectedDate}
                onChange={e => { if (e.target.value) setSelectedDate(e.target.value); }}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </label>
            <button aria-label={mode === 'day' ? 'The day after' : 'The week after'} onClick={() => changeDateByDays(mode === 'day' ? 1 : 7)} className={nav}>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          {(mode === 'day' ? selectedDate !== today : monday !== weekStartKey(today)) && (
            <button
              type="button"
              onClick={() => setSelectedDate(today)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-border-dark text-text-secondary hover:text-white hover:border-focus"
            >
              Today
            </button>
          )}
          {mode === 'week' && (
            <button
              type="button"
              onClick={() => setChecking(true)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-border-dark text-text-secondary hover:text-white hover:border-focus"
            >
              Check my week…
            </button>
          )}
          {mode === 'week' && (
            <button
              type="button"
              onClick={exportWeek}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold border border-border-dark text-text-secondary hover:text-white hover:border-focus"
            >
              Export CSV
            </button>
          )}
          <div role="group" aria-label="Show" className="flex items-center gap-0.5 bg-dark-800 border border-border-dark rounded-lg p-0.5">
            {switchButton('day', 'Day')}
            {switchButton('week', 'Week')}
            {switchButton('calendar', 'Calendar')}
          </div>
        </div>
      </div>

      {exported && (
        <p role={exported.ok ? 'status' : 'alert'} className={`text-xs ${exported.ok ? 'text-text-secondary' : 'text-accent-red'}`}>{exported.text}</p>
      )}

      <InterruptionsToPlace
        onJumpToDay={openDay}
      />

      {entries.moveError && <p role="alert" className="text-xs text-accent-red">Not moved: {entries.moveError}</p>}

      {mode === 'week' && <WeekView monday={monday} revision={revision} onOpenDay={openDay} />}
      {mode === 'calendar' && <WeekCalendar monday={monday} revision={revision} onChanged={() => setRevision(r => r + 1)} onAdd={setAdding} />}

      {mode === 'day' && <section aria-label="The day's entries" className="bg-dark-800 border border-border-dark rounded-xl p-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-bold text-white">
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
          <p role="group" aria-label="Time by task" className="text-xs text-text-secondary">
            {named.map((share, i) => (
              <React.Fragment key={share.taskId}>
                {i > 0 && ' · '}
                <span title={share.title}><span className="font-mono font-bold text-text-primary">{share.key}</span> {formatHoursAndMinutes(share.seconds)}</span>
              </React.Fragment>
            ))}
            {more > 0 && ` · + ${more}`}
          </p>
        )}

        {!loading && day && (
          <DayTimeline
            day={dayOf(selectedDate)}
            entries={worklogs}
            schedule={day.schedule}
            running={day.running}
            untilMs={selectedDate === today ? day.readAtMs : undefined}
            onEntry={log => entries.run(log, 'edit')}
            onGap={gap => setAdding({
              dateKey: selectedDate,
              start: toLocalInput(new Date(gap.startMs)),
              durationSeconds: Math.round((gap.endMs - gap.startMs) / 60_000) * 60
            })}
          />
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
                    providerName={providerName}
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
      </section>}

      {entries.dialogs}
      {checking && (
        <CheckWeekDialog
          monday={monday}
          onClose={() => {
            setChecking(false);
            // A fix made from the check shows in the sheet behind it.
            setRevision(r => r + 1);
          }}
          onOpenDay={dateKey => {
            setChecking(false);
            openDay(dateKey);
          }}
          onExport={exportWeek}
        />
      )}
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
