import React, { useState } from 'react';
import { ActiveSessionDTO, WorklogDTO } from '../../shared/dtos';
import { localDateKey } from '../../shared/local-date';
import { formatClockTime, formatHoursAndMinutes } from '../utils/formatters';
import { useProviderCapabilities } from '../hooks/useProviderCapabilities';
import { useEntryActions, EntryMenu } from './EntryActions';
import { useInterruptionsToPlace } from './InterruptionsToPlace';
import { SyncBadge } from './SyncBadge';

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
 */
export const TodayEntries: React.FC<{ session: ActiveSessionDTO | null; worklogs: WorklogDTO[] }> = ({ session, worklogs }) => {
  const [showAll, setShowAll] = useState(false);
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
  const totalSeconds = loggedSeconds + (session?.elapsedSeconds ?? 0) + toPlaceSeconds;

  const newestFirst = [...worklogs].sort((a, b) => b.startedAtUtc.localeCompare(a.startedAtUtc));
  const shown = showAll ? newestFirst : newestFirst.slice(0, TODAY_ENTRIES_SHOWN);
  const hidden = newestFirst.length - shown.length;
  const anyInterruption = worklogs.some(log => log.fromInterruption);

  const summary = [
    formatHoursAndMinutes(totalSeconds),
    `${formatHoursAndMinutes(sentSeconds)} sent`,
    ...(toPlaceSeconds > 0 ? [`${formatHoursAndMinutes(toPlaceSeconds)} to place`] : [])
  ].join(' · ');

  const cell = 'py-2.5 px-3';
  return (
    <section aria-label="Today's entries" className="bg-dark-800 border border-border-dark rounded-xl p-6 space-y-3">
      <h3 className="text-md font-bold text-white flex items-center justify-between">
        <span>Today</span>
        <span className="text-xs text-text-secondary font-normal font-mono">{summary}</span>
      </h3>

      {entries.moveError && <p role="alert" className="text-xs text-accent-red">Not moved: {entries.moveError}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-border-dark text-text-secondary text-xs">
              <th className={`${cell} font-semibold`}>Task</th>
              <th className={`${cell} font-semibold`}>Note</th>
              <th className={`${cell} font-semibold`}>Time</th>
              <th className={`${cell} font-semibold`}>Started</th>
              <th className={`${cell} font-semibold`}>{providerName || 'Sent'}</th>
              <th className={cell}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-dark text-sm">
            {session && (
              <tr className="bg-select">
                <td className={`${cell} font-mono font-bold text-text-primary`}>
                  <span className="inline-flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${session.status === 'TRACKING' ? 'bg-accent-green animate-pulse' : 'bg-accent-amber'}`} />
                    {session.interruption ? '⚡' : session.taskKey}
                  </span>
                </td>
                <td className={`${cell} text-white font-medium`}>{session.taskTitle}</td>
                <td className={`${cell} text-xs font-semibold ${session.status === 'TRACKING' ? 'text-accent-green' : 'text-accent-amber'}`}>
                  {session.status === 'TRACKING' ? 'running' : 'paused'}
                </td>
                <td className={`${cell} text-xs text-text-secondary font-mono`}>{formatClockTime(new Date(session.startTimeUtc))}</td>
                <td className={cell} />
                <td className={cell} />
              </tr>
            )}
            {shown.map(log => (
              <tr key={log.id} className={`transition-colors ${log.fromInterruption ? 'bg-accent-amber/5 hover:bg-accent-amber/10' : 'hover:bg-dark-700/50'}`}>
                <td className={`${cell} font-mono font-bold text-text-primary whitespace-nowrap`}>
                  {log.fromInterruption && <span title="Started as an interruption" className="text-accent-amber">⚡ </span>}
                  {log.taskKey ?? log.taskId}
                </td>
                <td className={`${cell} text-text-primary`}>
                  {log.comment || <span className="text-text-secondary">{log.taskTitle ?? ''}</span>}
                </td>
                <td className={`${cell} font-mono text-text-primary font-bold whitespace-nowrap`}>{formatHoursAndMinutes(log.durationSeconds)}</td>
                <td className={`${cell} text-xs text-text-secondary font-mono`}>{formatClockTime(new Date(log.startedAtUtc))}</td>
                <td className={cell}><SyncBadge log={log} /></td>
                <td className={`${cell} text-right`}><EntryMenu log={log} onAction={action => entries.run(log, action)} /></td>
              </tr>
            ))}
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
    </section>
  );
};
