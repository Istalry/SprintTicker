/**
 * "Previous task": the task to switch back to (P4, read by the Previous
 * shortcut, the mini timer, the tray and the picker's highlight).
 *
 * It is the task of the most recent ended session that is not the current
 * task. The session stores the task it replaced (`previous_task_id`,
 * migration 14), which is the fast path; sessions from before that column,
 * or a stored task that can no longer be offered, fall back to the sessions
 * themselves. "Can be offered" is the caller's: a task still in the lists
 * and named -- an interruption nobody named yet is not something to go back
 * to, as Recent leaves it out too (S7).
 */
export interface PreviousTaskInputs {
  /** The task being timed now, if any. */
  currentTaskId: string | null;
  /** What the open session stored as the task it replaced. */
  storedPreviousTaskId: string | null;
  /** Task ids of the latest ended sessions, newest first. */
  recentEndedTaskIds: readonly string[];
  /** Whether a task can be offered: listed, and named. */
  isOffered: (taskId: string) => boolean;
}

export function previousTaskId(inputs: PreviousTaskInputs): string | null {
  const { currentTaskId, storedPreviousTaskId, recentEndedTaskIds, isOffered } = inputs;
  const candidates = storedPreviousTaskId ? [storedPreviousTaskId, ...recentEndedTaskIds] : recentEndedTaskIds;
  for (const taskId of candidates) {
    if (taskId && taskId !== currentTaskId && isOffered(taskId)) return taskId;
  }
  return null;
}

/** How many ended sessions the fallback looks through. */
export const PREVIOUS_TASK_LOOKBACK = 20;

/** How many tasks Recent lists (S7). */
export const RECENT_TASKS_LIMIT = 6;
