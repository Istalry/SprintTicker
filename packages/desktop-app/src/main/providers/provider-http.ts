import { ProviderRequestError } from './provider-errors';
import {
  PROVIDER_REQUEST_TIMEOUT_MS,
  PROVIDER_MAX_RETRIES,
  PROVIDER_RETRY_BASE_MS,
  PROVIDER_RETRY_MAX_MS
} from './provider-constants';

/**
 * The single place a task provider talks to the network.
 *
 * Every provider request used to call `fetch` directly with its own headers and
 * no timeout, so a hung instance stalled a sync pass indefinitely -- which is
 * also why saving credentials could not await its own sync and had to be
 * fire-and-forget. The device driver learned this lesson first; the comment on
 * its `deviceFetch` records that centralising the timeout was how "ten of the
 * eighteen ended up without one".
 *
 * It exists as much for the second provider as for the first. Timeouts,
 * classification, 429 handling and backoff are provider-agnostic, and a Jira
 * adapter that reimplemented them would reimplement their bugs too.
 */

/** Methods that may be repeated without changing what the server holds. */
const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Statuses worth trying again: the server said "not now", not "no". */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export interface ProviderFetchOptions {
  /** Overrides the default per-attempt timeout. */
  timeoutMs?: number;
  /**
   * Allows retrying a request this module would otherwise consider unsafe.
   *
   * Only set it for a call the remote genuinely treats as idempotent. It is
   * off by default because the obvious candidate -- POSTing a worklog -- is
   * exactly the request that must not be retried blind: OpenProject's v3 API
   * has no idempotency key, so a retry after a response that was sent but
   * never received bills the time twice.
   */
  retryUnsafeMethod?: boolean;
  /** Injected in tests; defaults to the ambient fetch. */
  fetchFn?: typeof fetch;
  /** Injected in tests so backoff does not cost real seconds. */
  sleepFn?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Performs one provider request, with a timeout, bounded retries and typed
 * errors.
 *
 * Resolves only for a 2xx response. Anything else throws a
 * {@link ProviderRequestError}, because the callers that matter feed the sync
 * worker's prune, and a caller that forgets to check a status is how the local
 * cache got deleted (F-01).
 */
export async function providerFetch(
  providerId: string,
  url: string,
  init: RequestInit,
  context: string,
  options: ProviderFetchOptions = {}
): Promise<Response> {
  if (!providerId) throw new Error('providerFetch requires a providerId.');
  if (!url) throw new Error('providerFetch requires a url.');

  const doFetch = options.fetchFn ?? globalThis.fetch;
  const sleep = options.sleepFn ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? PROVIDER_REQUEST_TIMEOUT_MS;
  const method = (init.method ?? 'GET').toUpperCase();
  const mayRetry = options.retryUnsafeMethod === true || IDEMPOTENT_METHODS.has(method);
  const maxAttempts = mayRetry ? PROVIDER_MAX_RETRIES + 1 : 1;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await doFetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      // A timeout arrives here as an AbortError, which is a transport failure
      // like any other: the request did not complete and may succeed later.
      lastError = err;
      if (attempt < maxAttempts) {
        await sleep(backoffFor(attempt));
        continue;
      }
      throw ProviderRequestError.fromTransport(providerId, context, err);
    }

    if (res.ok) return res;

    if (RETRYABLE_STATUSES.has(res.status) && attempt < maxAttempts) {
      await sleep(retryDelayFor(res, attempt));
      continue;
    }

    throw ProviderRequestError.fromStatus(providerId, res.status, context, await readErrorDetail(res));
  }

  // Unreachable: the loop either returns or throws. Kept so a future change to
  // the loop bounds cannot silently fall through to undefined.
  throw ProviderRequestError.fromTransport(providerId, context, lastError);
}

/** Full-jitter exponential backoff, capped. */
function backoffFor(attempt: number): number {
  const ceiling = Math.min(PROVIDER_RETRY_BASE_MS * 2 ** (attempt - 1), PROVIDER_RETRY_MAX_MS);
  return ceiling / 2 + Math.random() * (ceiling / 2);
}

/**
 * How long to wait before repeating a request the server deferred.
 *
 * A `Retry-After` is an instruction, not a hint: ignoring it on a 429 is how a
 * client earns a longer ban than the one it was given.
 */
function retryDelayFor(res: Response, attempt: number): number {
  const header = res.headers?.get?.('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, PROVIDER_RETRY_MAX_MS);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.min(Math.max(date - Date.now(), 0), PROVIDER_RETRY_MAX_MS);
  }
  return backoffFor(attempt);
}

/**
 * Extracts the server's own explanation from a failed response.
 *
 * Both APIs put the actionable half of a 4xx in the body: without it a rejected
 * key reads only as "HTTP 401". OpenProject uses `message`; Jira Cloud returns
 * an `errorMessages` array.
 */
async function readErrorDetail(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { message?: string; errorMessages?: string[] };
    if (typeof body?.message === 'string' && body.message.length > 0) return body.message;
    if (Array.isArray(body?.errorMessages) && body.errorMessages.length > 0) {
      return body.errorMessages.join('; ');
    }
  } catch {
    // Not a JSON body. The status alone is still a usable error.
  }
  return undefined;
}
