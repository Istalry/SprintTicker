import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserWindow } from 'electron';
import { IPCChannel } from '../src/shared/ipc-channels';
import { ContextScheduleService } from '../src/main/services/context-schedule-service';
import { PriorityPreemptionEngine } from '../src/main/services/priority-preemption-engine';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';

describe('ContextScheduleService Unit Tests', () => {
  let mockPriorityEngine: { getUserMode: ReturnType<typeof vi.fn>; setUserMode: ReturnType<typeof vi.fn> };
  let mockSettingsRepo: { getSetting: ReturnType<typeof vi.fn> };
  let mockEngine: { getCurrentSession: ReturnType<typeof vi.fn>; pauseSession: ReturnType<typeof vi.fn>; resumeSession: ReturnType<typeof vi.fn> };
  let mockRenderer: { renderLunchMode: ReturnType<typeof vi.fn>; renderAwayMode: ReturnType<typeof vi.fn>; renderActiveSession: ReturnType<typeof vi.fn>; renderCeremonyPrompt: ReturnType<typeof vi.fn> };
  let service: ContextScheduleService;

  beforeEach(() => {
    mockPriorityEngine = {
      getUserMode: vi.fn().mockReturnValue('WORK'),
      setUserMode: vi.fn()
    };
    mockSettingsRepo = {
      // Every time these tests assert on is stated here. standupTime used to be
      // omitted, so the suite silently inherited whatever the service's inline
      // default happened to be -- and the clock values below were chosen
      // against that value. Changing the product default then broke a test that
      // is not about defaults at all.
      getSetting: vi.fn().mockReturnValue({
        standupTime: '10:00',
        lunchStartTime: '12:30',
        lunchEndTime: '13:30',
        eodWrapUpTime: '18:00'
      })
    };
    mockEngine = {
      getCurrentSession: vi.fn().mockReturnValue(null),
      pauseSession: vi.fn(),
      resumeSession: vi.fn(),
      stopSession: vi.fn(),
      startTask: vi.fn()
    };
    mockRenderer = {
      renderLunchMode: vi.fn(),
      renderAwayMode: vi.fn(),
      renderActiveSession: vi.fn(),
      renderCeremonyPrompt: vi.fn(),
      setContextMode: vi.fn().mockImplementation((mode: string) => {
        if (mode === 'LUNCH') mockRenderer.renderLunchMode();
        else if (mode === 'AWAY') mockRenderer.renderAwayMode();
        else if (mode === 'WORK') mockRenderer.renderActiveSession(mockEngine.getCurrentSession());
      })
    };

    service = new ContextScheduleService(
      mockPriorityEngine as unknown as PriorityPreemptionEngine,
      mockSettingsRepo as unknown as SettingsRepository,
      mockEngine as unknown as TimeTrackingEngine,
      mockRenderer as unknown as DisplayRenderer
    );
  });

  afterEach(() => {
    service.dispose();
  });

  it('Constructor_NullArguments_ThrowsArgumentNullException', () => {
    expect(() => new ContextScheduleService(null as unknown as PriorityPreemptionEngine, mockSettingsRepo as unknown as SettingsRepository, mockEngine as unknown as TimeTrackingEngine, mockRenderer as unknown as DisplayRenderer)).toThrowError('Argument cannot be null or undefined: priorityEngine');
  });

  it('EnterLunchMode_ActiveTrackingSession_AutoStopsSessionAndRendersLunchScreen', () => {
    mockEngine.getCurrentSession.mockReturnValue({ status: 'TRACKING', taskId: '123', isAdHoc: false, taskTitle: 'Test', projectId: 'P1', taskKey: 'P1-123' });

    service.enterLunchMode();

    expect(mockEngine.stopSession).toHaveBeenCalledWith('Auto-completed for Lunch Break split', false);
    expect(mockPriorityEngine.setUserMode).toHaveBeenCalledWith('LUNCH');
    expect(mockRenderer.renderLunchMode).toHaveBeenCalledTimes(1);
  });

  it('ExitLunchMode_WasAutoStoppedForLunch_ResumesSessionWithStartTask', () => {
    mockEngine.getCurrentSession.mockReturnValue({ status: 'TRACKING', taskId: '123', isAdHoc: false, taskTitle: 'Test', projectId: 'P1', taskKey: 'P1-123' });
    service.enterLunchMode();

    mockEngine.getCurrentSession.mockReturnValue(null); // No task running during lunch

    service.exitLunchMode();

    expect(mockPriorityEngine.setUserMode).toHaveBeenCalledWith('WORK');
    expect(mockEngine.startTask).toHaveBeenCalledWith('123', false, 'Test', 'P1', 'P1-123');
  });

  it('ExitLunchMode_WasNotAutoStoppedForLunch_RendersActiveSession', () => {
    service.exitLunchMode();

    expect(mockPriorityEngine.setUserMode).toHaveBeenCalledWith('WORK');
    expect(mockRenderer.renderActiveSession).toHaveBeenCalledTimes(1);
  });

  it('EnterAwayMode_CallsPriorityEngineAndRendersAwayMode', () => {
    service.enterAwayMode();

    expect(mockPriorityEngine.setUserMode).toHaveBeenCalledWith('AWAY');
    expect(mockRenderer.renderAwayMode).toHaveBeenCalledTimes(1);
  });

  it('ExitAwayMode_ReturnsToWorkModeAndRendersActiveSession', () => {
    service.exitAwayMode();

    expect(mockPriorityEngine.setUserMode).toHaveBeenCalledWith('WORK');
    expect(mockRenderer.renderActiveSession).toHaveBeenCalledTimes(1);
  });

  it('EvaluateSchedule_TimeInLunchWindow_EntersLunchMode', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 12, 45, 0));

    service.evaluateSchedule();

    expect(mockPriorityEngine.setUserMode).toHaveBeenCalledWith('LUNCH');
    expect(mockRenderer.renderLunchMode).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('EvaluateSchedule_TimeAfterLunch_ExitsLunchMode', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 14, 0, 0));

    mockPriorityEngine.getUserMode.mockReturnValue('LUNCH');

    service.evaluateSchedule();

    expect(mockPriorityEngine.setUserMode).toHaveBeenCalledWith('WORK');
    expect(mockRenderer.renderActiveSession).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('EvaluateSchedule_WithLunchStartAndLunchEndAliases_EntersAndExitsLunchModeOnTime', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 30, 13, 14, 0)); // 13:14 (between 13:13 and 13:15)

    mockSettingsRepo.getSetting.mockReturnValue({
      lunchStart: '13:13',
      lunchEnd: '13:15',
      enableLunchMute: true
    });

    service.evaluateSchedule();

    expect(mockPriorityEngine.setUserMode).toHaveBeenCalledWith('LUNCH');
    expect(mockRenderer.renderLunchMode).toHaveBeenCalledTimes(1);

    // Advance time past 13:15
    vi.setSystemTime(new Date(2026, 6, 30, 13, 16, 0));
    mockPriorityEngine.getUserMode.mockReturnValue('LUNCH');

    service.evaluateSchedule();

    expect(mockPriorityEngine.setUserMode).toHaveBeenCalledWith('WORK');

    vi.useRealTimers();
  });

  it('EvaluateSchedule_AppOpenedAfterEodTime_DoesNotTriggerEodPrompt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 19, 0, 0)); // Opened at 19:00 (after 18:00 EOD)

    const mockSend = vi.fn();
    const mockWindow = { isDestroyed: () => false, webContents: { send: mockSend } };
    const getWindow = () => mockWindow as unknown as BrowserWindow;

    const svc = new ContextScheduleService(
      mockPriorityEngine as unknown as PriorityPreemptionEngine,
      mockSettingsRepo as unknown as SettingsRepository,
      mockEngine as unknown as TimeTrackingEngine,
      mockRenderer as unknown as DisplayRenderer,
      getWindow
    );

    svc.evaluateSchedule(); // Initial check on app startup

    expect(mockRenderer.renderCeremonyPrompt).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();

    svc.dispose();
    vi.useRealTimers();
  });

  it('EvaluateSchedule_AppOpenedAfterStandupTime_DoesNotTriggerStandupPrompt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 11, 30, 0)); // Opened at 11:30 (after 10:00 Standup)

    const mockSend = vi.fn();
    const mockWindow = { isDestroyed: () => false, webContents: { send: mockSend } };
    const getWindow = () => mockWindow as unknown as BrowserWindow;

    const svc = new ContextScheduleService(
      mockPriorityEngine as unknown as PriorityPreemptionEngine,
      mockSettingsRepo as unknown as SettingsRepository,
      mockEngine as unknown as TimeTrackingEngine,
      mockRenderer as unknown as DisplayRenderer,
      getWindow
    );

    svc.evaluateSchedule(); // Initial check on app startup

    expect(mockRenderer.renderCeremonyPrompt).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();

    svc.dispose();
    vi.useRealTimers();
  });

  it('EvaluateSchedule_AppRunningBeforeStandupTime_TriggersStandupPromptAtDueTime', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 9, 30, 0)); // Opened at 09:30

    const mockSend = vi.fn();
    const mockWindow = { isDestroyed: () => false, webContents: { send: mockSend } };
    const getWindow = () => mockWindow as unknown as BrowserWindow;

    const svc = new ContextScheduleService(
      mockPriorityEngine as unknown as PriorityPreemptionEngine,
      mockSettingsRepo as unknown as SettingsRepository,
      mockEngine as unknown as TimeTrackingEngine,
      mockRenderer as unknown as DisplayRenderer,
      getWindow
    );

    svc.evaluateSchedule(); // Initial check at 09:30 -> no prompt
    expect(mockRenderer.renderCeremonyPrompt).not.toHaveBeenCalled();

    vi.setSystemTime(new Date(2026, 6, 28, 10, 0, 0)); // Clock ticks to 10:00
    svc.evaluateSchedule(); // Scheduled evaluation at 10:00 -> prompt triggered!

    expect(mockRenderer.renderCeremonyPrompt).toHaveBeenCalledWith('STANDUP', 'Daily Stand-Up');
    expect(mockSend).toHaveBeenCalledWith(IPCChannel.ON_CEREMONY_PROMPT, { type: 'STANDUP', title: 'Daily Stand-Up' });

    svc.dispose();
    vi.useRealTimers();
  });

  it('EvaluateSchedule_AppRunningBeforeEodTime_TriggersEodPromptAtDueTime', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 17, 0, 0)); // Opened at 17:00 (before 18:00 EOD)

    const mockSend = vi.fn();
    const mockWindow = { isDestroyed: () => false, webContents: { send: mockSend } };
    const getWindow = () => mockWindow as unknown as BrowserWindow;

    const svc = new ContextScheduleService(
      mockPriorityEngine as unknown as PriorityPreemptionEngine,
      mockSettingsRepo as unknown as SettingsRepository,
      mockEngine as unknown as TimeTrackingEngine,
      mockRenderer as unknown as DisplayRenderer,
      getWindow
    );

    svc.evaluateSchedule(); // Initial check at 17:00 -> no prompt
    expect(mockRenderer.renderCeremonyPrompt).not.toHaveBeenCalled();

    vi.setSystemTime(new Date(2026, 6, 28, 18, 0, 0)); // Clock ticks to 18:00 EOD
    svc.evaluateSchedule(); // Scheduled evaluation at 18:00 -> prompt triggered!

    expect(mockRenderer.renderCeremonyPrompt).toHaveBeenCalledWith('EOD', 'End-of-Day Wrap-Up');
    expect(mockSend).toHaveBeenCalledWith(IPCChannel.ON_CEREMONY_PROMPT, { type: 'EOD', title: 'End-of-Day Wrap-Up' });

    svc.dispose();
    vi.useRealTimers();
  });

  it('TriggerEodPrompt_ExplicitCall_BroadcastsToWindowAndRenderer', () => {
    const mockSend = vi.fn();
    const mockWindow = {
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send: mockSend }
    };
    const getWindow = () => mockWindow as unknown as BrowserWindow;

    const svc = new ContextScheduleService(
      mockPriorityEngine as unknown as PriorityPreemptionEngine,
      mockSettingsRepo as unknown as SettingsRepository,
      mockEngine as unknown as TimeTrackingEngine,
      mockRenderer as unknown as DisplayRenderer,
      getWindow
    );

    svc.triggerEodPrompt();

    expect(mockRenderer.renderCeremonyPrompt).toHaveBeenCalledWith('EOD', 'End-of-Day Wrap-Up');
    expect(mockWindow.restore).toHaveBeenCalledTimes(1);
    expect(mockWindow.show).toHaveBeenCalledTimes(1);
    expect(mockWindow.focus).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith(IPCChannel.ON_CEREMONY_PROMPT, { type: 'EOD', title: 'End-of-Day Wrap-Up' });

    svc.dispose();
  });
  /**
   * The "already prompted today" key must be the same day the trigger compares
   * against.
   *
   * The trigger uses local time (`getHours()`), while the key was derived from
   * `toISOString()` -- the UTC date. Those disagree for part of every day, and
   * west of UTC they disagree during the evening: at 20:00 in New York it is
   * already tomorrow in UTC. The key therefore changed in the middle of a local
   * working day, and any ceremony already due re-fired at that instant.
   *
   * Chosen deliberately for a timezone west of UTC. East of UTC the two dates
   * disagree between local midnight and the offset, when nothing is due, so the
   * fault is invisible from Europe -- which is where it was looked for.
   */
  it('EvaluateSchedule_WestOfUtcAcrossUtcMidnight_DoesNotRepeatTheSameDaysPrompt', () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'America/New_York';

    try {
      vi.useFakeTimers();
      // 10:00 EDT, the configured standup time. 14:00 UTC, still the 7th.
      vi.setSystemTime(new Date(2026, 8, 7, 10, 0, 0));

      const mockWindow = { isDestroyed: () => false, webContents: { send: vi.fn() } };
      const svc = new ContextScheduleService(
        mockPriorityEngine as unknown as PriorityPreemptionEngine,
        mockSettingsRepo as unknown as SettingsRepository,
        mockEngine as unknown as TimeTrackingEngine,
        mockRenderer as unknown as DisplayRenderer,
        () => mockWindow as unknown as BrowserWindow
      );

      svc.evaluateSchedule();
      const standups = () =>
        mockRenderer.renderCeremonyPrompt.mock.calls.filter(c => c[0] === 'STANDUP').length;
      expect(standups()).toBe(1);

      // 20:30 EDT the same local day -- but 00:30 UTC on the 8th.
      vi.setSystemTime(new Date(2026, 8, 7, 20, 30, 0));
      svc.evaluateSchedule();

      expect(standups()).toBe(1);

      svc.dispose();
      vi.useRealTimers();
    } finally {
      process.env.TZ = originalTz;
    }
  });

  describe('one failing ceremony must not cancel another', () => {
    // Reported from real use: the End-of-Day popup stopped appearing on time
    // and had to be triggered by hand. The trigger itself was fine -- the
    // manual button calls the very same method -- so the fault was in the
    // decision to call it.

    beforeEach(() => {
      // Stand-up off, so every renderCeremonyPrompt call in this block is the
      // End-of-Day one and a `mockImplementationOnce` cannot be spent on the
      // wrong ceremony.
      mockSettingsRepo.getSetting.mockReturnValue({
        standupTime: '10:00',
        enableStandupPrompt: false,
        lunchStartTime: '12:30',
        lunchEndTime: '13:30',
        eodWrapUpTime: '18:00'
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('EvaluateSchedule_LunchTransitionThrows_StillEvaluatesTheEndOfDayPrompt', () => {
      // The lunch branch runs first and reaches the renderer, and
      // `requestRender` deliberately rethrows a failed render. That used to
      // abandon the whole evaluation before End-of-Day was even considered.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 6, 28, 18, 30, 0));
      mockPriorityEngine.getUserMode.mockReturnValue('LUNCH');
      mockRenderer.setContextMode.mockImplementation(() => {
        throw new Error('display lock held');
      });

      // First tick only marks the day as started; the prompt is due on the next.
      service.evaluateSchedule();
      vi.setSystemTime(new Date(2026, 6, 29, 18, 30, 0));
      service.evaluateSchedule();

      expect(mockRenderer.renderCeremonyPrompt).toHaveBeenCalledWith('EOD', 'End-of-Day Wrap-Up');
    });

    it('EvaluateSchedule_AnEarlierThrow_DoesNotLeaveTheInitialCheckFlagStuck', () => {
      // The flag used to be cleared by the last statement of the `try`. Left
      // true, every later tick took the "suppress retroactive prompt" branch
      // and stamped the day as already prompted -- so the prompt silently never
      // fired again until the app was restarted.
      vi.useFakeTimers();
      // Start before the prompt is due, so the first tick cannot legitimately
      // suppress it, and make that first tick throw.
      vi.setSystemTime(new Date(2026, 6, 28, 9, 0, 0));
      mockPriorityEngine.getUserMode.mockImplementation(() => {
        throw new Error('engine unavailable');
      });
      service.evaluateSchedule();

      mockPriorityEngine.getUserMode.mockReturnValue('WORK');
      vi.setSystemTime(new Date(2026, 6, 28, 18, 30, 0));
      service.evaluateSchedule();

      expect(mockRenderer.renderCeremonyPrompt).toHaveBeenCalledWith('EOD', 'End-of-Day Wrap-Up');
    });

    it('EvaluateSchedule_TriggerThrows_RetriesOnTheNextTickRatherThanSkippingTheDay', () => {
      // The day used to be stamped before the prompt went out, so a single
      // failed render cancelled the ceremony until midnight.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 6, 28, 9, 0, 0));
      service.evaluateSchedule();

      mockRenderer.renderCeremonyPrompt.mockImplementationOnce(() => {
        throw new Error('display lock held');
      });
      vi.setSystemTime(new Date(2026, 6, 28, 18, 30, 0));
      service.evaluateSchedule();
      service.evaluateSchedule();

      const eodCalls = mockRenderer.renderCeremonyPrompt.mock.calls.filter(c => c[0] === 'EOD');
      expect(eodCalls).toHaveLength(2);
    });

    it('EvaluateSchedule_PromptAlreadyShown_DoesNotFireAgainTheSameDay', () => {
      // The guard the three tests above must not have broken.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 6, 28, 9, 0, 0));
      service.evaluateSchedule();

      vi.setSystemTime(new Date(2026, 6, 28, 18, 30, 0));
      service.evaluateSchedule();
      service.evaluateSchedule();
      service.evaluateSchedule();

      const eodCalls = mockRenderer.renderCeremonyPrompt.mock.calls.filter(c => c[0] === 'EOD');
      expect(eodCalls).toHaveLength(1);
    });
  });
});
