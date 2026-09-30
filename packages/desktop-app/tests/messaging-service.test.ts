import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessagingIntegrationService } from '../src/main/services/messaging-service';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { MessagingSettingsDTO } from '../src/shared/dtos';
import { ProviderManager } from '../src/main/providers/provider-manager';
import { OpenProjectProvider } from '../src/main/providers/openproject-provider';

describe('MessagingIntegrationService', () => {
  let settingsRepo: SettingsRepository;
  let mockRenderer: DisplayRenderer;
  let service: MessagingIntegrationService;

  beforeEach(() => {
    settingsRepo = {
      getSetting: vi.fn((_key: string, defaultVal: unknown) => defaultVal),
      setSetting: vi.fn()
    } as unknown as SettingsRepository;

    mockRenderer = {
      renderNotificationBanner: vi.fn()
    } as unknown as DisplayRenderer;

    service = new MessagingIntegrationService(settingsRepo, mockRenderer);
  });

  describe('constructor', () => {
    it('Constructor_NullSettingsRepo_ThrowsException', () => {
      expect(() => new MessagingIntegrationService(null as unknown as SettingsRepository)).toThrow();
    });

    it('Constructor_ValidSettingsRepo_ConstructsWithoutThrowing', () => {
      expect(() => new MessagingIntegrationService(settingsRepo, mockRenderer)).not.toThrow();
    });
  });

  describe('getSettings & saveSettings', () => {
    it('GetSettings_Default_ReturnsDefaultDTO', () => {
      const settings = service.getSettings();
      expect(settings).toBeDefined();
      expect(settings.enableOpenProjectNotifications).toBe(true);
      expect(settings.openProjectPollingIntervalSeconds).toBeGreaterThan(0);
    });

    it('SaveSettings_ValidDTO_CallsSettingsRepo', () => {
      const dto: MessagingSettingsDTO = {
        enableOpenProjectNotifications: true,
        openProjectPollingIntervalSeconds: 120,
        notificationTimeoutSeconds: 8
      };
      service.saveSettings(dto);
      expect(settingsRepo.setSetting).toHaveBeenCalledWith('messaging_settings', dto);
    });

    it('SaveSettings_Null_ThrowsException', () => {
      expect(() => service.saveSettings(null as unknown as MessagingSettingsDTO)).toThrow();
    });
  });

  describe('testIntegration', () => {
    it('TestIntegration_ValidChannel_DispatchesBannerAndReturnsResult', () => {
      const res = service.testIntegration('Slack Webhook');
      expect(res.success).toBe(true);
      expect(res.channel).toBe('Slack Webhook');
      expect(mockRenderer.renderNotificationBanner).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Alice', appName: 'Slack Webhook', iconId: 'slack' })
      );
    });

    it('TestIntegration_DiscordChannel_DispatchesDiscordBanner', () => {
      service.testIntegration('Discord Alerts');
      expect(mockRenderer.renderNotificationBanner).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Alice', appName: 'Discord Alerts', iconId: 'discord' })
      );
    });

    it('TestIntegration_GmailChannel_DispatchesGmailBanner', () => {
      service.testIntegration('Gmail Work');
      expect(mockRenderer.renderNotificationBanner).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Alice', appName: 'Gmail Work', iconId: 'gmail' })
      );
    });

    it('TestIntegration_OpenProjectChannel_DispatchesOpenProjectBanner', () => {
      service.testIntegration('OpenProject Alerts');
      expect(mockRenderer.renderNotificationBanner).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Alice', appName: 'OpenProject Alerts', iconId: 'openproject' })
      );
    });

    it('TestIntegration_EmptyChannel_ThrowsException', () => {
      expect(() => service.testIntegration('')).toThrow();
    });
  });

  describe('OpenProject Polling', () => {
    it('PollOpenProjectNotifications_FetchesUnreadAndDispatchesBanner', async () => {
      const mockOpProvider = {
        fetchUnreadNotifications: vi.fn().mockResolvedValue([
          { id: '1', actorName: 'Charlie' },
          { id: '2', actorName: 'Dave' }
        ])
      } as unknown as OpenProjectProvider;
      
      const mockProviderManager = {
        getProvider: vi.fn().mockReturnValue(mockOpProvider),
        getActiveProvider: vi.fn().mockReturnValue({ providerId: 'openproject' })
      } as unknown as ProviderManager;

      vi.useFakeTimers();
      new MessagingIntegrationService(settingsRepo, mockRenderer, mockProviderManager);
      
      await vi.advanceTimersByTimeAsync(2500);
      
      expect(mockOpProvider.fetchUnreadNotifications).toHaveBeenCalled();
      expect(mockRenderer.renderNotificationBanner).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Charlie', appName: 'OpenProject', iconId: 'openproject' })
      );
      expect(mockRenderer.renderNotificationBanner).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Dave', appName: 'OpenProject', iconId: 'openproject' })
      );
      vi.useRealTimers();
    });

    it('PollOpenProjectNotifications_ADifferentProviderIsActive_DoesNotDialOpenProjectAtAll', async () => {
      // This is OpenProject's own notification feed, not a general one, and it
      // polled regardless of which provider the user had chosen. Switching to
      // Jira therefore left a stale OpenProject address being dialled once a
      // minute forever, failing every time -- and the failure wrote a full
      // stack trace, which during a live debugging session buried the two
      // worklog errors that actually needed reading.
      const mockOpProvider = {
        fetchUnreadNotifications: vi.fn().mockResolvedValue([])
      } as unknown as OpenProjectProvider;

      const mockProviderManager = {
        getProvider: vi.fn().mockReturnValue(mockOpProvider),
        getActiveProvider: vi.fn().mockReturnValue({ providerId: 'jira' })
      } as unknown as ProviderManager;

      vi.useFakeTimers();
      new MessagingIntegrationService(settingsRepo, mockRenderer, mockProviderManager);

      await vi.advanceTimersByTimeAsync(2500);

      expect(mockOpProvider.fetchUnreadNotifications).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});

