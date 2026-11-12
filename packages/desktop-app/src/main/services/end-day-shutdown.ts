import { ArgumentNullException } from '../../shared/dtos';

/** How long End my day waits for the provider before shutting down anyway, entries kept. */
export const END_DAY_DRAIN_TIMEOUT_MS = 30_000;
/** Between two passes over the queue while it drains. */
export const END_DAY_DRAIN_POLL_MS = 1_000;

export interface EndDayShutdownDeps {
  /**
   * One pass over the queue: sends what is due, and answers whether anything
   * is still due to go -- held only by the undo window, not by an overlap or
   * a backoff, which no wait would end.
   */
  drainOnce: () => Promise<boolean>;
  /** Asks Windows to shut down, with its own 30 s to cancel. */
  scheduleShutdown: () => Promise<boolean>;
  abortShutdown: () => Promise<boolean>;
  isShutdownPending: () => boolean;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

/**
 * The optional PC shutdown of End my day (S17, P10a). It used to run right
 * after the stop, so the sends -- held ten seconds for Undo -- never left
 * before the machine went down, and Undo could not stop it. Now it starts
 * only when Undo has passed (the undo's commit), waits for the queue to
 * answer, for at most `END_DAY_DRAIN_TIMEOUT_MS`, and then shuts down
 * anyway: what is not sent stays in the queue and goes tomorrow. Undo, or
 * cancelling the wrap-up, cancels it at any point.
 */
export class EndDayShutdown {
  private readonly _deps: EndDayShutdownDeps;
  private readonly _now: () => number;
  private readonly _wait: (ms: number) => Promise<void>;
  /** Bumped by every start and cancel: a run that sees another number stops. */
  private _generation = 0;

  constructor(deps: EndDayShutdownDeps) {
    if (!deps) throw new ArgumentNullException('deps');
    this._deps = deps;
    this._now = deps.now ?? Date.now;
    this._wait = deps.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  }

  /** Drains the queue, then shuts down -- unless cancelled meanwhile. Resolves when it has done either. */
  public async start(): Promise<'scheduled' | 'cancelled' | 'failed'> {
    const generation = ++this._generation;
    const deadline = this._now() + END_DAY_DRAIN_TIMEOUT_MS;
    for (;;) {
      let waiting = true;
      try {
        waiting = await this._deps.drainOnce();
      } catch (err) {
        // A failed pass is the provider not answering: the deadline still holds.
        console.warn('[EndDayShutdown] A pass over the queue failed:', err);
      }
      if (generation !== this._generation) return 'cancelled';
      if (!waiting || this._now() >= deadline) break;
      await this._wait(END_DAY_DRAIN_POLL_MS);
      if (generation !== this._generation) return 'cancelled';
    }
    const scheduled = await this._deps.scheduleShutdown();
    if (generation !== this._generation) {
      // Cancelled while Windows was being asked: take it back.
      if (scheduled) await this._deps.abortShutdown();
      return 'cancelled';
    }
    return scheduled ? 'scheduled' : 'failed';
  }

  /** Stops a drain in progress, and a shutdown already asked for. */
  public async cancel(): Promise<void> {
    this._generation++;
    if (this._deps.isShutdownPending()) await this._deps.abortShutdown();
  }
}
