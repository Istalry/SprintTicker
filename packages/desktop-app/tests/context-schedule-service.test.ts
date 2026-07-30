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
      getSetting: vi.fn().mockReturnValue({
        lunchStartTime: '12:30',
        lunchEndTime: '13:30',
        eodWrapUpTime: '18:00'
      })
    };
    mockEngine = {
      getCurrentSession: vi.fn().mockReturnValue(null),
      pauseSession: vi.fn(),
      resumeSession: vi.fn()
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

  it('EnterLunchMode_ActiveTrackingSession_AutoPausesSessionAndRendersLunchScreen', () => {
    mockEngine.getCurrentSession.mockReturnValue({ status: 'TRACKING', taskKey: 'PROJ-101' });

    service.enterLunchMode();

    expect(mockEngine.pauseSession).toHaveBeenCalledTimes(1);
    expect(mockPriorityEngine.setUserMode).toHaveBeenCalledWith('LUNCH');
    expect(mockRenderer.renderLunchMode).toHaveBeenCalledTimes(1);
  });

  it('ExitLunchMode_WasAutoPausedForLunch_ResumesSession', () => {
    mockEngine.getCurrentSession.mockReturnValue({ status: 'TRACKING', taskKey: 'PROJ-101' });
    service.enterLunchMode();

    mockEngine.getCurrentSession.mockReturnValue({ status: 'PAUSED', taskKey: 'PROJ-101' });

    service.exitLunchMode();

    expect(mockPriorityEngine.setUserMode).toHaveBeenCalledWith('WORK');
    expect(mockEngine.resumeSession).toHaveBeenCalledTimes(1);
  });

  it('ExitLunchMode_WasNotAutoPausedForLunch_RendersActiveSession', () => {
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
});
