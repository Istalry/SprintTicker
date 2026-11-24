import React, { useState } from 'react';
import { ActiveSessionDTO, WorklogDTO } from '../../shared/dtos';
import { localDateKey } from '../../shared/local-date';
import { formatHoursAndMinutes, formatHoursMinutes } from '../utils/formatters';
import { hasTaskPage } from '../../shared/task-page';
import { ADHOC_PROJECT_ID } from '../../shared/adhoc-project';
import { TaskPageButton } from './TaskPageButton';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';
import { useEntryActions } from './EntryActions';
import { useInterruptionsToPlace } from './InterruptionsToPlace';
import { EntriesHead, EntryRow, ENTRY_CELL } from './EntryRow';
import { AddTimeDialog, AddTimeStart } from './AddTimeDialog';
import { groupEntriesByTask } from '../../shared/entry-groups';

/** Entries shown before "+ N more · show all": a heavy day stays one screen. */
export const TODAY_ENTRIES_SHOWN = 5;

/**
 * Today's entries (S5): one row per entry, newest first, with where it
 * stands with the provider and ⋯ for Correct, ↳ Move and Delete -- the same
 * actions and dialogs as History's rows. ⚡ marks time that started as an
 * interruption and was placed on its task.
 *
 * The header counts the day: everything done today (entries, the session
 * running, the interruptions of today still to place), what of it the
 * provider has, and what waits to be placed.
 *
 * It opens on the entries; *By task*, at its top right, shows one line per
 * task with the day's sum, unfolding into its entries (the user's choice,
 * 2026-11-24, LOCAL-WORK-AND-CALENDAR.md §4).
 */
