import React, { useEffect, useState } from 'react';
import { WorklogDTO } from '../../../shared/dtos';
import { addLocalDays, localDateKey } from '../../../shared/local-date';
import { buildWeekSheet, dayNotes, describeWeekExceptions } from '../../../shared/week-sheet';
import { formatHoursAndMinutes, formatWeekday } from '../../utils/formatters';
import { useInterruptionsToPlace } from '../../components/InterruptionsToPlace';
import { useProviderCapabilities } from '../../hooks/useProviderCapabilities';

/** Projects listed before "▸ N more projects · show all". */
export const WEEK_PROJECTS_SHOWN = 3;
/** Weekdays shown even when empty: Monday to Friday. A weekend shows when it has time. */
const WEEKDAYS_SHOWN = 5;

interface WeekRead {
  monday: string;
  entries: WorklogDTO[];
}

const dateOf = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const weekdayShort = (key: string) => formatWeekday(key, 'short');
const weekdayLong = (key: string) => formatWeekday(key, 'long');

/**
 * History's week (S15, P9c): a timesheet grouped by project, each task's
 * time on each day, the Day row, and the row of what the provider holds --
 * what the user's manager sees, which leaves out what is held, sending, or
 * still to place. A day's amber cell says why it differs. A day's total, or
 * a task's cell, opens that day.
 */
