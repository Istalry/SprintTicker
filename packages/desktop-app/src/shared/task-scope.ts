/**
 * Which of a project's tasks a provider should fetch.
 *
 * `getTasks` hardcoded "assigned to me", so unassigned tickets and anything
 * owned by a teammate were invisible with nothing in the UI to say so (audit
 * F-12). Which tasks matter is the user's business, not the adapter's.
 *
 * The scope is shared but the query is not: OpenProject takes a JSON filter
 * array and Jira takes JQL, so each adapter turns the same scope into its own
 * dialect. Only the vocabulary lives here.
 *
 * Pure data with no imports, so it is safe on both sides of the context bridge.
 */

export const TaskScope = {
  /** Open tasks assigned to the authenticated user. The historical behaviour. */
  ASSIGNED_TO_ME: 'assigned_to_me',
  /** Every open task in the project, whoever owns it. */
  ALL_OPEN: 'all_open',
  /** A raw provider-native query, supplied by the user. */
  CUSTOM: 'custom'
} as const;

/** Union of the scope string literals above. */
export type TaskScopeValue = (typeof TaskScope)[keyof typeof TaskScope];

const KNOWN_SCOPES = new Set<string>(Object.values(TaskScope));

/**
 * Coerces a stored setting to a scope, falling back to the default.
 *
 * A value read from the database can be anything -- an older build's spelling,
 * a hand-edited row. Falling back is right here because the alternative is
 * refusing to list tasks at all over a malformed preference.
 */
export function parseTaskScope(value: string | undefined | null): TaskScopeValue {
  return typeof value === 'string' && KNOWN_SCOPES.has(value)
    ? (value as TaskScopeValue)
    : TaskScope.ASSIGNED_TO_ME;
}

/** Human-readable labels, so main and the renderer cannot disagree on wording. */
export const TASK_SCOPE_LABELS: Record<TaskScopeValue, string> = {
  [TaskScope.ASSIGNED_TO_ME]: 'Assigned to me',
  [TaskScope.ALL_OPEN]: 'Everything open in the project',
  [TaskScope.CUSTOM]: 'Custom query'
};
