import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WindowsNotificationListenerService } from '../src/main/services/windows-notification-listener-service';
import { PriorityPreemptionEngine } from '../src/main/services/priority-preemption-engine';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';

describe('WindowsNotificationListenerService Unit Tests', () => {
  let settingsRepo: SettingsRepository;
  let priorityEngine: PriorityPreemptionEngine;
  let mockRenderer: DisplayRenderer;
  let service: WindowsNotificationListenerService;

  beforeEach(() => {
    settingsRepo = {
      getSetting: vi.fn().mockImplementation((key, defaultValue) => defaultValue),
      setSetting: vi.fn()
    } as unknown as SettingsRepository;

    priorityEngine = {
      evaluateRequest: vi.fn().mockReturnValue({ shouldRender: true, action: 'DISPLAY', evaluatedPriority: 40 })
    } as unknown as PriorityPreemptionEngine;

    mockRenderer = {
      renderNotificationBanner: vi.fn()
    } as unknown as DisplayRenderer;

    service = new WindowsNotificationListenerService(settingsRepo, priorityEngine, mockRenderer);
  });

  it('Constructor_NullSettingsRepo_ThrowsArgumentNullException', () => {
    expect(
      () => new WindowsNotificationListenerService(null as unknown as SettingsRepository, priorityEngine, mockRenderer)
    ).toThrowError('Argument cannot be null or undefined: settingsRepo');
  });

  it('Constructor_NullPriorityEngine_ThrowsArgumentNullException', () => {
    expect(
      () => new WindowsNotificationListenerService(settingsRepo, null as unknown as PriorityPreemptionEngine, mockRenderer)
    ).toThrowError('Argument cannot be null or undefined: priorityEngine');
  });

  it('GetSettings_DefaultConfig_ReturnsDefaultRulesAndListenerState', () => {
    const config = service.getSettings();

    expect(config.enableListener).toBe(true);
    expect(config.sourceRules.length).toBeGreaterThan(0);
  });

  it('SaveSettings_ValidPartialDTO_MergesAndSavesToSettingsRepo', () => {
    service.saveSettings({ enableListener: false });

    expect(settingsRepo.setSetting).toHaveBeenCalledWith(
      'windows_notification_settings',
      expect.objectContaining({ enableListener: false })
    );
  });

  it('HandleNotification_DontShowPriorityMode_SuppressesNotification', () => {
    settingsRepo.getSetting = vi.fn().mockReturnValue({
      enableListener: true,
      sourceRules: [{ appId: 'discord', appName: 'Discord', iconId: 'discord', priorityMode: 'DONT_SHOW' }]
    });

    const result = service.handleNotification({ appId: 'discord', appName: 'Discord', title: 'Test', body: 'Msg' });

    expect(result).toBe(false);
    expect(mockRenderer.renderNotificationBanner).not.toHaveBeenCalled();
  });

  it('HandleNotification_DefaultPriorityMode_EvaluatesPriority40AndRendersBanner', () => {
    settingsRepo.getSetting = vi.fn().mockReturnValue({
      enableListener: true,
      sourceRules: [{ appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'DEFAULT' }]
    });

    const result = service.handleNotification({ appId: 'slack', appName: 'Slack', title: 'Bob', body: 'PR review' });

    expect(result).toBe(true);
    expect(priorityEngine.evaluateRequest).toHaveBeenCalledWith('messagingPriority');
    expect(mockRenderer.renderNotificationBanner).toHaveBeenCalledWith(
      'Bob: PR review',
      'Message',
      40,
      'slack',
      undefined,
      10000
    );
  });

  it('HandleNotification_HighPriorityMode_EvaluatesPriority95AndRendersBanner', () => {
    (priorityEngine.evaluateRequest as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      shouldRender: true,
      action: 'DISPLAY',
      evaluatedPriority: 95
    });

    settingsRepo.getSetting = vi.fn().mockReturnValue({
      enableListener: true,
      sourceRules: [{ appId: 'discord', appName: 'Discord', iconId: 'discord', priorityMode: 'HIGH_PRIORITY' }]
    });

    const result = service.handleNotification({ appId: 'discord', appName: 'Discord', title: 'Alice', body: 'Urgent build' });

    expect(result).toBe(true);
    expect(priorityEngine.evaluateRequest).toHaveBeenCalledWith('highNotificationPriority');
    expect(mockRenderer.renderNotificationBanner).toHaveBeenCalledWith(
      'Alice: Urgent build',
      'Message',
      95,
      'discord',
      undefined,
      10000
    );
  });

  it('SimulateNotification_ValidPayload_DispatchesNotification', () => {
    const event = service.simulateNotification('battery', 'System Battery', 'Low Battery', 'Plug in charger');

    expect(event.appId).toBe('battery');
    expect(mockRenderer.renderNotificationBanner).toHaveBeenCalled();
  });

  it('StartListening_AlreadyListening_DoesNotThrowException', () => {
    expect(() => {
      service.startListening();
      service.startListening();
    }).not.toThrow();
    service.stopListening();
  });

  it('StopListening_ActiveListener_StopsCleanly', () => {
    service.startListening();
    expect(() => service.stopListening()).not.toThrow();
  });
});
