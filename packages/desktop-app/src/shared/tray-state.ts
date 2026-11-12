import type { UserMode } from './dtos';

/**
 * The tray icon's mark (redesign P12b, S26): a shape as well as a colour,
 * so the state reads without telling green from amber.
 *
 * - `timing` ▶ green: a task is timed.
 * - `interruption` ⚡ amber: an interruption runs.
 * - `paused` ❚❚ amber: paused, at Lunch or Away.
 * - `nothing-timing` ! amber: nothing timed, in working hours.
 * - `off-hours` ○ grey: nothing timed, outside them.
 */
export type TrayMark = 'timing' | 'interruption' | 'paused' | 'nothing-timing' | 'off-hours';

export interface TrayStateInput {
  session: { status: string; interruption?: unknown } | null;
  mode: UserMode;
  /** In WORK, on a working day, from the stand-up to the wrap-up. */
  inWorkingHours: boolean;
}

/**
 * Which mark, in this order: an interruption over everything, since it holds
 * the task; then a task timed, which wins over the mode -- working through
 * Lunch is timing; then a pause or a break; then the hours.
 */
export function trayMarkOf({ session, mode, inWorkingHours }: TrayStateInput): TrayMark {
  if (session?.interruption) return 'interruption';
  if (session?.status === 'TRACKING') return 'timing';
  if (session?.status === 'PAUSED' || mode === 'LUNCH' || mode === 'AWAY') return 'paused';
  return inWorkingHours ? 'nothing-timing' : 'off-hours';
}

/** The number on the icon: the entries waiting to send, "9+" past nine, none at zero. */
export function trayBadgeOf(waiting: number): string | null {
  if (!Number.isFinite(waiting) || waiting <= 0) return null;
  return waiting > 9 ? '9+' : String(Math.floor(waiting));
}
