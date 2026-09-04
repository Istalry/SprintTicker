import { randomUUID } from 'crypto';

/**
 * Prefixes used for entity identifiers.
 *
 * These strings are load-bearing, not cosmetic. `TaskRepository.deleteTasksNotIn`
 * filters with `id NOT LIKE 'adhoc_%'` to protect locally created tasks from the
 * remote-sync prune, so changing ADHOC_TASK would make the sync worker delete
 * every ad-hoc task the user has ever made. Any change here needs a migration
 * that rewrites existing rows.
 */
export const IdPrefix = {
  ADHOC_TASK: 'adhoc_',
  SESSION: 'sess_',
  WORKLOG: 'wl_',
  SYNC_ITEM: 'sync_'
} as const;

export type IdPrefixValue = (typeof IdPrefix)[keyof typeof IdPrefix];

/**
 * Builds a collision-free identifier.
 *
 * Identifiers were previously `${prefix}${Date.now()}`, which collides whenever
 * two of the same entity are created inside one millisecond. That is not
 * hypothetical here: stopping a session writes a worklog and a sync-queue row
 * together, and an auto-stop-then-start (switching task, or the lunch split)
 * runs both halves back to back. A collision is an INSERT against a TEXT PRIMARY
 * KEY, so the second write throws and the time it represented is lost.
 *
 * The millisecond timestamp is kept as a leading component so identifiers still
 * sort chronologically and stay legible in a database dump; the UUID suffix is
 * what makes them unique.
 */
export function createId(prefix: IdPrefixValue): string {
  return `${prefix}${Date.now()}_${randomUUID()}`;
}
