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
