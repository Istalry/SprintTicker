/**
 * The comments the app writes on a worklog when the user wrote none: what
 * ended the session.
 */
export const WORKLOG_COMMENTS = {
  DEFAULT: 'Completed session via SprintTicker',
  SWITCHED_TASK: 'Auto-completed due to new task start',
  BAR_STOP: 'Stopped via BUSY Bar Paused Menu',
  BAR_FINISH: 'Completed via BUSY Bar Paused Menu',
  BAR_FINISH_CONFIRMED: 'Completed via BUSY Bar after confirming',
  BAR_LONG_PRESS: 'Completed via BUSY Bar Long Press',
  WRAP_UP: 'Finalized during End-of-Day Wrap-Up',
  LUNCH: 'Auto-completed for Lunch Break split'
} as const;
