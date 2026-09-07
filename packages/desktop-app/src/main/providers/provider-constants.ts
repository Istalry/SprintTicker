/**
 * Tuning for provider HTTP requests.
 *
 * These are provider-agnostic on purpose. The pagination constants were written
 * for OpenProject and the timeout constants for the shared client, but a second
 * adapter that picked its own numbers would drift from the first for no reason
 * anyone could later reconstruct.
 */

/**
 * How long one provider request may take before it is abandoned.
 *
 * Generous next to the device's 2s, because a self-hosted OpenProject behind a
 * cold reverse proxy is genuinely slow and a sync that gives up on it is worse
 * than one that waits. The point is only that a hung socket cannot stall a sync
 * pass forever -- which it could, since none of these calls had a timeout at
 * all.
 */
export const PROVIDER_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Extra attempts after the first, for requests that are safe to repeat.
 *
 * Two: enough to ride out a restarting proxy or a single rate-limit window,
 * few enough that a genuinely dead server fails within one sync interval
 * instead of holding the worker across several.
 */
export const PROVIDER_MAX_RETRIES = 2;

/** First backoff step; doubles per attempt. */
export const PROVIDER_RETRY_BASE_MS = 500;

/**
 * Ceiling on any single wait, including one the server asked for.
 *
 * A `Retry-After` is honoured but not obeyed without limit: Jira Cloud can
 * answer a burst with a delay measured in minutes, and blocking the sync worker
 * that long is worse than failing the pass and picking it up next interval.
 */
export const PROVIDER_RETRY_MAX_MS = 8_000;

/**
 * OpenProject v3 paginates every collection and defaults to 20 elements per
 * page. Every call site here fetched a bare collection URL and read
 * `_embedded.elements` once, so anyone with more than 20 projects, work
 * packages or statuses silently saw only the first page (audit F-12).
 */

/**
 * Elements requested per page.
 *
 * OpenProject clamps this to the instance's `maximum_page_size`, so asking for
 * more than the server allows is safe -- the walk simply takes more pages.
 */
export const COLLECTION_PAGE_SIZE = 100;

/**
 * Hard stop on the number of pages a single collection walk may request.
 *
 * This is a runaway guard, not a limit on how much data is supported: a server
 * that keeps offering a `nextByOffset` link forever would otherwise spin here
 * until the process ran out of memory.
 */
export const MAX_COLLECTION_PAGES = 100;
