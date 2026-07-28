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
      enableGmailLed: true,
      notificationTimeoutSeconds: 10,
      stealthClockIdleTimeoutMins: 15,
      enableEdgeGlow: true,
      edgeGlowOpacity: 0.3,
      edgeGlowMode: 'PULSE',
      edgeGlowTransition: 'FADE'
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

    const iconId = channel.toLowerCase().includes('discord')
      ? 'discord'
      : channel.toLowerCase().includes('gmail')
      ? 'gmail'
      : 'slack';

    const testSender = 'Alice';
    if (this.renderer) {
      this.renderer.renderNotificationBanner(testSender, channel, 40, iconId);
    }

    return {
      success: true,
      channel,
      message: `Sent test notification payload for ${channel}!`
    };
  }

  /// <summary>
  /// Processes incoming Slack event payloads and updates front matrix display.
  /// </summary>
  public handleSlackEvent(payload: SlackEventPayload): void {
    if (!payload) return;
    const settings = this.getSettings();
    if (settings.enableSlackPreview && this.renderer) {
      const sender = payload.sender || 'Alice';
      this.renderer.renderNotificationBanner(sender, 'SLACK', 40, 'slack');
    }
  }

  /// <summary>
  /// Processes incoming Discord webhook payloads and updates front matrix display.
  /// </summary>
  public handleDiscordWebhook(payload: DiscordWebhookPayload): void {
    if (!payload) return;
    const settings = this.getSettings();
    if (settings.enableDiscordLed && this.renderer) {
      const author = payload.author || 'Bob';
      this.renderer.renderNotificationBanner(author, 'DISCORD', 40, 'discord');
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
