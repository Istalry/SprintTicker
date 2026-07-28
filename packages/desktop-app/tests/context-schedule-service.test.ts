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
      renderCeremonyPrompt: vi.fn()
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
    mockEngine.getCurrentSession.mockReturnValue({ status: 'in_progress', taskKey: 'PROJ-101' });

    service.enterLunchMode();

    expect(mockEngine.pauseSession).toHaveBeenCalledTimes(1);
    expect(mockPriorityEngine.setUserMode).toHaveBeenCalledWith('LUNCH');
    expect(mockRenderer.renderLunchMode).toHaveBeenCalledTimes(1);
  });

  it('ExitLunchMode_WasAutoPausedForLunch_ResumesSession', () => {
    mockEngine.getCurrentSession.mockReturnValue({ status: 'in_progress', taskKey: 'PROJ-101' });
    service.enterLunchMode();

    mockEngine.getCurrentSession.mockReturnValue({ status: 'paused', taskKey: 'PROJ-101' });

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

  it('EvaluateSchedule_TimeIsEOD_TriggersEodPrompt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 18, 5, 0));

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

    svc.evaluateSchedule();

    expect(mockRenderer.renderCeremonyPrompt).toHaveBeenCalledWith('EOD', 'End-of-Day Wrap-Up');
    expect(mockSend).toHaveBeenCalledWith(IPCChannel.ON_CEREMONY_PROMPT, { type: 'EOD', title: 'End-of-Day Wrap-Up' });

    svc.dispose();
    vi.useRealTimers();
  });
});
