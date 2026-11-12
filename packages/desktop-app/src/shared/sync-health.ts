/**
 * How the provider's sync is going, for S31's cards on Today (redesign P11b):
 * each says what still works, so nobody stops timing because something else
 * is down.
 *
 * - `first-sync`: the first pass ever, with its progress -- the task cache
 *   holds nothing of the provider's yet.
 * - `unreachable`: the provider did not answer, or answered nonsense.
 * - `refused`: it refused the saved credentials.
 * - `not-configured`: no account, or one half set up.
 * - `unknown`: no pass has finished since the app started.
 */
export type SyncHealthState = 'ok' | 'first-sync' | 'unreachable' | 'refused' | 'not-configured' | 'unknown';

export interface SyncHealthDTO {
  state: SyncHealthState;
  /** The provider being synced; '' until a pass names it. */
  providerId: string;
  /** When the current failure began: "not answering since 10:42". Null unless failing. */
  sinceUtc: string | null;
  /** The last pass that committed the lists, in this run: "the task list is from 09:12". */
  lastSyncedAtUtc: string | null;
  /** The first sync's projects fetched so far; null outside it, or before the count is known. */
  progress: { done: number; total: number } | null;
}

export const INITIAL_SYNC_HEALTH: SyncHealthDTO = {
  state: 'unknown',
  providerId: '',
  sinceUtc: null,
  lastSyncedAtUtc: null,
  progress: null
};

/** What Today shows once, until dismissed: an update just installed, no account yet. */
export interface NoticesDTO {
  /** The version just updated to, until "Not now" or "What's new"; null otherwise. */
  updatedTo: string | null;
  /** "No account yet" was put away. */
  noAccountDismissed: boolean;
}

export type NoticeKind = 'updated' | 'no-account';

/** The release page "What's new" opens, on this project's repository only. */
export function releasePageOf(version: string): string {
  return `https://github.com/Istalry/SprintTicker/releases/tag/v${version}`;
}
