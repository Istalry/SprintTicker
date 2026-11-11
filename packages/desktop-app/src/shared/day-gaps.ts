import { ScheduleSettingsDTO } from './dtos';
import { normalizeScheduleSettings } from './schedule-defaults';
import { atLocalTime } from './local-date';

/**
 * A day's untracked time (S14b, P9b): its working hours, less its lunch,
 * less every entry -- what the timeline hatches and Add time can fill.
 * Nothing is guessed or logged from a gap; it is only shown.
 *
 * Working hours are the stand-up to the wrap-up, the same hours the
 * reminders ask in (`inWorkingHours`), so a day has one definition of them.
 * Pure: the window passes the schedule and the clock.
 */

/** A stretch of a day, in epoch milliseconds, end excluded. */
export interface Span {
  startMs: number;
  endMs: number;
}

export interface WorkingWindow extends Span {
  /** Lunch inside the working hours, never counted as untracked; null when it falls outside them. */
  lunch: Span | null;
}

/**
 * Untracked stretches shorter than this are not shown: the seconds between
 * one stop and the next start are not time anyone forgot.
 */
export const DAY_GAP_MIN_SECONDS = 5 * 60;

/** The working hours of `day` by the schedule, or null on a day not worked. */
export function workingWindow(day: Date, schedule: ScheduleSettingsDTO): WorkingWindow | null {
  const s = normalizeScheduleSettings(schedule);
  if (!s.workingDays!.includes(day.getDay())) return null;
  const startMs = atLocalTime(day, s.standupTime!).getTime();
  const endMs = atLocalTime(day, s.eodWrapUpTime!).getTime();
  if (!(endMs > startMs)) return null;
  const lunchStart = Math.max(atLocalTime(day, s.lunchStartTime!).getTime(), startMs);
  const lunchEnd = Math.min(atLocalTime(day, s.lunchEndTime!).getTime(), endMs);
  return { startMs, endMs, lunch: lunchEnd > lunchStart ? { startMs: lunchStart, endMs: lunchEnd } : null };
}

/** An entry as a span: from its start, for its duration. */
export function spanOf(entry: { startedAtUtc: string; durationSeconds: number }): Span {
  const startMs = Date.parse(entry.startedAtUtc);
  return { startMs, endMs: startMs + entry.durationSeconds * 1000 };
}

/**
 * The untracked stretches of a working window, in order: the window, cut at
 * `untilMs` (now, on today -- the rest of the day is not missing yet), less
 * the lunch, less every span covered. Stretches under `minSeconds` go.
 */
export function dayGaps(
  window: WorkingWindow,
  covered: readonly Span[],
  untilMs: number = Number.POSITIVE_INFINITY,
  minSeconds: number = DAY_GAP_MIN_SECONDS
): Span[] {
  const endMs = Math.min(window.endMs, untilMs);
  const taken = [...covered, ...(window.lunch ? [window.lunch] : [])]
    .filter(span => span.endMs > span.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const gaps: Span[] = [];
  let cursor = window.startMs;
  for (const span of taken) {
    if (span.startMs > cursor) gaps.push({ startMs: cursor, endMs: Math.min(span.startMs, endMs) });
    cursor = Math.max(cursor, span.endMs);
    if (cursor >= endMs) break;
  }
  if (cursor < endMs) gaps.push({ startMs: cursor, endMs });
  return gaps.filter(gap => gap.endMs - gap.startMs >= minSeconds * 1000);
}

/** The seconds a set of gaps adds up to. */
export function gapSeconds(gaps: readonly Span[]): number {
  return gaps.reduce((sum, gap) => sum + Math.round((gap.endMs - gap.startMs) / 1000), 0);
}
