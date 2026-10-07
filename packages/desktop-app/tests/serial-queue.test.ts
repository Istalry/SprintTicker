import { describe, it, expect } from 'vitest';
import { SerialQueue } from '../src/main/hardware/serial-queue';

describe('SerialQueue', () => {
  const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

  it('Run_SeveralAtOnce_RunsThemOneAtATimeInOrder', async () => {
    const queue = new SerialQueue();
    const log: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const op = (name: string) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      log.push(`start ${name}`);
      await tick();
      log.push(`end ${name}`);
      running--;
      return name;
    };

    const results = await Promise.all([queue.run(op('a')), queue.run(op('b')), queue.run(op('c'))]);

    expect(results).toEqual(['a', 'b', 'c']);
    expect(maxRunning).toBe(1);
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('Run_OperationFails_RejectsItsCallerAndRunsTheNext', async () => {
    const queue = new SerialQueue();

    const failing = queue.run(async () => {
      throw new Error('device said no');
    });
    const next = queue.run(async () => 'still runs');

    await expect(failing).rejects.toThrow('device said no');
    await expect(next).resolves.toBe('still runs');
  });

  it('Length_CountsWaitingAndRunningOperations', async () => {
    const queue = new SerialQueue();
    let release: () => void = () => undefined;
    const first = queue.run(() => new Promise<void>(resolve => (release = resolve)));
    const second = queue.run(async () => undefined);

    expect(queue.length).toBe(2);
    await tick();
    release();
    await Promise.all([first, second]);

    expect(queue.length).toBe(0);
  });
});
