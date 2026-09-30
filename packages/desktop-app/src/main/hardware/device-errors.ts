/**
 * How the BUSY Bar driver reports a request the device did not carry out.
 *
 * The driver used to answer `Promise<boolean>` and never throw, and that shape
 * shipped the same bug twice. A refused request came back as `false`, which a
 * caller that forgets to look cannot tell from success -- and `.then(...)
 * .catch(...)` on one of those calls puts the failure handling in a `catch` that
 * can never run. The Away animation went dark for a fortnight that way: the
 * device refused the `.anim`, `then` asked it to draw the file anyway, and
 * nothing logged anything. TypeScript could not help, because ignoring a
 * `boolean` is legal. Ignoring a rejection is not: `no-floating-promises` makes
 * it a lint error in main, so throwing turns that whole class of bug into a
 * build failure.
 *
 * Two outcomes that *look* like failures are deliberately not errors, and come
 * back as values instead:
 *
 * - `409` -- another application owns the display at a higher priority. That
 *   is the device working as designed, not this request going wrong, so draws
 *   answer `'conflict'` rather than throwing.
 * - A pixel frame that was queued (disconnected, or another frame in flight)
 *   or superseded (a clear or payload landed mid-upload). Neither is a failure;
 *   both used to be reported as `false`, indistinguishable from a refusal.
 */

// Type-only: the driver imports this module at runtime, so a value import back
// would be a cycle.
import type { DeviceResponseKind } from './busybar-driver';

/**
 * Why a device request failed.
 *
 * - `disconnected` -- the driver is not connected, so nothing was sent.
 * - `unreachable` -- sent, and no answer: timeout, refused connection, DNS.
 * - `conflict` -- `409` on a request that is not a draw, where the display
 *   owning priority has no meaning. Draws report it as an outcome instead.
 * - `too_large` -- `413`. Permanent: retrying sends the same bytes.
 * - `busy` -- `503`, still busy after the driver's own retry.
 * - `rejected` -- any other non-2xx answer.
 */
export type DeviceFailureKind = 'disconnected' | 'unreachable' | 'conflict' | 'too_large' | 'busy' | 'rejected';

/** What a draw request achieved. A `409` is an answer, not a failure. */
export type DrawOutcome = 'drawn' | 'conflict';

/**
 * What a pixel frame request achieved.
 *
 * - `sent` -- uploaded and drawn.
 * - `queued` -- not sent yet; it is the frame the driver will send next, once
 *   it reconnects or the frame in flight finishes. A newer frame replaces it.
 * - `superseded` -- a `clearDisplay` or `sendDisplayPayload` landed during the
 *   upload, so the draw was abandoned. The device is not showing this frame.
 * - `conflict` -- uploaded, but the draw got a `409`.
 */
export type FrameOutcome = 'sent' | 'queued' | 'superseded' | 'conflict';

/**
 * What a `clearDisplay` achieved.
 *
 * - `cleared` -- the application's elements are gone and the display is
 *   released.
 * - `superseded` -- something was drawn while the clear was taking its
 *   animations down, so the full clear was skipped: releasing the display then
 *   would wipe the screen that just replaced the one being cleared.
 */
export type ClearOutcome = 'cleared' | 'superseded';

/**
 * Whether a failed element removal means the element was not there.
 *
 * Firmware 1.2.4 answers **400** -- not 404 -- to `DELETE /api/display/draw`
 * naming an id it does not hold. Only that status reads as "already gone":
 * any other refusal says nothing about the element, and treating it as gone
 * before releasing the display is how an animation would be left up for the
 * close that hangs the bar.
 */
export function isElementAbsent(err: unknown): boolean {
  return err instanceof DeviceRequestError && err.kind === 'rejected' && err.status === 400;
}

/** A thrown value as one log-friendly line. */
export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class DeviceRequestError extends Error {
  constructor(
    /** Why it failed. */
    public readonly kind: DeviceFailureKind,
    /** What was being attempted, e.g. `asset upload frame_0.png`. */
    public readonly operation: string,
    /** The HTTP status, when the device answered at all. */
    public readonly status: number | null = null,
    detail?: string
  ) {
    super(`${operation} failed (${kind}${status !== null ? `, HTTP ${status}` : ''})${detail ? `: ${detail}` : ''}`);
    this.name = 'DeviceRequestError';
  }

  /**
   * Builds the error for a classified response that was not `ok`.
   *
   * `transportError` is only used when there was no response, since that is
   * the only case where the status says nothing about why.
   */
  public static fromResponseKind(
    kind: Exclude<DeviceResponseKind, 'ok'>,
    operation: string,
    response: Response | null,
    transportError: string | null
  ): DeviceRequestError {
    const failureKind: DeviceFailureKind = kind === 'error' ? 'rejected' : kind;
    return new DeviceRequestError(
      failureKind,
      operation,
      response ? response.status : null,
      response ? undefined : (transportError ?? 'no answer')
    );
  }
}
