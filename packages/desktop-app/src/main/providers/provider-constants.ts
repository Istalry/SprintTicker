/**
 * Tuning for provider HTTP collection requests.
 *
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
