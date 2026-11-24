import { ArgumentNullException } from './dtos';
import type { Overlap, TimedEntry } from './overlap';
import type { WorklogCorrectionDTO } from './worklog-correction';

/**
 * History's calendar (LOCAL-WORK-AND-CALENDAR.md §5): the week as columns
 * and the entries as blocks over the hours. What a gesture comes to is
 * worked out here, apart from the pointer, so it is tested in Node; the
 * change itself goes through the commands the rows use.
 */

/** Every gesture lands on a quarter of an hour, as Google Calendar's does. */
export const CALENDAR_SNAP_MINUTES = 15;
/** What a click on an empty slot proposes, before the user drags a length. */
export const CALENDAR_CLICK_MINUTES = 30;
/** The hours shown when the schedule says none and nothing is logged outside them. */
export const CALENDAR_DEFAULT_HOURS = { start: 8, end: 19 } as const;

const MINUTE_MS = 60_000;

/** `minutes` to the nearest quarter of an hour. */
export function snapMinutes(minutes: number): number {
  return Math.round(minutes / CALENDAR_SNAP_MINUTES) * CALENDAR_SNAP_MINUTES;
}

/**
 * The hours the grid spans: the working hours, or the default, widened to
 * whole hours so that every span shown fits.
 */
export function calendarHours(
  spans: ReadonlyArray<{ startMs: number; endMs: number }>,
  working: { start: number; end: number } | null
): { start: number; end: number } {
  if (!spans) throw new ArgumentNullException('spans');
  let { start, end } = working ?? CALENDAR_DEFAULT_HOURS;
  for (const span of spans) {
    const from = new Date(span.startMs);
    const to = new Date(span.endMs);
    // A span ending the next day reaches the end of this one.
    const toHour = to.getDate() !== from.getDate() ? 24 : to.getHours() + (to.getMinutes() || to.getSeconds() ? 1 : 0);
    start = Math.min(start, from.getHours());
    end = Math.max(end, toHour);
  }
  return { start: Math.max(0, start), end: Math.min(24, Math.max(end, start + 1)) };
}

/** An entry in its day's column: entries that overlap share the width, side by side. */
export interface PlacedEntry<T> {
  entry: T;
  column: number;
  columns: number;
}

/**
 * Side-by-side columns for one day's entries, as a calendar lays out events
 * at the same time: each takes the first column free at its start, and a
 * cluster of entries that overlap shares its count of columns.
 */
export function placeDay<T extends TimedEntry>(entries: readonly T[]): PlacedEntry<T>[] {
  if (!entries) throw new ArgumentNullException('entries');
  const startOf = (e: TimedEntry) => Date.parse(e.startedAtUtc);
  const endOf = (e: TimedEntry) => startOf(e) + e.durationSeconds * 1000;
  const sorted = [...entries].sort((a, b) => startOf(a) - startOf(b) || endOf(b) - endOf(a));
  const placed: PlacedEntry<T>[] = [];
  let cluster: PlacedEntry<T>[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => {
    for (const p of cluster) p.columns = columnEnds.length;
    cluster = [];
    columnEnds = [];
  };
  for (const entry of sorted) {
    if (startOf(entry) >= clusterEnd) close();
    let column = columnEnds.findIndex(end => end <= startOf(entry));
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = endOf(entry);
    clusterEnd = Math.max(clusterEnd, endOf(entry));
    const item = { entry, column, columns: 1 };
    cluster.push(item);
    placed.push(item);
  }
  close();
  return placed;
}

/**
 * The entry moved by `minutes`, snapped, and by `days`: the same length and
 * note at another time, as a drag puts it.
 */
export function movedEntry(entry: TimedEntry & { comment: string }, minutes: number, days: number): WorklogCorrectionDTO {
  const start = new Date(Date.parse(entry.startedAtUtc) + snapMinutes(minutes) * MINUTE_MS);
  // By calendar day, so a move across a change of clock keeps its hour.
  start.setDate(start.getDate() + days);
  return { startedAtUtc: start.toISOString(), durationSeconds: entry.durationSeconds, comment: entry.comment };
}

/**
 * The entry with its `edge` dragged by `minutes`: the top moves the start
 * and keeps the end, the bottom moves the end. Never shorter than a
 * quarter of an hour, and the edge left alone stays to the second.
 */
export function resizedEntry(entry: TimedEntry & { comment: string }, edge: 'start' | 'end', minutes: number): WorklogCorrectionDTO {
  const startMs = Date.parse(entry.startedAtUtc);
  const endMs = startMs + entry.durationSeconds * 1000;
  const shortest = CALENDAR_SNAP_MINUTES * MINUTE_MS;
  if (edge === 'start') {
    const newStart = Math.min(startMs + snapMinutes(minutes) * MINUTE_MS, endMs - shortest);
    return { startedAtUtc: new Date(newStart).toISOString(), durationSeconds: Math.round((endMs - newStart) / 1000), comment: entry.comment };
  }
  const newEnd = Math.max(endMs + snapMinutes(minutes) * MINUTE_MS, startMs + shortest);
  return { startedAtUtc: entry.startedAtUtc, durationSeconds: Math.round((newEnd - startMs) / 1000), comment: entry.comment };
}

/** The two fixes an overlap offers: the first ends where the second starts, or the second starts where the first ends. */
export interface OverlapFixes {
  endFirst: WorklogCorrectionDTO | null;
  startSecond: WorklogCorrectionDTO | null;
}

/**
 * What each fix of an overlap would write. Null for a fix that would leave
 * an entry with no time: the first starting with the second, or the second
 * ending inside the first.
 */
export function overlapFixes<T extends TimedEntry & { comment: string }>(overlap: Overlap<T>): OverlapFixes {
  if (!overlap) throw new ArgumentNullException('overlap');
  const { earlier, later } = overlap;
  const earlierStart = Date.parse(earlier.startedAtUtc);
  const earlierEnd = earlierStart + earlier.durationSeconds * 1000;
  const laterStart = Date.parse(later.startedAtUtc);
  const laterEnd = laterStart + later.durationSeconds * 1000;
  const firstSeconds = Math.round((laterStart - earlierStart) / 1000);
  const secondSeconds = Math.round((laterEnd - earlierEnd) / 1000);
  return {
    endFirst: firstSeconds > 0 ? { startedAtUtc: earlier.startedAtUtc, durationSeconds: firstSeconds, comment: earlier.comment } : null,
    startSecond: secondSeconds > 0 ? { startedAtUtc: new Date(earlierEnd).toISOString(), durationSeconds: secondSeconds, comment: later.comment } : null
  };
}
