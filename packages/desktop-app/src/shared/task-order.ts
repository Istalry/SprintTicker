import { ArgumentNullException, TaskDTO } from './dtos';

/**
 * Where each status sorts in the hardware task picker.
 *
 * In progress first, because that is what a user most often comes back to;
 * then what is still to do; finished work last, where it stays reachable
 * without being scrolled past on the way to anything else. Chosen by the user
 * (2026-09-30) over the "to do first" order it was first described with.
 */
export const TASK_STATUS_SELECTION_RANK: Readonly<Record<TaskDTO['status'], number>> = {
  in_progress: 0,
  todo: 1,
  done: 2
};

/** Past every known status, so a value the type does not know sorts last rather than first. */
const UNKNOWN_STATUS_RANK = Number.MAX_SAFE_INTEGER;

/**
 * The tasks in picker order: by status, and in their original order within a
 * status. Returns a new array; the input is left as it was.
 *
 * Stable on purpose. Tasks arrive in the provider's order, which is usually
 * meaningful (a board's ranking), and sorting on status alone must not
 * shuffle it.
 */
export function orderTasksForSelection<T extends Pick<TaskDTO, 'status'>>(tasks: readonly T[]): T[] {
  if (!tasks) throw new ArgumentNullException('tasks');
  const rank = (task: T): number => TASK_STATUS_SELECTION_RANK[task.status] ?? UNKNOWN_STATUS_RANK;
  return [...tasks].sort((a, b) => rank(a) - rank(b));
}
