import { addLocalDays } from './local-date';

/**
 * Which days are worked, as `Date.getDay()` numbers: 0 is Sunday, 6 Saturday.
 * Monday to Friday unless the user says otherwise.
 */
export const DEFAULT_WORKING_DAYS: readonly number[] = [1, 2, 3, 4, 5];

/** The week as the schedule shows it, Monday first. */
export const WEEKDAYS_MONDAY_FIRST: ReadonlyArray<{ day: number; label: string }> = [
  { day: 1, label: 'Mon' }, { day: 2, label: 'Tue' }, { day: 3, label: 'Wed' }, { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' }, { day: 6, label: 'Sat' }, { day: 0, label: 'Sun' }
];

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The weekday of a `YYYY-MM-DD` key, as `Date.getDay()` numbers it. */
export function weekdayOf(dateKey: string): number {
  if (!dateKey || !DATE_KEY_PATTERN.test(dateKey)) {
    throw new Error(`Expected a YYYY-MM-DD date key, received: ${String(dateKey)}`);
  }
  const [year, month, day] = dateKey.split('-').map(Number);
  // Local parts, as every day here is the user's: see local-date.ts.
  return new Date(year, month - 1, day).getDay();
}

/** The Monday of the week holding `dateKey`. The week runs Monday to Sunday. */
export function weekStartKey(dateKey: string): string {
  return addLocalDays(dateKey, -((weekdayOf(dateKey) + 6) % 7));
}

/** Whether `dateKey` is worked: one of the working weekdays, and not a day off. */
export function isWorkingDay(dateKey: string, workingDays: readonly number[], daysOff: ReadonlySet<string>): boolean {
  return workingDays.includes(weekdayOf(dateKey)) && !daysOff.has(dateKey);
}

/**
 * The last day worked in the week holding `dateKey`, or null for a week with
 * none -- every working day a holiday. The week ends there: Friday usually,
 * Thursday before a Friday off, the Saturday of someone who works it.
 */
export function lastWorkingDayOfWeek(
  dateKey: string,
  workingDays: readonly number[],
  daysOff: ReadonlySet<string>
): string | null {
  const monday = weekStartKey(dateKey);
  for (let offset = 6; offset >= 0; offset--) {
    const day = addLocalDays(monday, offset);
    if (isWorkingDay(day, workingDays, daysOff)) return day;
  }
  return null;
}

/**
 * Why a set of working days cannot be kept, or null when it can: whole
 * weekday numbers, each once, and at least one -- a week with no working day
 * would never prompt for anything again, which reads as the app broken.
 */
export function checkWorkingDays(workingDays: unknown): string | null {
  if (!Array.isArray(workingDays) || workingDays.length === 0) return 'Pick at least one working day.';
  if (!workingDays.every(day => Number.isInteger(day) && day >= 0 && day <= 6)) return 'Working days must be days of the week.';
  if (new Set(workingDays).size !== workingDays.length) return 'A working day is listed twice.';
  return null;
}
