import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessagingIntegrationService } from '../src/main/services/messaging-service';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { MessagingSettingsDTO } from '../src/shared/dtos';
import { WebhookServer } from '../src/main/api/webhook-server';

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

    it('Constructor_WithWebhookServer_RegistersListeners', () => {
      const mockWebhookServer = {
        onSlackEvent: vi.fn(),
        onDiscordWebhookEvent: vi.fn()
      } as unknown as WebhookServer;
      new MessagingIntegrationService(settingsRepo, mockRenderer, mockWebhookServer);
      expect(mockWebhookServer.onSlackEvent).toHaveBeenCalled();
      expect(mockWebhookServer.onDiscordWebhookEvent).toHaveBeenCalled();
    });
  });

  describe('getSettings & saveSettings', () => {
    it('GetSettings_Default_ReturnsDefaultDTO', () => {
      const settings = service.getSettings();
      expect(settings).toBeDefined();
      expect(settings.discordWebhookUrl).toBe('https://discord.com/api/webhooks/demo');
      expect(settings.enableDiscordLed).toBe(true);
    });

    it('SaveSettings_ValidDTO_CallsSettingsRepo', () => {
      const dto = {
        discordWebhookUrl: 'https://discord.com/test',
        enableDiscordLed: false,
        slackWebhookUrl: 'https://slack.com/test',
        enableSlackPreview: true,
        gmailQuery: 'is:unread',
        enableGmailLed: true
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
      expect(mockRenderer.renderNotificationBanner).toHaveBeenCalledWith('Alice', 'Slack Webhook', 40, 'slack');
    });

    it('TestIntegration_DiscordChannel_DispatchesDiscordBanner', () => {
      service.testIntegration('Discord Alerts');
      expect(mockRenderer.renderNotificationBanner).toHaveBeenCalledWith('Alice', 'Discord Alerts', 40, 'discord');
    });

    it('TestIntegration_GmailChannel_DispatchesGmailBanner', () => {
      service.testIntegration('Gmail Work');
      expect(mockRenderer.renderNotificationBanner).toHaveBeenCalledWith('Alice', 'Gmail Work', 40, 'gmail');
    });

    it('TestIntegration_EmptyChannel_ThrowsException', () => {
      expect(() => service.testIntegration('')).toThrow();
    });
  });

  describe('handleSlackEvent & handleDiscordWebhook', () => {
    it('HandleSlackEvent_EnabledPreview_DispatchesSlackBanner', () => {
      service.handleSlackEvent({ sender: 'Alice', message: 'Deployment complete!' });
      expect(mockRenderer.renderNotificationBanner).toHaveBeenCalledWith('Alice', 'SLACK', 40, 'slack');
    });

    it('HandleDiscordWebhook_EnabledLed_DispatchesDiscordBanner', () => {
      service.handleDiscordWebhook({ author: 'Bob', content: 'Bug urgent fix needed' });
      expect(mockRenderer.renderNotificationBanner).toHaveBeenCalledWith('Bob', 'DISCORD', 40, 'discord');
    });
  });
});
