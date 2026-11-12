import { describe, it, expect, vi } from 'vitest';
import type { ActiveSessionDTO } from '../src/shared/dtos';
import type { InterruptionSource } from '../src/shared/interruption';
import { MiniOnInterruption } from '../src/main/windows/mini-on-interruption';

/** An interruption from the bar, the deck or the shortcut puts the mini timer on screen (P12d, S25). */
describe('MiniOnInterruption', () => {
  const interruption = (id: string, source: InterruptionSource): ActiveSessionDTO => ({
    sessionId: id, projectId: 'p', taskId: id, taskKey: 'ADHOC', taskTitle: 'Interruption 10:30', isAdHoc: true,
    status: 'TRACKING', startTimeUtc: '2026-11-12T09:00:00.000Z', totalPausedSeconds: 0, elapsedSeconds: 4,
    interruption: {
      id, name: null, title: 'Interruption 10:30', startedAtUtc: '2026-11-12T09:00:00.000Z', index: 1, source,
      interruptedSessionId: 's1', interruptedTaskKey: 'MG-12', interruptedTaskTitle: 'T', interruptedWasPaused: false
    }
  });

  function over(onScreen = false) {
    let listener: ((session: ActiveSessionDTO | null) => void) | null = null;
    const openMini = vi.fn();
    const opener = new MiniOnInterruption({
      subscribe: l => { listener = l; return () => { listener = null; }; },
      isDashboardOnScreen: () => onScreen,
      openMini
    });
    opener.start();
    return { openMini, opener, emit: (s: ActiveSessionDTO | null) => listener?.(s) };
  }

  it.each(['bar', 'deck', 'shortcut'] as const)('FromThe%s_OpensTheMiniTimer', source => {
    const { openMini, emit } = over();

    emit(interruption('i1', source));

    expect(openMini).toHaveBeenCalledTimes(1);
  });

  it.each(['window', 'mini', 'tray'] as const)('FromThe%s_LeavesItAlone', source => {
    // Already on screen, or the window opens itself.
    const { openMini, emit } = over();

    emit(interruption('i1', source));

    expect(openMini).not.toHaveBeenCalled();
  });

  it('EveryTick_OpensOncePerInterruption_ClosedItStaysClosed', () => {
    const { openMini, emit } = over();

    emit(interruption('i1', 'deck'));
    emit(interruption('i1', 'deck'));
    emit(interruption('i2', 'deck'));

    expect(openMini).toHaveBeenCalledTimes(2);
  });

  it('DashboardOnScreen_ItsCardHasTheField_NoMiniTimer', () => {
    const { openMini, emit } = over(true);

    emit(interruption('i1', 'deck'));

    expect(openMini).not.toHaveBeenCalled();
  });

  it('OpeningFails_IsLoggedNotThrown', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { openMini, emit } = over();
    openMini.mockImplementation(() => { throw new Error('gone'); });

    expect(() => emit(interruption('i1', 'bar'))).not.toThrow();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('Stopped_OpensNothing', () => {
    const { openMini, emit, opener } = over();

    opener.stop();
    emit(interruption('i1', 'deck'));

    expect(openMini).not.toHaveBeenCalled();
  });
});
