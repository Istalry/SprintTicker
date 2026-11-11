import type { WorklogDTO } from './dtos';
import { localDateKey } from './local-date';
import { formatHoursAndMinutes } from './time-format';

/**
 * The week as a timesheet (S15, P9c): the time of each task on each day,
 * grouped by project, a Day row, the row of what the provider holds -- what
 * the user's manager sees -- and the time still to place. Pure and shared:
 * Check my week (P9d) reads the same figures.
 */

/** Ad-hoc work and tasks whose project row is gone are grouped under this. */
export const WEEK_NO_PROJECT = 'Not in a project';

export interface WeekTaskRow {
  taskId: string;
  key: string;
  title: string;
  /** Seconds per day, in the order of the sheet's days. */
  perDay: number[];
  total: number;
}

export interface WeekProject {
  projectId: string;
  name: string;
  perDay: number[];
  total: number;
  /** The most time first. */
  tasks: WeekTaskRow[];
}

export interface WeekDay {
  dateKey: string;
  seconds: number;
  /** What the provider holds of the day: its last answered sends. */
  providerSeconds: number;
  toPlaceSeconds: number;
  /** Not at the provider: held by an overlap, waiting, or refused. */
  heldSeconds: number;
  waitingSeconds: number;
  failedSeconds: number;
  /** Corrections or deletions not answered yet. */
  corrections: number;
}

export interface WeekSheet {
  days: WeekDay[];
  /** The most time first. */
  projects: WeekProject[];
  total: number;
  providerTotal: number;
  toPlaceTotal: number;
}

/** What the sheet reads of an interruption still to place. */
export interface TimeToPlace {
  startedAtUtc: string;
  durationSeconds: number;
}

const dayOf = (startedAtUtc: string) => localDateKey(new Date(startedAtUtc));

export function buildWeekSheet(dayKeys: readonly string[], entries: readonly WorklogDTO[], toPlace: readonly TimeToPlace[] = []): WeekSheet {
  const index = new Map(dayKeys.map((key, i) => [key, i]));
  const days: WeekDay[] = dayKeys.map(dateKey => ({
    dateKey, seconds: 0, providerSeconds: 0, toPlaceSeconds: 0, heldSeconds: 0, waitingSeconds: 0, failedSeconds: 0, corrections: 0
  }));
  const projects = new Map<string, WeekProject & { byTask: Map<string, WeekTaskRow> }>();

  for (const entry of entries) {
    const i = index.get(dayOf(entry.startedAtUtc));
    if (i === undefined) continue;
    const day = days[i];
    const seconds = entry.durationSeconds;
    day.seconds += seconds;
    day.providerSeconds += entry.providerSeconds ?? 0;
    if (entry.syncState === 'held-overlap') day.heldSeconds += seconds;
    if (entry.syncState === 'pending') day.waitingSeconds += seconds;
    if (entry.syncState === 'failed') day.failedSeconds += seconds;
    if (entry.syncState === 'correction-pending' || entry.syncState === 'correction-failed') day.corrections++;

    const projectId = entry.projectName ? entry.projectId ?? entry.projectName : WEEK_NO_PROJECT;
    let project = projects.get(projectId);
    if (!project) {
      project = { projectId, name: entry.projectName ?? WEEK_NO_PROJECT, perDay: dayKeys.map(() => 0), total: 0, tasks: [], byTask: new Map() };
      projects.set(projectId, project);
    }
    project.perDay[i] += seconds;
    project.total += seconds;
    let task = project.byTask.get(entry.taskId);
    if (!task) {
      task = { taskId: entry.taskId, key: entry.taskKey ?? entry.taskId, title: entry.taskTitle ?? '', perDay: dayKeys.map(() => 0), total: 0 };
      project.byTask.set(entry.taskId, task);
    }
    task.perDay[i] += seconds;
    task.total += seconds;
  }
  for (const item of toPlace) {
    const i = index.get(dayOf(item.startedAtUtc));
    if (i !== undefined) days[i].toPlaceSeconds += item.durationSeconds;
  }

  const ordered = [...projects.values()]
    .map(({ byTask, ...project }) => ({ ...project, tasks: [...byTask.values()].sort((a, b) => b.total - a.total) }))
    .sort((a, b) => b.total - a.total);
  const sum = (pick: (day: WeekDay) => number) => days.reduce((total, day) => total + pick(day), 0);
  return {
    days,
    projects: ordered,
    total: sum(day => day.seconds),
    providerTotal: sum(day => day.providerSeconds),
    toPlaceTotal: sum(day => day.toPlaceSeconds)
  };
}

/** Why a day is not all at the provider, in a few words each: its amber cell. */
export function dayNotes(day: WeekDay): string[] {
  const notes: string[] = [];
  if (day.toPlaceSeconds) notes.push(`${formatHoursAndMinutes(day.toPlaceSeconds)} to place`);
  if (day.heldSeconds) notes.push(`${formatHoursAndMinutes(day.heldSeconds)} held`);
  if (day.waitingSeconds) notes.push(`${formatHoursAndMinutes(day.waitingSeconds)} sending`);
  if (day.failedSeconds) notes.push(`${formatHoursAndMinutes(day.failedSeconds)} not sent`);
  if (day.corrections) notes.push(day.corrections === 1 ? 'correction waiting' : `${day.corrections} corrections waiting`);
  return notes;
}

/**
 * The sheet's last line (S15): "All sent." or "All sent, except OPS-4's 20m
 * on Tuesday, held by an overlap, and 18m on Wednesday still to place." Each
 * entry not at the provider, and each day's time to place, in day order.
 * Entries kept here by design (ad-hoc, a project made here) are not
 * exceptions.
 */
export function describeWeekExceptions(
  sheet: WeekSheet,
  entries: readonly WorklogDTO[],
  dayName: (dateKey: string) => string,
  providerName: string
): string {
  const parts: string[] = [];
  for (const day of sheet.days) {
    const on = dayName(day.dateKey);
    for (const entry of entries.filter(e => dayOf(e.startedAtUtc) === day.dateKey)) {
      const whose = `${entry.taskKey ?? entry.taskId}'s`;
      const time = formatHoursAndMinutes(entry.durationSeconds);
      switch (entry.syncState) {
        case 'held-overlap':
          parts.push(`${whose} ${time} on ${on}, held by an overlap`);
          break;
        case 'pending':
          parts.push(`${whose} ${time} on ${on}, still sending`);
          break;
        case 'failed':
          parts.push(`${whose} ${time} on ${on}, which ${providerName} did not take`);
          break;
        case 'correction-pending':
          parts.push(`${whose} correction on ${on}, on its way`);
          break;
        case 'correction-failed':
          parts.push(`${whose} correction on ${on}, which ${providerName} did not answer`);
          break;
        default:
          break;
      }
    }
    if (day.toPlaceSeconds) parts.push(`${formatHoursAndMinutes(day.toPlaceSeconds)} on ${on} still to place`);
  }
  if (parts.length === 0) return sheet.total > 0 ? 'All sent.' : '';
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `All sent, except ${list}.`;
}
