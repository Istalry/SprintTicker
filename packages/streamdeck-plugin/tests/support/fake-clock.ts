/**
 * A clock the tests move by hand, handed to AppLink and DeckController in
 * place of the real timers. Explicit rather than Vitest's fake timers: the
 * controller's draws settle in promise callbacks, and a clock that only
 * moves when told keeps those apart from the timers.
 */
export class FakeClock {
  public nowMs: number;
  private readonly _timers = new Map<number, { at: number; fn: () => void; every: number | null }>();
  private _nextId = 1;

  constructor(start: string = '2026-10-22T10:00:00.000Z') {
    this.nowMs = Date.parse(start);
  }

  public readonly now = (): Date => new Date(this.nowMs);

  public readonly setTimeout = (fn: () => void, ms: number): unknown => this.add(fn, ms, null);
  public readonly setInterval = (fn: () => void, ms: number): unknown => this.add(fn, ms, ms);
  public readonly clearTimeout = (handle: unknown): void => {
    this._timers.delete(handle as number);
  };
  public readonly clearInterval = (handle: unknown): void => {
    this._timers.delete(handle as number);
  };

  /** Timers still waiting to fire. */
  public get pending(): number {
    return this._timers.size;
  }

  /** Moves time on by `ms`, firing every timer due on the way, in order. */
  public advance(ms: number): void {
    const end = this.nowMs + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextAt = Infinity;
      for (const [id, timer] of this._timers) {
        if (timer.at <= end && timer.at < nextAt) {
          nextAt = timer.at;
          nextId = id;
        }
      }
      if (nextId === null) break;
      const timer = this._timers.get(nextId)!;
      this.nowMs = timer.at;
      if (timer.every === null) this._timers.delete(nextId);
      else timer.at += timer.every;
      timer.fn();
    }
    this.nowMs = end;
  }

  private add(fn: () => void, ms: number, every: number | null): number {
    const id = this._nextId++;
    this._timers.set(id, { at: this.nowMs + ms, fn, every });
    return id;
  }
}
