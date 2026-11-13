import { localDateKey } from './local-date';
import { weekStartKey } from './working-days';

/**
 * Time in a week already closed: the wrap-up of its last working day said
 * it was over (`last_week_closed`, the Monday of the last week closed).
 *
 * Closing a week locks nothing here, but the user's timesheet for it may be
 * in, or approved -- Tempo locks periods -- so a move, a correction or a
 * deletion there asks first (the user's choice, 2026-11-09). Shared so the
 * window and main read one rule.
 */

/** Whether a worklog starting at `startedAtUtc` lies in a week closed by `lastWeekClosed`. */
export function isInClosedWeek(startedAtUtc: string, lastWeekClosed: string | null): boolean {
  if (!lastWeekClosed) return false;
  const start = new Date(startedAtUtc);
  if (Number.isNaN(start.getTime())) return false;
  return weekStartKey(localDateKey(start)) <= lastWeekClosed;
}

/** What the window says before changing time in a closed week, naming the provider (`providerDisplayName`). */
export function closedWeekWarning(providerName: string): string {
  return `This is time from a week already closed. If its timesheet is in, or approved, this changes it — and a locked one may refuse the change at ${providerName}.`;
}
