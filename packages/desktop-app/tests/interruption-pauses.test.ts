import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { InterruptionRepository, interruptionSeconds } from '../src/main/db/repositories/interruption-repository';

/**
 * An interruption pauses as a task does (migration 17, 2026-11-16): its
 * time is its span less its pauses, the ended ones and the one still open.
 */
describe('A paused interruption', () => {
  let repo: InterruptionRepository;
  const T = (minutes: number) => new Date(Date.UTC(2026, 10, 16, 9, minutes, 0)).toISOString();

  beforeEach(() => {
    repo = new InterruptionRepository(new DatabaseConnection(':memory:'));
    repo.open({ id: 'int_1', startedAtUtc: T(0), source: 'bar', interruptedSessionId: null, interruptedWasPaused: false, afterId: null });
  });

  it('InterruptionSeconds_NeverPaused_IsItsSpan', () => {
    repo.close('int_1', T(10));

    expect(interruptionSeconds(repo.get('int_1')!)).toBe(600);
  });

  it('InterruptionSeconds_PausedAndResumed_LeavesThePauseOut', () => {
    repo.pause('int_1', T(5));
    repo.resume('int_1', T(8));
    repo.close('int_1', T(10));

    const fragment = repo.get('int_1')!;
    expect(fragment).toMatchObject({ pausedAtUtc: null, pausedSeconds: 180 });
    expect(interruptionSeconds(fragment)).toBe(420);
  });

  it('InterruptionSeconds_WhilePaused_StopsCounting', () => {
    repo.pause('int_1', T(5));

    expect(interruptionSeconds(repo.get('int_1')!, T(9))).toBe(300);
  });

  it('Close_WhilePaused_EndsThePauseWithIt', () => {
    repo.pause('int_1', T(5));
    repo.close('int_1', T(10));

    const fragment = repo.get('int_1')!;
    expect(fragment).toMatchObject({ endedAtUtc: T(10), pausedAtUtc: null, pausedSeconds: 300 });
    expect(interruptionSeconds(fragment)).toBe(300);
  });

  it('Discard_WhilePaused_EndsThePauseWithIt', () => {
    repo.pause('int_1', T(5));
    repo.markDiscarded('int_1', T(10));

    expect(repo.get('int_1')).toMatchObject({ endedAtUtc: T(10), discardedAtUtc: T(10), pausedAtUtc: null, pausedSeconds: 300 });
  });

  it('Pause_Twice_KeepsTheFirstStart', () => {
    repo.pause('int_1', T(5));
    repo.pause('int_1', T(7));

    expect(repo.get('int_1')!.pausedAtUtc).toBe(T(5));
  });

  it('PauseOrResume_AnEndedFragment_ChangesNothing', () => {
    repo.close('int_1', T(10));
    repo.pause('int_1', T(11));
    repo.resume('int_1', T(12));

    expect(repo.get('int_1')).toMatchObject({ pausedAtUtc: null, pausedSeconds: 0 });
  });
});
