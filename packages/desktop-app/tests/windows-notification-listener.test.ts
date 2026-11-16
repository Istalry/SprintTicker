import { AppIconBitmapProcessor } from '../src/main/hardware/app-icon-bitmap-processor';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APP_USER_MODEL_ID } from '../src/main/app-identity';
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
 * the feature was broken end to end.
 *
 * Priority ordering is the user's to set, and these tests must not assume one.
 * They cover what the code owes the configuration: raise each notification under
 * the class its rule names, exactly once, and report honestly whether it
 * reached the display.
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
        return { frontElements: [], ledColorHex: '#000000FF' };
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
      iconResolver,
      undefined,
      // Shown at once: the hold for a first icon lookup has its own tests.
      0
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
      appName: 'Slack',
      title: 'Bob',
      body: 'PR review',
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

  it('HandleNotification_HighPriorityDuringWork_ReachesTheDisplay', () => {
    // This is what the fix restores. The old code raised the request under
    // `highNotificationPriority` (70), then re-derived `messagingPriority` (65)
    // and evaluated a second time -- against the lock the first evaluation had
    // just taken. 65 < 70, so the banner was refused by its own request and the
    // display stayed pinned at 70 with no release scheduled.
    withRules([{ appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'HIGH_PRIORITY' }]);

    const result = service.handleNotification({ appId: 'slack', appName: 'Slack', title: 'Ops', body: 'Prod down' });

    expect(result).toBe(true);
    expect(bannerCalls[0].eventName).toBe('highNotificationPriority');
    expect(priorityEngine.getActiveLockEventName()).toBe('highNotificationPriority');
  });

  it('HandleNotification_HighPriorityWhileLunchHoldsTheDisplay_DoesNotInterrupt', () => {
    // Lunch and Away outrank both notification classes in the shipped ordering,
    // so a break stays a break. That is the priority panel doing its job, not a
    // defect, and the fix above must not change it: the banner is still refused,
    // just for the right reason -- 70 is below the 95 Lunch mode holds.
    priorityEngine.setUserMode('LUNCH');
    priorityEngine.evaluateRequest('lunchModePriority', undefined, () => undefined);
    withRules([{ appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'HIGH_PRIORITY' }]);

    const result = service.handleNotification({ appId: 'slack', appName: 'Slack', title: 'Ops', body: 'Prod down' });

    expect(result).toBe(false);
    expect(priorityEngine.getActiveLockEventName()).toBe('lunchModePriority');
  });

  it('HandleNotification_HighPriorityWhileAwayHoldsTheDisplay_DoesNotInterrupt', () => {
    priorityEngine.setUserMode('AWAY');
    priorityEngine.evaluateRequest('awayModePriority', undefined, () => undefined);
    withRules([{ appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'HIGH_PRIORITY' }]);

    const result = service.handleNotification({ appId: 'slack', appName: 'Slack', title: 'Ops', body: 'Prod down' });

    expect(result).toBe(false);
    expect(priorityEngine.getActiveLockEventName()).toBe('awayModePriority');
  });

  it('HandleNotification_DefaultPriorityDuringAway_IsReportedAsSuppressed', () => {
    // The caller has to be told, or the status panel counts a notification that
    // never reached the display as captured.
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

  describe('the icon', () => {
    // Electron decodes the image, and the tests have no Electron: the decode
    // is stood in for, and what matters is whether it is asked at all.
    const FILE = 'C:/icons/app.png';
    const GRID = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => '#FF0000FF'));
    let decode: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      decode = vi.spyOn(AppIconBitmapProcessor, 'tryProcessAppImage').mockReturnValue(GRID);
    });

    afterEach(() => {
      decode.mockRestore();
    });

    it('HandleNotification_DiscordWithItsOwnIcon_ShowsItsOwn', () => {
      // The user's choice (2026-11-16): the app's own logo, converted, over
      // the icon drawn for it -- the candidate briefly had it the other way.
      withRules([{ appId: 'discord', appName: 'Discord', iconId: 'discord', priorityMode: 'DEFAULT' }]);

      service.handleNotification({ appId: 'com.squirrel.Discord.Discord', appName: 'Discord', title: 'Toukha', body: 'hi', iconPath: FILE });

      expect(decode).toHaveBeenCalledWith(FILE, 'com.squirrel.Discord.Discord');
      expect(bannerCalls[0]).toMatchObject({ iconId: 'discord', customIconData: GRID });
    });

    it('HandleNotification_DiscordWithNoIconFoundYet_ShowsTheDrawnOne', () => {
      withRules([{ appId: 'discord', appName: 'Discord', iconId: 'discord', priorityMode: 'DEFAULT' }]);
      decode.mockReturnValue(null);

      service.handleNotification({ appId: 'com.squirrel.Discord.Discord', appName: 'Discord', title: 'Toukha', body: 'hi', iconPath: FILE });

      expect(bannerCalls[0]).toMatchObject({ iconId: 'discord', customIconData: undefined });
    });

    it('HandleNotification_DiscordWithAnImageTheUserChose_ShowsTheirs', () => {
      withRules([{ appId: 'discord', appName: 'Discord', iconId: 'discord', priorityMode: 'DEFAULT', iconImagePath: FILE }]);

      service.handleNotification({ appId: 'com.squirrel.Discord.Discord', appName: 'Discord', title: 'Toukha', body: 'hi' });

      expect(decode).toHaveBeenCalledWith(FILE, 'com.squirrel.Discord.Discord');
      expect(bannerCalls[0].customIconData).toBe(GRID);
    });

    it('HandleNotification_AnAppWeNeverDrew_ShowsItsOwnIcon', () => {
      withRules([]);

      service.handleNotification({ appId: 'Contoso.Notes', appName: 'Notes', title: 'Saved', body: 'ok', iconPath: FILE });

      expect(bannerCalls[0]).toMatchObject({ iconId: 'bell', customIconData: GRID });
    });

    describe('the first banner of an app not looked up yet', () => {
      // Discord on rc3 (2026-11-16): the first message drew our icon, the
      // second its own logo, because the lookup answered between the two.
      const DISCORD = 'com.squirrel.Discord.Discord';

      function holdingService(runPowerShell: () => Promise<string>): WindowsNotificationListenerService {
        withRules([{ appId: 'discord', appName: 'Discord', iconId: 'discord', priorityMode: 'DEFAULT' }]);
        // An unpackaged app: the shell names its exe, and the exe holds the icon.
        const resolver = new AppIconResolver(runPowerShell, async () => FILE, undefined, () => true);
        return new WindowsNotificationListenerService(settingsRepo, priorityEngine, mockRenderer, resolver);
      }

      afterEach(() => {
        vi.useRealTimers();
      });

      it('HandleNotification_LogoFoundWithinTheWait_ShowsTheLogoOnTheFirstBanner', async () => {
        const holding = holdingService(async () => FILE);

        const accepted = holding.handleNotification({ appId: DISCORD, appName: 'Discord', title: 'Toukha', body: 'hi' });

        expect(accepted).toBe(true);
        await vi.waitFor(() => expect(bannerCalls).toHaveLength(1));
        expect(bannerCalls[0]).toMatchObject({ iconId: 'discord', customIconData: GRID });
      });

      it('HandleNotification_LookupSlowerThanTheWait_ShowsTheDrawnIconAfterIt', async () => {
        vi.useFakeTimers();
        const holding = holdingService(() => new Promise<string>(() => undefined));

        holding.handleNotification({ appId: DISCORD, appName: 'Discord', title: 'Toukha', body: 'hi' });
        await vi.advanceTimersByTimeAsync(WindowsNotificationListenerService.FIRST_ICON_WAIT_MS - 1);
        expect(bannerCalls).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1);

        expect(bannerCalls).toHaveLength(1);
        expect(bannerCalls[0]).toMatchObject({ iconId: 'discord', customIconData: undefined });
      });

      it('HandleNotification_AppLookedUpBefore_ShowsAtOnce', async () => {
        const holding = holdingService(async () => FILE);
        holding.handleNotification({ appId: DISCORD, appName: 'Discord', title: 'Toukha', body: 'hi' });
        await vi.waitFor(() => expect(bannerCalls).toHaveLength(1));

        holding.handleNotification({ appId: DISCORD, appName: 'Discord', title: 'Toukha', body: 'again' });

        expect(bannerCalls).toHaveLength(2);
        expect(bannerCalls[1].customIconData).toBe(GRID);
      });

      it('HandleNotification_NoRendererWhileUnseen_IsNotShown', () => {
        withRules([{ appId: 'discord', appName: 'Discord', iconId: 'discord', priorityMode: 'DEFAULT' }]);
        const resolver = new AppIconResolver(async () => FILE, async () => null, undefined, () => true);
        const headless = new WindowsNotificationListenerService(settingsRepo, priorityEngine, undefined, resolver);

        expect(headless.handleNotification({ appId: DISCORD, appName: 'Discord', title: 'Toukha', body: 'hi' })).toBe(false);
      });
    });
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


  describe('private message bodies', () => {
    it('HandleNotification_RuleHidesTheBody_PassesHideBodyToTheRenderer', () => {
      service.saveSettings({
        sourceRules: [
          { appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'DEFAULT', hideMessageBody: true }
        ]
      });

      service.handleNotification({
        appId: 'slack',
        appName: 'Slack',
        title: 'Alice',
        body: 'salary review at 4pm'
      } as never);

      expect(bannerCalls[0].hideBody).toBe(true);
    });

    it('GetSettings_RuleStoredBeforeTheFieldExisted_TakesTheSeededDefault', () => {
      // Settings are one JSON blob and the seeded defaults are only consulted
      // when no blob exists, so without a backfill this default would reach new
      // installs and no existing one.
      service.saveSettings({
        sourceRules: [
          { appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'DEFAULT' }
        ]
      });

      const rule = service.getSettings().sourceRules.find(r => r.appId === 'slack');
      expect(rule?.hideMessageBody).toBe(true);
    });

    it('GetSettings_UserTurnedTheSettingOff_KeepsItOff', () => {
      // An explicit false is a decision, not an absent field, and must survive
      // the backfill.
      service.saveSettings({
        sourceRules: [
          { appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'DEFAULT', hideMessageBody: false }
        ]
      });

      const rule = service.getSettings().sourceRules.find(r => r.appId === 'slack');
      expect(rule?.hideMessageBody).toBe(false);
    });
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

    it('BuildPowerShellScript_OwnToasts_SkippedOnBothPaths', () => {
      // The app's own toasts reach the bar once, from ProviderEventService.
      // Only the database path used to skip them; the WinRT path mirrored
      // them, which would have put each one on the bar twice.
      const script = generatedScript();

      expect(script).toContain(`$selfAppIds = @('${APP_USER_MODEL_ID}', 'com.busybar.desktop')`);
      expect(script).toContain('if ($selfAppIds -contains $aId) { continue }');
      expect(script).toContain('foreach ($selfId in $selfAppIds)');
    });

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

  describe('the app name on the banner is one a person would recognise', () => {
    // Reported from real use: a Discord notification showed as
    // `squirrel.Discord.Discord`. The poller strips `com.` off the AUMID but
    // not `squirrel.`, and this code read that derived name ahead of the
    // curated one on the matching rule. It was invisible until the banner
    // stopped rewriting every chat app's label to the literal "Message".

    it('HandleNotification_SquirrelDerivedAppName_UsesTheRulesNameInstead', () => {
      service.handleNotification({
        appId: 'com.squirrel.Discord.Discord',
        appName: 'squirrel.Discord.Discord',
        title: 'Alice',
        body: 'ping'
      });

      expect(bannerCalls[0].appName).toBe('Discord');
    });

    it('HandleNotification_NoRuleMatches_StillCleansTheIdentifier', () => {
      // With no curated name to fall back on, the identifier has to be reduced
      // rather than shown raw.
      withRules([]);

      service.handleNotification({
        appId: 'com.squirrel.Obsidian.Obsidian',
        appName: 'squirrel.Obsidian.Obsidian',
        title: 'Note',
        body: 'synced'
      });

      expect(bannerCalls[0].appName).toBe('Obsidian');
    });

    it('HandleNotification_UserRenamedTheRule_ThatNameWins', () => {
      // The panel lets a source be renamed, and that choice has to outrank
      // anything derived from the identifier.
      withRules([
        { appId: 'discord', appName: 'Team Chat', iconId: 'discord', priorityMode: 'DEFAULT' }
      ]);

      service.handleNotification({
        appId: 'com.squirrel.Discord.Discord',
        appName: 'squirrel.Discord.Discord',
        title: 'Alice',
        body: 'ping'
      });

      expect(bannerCalls[0].appName).toBe('Team Chat');
    });
  });
});
