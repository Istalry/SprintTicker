/**
 * A running timer, always `HH:MM:SS`: `05:12` alone reads as five hours
 * twelve on a screen beside the bar's `HH:MM`, and the width no longer jumps
 * at the hour.
 */
export function formatSeconds(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// Logged time is written by main too (the Undo bar's label), so it lives in shared.
import { formatHoursAndMinutes } from '../../shared/time-format';
export { formatHoursAndMinutes };

/**
 * Windows' regional format, once main has said what it is; until then, and if
 * it named something Intl does not know, the browser default.
 */
let regionalLocale: string | undefined;

/**
 * Adopts the locale times are formatted in. Called once at startup.
 *
 * Checked rather than trusted: `toLocaleTimeString` throws a RangeError on a
 * malformed tag, and every list that shows a time would go down with it.
 */
export function setRegionalLocale(locale: string | null | undefined): void {
  try {
    regionalLocale = locale ? Intl.DateTimeFormat.supportedLocalesOf([locale])[0] : undefined;
  } catch {
    // A malformed tag throws here too; the default is the safe answer.
    regionalLocale = undefined;
  }
}

/**
 * A wall-clock time in Windows' regional format -- `14:05:33` for most of
 * Europe, `2:05:33 PM` in the US -- whatever language the app itself is in.
 */
export function formatClockTime(date: Date): string {
  return date.toLocaleTimeString(regionalLocale);
}

/** `14:05`, in the regional format: a time the user picks, where seconds would be noise. */
export function formatHoursMinutes(date: Date): string {
  return date.toLocaleTimeString(regionalLocale, { hour: '2-digit', minute: '2-digit' });
}

/**
 * "2h 00m on Mon, 1h 00m on Tue": the days a session across midnight is
 * filed under. Null for a session within one day, where it says nothing.
 */
export function formatDaySplit(shares: ReadonlyArray<{ dateKey: string; seconds: number }>): string | null {
  if (shares.length < 2) return null;
  return shares
    .map(({ dateKey, seconds }) => {
      const [year, month, day] = dateKey.split('-').map(Number);
      const weekday = new Date(year, month - 1, day).toLocaleDateString(regionalLocale, { weekday: 'short' });
      return `${formatHoursAndMinutes(seconds)} on ${weekday}`;
    })
    .join(', ');
}

/** `Fri 17 Oct, 18:04`, in the regional format: an instant on a day that may not be today. */
export function formatDayAndTime(date: Date): string {
  return date.toLocaleString(regionalLocale, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

/** `Mon 9 Nov`, in the regional format, from a local date key: the user's day, not UTC's. */
export function formatDay(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(regionalLocale, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** `Tuesday 10 November`, in the regional format, from a local date key: the morning card's day. */
export function formatLongDay(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(regionalLocale, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** `Mon` or `Monday`, in the regional format, from a local date key: the week's columns and sentences. */
export function formatWeekday(dateKey: string, width: 'short' | 'long' = 'short'): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(regionalLocale, { weekday: width });
}

/** `2 November`, in the regional format, from a local date key: "Week of 2 November". */
export function formatDayAndMonth(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(regionalLocale, { day: 'numeric', month: 'long' });
}

/** "1 task", "4 tasks": a count with its noun, never "task(s)". */
export function countOf(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * The sentence main threw, without the wrapper Electron puts round a rejected
 * `invoke` -- `Error invoking remote method 'worklog:update':
 * ArgumentException: ...` -- which would read as a crash rather than as a
 * reason the user can act on.
 */
export function ipcErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^Error invoking remote method '[^']*': /, '').replace(/^\w*(?:Error|Exception): /, '');
}
