/**
 * Whose a task is, as its provider says.
 *
 * The lists used to hold the user's own work only, so "listed" meant "mine"
 * and nothing stored the assignee. A team's bug list is often unassigned, and
 * a teammate's task in progress is worth seeing, so the sync now keeps both
 * -- and each row says whose it is, read from the assignee the provider
 * returns rather than from which query found it.
 *
 * Pure data with no imports, so it is safe on both sides of the context bridge.
 */

export const TaskOwnership = {
  /** Assigned to the user the credentials belong to. */
  MINE: 'mine',
  /** Assigned to nobody: free to take. */
  UNASSIGNED: 'unassigned',
  /** Assigned to someone else -- a teammate, or a group. */
  OTHER: 'other'
} as const;

export type TaskOwnershipValue = (typeof TaskOwnership)[keyof typeof TaskOwnership];

const KNOWN = new Set<string>(Object.values(TaskOwnership));

/** A stored value as an ownership; anything unknown reads as the user's, the old meaning of a row. */
export function parseTaskOwnership(value: string | null | undefined): TaskOwnershipValue {
  return typeof value === 'string' && KNOWN.has(value) ? (value as TaskOwnershipValue) : TaskOwnership.MINE;
}

/**
 * The ownership of a task from its assignee's id and the user's.
 *
 * No assignee is unassigned; the user's own id is theirs; any other id --
 * a person, a group, a placeholder -- is someone else's.
 */
export function ownershipOf(assigneeId: string | null | undefined, myId: string): TaskOwnershipValue {
  if (!assigneeId) return TaskOwnership.UNASSIGNED;
  return assigneeId === myId ? TaskOwnership.MINE : TaskOwnership.OTHER;
}

/**
 * Whether the default scope keeps a task: all of the user's open work, every
 * open task nobody owns, and a teammate's task only while it is in progress.
 *
 * Applied after the query as well as in it: a provider that cannot narrow a
 * query the same way -- OpenProject has no OR between filters, and the fakes
 * answer every query alike -- must still hand the sync the same set.
 */
export function keptByDefaultScope(task: { ownership?: TaskOwnershipValue; status: 'todo' | 'in_progress' | 'done' }): boolean {
  return (task.ownership ?? TaskOwnership.MINE) !== TaskOwnership.OTHER || task.status === 'in_progress';
}
