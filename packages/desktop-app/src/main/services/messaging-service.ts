import { SettingsRepository } from '../db/repositories/settings-repository';
import { DisplayRenderer } from '../hardware/display-renderer';
import { MessagingSettingsDTO, MessagingTestResultDTO } from '../../shared/dtos';
import { WebhookServer, SlackEventPayload, DiscordWebhookPayload } from '../api/webhook-server';

/**
 * Service managing third-party notification channels (Discord, Slack, Gmail)
 * and triggering visual hardware alerts on the physical BUSY Bar display.
 */
export class MessagingIntegrationService {
  private settingsRepo: SettingsRepository;
  private renderer?: DisplayRenderer;

  constructor(settingsRepo: SettingsRepository, renderer?: DisplayRenderer, webhookServer?: WebhookServer) {
    if (!settingsRepo) {
      throw new ArgumentNullException('settingsRepo');
    }
    this.settingsRepo = settingsRepo;
    this.renderer = renderer;

    if (webhookServer) {
      webhookServer.onSlackEvent((payload) => this.handleSlackEvent(payload));
      webhookServer.onDiscordWebhookEvent((payload) => this.handleDiscordWebhook(payload));
    }
  }

  /// <summary>
  /// Retrieves persisted third-party messaging configurations.
  /// </summary>
  public getSettings(): MessagingSettingsDTO {
    return this.settingsRepo.getSetting('messaging_settings', {
      discordWebhookUrl: 'https://discord.com/api/webhooks/demo',
      enableDiscordLed: true,
      slackWebhookUrl: 'https://hooks.slack.com/services/demo',
      enableSlackPreview: true,
      gmailQuery: 'is:unread label:urgent',
      enableGmailLed: true
    });
  }

  /// <summary>
  /// Persists third-party messaging configurations to SQLite database.
  /// </summary>
  public saveSettings(settings: MessagingSettingsDTO): void {
    if (!settings) {
      throw new ArgumentNullException('settings');
    }
    this.settingsRepo.setSetting('messaging_settings', settings);
  }

  /// <summary>
  /// Executes a simulated or real test alert dispatch for a specific channel.
  /// </summary>
  public testIntegration(channel: string): MessagingTestResultDTO {
    if (!channel || channel.trim().length === 0) {
      throw new ArgumentException('Channel parameter cannot be empty');
    }

    const testMessage = `[TEST ALERT] Incoming message from ${channel}`;
    if (this.renderer) {
      this.renderer.renderNotificationBanner(testMessage, 40);
    }

    return {
      success: true,
      channel,
      message: `Sent test notification payload to ${channel}!`
    };
  }

  /// <summary>
  /// Processes incoming Slack event payloads and updates front matrix display.
  /// </summary>
  public handleSlackEvent(payload: SlackEventPayload): void {
    if (!payload) return;
    const settings = this.getSettings();
    if (settings.enableSlackPreview && this.renderer) {
      const sender = payload.sender || 'Slack User';
      const text = payload.message || 'New Slack Message';
      this.renderer.renderNotificationBanner(`[SLACK] ${sender}: ${text}`, 40);
    }
  }

  /// <summary>
  /// Processes incoming Discord webhook payloads and updates front matrix display.
  /// </summary>
  public handleDiscordWebhook(payload: DiscordWebhookPayload): void {
    if (!payload) return;
    const settings = this.getSettings();
    if (settings.enableDiscordLed && this.renderer) {
      const author = payload.author || 'Discord User';
      const text = payload.content || 'New Discord Mention';
      this.renderer.renderNotificationBanner(`[DISCORD] ${author}: ${text}`, 40);
    }
  }
}

class ArgumentNullException extends Error {
  constructor(paramName: string) {
    super(`Argument cannot be null or undefined: ${paramName}`);
    this.name = 'ArgumentNullException';
  }
}

class ArgumentException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgumentException';
  }
}
