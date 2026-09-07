/**
 * The working-day key, in the user's own timezone.
 *
 * A calendar day here always means the user's day: the one their standup, lunch
 * and worklogs belong to. `toISOString().split('T')[0]` gives the *UTC* day, and
 * the two disagree for part of every day away from UTC:
 *
 * - West of UTC, they disagree during the working evening. At 20:00 in New York
 *   it is already tomorrow in UTC.
 * - East of UTC, they disagree between local midnight and the offset. At 00:30
 *   in Paris it is still yesterday in UTC.
 *
 * That asymmetry is why this was hard to see: developed and tested from Europe,
 * the disagreement falls in the small hours when nothing is scheduled and nobody
 * is logging time.
 *
 * Use this wherever a date identifies a day of work. Keep `toISOString()` for
 * instants -- timestamps stored or sent to the device are genuinely UTC.
 */
export function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Thrown when a value that must be a `YYYY-MM-DD` key is not one. */
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The UTC instants bounding a local calendar day, as a half-open range.
 *
 * Worklog timestamps are stored as `toISOString()` strings, so "which day was
 * this worked?" is a question about the user's day asked of UTC data. The
 * obvious answer -- `strftime('%Y-%m-%d', created_at_utc, 'localtime')` -- is
 * correct in production but has two drawbacks: it applies a function to the
 * column, so `idx_worklogs_created_at` cannot serve the query, and
 * better-sqlite3 does not pick up a `process.env.TZ` change, so no test can
 * force a timezone and prove the behaviour.
 *
 * Computing the bounds here keeps every timezone decision in JavaScript, where
 * the tz database handles DST and where a test can set `TZ` and get an answer.
 * The comparison that remains is a plain range over an indexed column, which
 * works because every stored timestamp is a 24-character `toISOString()` value
 * and those sort lexicographically in chronological order.
 */
export function localDayBoundsUtc(dateKey: string): { startUtc: string; endUtc: string } {
  if (!dateKey || !DATE_KEY_PATTERN.test(dateKey)) {
    throw new Error(`Expected a YYYY-MM-DD date key, received: ${String(dateKey)}`);
  }

  const [year, month, day] = dateKey.split('-').map(Number);

  // Local midnight to the next local midnight. Constructing from local parts is
  // what makes this DST-correct: the day after a spring-forward is 23 hours
  // long, and Date resolves that rather than assuming 24.
  return {
    startUtc: new Date(year, month - 1, day).toISOString(),
    endUtc: new Date(year, month - 1, day + 1).toISOString()
  };
}

/**
 * Moves a date key by whole local days.
 *
 * The history view used to do this with `new Date(dateKey)`, which parses a
 * date-only string as *UTC* midnight, and then stepped it with local getters
 * and setters. West of UTC that instant is still the previous day locally, so
 * "next day" resolved back to the day it started on and the control did
 * nothing. Working in local parts throughout avoids the mixed frame; Date
 * normalises month and year rollover.
 */
export function addLocalDays(dateKey: string, days: number): string {
  if (!dateKey || !DATE_KEY_PATTERN.test(dateKey)) {
    throw new Error(`Expected a YYYY-MM-DD date key, received: ${String(dateKey)}`);
  }

  const [year, month, day] = dateKey.split('-').map(Number);
  return localDateKey(new Date(year, month - 1, day + days));
}
