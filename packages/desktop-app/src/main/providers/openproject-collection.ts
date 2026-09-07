import { ProviderRequestError } from './provider-errors';
import { providerFetch, ProviderFetchOptions } from './provider-http';
import { COLLECTION_PAGE_SIZE, MAX_COLLECTION_PAGES } from './provider-constants';

/** The envelope every OpenProject v3 collection endpoint returns. */
interface OpenProjectCollection {
  _embedded?: { elements?: Array<Record<string, unknown>> };
  _links?: { nextByOffset?: { href?: string } };
}

/**
 * Walks an OpenProject v3 collection to its end and returns every element.
 *
 * Failure is reported by throwing, never by returning a short list. A silently
 * truncated collection is audit F-01 in a new costume: the sync worker treats
 * what it receives as the authoritative remote state and prunes anything
 * missing from it, so handing back page one of four would delete three
 * quarters of the local cache. That is also why exceeding the page cap throws
 * rather than returning what it has.
 *
 * Query parameters are passed unencoded and encoded here. The call sites used
 * to hand-roll `encodeURIComponent` into a template string, which cannot
 * survive a second parameter being added.
 */
export async function fetchOpenProjectCollection(
  providerId: string,
  baseUrl: string,
  authHeader: string,
  path: string,
  context: string,
  params: Record<string, string> = {},
  options: ProviderFetchOptions = {}
): Promise<Array<Record<string, unknown>>> {
  const firstUrl = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) {
    firstUrl.searchParams.set(key, value);
  }
  firstUrl.searchParams.set('pageSize', String(COLLECTION_PAGE_SIZE));

  const collected: Array<Record<string, unknown>> = [];
  let nextUrl: string | null = firstUrl.toString();
  let pagesFetched = 0;

  while (nextUrl !== null) {
    pagesFetched += 1;
    if (pagesFetched > MAX_COLLECTION_PAGES) {
      throw new ProviderRequestError(
        providerId,
        'protocol',
        `${context} failed: collection did not end within ${MAX_COLLECTION_PAGES} pages`
      );
    }

    // Timeouts, status classification and rate-limit backoff all live in
    // providerFetch, which throws for anything that is not a 2xx. A page walk
    // only has to worry about the shape of a page.
    const res = await providerFetch(
      providerId,
      nextUrl,
      { headers: { Authorization: authHeader, Accept: 'application/json' } },
      context,
      options
    );

    let json: OpenProjectCollection;
    try {
      json = (await res.json()) as OpenProjectCollection;
    } catch (err) {
      throw new ProviderRequestError(
        providerId,
        'protocol',
        `${context} failed: response body was not valid JSON`,
        { cause: err }
      );
    }

    const elements = json?._embedded?.elements;
    if (!Array.isArray(elements)) {
      // An empty result is legitimate; a missing collection is not, and must
      // not be reported as "the user has nothing" -- see the note above.
      throw new ProviderRequestError(
        providerId,
        'protocol',
        `${context} failed: response had no _embedded.elements collection`
      );
    }

    collected.push(...elements);

    // An empty page ends the walk even when the server still offers a next
    // link, so an instance that miscounts cannot spin us up to the page cap.
    const nextHref = json?._links?.nextByOffset?.href;
    nextUrl =
      typeof nextHref === 'string' && nextHref.length > 0 && elements.length > 0
        ? new URL(nextHref, baseUrl).toString()
        : null;
  }

  return collected;
}
