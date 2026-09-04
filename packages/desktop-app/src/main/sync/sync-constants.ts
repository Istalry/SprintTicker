/**
 * Tuning for the offline worklog sync queue.
 *
 * Collected here rather than inlined so the retry policy is legible in one
 * place: the previous implementation had a bare `3` at two call sites and no
 * backoff at all, which meant a provider that was down for four minutes
 * exhausted every retry a queued worklog would ever get.
 */

/** How often the background worker wakes to drain the queue. */
export const SYNC_INTERVAL_MS = 300_000; // 5 minutes

/**
 * Attempts before a row is parked as FAILED.
 *
 * FAILED is no longer terminal -- a schema migration requeues such rows on
 * upgrade, and they can be retried explicitly -- but it stops the worker
 * hammering an endpoint that is not going to start working on its own.
 */
export const MAX_SYNC_ATTEMPTS = 8;

/** Delay before the first retry. */
export const SYNC_BACKOFF_BASE_MS = 30_000; // 30 seconds

/** Ceiling for the exponential backoff, so a long outage still retries hourly. */
export const SYNC_BACKOFF_MAX_MS = 3_600_000; // 1 hour

/**
 * How long a claimed row may sit in SYNCING before another pass may reclaim it.
 *
 * A row is claimed immediately before the network call and released after it.
 * If the process dies in between, the claim would otherwise pin that worklog in
 * SYNCING forever.
 */
export const SYNC_CLAIM_TIMEOUT_MS = 600_000; // 10 minutes

/**
 * Exponential backoff with full jitter, in milliseconds.
 *
 * Jitter matters because every queued row fails together during an outage and
 * would otherwise retry in lockstep, delivering the whole backlog as a burst
 * the moment the provider recovers.
 */
export function computeBackoffMs(retryCount: number): number {
  const exponential = SYNC_BACKOFF_BASE_MS * Math.pow(2, Math.max(0, retryCount));
  const capped = Math.min(exponential, SYNC_BACKOFF_MAX_MS);
  return Math.floor(capped / 2 + Math.random() * (capped / 2));
}

/**
 * A short, stable tag identifying which queue row produced a worklog.
 *
 * OpenProject v3 has no idempotency key, so a worklog the provider accepted
 * just before the app died can be re-sent when its claim is reclaimed. Both
 * copies carry the same tag, which makes the duplicate findable by search
 * rather than by comparing durations by eye.
 *
 * Deliberately short: this text lands in a user-visible worklog comment on
 * every entry, so it uses the last 8 characters of the row id rather than the
 * whole thing.
 */
export function syncMarker(syncItemId: string): string {
  return `[#${syncItemId.slice(-8)}]`;
}

/** Appends the marker to a worklog comment. */
export function withSyncMarker(comment: string, syncItemId: string): string {
  return `${comment} ${syncMarker(syncItemId)}`.trim();
}
