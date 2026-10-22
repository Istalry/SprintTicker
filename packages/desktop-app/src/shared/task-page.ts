import { ADHOC_PROJECT_ID } from './adhoc-project';
import { OWN_PROJECT_PROVIDER_ID } from './local-provider';

/**
 * A task's page on its provider -- Jira's `/browse/KEY`, OpenProject's
 * `/work_packages/ID` -- opened from the window to comment, attach a
 * picture or read the thread.
 *
 * Pure, so the window decides where to show the button by the same rule main
 * applies before opening anything.
 */

/** Providers whose tasks live here only: the app's own projects, and ad-hoc work. */
const NO_PAGE_PROVIDERS: ReadonlySet<string> = new Set([OWN_PROJECT_PROVIDER_ID, 'adhoc']);

/**
 * Whether a task of this project can have a page on a provider. A project
 * whose provider is not known (`local`, or no row) may: the active provider
 * is asked, as for its time.
 */
export function hasTaskPage(projectId: string | null | undefined, providerId: string | null | undefined): boolean {
  if (!projectId || projectId === ADHOC_PROJECT_ID) return false;
  return !providerId || !NO_PAGE_PROVIDERS.has(providerId);
}

/**
 * Whether a page URL may be opened: http or https, on the provider's own
 * site. The URL is built from synced data -- a key, an id -- and handed to
 * the operating system, which would as readily launch any other protocol
 * handler or site; this is what keeps it to the provider's pages.
 */
export function isOpenableTaskPage(url: string, siteBase: string): boolean {
  try {
    const page = new URL(url);
    const site = new URL(siteBase);
    return (page.protocol === 'https:' || page.protocol === 'http:') && page.origin === site.origin;
  } catch {
    // Not a URL at all: nothing to open.
    return false;
  }
}
