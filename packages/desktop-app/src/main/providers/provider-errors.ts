/**
 * Why a provider request could not be completed.
 *
 * - `not_configured` — no credentials yet. Not a failure; the user simply has
 *   not set the provider up. Callers should treat it as "nothing to sync",
 *   never as "the remote has no data".
 * - `transport`    — network unreachable, DNS failure, timeout. Retryable.
 * - `auth`         — 401/403. Retrying will not help until the user acts.
 * - `protocol`     — reachable and authorised, but the response was not what
 *                    the API contract promises (bad status, unparseable body).
 */
export type ProviderErrorKind = 'not_configured' | 'transport' | 'auth' | 'protocol';

/**
 * Raised by a task provider when a request cannot be fulfilled.
 *
 * Providers throw instead of returning an empty array. The distinction is not
 * stylistic: `getProjects()` used to return `[]` both when the remote genuinely
 * had no projects and when the request failed or was never configured. The
 * sync worker treats its fetch as authoritative and prunes anything absent from
 * it, so a single failed request -- or simply launching before entering
 * credentials -- deleted every locally cached project and task.
 *
 * A `Result` type was considered and rejected: TypeScript cannot force a caller
 * to inspect an `ok` flag, and *forgetting to check* is precisely the bug. A
 * throw cannot be skipped, because control flow never reaches the prune.
 */
export class ProviderRequestError extends Error {
  public readonly kind: ProviderErrorKind;
  public readonly providerId: string;
  /** HTTP status, when the failure came from a response. */
  public readonly status?: number;

  constructor(
    providerId: string,
    kind: ProviderErrorKind,
    message: string,
    options?: { status?: number; cause?: unknown }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ProviderRequestError';
    this.providerId = providerId;
    this.kind = kind;
    this.status = options?.status;
  }

  /**
   * True when retrying the same request cannot succeed without user action.
   *
   * A 4xx belongs here as much as a 401 does, and leaving it out cost real
   * retries against a live Jira site: a worklog for an issue that had since
   * been deleted answered `404 - Le ticket n'existe pas`, and one Jira refused
   * outright answered `400`. Both were retried on the ordinary backoff, and
   * both retries sent byte-identical requests to a byte-identical URL. This is
   * the rule the device driver already follows -- `413` there is documented as
   * permanent because retrying sends the same bytes -- applied to providers.
   *
   * The two 4xx exceptions are the ones that describe a moment rather than a
   * request: `408` is the server saying it waited too long, and `429` that it
   * wants a pause. `providerFetch` already retries both internally, and a row
   * that still fails afterwards deserves the queue's slower backoff, not a
   * park.
   *
   * A 5xx stays retryable: the request was fine and the server was not.
   */
  public get isPermanent(): boolean {
    if (this.kind === 'auth' || this.kind === 'not_configured') return true;
    if (this.status === undefined) return false;
    if (this.status === 408 || this.status === 429) return false;
    return this.status >= 400 && this.status < 500;
  }

  /** Convenience for the common "credentials are missing" case. */
  public static notConfigured(providerId: string): ProviderRequestError {
    return new ProviderRequestError(
      providerId,
      'not_configured',
      `${providerId} is not configured: set a domain and API key in Settings.`
    );
  }

  /**
   * Classifies an HTTP response status into the matching error kind.
   *
   * `detail` carries the server's own explanation when there is one. It is
   * what makes a failed credential probe say "HTTP 401 - You did not provide
   * the correct credentials" instead of leaving the user to guess.
   */
  public static fromStatus(
    providerId: string,
    status: number,
    context: string,
    detail?: string
  ): ProviderRequestError {
    const kind: ProviderErrorKind = status === 401 || status === 403 ? 'auth' : 'protocol';
    const suffix = detail ? ` - ${detail}` : '';
    return new ProviderRequestError(providerId, kind, `${context} failed: HTTP ${status}${suffix}`, { status });
  }

  /** Wraps a thrown fetch/network error, preserving the original as `cause`. */
  public static fromTransport(providerId: string, context: string, cause: unknown): ProviderRequestError {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return new ProviderRequestError(providerId, 'transport', `${context} failed: ${detail}`, { cause });
  }
}

/** Narrowing helper for `catch` blocks. */
export function isProviderRequestError(err: unknown): err is ProviderRequestError {
  return err instanceof ProviderRequestError;
}
