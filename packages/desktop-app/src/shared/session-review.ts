import { PauseIntervalDTO } from './dtos';

/**
 * A session left running: when the user was last here, and when a session
 * counts as forgotten rather than worked late.
 *
 * Time is wall clock minus pauses, so a session forgotten on Friday showed 62
 * hours on Monday, and stopping it sent all 62 to the provider at once.
 */

/** How often the user's presence is sampled, and a forgotten session looked for. */
export const PRESENCE_SAMPLE_MS = 60_000;

/** Idle up to this long is still someone at the machine: reading, thinking. */
export const ACTIVE_IDLE_MAX_SECONDS = 120;

/** The stored presence is rewritten only when it moves on by this much. */
export const PRESENCE_WRITE_STEP_MS = 60_000;

/**
 * An absence shorter than this across midnight is overtime, not a forgotten
 * session: anyone at the keyboard moves the presence on every minute, so only
 * a long stretch with neither keyboard nor mouse -- a long call -- comes near
 * it, and that gets a question, never a stop.
 */
export const FORGOTTEN_MIN_GAP_MS = 2 * 60 * 60 * 1000;

/** When the user was last at the machine, as an ISO instant. */
export const LAST_PRESENCE_KEY = 'last_user_presence_utc';

/** The question being asked, `{ sessionId, lastPresenceUtc }`: it survives a restart. */
export const FORGOTTEN_REVIEW_KEY = 'forgotten_session_review';

/**
 * Seconds worked between `startUtc` and `endUtc`, less the pauses that fall
 * in between. Shared so the dialog shows exactly what main will log for each
 * end time it offers.
 */
export function workedSecondsUntil(startUtc: string, endUtc: string, pauses: readonly PauseIntervalDTO[]): number {
  const start = Date.parse(startUtc);
  const end = Date.parse(endUtc);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  let pausedMs = 0;
  for (const pause of pauses) {
    const from = Math.max(start, Date.parse(pause.fromUtc));
    const to = Math.min(end, Date.parse(pause.toUtc));
    if (to > from) pausedMs += to - from;
  }
  return Math.max(0, Math.floor((end - start - pausedMs) / 1000));
}
