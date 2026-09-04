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

  /** True when retrying the same request cannot succeed without user action. */
  public get isPermanent(): boolean {
    return this.kind === 'auth' || this.kind === 'not_configured';
  }

  /** Convenience for the common "credentials are missing" case. */
  public static notConfigured(providerId: string): ProviderRequestError {
    return new ProviderRequestError(
      providerId,
      'not_configured',
      `${providerId} is not configured: set a domain and API key in Settings.`
    );
  }

  /** Classifies an HTTP response status into the matching error kind. */
  public static fromStatus(providerId: string, status: number, context: string): ProviderRequestError {
    const kind: ProviderErrorKind = status === 401 || status === 403 ? 'auth' : 'protocol';
    return new ProviderRequestError(providerId, kind, `${context} failed: HTTP ${status}`, { status });
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
