/**
 * Taking a task nobody owns, on start.
 *
 * Starting an unassigned task assigns it to the user, without asking: the
 * time and the task then go together (decided 2026-10-16). Between the list
 * the user picked from and the start, a teammate may have taken it; then it
 * is not assigned -- never reassigned away from them -- but still started,
 * and the user is told who has it.
 *
 * Pure data with no imports, so it is safe on both sides of the bridge.
 */

/** What the provider answered to "assign this task to me". */
export type TaskClaim =
  /** It was nobody's, and is now the user's. */
  | { outcome: 'assigned' }
  /** It was already the user's -- assigned to them since the last sync. */
  | { outcome: 'already_mine' }
  /** Someone took it meanwhile; it was left with them. */
  | { outcome: 'taken'; assigneeName: string };

/** What the engine reports once a claim has an answer, for the toast and the bar. */
export interface TaskClaimReport {
  sessionId: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  /** The provider asked, as its id; the caller names it. */
  providerId: string | undefined;
  /** The answer, or absent when the request failed. */
  claim?: TaskClaim;
  /** Why the request failed, for the log and the toast; absent on an answer. */
  error?: string;
}

/** The name shown for an assignee the provider did not name. */
export const UNNAMED_ASSIGNEE = 'someone else';
