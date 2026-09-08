import { SettingsRepository } from '../db/repositories/settings-repository';
import { DisplayRenderer } from '../hardware/display-renderer';
import { MessagingSettingsDTO, MessagingTestResultDTO, ArgumentNullException, ArgumentException } from '../../shared/dtos';
import { ProviderManager } from '../providers/provider-manager';
import { OpenProjectProvider } from '../providers/openproject-provider';

/**
 * Service managing third-party notification channels (Discord, Slack, Gmail)
 * and triggering visual hardware alerts on the physical BUSY Bar display.
 */
export class MessagingIntegrationService {
  private settingsRepo: SettingsRepository;
  private renderer?: DisplayRenderer;
  private providerManager?: ProviderManager;
  private opPollingInterval: NodeJS.Timeout | null = null;
  private knownOpNotifications = new Set<string>();

  constructor(settingsRepo: SettingsRepository, renderer?: DisplayRenderer, providerManager?: ProviderManager) {
    if (!settingsRepo) {
      throw new ArgumentNullException('settingsRepo');
    }
    this.settingsRepo = settingsRepo;
    this.renderer = renderer;

    
    this.providerManager = providerManager;
    this.restartOpenProjectPolling();
  }

  /// <summary>
  /// Manages the OpenProject API polling interval based on current settings.
  /// </summary>
  public restartOpenProjectPolling(): void {
    if (this.opPollingInterval) {
      clearInterval(this.opPollingInterval);
      this.opPollingInterval = null;
    }
    const settings = this.getSettings();
    if (settings.enableOpenProjectNotifications && this.providerManager) {
      const intervalMs = (settings.openProjectPollingIntervalSeconds || 60) * 1000;
      this.opPollingInterval = setInterval(() => {
        void this.pollOpenProjectNotifications().catch(err =>
          console.warn('[MessagingService] OpenProject notification poll failed:', err)
        );
      }, intervalMs);
      // Execute an immediate initial poll
      setTimeout(() => {
        void this.pollOpenProjectNotifications().catch(err =>
          console.warn('[MessagingService] Initial OpenProject notification poll failed:', err)
        );
      }, 2000);
    }
  }

  private async pollOpenProjectNotifications(): Promise<void> {
    if (!this.providerManager || !this.renderer) return;

    // Only poll the provider the user is actually working against. This is
    // OpenProject's own notification feed, not a general one, and it ran every
    // interval regardless -- so switching to Jira left a stale OpenProject
    // address being dialled once a minute forever, failing every time.
    const active = this.providerManager.getActiveProvider();
    if (!active || active.providerId !== 'openproject') return;

    const opProvider = this.providerManager.getProvider('openproject') as OpenProjectProvider;
    if (!opProvider) return;

    try {
      const notifications = await opProvider.fetchUnreadNotifications();
      for (const n of notifications) {
        if (!this.knownOpNotifications.has(n.id)) {
          this.knownOpNotifications.add(n.id);
          this.renderer.renderNotificationBanner({
            appName: 'OpenProject',
            title: n.actorName,
            body: n.subject,
            iconId: 'openproject'
          });
        }
      }
      
      // Cleanup old known notifications if the set gets too large to prevent memory leaks
      if (this.knownOpNotifications.size > 500) {
        const arr = Array.from(this.knownOpNotifications);
        this.knownOpNotifications = new Set(arr.slice(arr.length - 100));
      }
    } catch (err) {
      console.warn('[MessagingService] Error polling OpenProject notifications:', err);
    }
  }

  /// <summary>
  /// Retrieves persisted third-party messaging configurations.
  /// </summary>
  public getSettings(): MessagingSettingsDTO {
    return this.settingsRepo.getSetting('messaging_settings', {
      enableOpenProjectNotifications: true,
      openProjectPollingIntervalSeconds: 60,
      notificationTimeoutSeconds: 10
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
    this.restartOpenProjectPolling();
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
      : channel.toLowerCase().includes('openproject')
      ? 'openproject'
      : 'slack';

    if (this.renderer) {
      this.renderer.renderNotificationBanner({
        appName: channel,
        title: 'Alice',
        body: 'Test notification',
        iconId
      });
    }

    return {
      success: true,
      channel,
      message: `Sent test notification payload for ${channel}!`
    };
  }

}
