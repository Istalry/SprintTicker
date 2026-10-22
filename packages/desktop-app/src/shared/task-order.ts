import { ArgumentNullException, TaskDTO } from './dtos';
import { TaskOwnership, TaskOwnershipValue } from './task-ownership';

/**
 * Where each owner and status sorts in every task list, the window's and the
 * bar's alike. Chosen by the user (2026-10-16), extending their 2026-09-30
 * choice of in progress before to do for their own work:
 *
 * 1. mine in progress, 2. mine to do -- what a user most often comes back to;
 * 3. unassigned to do, 4. unassigned in progress -- free work, the kind
 *    still waiting for someone before the kind somebody started and left;
 * 5. a teammate's in progress;
 * 6. mine done, 7. unassigned done -- finished work, last.
 *
 * A teammate's task to do or done is fetched only by "everything open" or a
 * custom query; it sorts after all of it rather than among the user's work.
 */
export const TASK_SELECTION_RANK: Readonly<Record<TaskOwnershipValue, Readonly<Record<TaskDTO['status'], number>>>> = {
  [TaskOwnership.MINE]: { in_progress: 0, todo: 1, done: 5 },
  [TaskOwnership.UNASSIGNED]: { todo: 2, in_progress: 3, done: 6 },
  [TaskOwnership.OTHER]: { in_progress: 4, todo: 7, done: 8 }
};

/**
 * Past every known status or priority, so a value this does not know sorts
 * last rather than first.
 */
const UNKNOWN_RANK = Number.MAX_SAFE_INTEGER;

/**
 * The tasks in list order: by owner and status (above), then by priority
 * (most urgent first; none after any), then in their original order. Returns
 * a new array; the input is left as it was. A task with no ownership is the
 * user's, as everywhere.
 *
 * Stable on purpose. Tasks arrive in the provider's order, which is usually
 * meaningful (a board's ranking), and where status and priority are equal it
 * must not be shuffled.
 */
export function orderTasksForSelection<T extends Pick<TaskDTO, 'status' | 'priorityRank' | 'ownership'>>(tasks: readonly T[]): T[] {
  if (!tasks) throw new ArgumentNullException('tasks');
  const groupRank = (task: T): number =>
    TASK_SELECTION_RANK[task.ownership ?? TaskOwnership.MINE]?.[task.status] ?? UNKNOWN_RANK;
  const priorityRank = (task: T): number =>
    typeof task.priorityRank === 'number' && Number.isFinite(task.priorityRank) ? task.priorityRank : UNKNOWN_RANK;
  return [...tasks].sort((a, b) => groupRank(a) - groupRank(b) || priorityRank(a) - priorityRank(b));
}
