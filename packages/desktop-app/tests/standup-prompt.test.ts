import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserWindow } from 'electron';
import { IPCChannel } from '../src/shared/ipc-channels';
import { ContextScheduleService } from '../src/main/services/context-schedule-service';
import { PriorityPreemptionEngine } from '../src/main/services/priority-preemption-engine';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';

describe('Standup & Ceremony Snooze Unit Tests', () => {
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
        standupTime: '10:00',
        enableStandupPrompt: true,
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

  it('EvaluateSchedule_StandupTimeArrives_TriggersStandupPrompt', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 9, 55, 0));

    const mockSend = vi.fn();
    const mockWindow = { isDestroyed: () => false, isMinimized: () => false, show: vi.fn(), focus: vi.fn(), webContents: { send: mockSend } };
    const getWindow = () => mockWindow as unknown as BrowserWindow;

    const svc = new ContextScheduleService(
      mockPriorityEngine as unknown as PriorityPreemptionEngine,
      mockSettingsRepo as unknown as SettingsRepository,
      mockEngine as unknown as TimeTrackingEngine,
      mockRenderer as unknown as DisplayRenderer,
      getWindow
    );

    svc.evaluateSchedule(); // 09:55 -> no prompt yet

    vi.setSystemTime(new Date(2026, 6, 28, 10, 0, 0)); // 10:00 -> standup time arrives
    svc.evaluateSchedule();

    expect(mockRenderer.renderCeremonyPrompt).toHaveBeenCalledWith('STANDUP', 'Daily Stand-Up');
    expect(mockSend).toHaveBeenCalledWith(IPCChannel.ON_CEREMONY_PROMPT, { type: 'STANDUP', title: 'Daily Stand-Up' });
    expect(mockWindow.show).toHaveBeenCalled();
    expect(mockWindow.focus).toHaveBeenCalled();

    svc.dispose();
    vi.useRealTimers();
  });

  it('SnoozeCeremony_StandupSnoozed_DelaysNextPromptEvaluation', () => {
    service.snoozeCeremony('STANDUP', 10);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 10, 5, 0));

    service.evaluateSchedule();

    expect(mockRenderer.renderCeremonyPrompt).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('SnoozeCeremony_EodSnoozed_DelaysNextPromptEvaluation', () => {
    mockSettingsRepo.getSetting.mockReturnValue({
      standupTime: '10:00',
      enableStandupPrompt: false,
      lunchStartTime: '12:30',
      lunchEndTime: '13:30',
      eodWrapUpTime: '18:00'
    });

    service.snoozeCeremony('EOD', 15);

    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 28, 18, 5, 0));

    service.evaluateSchedule();

    expect(mockRenderer.renderCeremonyPrompt).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
