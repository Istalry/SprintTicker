/**
 * Formats duration in total seconds to HH:MM:SS or MM:SS display string.
 */
export function formatSeconds(totalSeconds: number): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) {
    return '00:00';
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const pad = (num: number) => num.toString().padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Formats total seconds as "Xh YYm" string for summary views.
 */
export function formatHoursAndMinutes(totalSeconds: number): string {
  const hrs = Math.floor((totalSeconds || 0) / 3600);
  const mins = Math.floor(((totalSeconds || 0) % 3600) / 60);
  return `${hrs}h ${mins.toString().padStart(2, '0')}m`;
}

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