describe('MessagingIntegrationService OpenProject polling behaviour', () => {
  let stored: Record<string, unknown>;
  let renderer: DisplayRenderer;
  let fetchUnread: ReturnType<typeof vi.fn>;
  let providers: ProviderManager;

  const repo = () => ({
    getSetting: vi.fn((key: string, defaultValue: unknown) => stored[key] ?? defaultValue),
    setSetting: vi.fn((key: string, value: unknown) => { stored[key] = value; })
  }) as unknown as SettingsRepository;

  const shown = () => vi.mocked(renderer.renderNotificationBanner).mock.calls.map(c => c[0].title);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stored = {};
    renderer = { renderNotificationBanner: vi.fn() } as unknown as DisplayRenderer;
    fetchUnread = vi.fn().mockResolvedValue([]);
    providers = {
      getProvider: vi.fn().mockReturnValue({ fetchUnreadNotifications: fetchUnread }),
      getActiveProvider: vi.fn().mockReturnValue({ providerId: 'openproject' })
    } as unknown as ProviderManager;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('Poll_SameNotificationStillUnread_IsShownOnce', async () => {
    // Unread stays unread until the user reads it in OpenProject; every poll
    // returns it again, and the bar must not announce it every minute.
    fetchUnread.mockResolvedValue([{ id: '7', actorName: 'Charlie', subject: 'Review' }]);
    new MessagingIntegrationService(repo(), renderer, providers);

    await vi.advanceTimersByTimeAsync(2000 + 60_000 * 2);

    expect(fetchUnread).toHaveBeenCalledTimes(3);
    expect(shown()).toEqual(['Charlie']);
  });

  it('Poll_ServerFails_KeepsPollingAfterwards', async () => {
    fetchUnread
      .mockRejectedValueOnce(new Error('503'))
      .mockResolvedValueOnce([{ id: '8', actorName: 'Dana', subject: 'Done' }]);
    new MessagingIntegrationService(repo(), renderer, providers);

    await vi.advanceTimersByTimeAsync(2000 + 60_000);

    expect(shown()).toEqual(['Dana']);
  });

  it('Polling_DisabledInSettings_NeverDialsOpenProject', async () => {
    stored.messaging_settings = { enableOpenProjectNotifications: false, openProjectPollingIntervalSeconds: 60, notificationTimeoutSeconds: 10 };
    new MessagingIntegrationService(repo(), renderer, providers);

    await vi.advanceTimersByTimeAsync(10 * 60_000);

    expect(fetchUnread).not.toHaveBeenCalled();
  });

  it('SaveSettings_NewInterval_ReplacesTheOldTimerRatherThanAddingOne', async () => {
    const service = new MessagingIntegrationService(repo(), renderer, providers);
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchUnread).toHaveBeenCalledTimes(1);

    service.saveSettings({ enableOpenProjectNotifications: true, openProjectPollingIntervalSeconds: 300, notificationTimeoutSeconds: 10 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchUnread).toHaveBeenCalledTimes(2);

    // The old 60 s timer would have fired four times in here.
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(fetchUnread).toHaveBeenCalledTimes(2);
  });
});
