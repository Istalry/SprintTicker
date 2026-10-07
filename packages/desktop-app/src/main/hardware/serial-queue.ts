/**
 * Runs asynchronous operations one at a time, in the order they were asked
 * for.
 *
 * Written once here after it had been written twice -- the animation player's
 * scene lock and the driver's clear chain -- and needed a third time for the
 * driver's display queue. A failed operation rejects its own caller and lets
 * the next one run; it never blocks the queue.
 *
 * Without `.then(`, which `src/main/hardware/` bans: each link is a promise
 * resolved by the `finally` of the operation before it.
 */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  /** Operations waiting or running. */
  public get length(): number {
    return this.pending;
  }

  public async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let finished!: () => void;
    this.tail = new Promise<void>(resolve => {
      finished = resolve;
    });
    this.pending++;
    try {
      // Never rejects: every link is resolved by a `finally` like this one.
      await previous;
      return await operation();
    } finally {
      this.pending--;
      finished();
    }
  }
}