export const TodayEntries: React.FC<{ session: ActiveSessionDTO | null; worklogs: WorklogDTO[] }> = ({ session, worklogs }) => {
  const [showAll, setShowAll] = useState(false);
  const [byTask, setByTask] = useState(false);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState<AddTimeStart | null>(null);
  const { providerName } = useProviderCapabilities();
  // Today's list follows main on its own (`onWorklogsUpdated`): nothing to read again here.
  const entries = useEntryActions(worklogs, () => undefined);
  const waiting = useInterruptionsToPlace();

  const today = localDateKey();
  const toPlaceSeconds = waiting
    .filter(item => localDateKey(new Date(item.startedAtUtc)) === today)
    .reduce((sum, item) => sum + item.durationSeconds, 0);
  const loggedSeconds = worklogs.reduce((sum, log) => sum + log.durationSeconds, 0);
  const sentSeconds = worklogs.filter(log => log.syncState === 'sent').reduce((sum, log) => sum + log.durationSeconds, 0);
  // During an interruption the session is the fragment; the task it holds
  // still counts (C6).
  const totalSeconds = loggedSeconds + (session?.elapsedSeconds ?? 0) + (session?.interruption?.heldElapsedSeconds ?? 0) + toPlaceSeconds;

  const newestFirst = [...worklogs].sort((a, b) => b.startedAtUtc.localeCompare(a.startedAtUtc));
  const shown = showAll ? newestFirst : newestFirst.slice(0, TODAY_ENTRIES_SHOWN);
  const groups = groupEntriesByTask(worklogs);
  const shownGroups = showAll ? groups : groups.slice(0, TODAY_ENTRIES_SHOWN);
  const hidden = byTask ? groups.length - shownGroups.length : newestFirst.length - shown.length;
  const toggleGroup = (key: string) => setUnfolded(current => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const anyInterruption = worklogs.some(log => log.fromInterruption);

  const summary = [
    formatHoursAndMinutes(totalSeconds),
    `${formatHoursAndMinutes(sentSeconds)} sent`,
    ...(toPlaceSeconds > 0 ? [`${formatHoursAndMinutes(toPlaceSeconds)} to place`] : [])
  ].join(' · ');

  const cell = ENTRY_CELL;
  return (
    <section aria-label="Today's entries" className="bg-dark-800 border border-border-dark rounded-xl p-6 space-y-3">
      <h3 className="text-base font-bold text-white flex items-center justify-between">
        <span>Today</span>
        <span className="flex items-center gap-3">
          <span className="text-xs text-text-secondary font-normal font-mono">{summary}</span>
          <span role="group" aria-label="Show today" className="inline-flex rounded-lg border border-border-dark p-0.5 text-xs font-semibold">
            {([['Entries', false], ['By task', true]] as const).map(([label, value]) => (
              <button
                key={label}
                type="button"
                aria-pressed={byTask === value}
                onClick={() => setByTask(value)}
                className={`px-2 py-0.5 rounded-md ${byTask === value ? 'bg-select text-white' : 'text-text-secondary hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </span>
          <button
            type="button"
            onClick={() => setAdding({ dateKey: today })}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-border-dark text-text-secondary hover:text-white hover:border-focus"
          >
            + Add time
          </button>
        </span>
      </h3>

      {entries.moveError && <p role="alert" className="text-xs text-accent-red">Not moved: {entries.moveError}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <EntriesHead providerName={providerName} />
          <tbody className="divide-y divide-border-dark text-sm">
            {session && (
              <tr className="bg-select">
                <td className={`${cell} font-mono font-bold text-text-primary`}>
                  <span className="inline-flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${session.status === 'TRACKING' ? 'bg-accent-green motion-safe:animate-pulse' : 'bg-accent-amber'}`} />
                    {session.interruption ? <span aria-hidden="true">⚡</span> : session.taskKey}
                    {!session.interruption && hasTaskPage(session.isAdHoc ? ADHOC_PROJECT_ID : session.projectId, session.providerId) && (
                      <TaskPageButton taskId={session.taskId} taskKey={session.taskKey} />
                    )}
                  </span>
                </td>
                {/* The rows' own pattern (C18): the note column, a duration, HH:MM. */}
                <td className={`${cell} text-text-secondary`}>{session.taskTitle}</td>
                <td className={`${cell} font-mono font-bold whitespace-nowrap ${session.status === 'TRACKING' ? 'text-accent-green' : 'text-accent-amber'}`}>
                  {formatHoursAndMinutes(session.elapsedSeconds)}
                  <span className="sr-only">{session.status === 'TRACKING' ? ', running' : ', paused'}</span>
                </td>
                <td className={`${cell} text-xs text-text-secondary font-mono`}>{formatHoursMinutes(new Date(session.startTimeUtc))}</td>
                <td className={cell} />
                <td className={cell} />
              </tr>
            )}
            {!byTask && shown.map(log => <EntryRow key={log.id} log={log} onAction={action => entries.run(log, action)} providerName={providerName} />)}
            {byTask && shownGroups.map(group => {
              const open = unfolded.has(group.key);
              const count = `${group.entries.length} ${group.entries.length === 1 ? 'entry' : 'entries'}`;
              return (
                <React.Fragment key={group.key}>
                  <tr className="hover:bg-dark-700/50">
                    <td className={`${cell} font-mono font-bold text-text-primary whitespace-nowrap`}>{group.taskKey}</td>
                    <td className={`${cell} text-text-primary`}>
                      {group.taskTitle}
                      {group.projectName && <span className="text-text-secondary"> · {group.projectName}</span>}
                    </td>
                    <td className={`${cell} font-mono text-text-primary font-bold whitespace-nowrap`}>{formatHoursAndMinutes(group.seconds)}</td>
                    <td className={cell} colSpan={3}>
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={`${count} of ${group.taskKey}`}
                        onClick={() => toggleGroup(group.key)}
                        className="text-xs text-text-secondary hover:text-white"
                      >
                        {count} <span aria-hidden="true">{open ? '▾' : '▸'}</span>
                      </button>
                    </td>
                  </tr>
                  {open && group.entries.map(log => (
                    <EntryRow key={log.id} log={log} onAction={action => entries.run(log, action)} providerName={providerName} />
                  ))}
                </React.Fragment>
              );
            })}
            {!session && worklogs.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-xs text-text-secondary">
                  Nothing logged today yet. Start a task above and its time shows here.
                </td>
              </tr>
            )}
            {(hidden > 0 || anyInterruption) && (
              <tr>
                <td colSpan={6} className="py-2.5 text-center text-xs text-text-secondary">
                  {hidden > 0 && (
                    <>+ {hidden} more · <button type="button" onClick={() => setShowAll(true)} className="underline underline-offset-2 hover:text-white">show all</button></>
                  )}
                  {hidden > 0 && anyInterruption && ' · '}
                  {anyInterruption && '⚡ marks time that started as an interruption'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {entries.dialogs}
      <AddTimeDialog opening={adding} onClose={() => setAdding(null)} onAdded={() => setAdding(null)} />
    </section>
  );
};
