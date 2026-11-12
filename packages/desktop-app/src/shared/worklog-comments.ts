/**
 * The comments the app writes on a worklog when the user wrote none: what
 * ended the session.
 */
export const WORKLOG_COMMENTS = {
  DEFAULT: 'Completed session via SprintTicker',
  SWITCHED_TASK: 'Auto-completed due to new task start',
  INTERRUPTED: 'Stopped for an interruption',
  BAR_STOP: 'Stopped via BUSY Bar',
  BAR_FINISH: 'Completed via BUSY Bar Paused Menu',
  BAR_FINISH_CONFIRMED: 'Completed via BUSY Bar after confirming',
  WRAP_UP: 'Finalized during End-of-Day Wrap-Up',
  LUNCH: 'Auto-completed for Lunch Break split',
  /** Time added by hand with no note (S16b). */
  ADDED: 'Added in SprintTicker'
} as const;
