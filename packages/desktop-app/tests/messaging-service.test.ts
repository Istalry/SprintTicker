import { describe, it, expect, beforeEach, vi } from 'vitest';
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
