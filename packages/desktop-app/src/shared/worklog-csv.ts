import type { WorklogDTO } from './dtos';
import { localDateKey } from './local-date';

/**
 * Worklogs as CSV (S15's Export CSV, P9c): one row per entry, in the order
 * given, for a timesheet or a spreadsheet. Shared and pure so the test reads
 * exactly what main writes.
 *
 * Times are local, as the user worked them; hours are also given as a
 * decimal, which is what a timesheet sums. A cell holding a comma, a quote
 * or a line break is quoted, its quotes doubled (RFC 4180). A cell starting
 * with `=`, `+`, `-` or `@` gets a leading quote mark: a spreadsheet would
 * otherwise run a note as a formula.
 */
export const WORKLOG_CSV_HEADER = ['Date', 'Start', 'End', 'Duration', 'Hours', 'Project', 'Task', 'Title', 'Note', 'Sent'] as const;

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

function cell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function worklogsToCsv(worklogs: readonly WorklogDTO[]): string {
  const rows = worklogs.map(log => {
    const start = new Date(log.startedAtUtc);
    const end = new Date(start.getTime() + log.durationSeconds * 1000);
    const minutes = Math.round(log.durationSeconds / 60);
    return [
      localDateKey(start),
      clock(start),
      clock(end),
      `${Math.floor(minutes / 60)}:${pad(minutes % 60)}`,
      (log.durationSeconds / 3600).toFixed(2),
      log.projectName ?? '',
      log.taskKey ?? log.taskId,
      log.taskTitle ?? '',
      log.comment,
      log.syncState === 'sent' ? 'yes' : 'no'
    ].map(cell).join(',');
  });
  return [WORKLOG_CSV_HEADER.join(','), ...rows].join('\r\n') + '\r\n';
}
