import { describe, it, expect, vi } from 'vitest';
import { EndDayShutdown, END_DAY_DRAIN_POLL_MS, END_DAY_DRAIN_TIMEOUT_MS } from '../src/main/services/end-day-shutdown';

/** A clock that moves only when the shutdown waits. */
const harness = (passes: boolean[], over: Partial<ConstructorParameters<typeof EndDayShutdown>[0]> = {}) => {
  let now = 0;
  let pending = false;
  const drainOnce = vi.fn(async () => passes.shift() ?? true);
  const scheduleShutdown = vi.fn(async () => { pending = true; return true; });
  const abortShutdown = vi.fn(async () => { pending = false; return true; });
  const shutdown = new EndDayShutdown({
    drainOnce,
    scheduleShutdown,
    abortShutdown,
    isShutdownPending: () => pending,
    now: () => now,
    wait: async ms => { now += ms; },
    ...over
  });
  return { shutdown, drainOnce, scheduleShutdown, abortShutdown, elapsed: () => now };
};

/** End my day's shutdown (S17, P10a): after the queue has answered, or 30 s. */
describe('EndDayShutdown', () => {
  it('Start_QueueEmpties_ShutsDownThen', async () => {
    const h = harness([true, true, false]);

    await expect(h.shutdown.start()).resolves.toBe('scheduled');

    expect(h.drainOnce).toHaveBeenCalledTimes(3);
    expect(h.elapsed()).toBe(2 * END_DAY_DRAIN_POLL_MS);
    expect(h.scheduleShutdown).toHaveBeenCalledTimes(1);
  });

  it('Start_QueueNeverEmpties_ShutsDownAt30s_EntriesKept', async () => {
    const h = harness([]);

    await expect(h.shutdown.start()).resolves.toBe('scheduled');

    expect(h.elapsed()).toBe(END_DAY_DRAIN_TIMEOUT_MS);
    expect(h.scheduleShutdown).toHaveBeenCalledTimes(1);
  });

  it('Start_APassThrows_KeepsGoingToTheDeadline', async () => {
    const h = harness([], { drainOnce: vi.fn().mockRejectedValue(new Error('offline')) });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(h.shutdown.start()).resolves.toBe('scheduled');

    expect(h.elapsed()).toBe(END_DAY_DRAIN_TIMEOUT_MS);
    vi.restoreAllMocks();
  });

  it('Cancel_WhileDraining_NeverShutsDown', async () => {
    let release: (value: boolean) => void = () => undefined;
    const h = harness([], { drainOnce: vi.fn(() => new Promise<boolean>(resolve => { release = resolve; })) });

    const run = h.shutdown.start();
    await h.shutdown.cancel();
    release(false);

    await expect(run).resolves.toBe('cancelled');
    expect(h.scheduleShutdown).not.toHaveBeenCalled();
  });

  it('Cancel_AfterItWasAskedFor_TakesItBack', async () => {
    const h = harness([false]);
    await h.shutdown.start();

    await h.shutdown.cancel();

    expect(h.abortShutdown).toHaveBeenCalledTimes(1);
  });

  it('Start_Refused_SaysFailed', async () => {
    const h = harness([false], { scheduleShutdown: vi.fn().mockResolvedValue(false) });

    await expect(h.shutdown.start()).resolves.toBe('failed');
  });
});