export const WeekView: React.FC<{ monday: string; revision: number; onOpenDay: (dateKey: string) => void }> = ({ monday, revision, onOpenDay }) => {
  const [read, setRead] = useState<WeekRead | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [opened, setOpened] = useState<ReadonlySet<string> | null>(null);
  const { providerName } = useProviderCapabilities();
  const provider = providerName || 'your provider';
  const waiting = useInterruptionsToPlace();
  const sunday = addLocalDays(monday, 6);

  useEffect(() => {
    let current = true;
    const api = window.electronAPI;
    if (!api?.getWorklogsRange) return undefined;
    api.getWorklogsRange(monday, sunday).then(
      entries => { if (current) setRead({ monday, entries }); },
      err => {
        console.error('[WeekView] Failed to read the week of', monday, err);
        if (current) setRead({ monday, entries: [] });
      }
    );
    return () => { current = false; };
  }, [monday, sunday, revision]);

  if (!read || read.monday !== monday) return <div className="text-xs text-text-secondary py-4">Loading the week…</div>;

  const allDays = Array.from({ length: 7 }, (_, i) => addLocalDays(monday, i));
  const withTime = new Set(read.entries.map(e => localDateKey(new Date(e.startedAtUtc))));
  const dayKeys = allDays.filter((key, i) => i < WEEKDAYS_SHOWN || withTime.has(key));
  const sheet = buildWeekSheet(dayKeys, read.entries, waiting);
  const projects = showAll ? sheet.projects : sheet.projects.slice(0, WEEK_PROJECTS_SHOWN);
  const hidden = sheet.projects.length - projects.length;
  // The largest project opens by itself; the rest wait for a click.
  const open = opened ?? new Set(sheet.projects.slice(0, 1).map(p => p.projectId));
  const toggle = (projectId: string) => {
    const next = new Set(open);
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    setOpened(next);
  };
  const exceptions = describeWeekExceptions(sheet, read.entries, weekdayLong, provider);

  const cell = 'py-2 px-3 text-right font-mono whitespace-nowrap';
  const time = (seconds: number) => (seconds ? formatHoursAndMinutes(seconds) : '');
  return (
    <section aria-label="The week" className="bg-dark-800 border border-border-dark rounded-xl p-6 space-y-3">
      {sheet.total === 0 && sheet.toPlaceTotal === 0 ? (
        <div className="text-center py-8 text-xs text-text-secondary">Nothing logged this week.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border-dark text-text-secondary text-xs">
                <th className="py-2 px-3 text-left font-semibold">Project / task</th>
                {dayKeys.map(key => <th key={key} className="py-2 px-3 text-right font-semibold">{weekdayShort(key)} {dateOf(key).getDate()}</th>)}
                <th className="py-2 px-3 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-dark">
              {projects.map(project => (
                <React.Fragment key={project.projectId}>
                  <tr className="bg-dark-900/40">
                    <td className="py-2 px-3">
                      <button type="button" aria-expanded={open.has(project.projectId)} onClick={() => toggle(project.projectId)} className="font-bold text-white whitespace-nowrap hover:text-accent-green">
                        {open.has(project.projectId) ? '▾' : '▸'} {project.name}
                      </button>
                    </td>
                    {dayKeys.map((key, i) => <td key={key} className={`${cell} text-text-secondary`}>{open.has(project.projectId) ? '' : time(project.perDay[i])}</td>)}
                    <td className={`${cell} font-bold text-white`}>{formatHoursAndMinutes(project.total)}</td>
                  </tr>
                  {open.has(project.projectId) && project.tasks.map(task => (
                    <tr key={task.taskId} className="hover:bg-dark-700/40">
                      <td className="py-2 px-3 pl-8 text-text-primary whitespace-nowrap">
                        <span className="font-mono font-bold">{task.key}</span>{' '}
                        <span title={task.title} className="inline-block max-w-[14rem] truncate align-bottom text-text-secondary">{task.title}</span>
                      </td>
                      {dayKeys.map((key, i) => (
                        <td key={key} className={cell}>
                          {task.perDay[i] > 0 && (
                            <button type="button" onClick={() => onOpenDay(key)} className="text-text-primary hover:text-white hover:underline">
                              {formatHoursAndMinutes(task.perDay[i])}
                              {/* The time is the name, read first; the label used to replace it (REVIEW-2026-11 A3). */}
                              <span className="sr-only">, {task.key} on {weekdayLong(key)}: open the day</span>
                            </button>
                          )}
                        </td>
                      ))}
                      <td className={`${cell} text-text-primary`}>{formatHoursAndMinutes(task.total)}</td>
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              {hidden > 0 && (
                <tr>
                  <td colSpan={dayKeys.length + 2} className="py-2 px-3 text-xs text-text-secondary">
                    <button type="button" onClick={() => setShowAll(true)} className="hover:text-white">▸ {hidden} more {hidden === 1 ? 'project' : 'projects'} · show all</button>
                  </td>
                </tr>
              )}
              <tr aria-label="Day" className="border-t-2 border-border-dark">
                <td className="py-2 px-3 font-bold text-white">Day</td>
                {sheet.days.map(day => {
                  const notes = dayNotes(day);
                  return (
                    <td key={day.dateKey} className={`${cell} align-top ${notes.length ? 'bg-accent-amber/10' : ''}`}>
                      <button type="button" onClick={() => onOpenDay(day.dateKey)} className={`font-bold hover:underline ${notes.length ? 'text-accent-amber' : 'text-white'}`}>
                        {time(day.seconds) || '–'}
                        <span className="sr-only">, {weekdayLong(day.dateKey)}: open the day</span>
                      </button>
                      {notes.map(note => <div key={note} className="text-[10px] font-sans font-normal text-accent-amber">{note}</div>)}
                    </td>
                  );
                })}
                <td className={`${cell} font-bold text-white`}>{formatHoursAndMinutes(sheet.total)}</td>
              </tr>
              <tr aria-label={`In ${provider}`}>
                <td className="py-2 px-3 text-text-secondary">In {provider} <span className="text-[11px]">· what your manager sees</span></td>
                {sheet.days.map(day => <td key={day.dateKey} className={`${cell} text-text-secondary`}>{time(day.providerSeconds)}</td>)}
                <td className={`${cell} text-text-primary`}>{formatHoursAndMinutes(sheet.providerTotal)}</td>
              </tr>
              {sheet.toPlaceTotal > 0 && (
                <tr aria-label="To place">
                  <td className="py-2 px-3 text-accent-amber"><span aria-hidden="true">⚡</span> To place</td>
                  {sheet.days.map(day => <td key={day.dateKey} className={`${cell} text-accent-amber`}>{time(day.toPlaceSeconds)}</td>)}
                  <td className={`${cell} text-accent-amber`}>{formatHoursAndMinutes(sheet.toPlaceTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {exceptions && (
        <p className="text-xs text-text-secondary">
          {exceptions} Click a day&apos;s total to open that day, or a task&apos;s cell to open that day.
        </p>
      )}
    </section>
  );
};
