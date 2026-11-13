/**
 * The comments the app writes on a worklog when the user wrote none: what
 * ended the session.
 */
// The words the provider shows under an entry: the glossary's, as on every
// surface (second pass, C9/N4) -- not "Wrap-Up" or "BUSY Bar menu".
export const WORKLOG_COMMENTS = {
  DEFAULT: 'Completed session via SprintTicker',
  SWITCHED_TASK: 'Stopped by switching task',
  INTERRUPTED: 'Stopped for an interruption',
  BAR_STOP: 'Stopped on the BUSY Bar',
  BAR_FINISH: 'Done on the BUSY Bar',
  BAR_FINISH_CONFIRMED: 'Done on the BUSY Bar, after confirming',
  WRAP_UP: 'Stopped by End my day',
  LUNCH: 'Stopped for lunch',
  /** Time added by hand with no note (S16b). */
  ADDED: 'Added in SprintTicker'
} as const;
