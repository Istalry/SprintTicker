/**
 * Interrupt: a timer started at once, on a new ad-hoc task under a name the
 * app makes up, for the user to name or move to a task afterwards.
 *
 * Shared because the window, the mini timer and History show the same name
 * the bar does, and tell an unnamed interruption the same way.
 */

/** What an interruption's task is called until the user names it. */
export const INTERRUPTION_TITLE_PREFIX = 'Interruption';

/**
 * The made-up name: `Interruption 14:32`, in local time. The time is what
 * tells two of a day apart in History, and a name the user would not type.
 */
export function interruptionTitle(at: Date): string {
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `${INTERRUPTION_TITLE_PREFIX} ${hh}:${mm}`;
}
