import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WindowsNotificationListenerService } from '../src/main/services/windows-notification-listener-service';
import { PriorityPreemptionEngine } from '../src/main/services/priority-preemption-engine';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { DisplayRenderer, NotificationBannerOptions } from '../src/main/hardware/display-renderer';
import { AppIconResolver } from '../src/main/services/app-icon-resolver';
import { WindowsNotificationSettingsDTO } from '../src/shared/dtos';

/**
 * These tests drive a real `PriorityPreemptionEngine` rather than a stub.
 *
 * The previous suite stubbed it and asserted that a HIGH_PRIORITY notification
 * evaluated to priority 95. No rule in the engine produces 95 for a
 * notification -- the real value is 70 -- so the suite agreed with itself while
 * the feature was broken end to end: the banner re-derived its own event name
 * from `priority >= 90`, 70 failed that test, and every high-priority alert
 * re-entered as `messagingPriority`, which is SUPPRESS during Lunch and Away.
 */
describe('WindowsNotificationListenerService Unit Tests', () => {
  let settingsRepo: SettingsRepository;
  let priorityEngine: PriorityPreemptionEngine;
  let mockRenderer: DisplayRenderer;
  let iconResolver: AppIconResolver;
  let service: WindowsNotificationListenerService;
  let bannerCalls: NotificationBannerOptions[];

  /** Stands in for the display: records the request, then takes the lock as the real renderer would. */
  function stubRenderer(): DisplayRenderer {
    return {
      renderNotificationBanner: vi.fn((options: NotificationBannerOptions) => {
        bannerCalls.push(options);
        priorityEngine.evaluateRequest(options.eventName ?? 'messagingPriority', undefined, () => undefined);
        return { frontElements: [], backElements: [] };
      })
    } as unknown as DisplayRenderer;
  }

  function withRules(rules: WindowsNotificationSettingsDTO['sourceRules']): void {
    settingsRepo.getSetting = vi.fn().mockReturnValue({
      enableListener: true,
      notificationTimeoutSeconds: 10,
      pollingIntervalSeconds: 2,
      sourceRules: rules
    });
  }

  beforeEach(() => {
    bannerCalls = [];
    const store = new Map<string, unknown>();
    settingsRepo = {
      getSetting: vi.fn((key: string, defaultValue: unknown) => store.get(key) ?? defaultValue),
      setSetting: vi.fn((key: string, value: unknown) => store.set(key, value))
    } as unknown as SettingsRepository;

    priorityEngine = new PriorityPreemptionEngine(settingsRepo);
    mockRenderer = stubRenderer();
    // No real shell lookups: resolution is exercised in app-icon-resolver.test.ts.
    iconResolver = new AppIconResolver(
      async () => '',
      async () => null
    );
    service = new WindowsNotificationListenerService(
      settingsRepo,
      priorityEngine,
      mockRenderer,
      iconResolver
    );
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

  it('GetSettings_DefaultRules_MatchTheRendererSeed', async () => {
    // Main and the settings view seeded contradictory priority modes, so the
    // effective default depended on which process wrote to the database first.
    const { createDefaultNotificationSettings } = await import('../src/shared/notification-defaults');

    expect(service.getSettings().sourceRules).toEqual(createDefaultNotificationSettings().sourceRules);
  });

  it('SaveSettings_ValidPartialDTO_MergesAndSavesToSettingsRepo', () => {
    service.saveSettings({ enableListener: false });

    expect(settingsRepo.setSetting).toHaveBeenCalledWith(
      'windows_notification_settings',
      expect.objectContaining({ enableListener: false })
    );
  });

  it('HandleNotification_DontShowPriorityMode_SuppressesNotification', () => {
    withRules([{ appId: 'discord', appName: 'Discord', iconId: 'discord', priorityMode: 'DONT_SHOW' }]);

    const result = service.handleNotification({ appId: 'discord', appName: 'Discord', title: 'Test', body: 'Msg' });

    expect(result).toBe(false);
    expect(mockRenderer.renderNotificationBanner).not.toHaveBeenCalled();
  });

  it('HandleNotification_DefaultPriorityMode_RaisesMessagingPriority', () => {
    withRules([{ appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'DEFAULT' }]);

    const result = service.handleNotification({ appId: 'slack', appName: 'Slack', title: 'Bob', body: 'PR review' });

    expect(result).toBe(true);
    expect(bannerCalls[0]).toMatchObject({
      senderName: 'Bob: PR review',
      channelName: 'Message',
      eventName: 'messagingPriority',
      iconId: 'slack',
      timeoutMs: 10000
    });
  });

  it('HandleNotification_HighPriorityMode_RaisesHighNotificationPriority', () => {
    withRules([{ appId: 'discord', appName: 'Discord', iconId: 'discord', priorityMode: 'HIGH_PRIORITY' }]);

    const result = service.handleNotification({
      appId: 'discord',
      appName: 'Discord',
      title: 'Alice',
      body: 'Urgent build'
    });

    expect(result).toBe(true);
    expect(bannerCalls[0].eventName).toBe('highNotificationPriority');
  });

  it('HandleNotification_HighPriorityDuringLunch_StillReachesTheDisplay', () => {
    // The whole point of the setting. `highNotificationPriority` is DISPLAY in
    // all three modes; the old code turned it into `messagingPriority`, which is
    // SUPPRESS during Lunch, so this notification never appeared.
    priorityEngine.setUserMode('LUNCH');
    withRules([{ appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'HIGH_PRIORITY' }]);

    const result = service.handleNotification({ appId: 'slack', appName: 'Slack', title: 'Ops', body: 'Prod down' });

    expect(result).toBe(true);
    expect(bannerCalls[0].eventName).toBe('highNotificationPriority');
    expect(priorityEngine.getActiveLockEventName()).toBe('highNotificationPriority');
  });

  it('HandleNotification_DefaultPriorityDuringAway_IsReportedAsSuppressed', () => {
    // `messagingPriority` is SUPPRESS when Away, so the banner must not take the
    // lock -- and the caller must be told, or the status panel counts a
    // suppressed notification as captured.
    priorityEngine.setUserMode('AWAY');
    withRules([{ appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'DEFAULT' }]);

    const result = service.handleNotification({ appId: 'slack', appName: 'Slack', title: 'Bob', body: 'lunch?' });

    expect(result).toBe(false);
    expect(priorityEngine.getActiveLockEventName()).toBeNull();
  });

  it('HandleNotification_HighPriority_AcquiresTheLockExactlyOnce', () => {
    // Two acquisitions under different names was the leak: the banner scheduled
    // its release against one name while the other stayed held.
    const evaluateSpy = vi.spyOn(priorityEngine, 'evaluateRequest');
    withRules([{ appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'HIGH_PRIORITY' }]);

    service.handleNotification({ appId: 'slack', appName: 'Slack', title: 'Ops', body: 'Prod down' });

    expect(evaluateSpy).toHaveBeenCalledTimes(1);
    expect(evaluateSpy).toHaveBeenCalledWith('highNotificationPriority', undefined, expect.any(Function));
  });

  it('HandleNotification_AumidReportedByWindows_MatchesTheShortNamedRule', () => {
    // Windows reports the packaged AUMID, not "slack".
    withRules([{ appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'HIGH_PRIORITY' }]);

    const result = service.handleNotification({
      appId: 'com.tinyspeck.slackdesktop_8yrtsj140pw4g!com.tinyspeck.slackdesktop',
      appName: 'Slack',
      title: 'Bob',
      body: 'ping'
    });

    expect(result).toBe(true);
    expect(bannerCalls[0].eventName).toBe('highNotificationPriority');
  });

  it('HandleNotification_RuleWithBlankAppId_DoesNotCaptureEveryApp', () => {
    // `searchId.includes('')` is true for every notification on the machine, so
    // one blank rule used to swallow the lot.
    withRules([
      { appId: '', appName: '', iconId: 'bell', priorityMode: 'DONT_SHOW' },
      { appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'DEFAULT' }
    ]);

    const result = service.handleNotification({ appId: 'slack', appName: 'Slack', title: 'Bob', body: 'ping' });

    expect(result).toBe(true);
  });

  it('SimulateNotification_ValidPayload_DispatchesNotification', () => {
    const event = service.simulateNotification('battery', 'System Battery', 'Low Battery', 'Plug in charger');

    expect(event.appId).toBe('battery');
    expect(mockRenderer.renderNotificationBanner).toHaveBeenCalled();
  });

  it('GetLogEntries_AfterSimulatedNotification_HoldsNoMessageContent', () => {
    service.simulateNotification('slack', 'Slack', 'Payroll spreadsheet', 'attached, do not share');

    const logged = service.getLogEntries().map(entry => entry.message).join('\n');

    expect(logged).not.toContain('Payroll spreadsheet');
    expect(logged).not.toContain('do not share');
    expect(logged).toContain('Slack');
  });

  describe('generated PowerShell poller', () => {
    /**
     * The poller is a generated script, so it is unreachable by ordinary unit
     * tests -- but it is also where the expensive and leaky behaviour lived, and
     * running it for real means spawning PowerShell against the developer's own
     * notification database. Asserting on the generated text is the honest
     * middle ground: it pins the fixes without the side effects.
     */
    function generatedScript(): string {
      return (
        service as unknown as { buildPowerShellScript(intervalMs: number): string }
      ).buildPowerShellScript(2000);
    }

    it('BuildPowerShellScript_TempDatabaseCleanup_RemovesTheWalAndShmSidecars', () => {
      // `Remove-Item $tempDb` deleted only the base file, so every pass left a
      // busybar_wpndb_poll.db-wal and -shm behind in %TEMP% forever. One such
      // WAL -- 3.9 MB of real notifications -- was committed to this repository.
      const script = generatedScript();

      expect(script).not.toMatch(/Remove-Item \$tempDb\s+-Force/);
      expect(script.match(/Remove-Item "\$tempDb\*"/g)?.length).toBe(3);
    });

    it('BuildPowerShellScript_IdleMachine_SkipsCopyingTheDatabase', () => {
      // A multi-megabyte database and two sidecars were copied every two
      // seconds whether or not anything had arrived.
      const script = generatedScript();

      expect(script).toContain('function Get-NotifDbStamp');
      expect(script).toContain('$currentStamp -eq $lastDbStamp');
      expect(script).toContain('if (-not $skipDbPass)');
    });

    it('BuildPowerShellScript_StampCheck_ConsidersTheWalNotJustTheDatabase', () => {
      // Windows appends to the WAL and only folds it into the main file at a
      // checkpoint, so watching the .db alone would miss every new notification.
      expect(generatedScript()).toContain('"$dbPath-wal"');
    });

    it('BuildPowerShellScript_PollingInterval_IsTakenFromSettings', () => {
      expect(generatedScript()).toContain('$pollingMs = 2000');
    });
  });

  it('StartListening_AlreadyListening_DoesNotThrowException', () => {
    // Listener disabled so the suite does not spawn a real PowerShell poller
    // against the developer's own notification database -- which it did, on
    // every run, copying that database into %TEMP%.
    withRules([]);
    settingsRepo.getSetting = vi.fn().mockReturnValue({
      enableListener: false,
      notificationTimeoutSeconds: 10,
      pollingIntervalSeconds: 2,
      sourceRules: []
    });

    expect(() => {
      service.startListening();
      service.startListening();
    }).not.toThrow();
  });

  it('StartListening_DisabledInSettings_LeavesTheServiceRestartable', () => {
    // `_isListening` was set before the enabled check, so a listener that bailed
    // out still counted as running and could never be started afterwards.
    settingsRepo.getSetting = vi.fn().mockReturnValue({
      enableListener: false,
      notificationTimeoutSeconds: 10,
      pollingIntervalSeconds: 2,
      sourceRules: []
    });

    service.startListening();

    expect(service.getListenerStatus().isListening).toBe(false);
  });
});
