import { ITaskProvider, WorklogPayload } from './task-provider-interface';
import { AdHocProvider } from './adhoc-provider';
import { OpenProjectProvider } from './openproject-provider';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { ProjectDTO, TaskDTO } from '../../shared/dtos';
import { PROVIDER_SETTING_DEFAULTS, ProviderSettingKey, ProviderSettingKeyValue } from '../../shared/provider-settings';

/**
 * Service managing registered Task Providers (OpenProject and AdHoc), provider credentials,
 * active provider selection, and offline worklog queue flushing.
 */
export class ProviderManager {
  private _providers: Map<string, ITaskProvider> = new Map();
  private _activeProviderId: string = 'openproject';
  private _settingsRepo: SettingsRepository;

  /// <summary>
  /// Initializes the Task Provider Manager, registering default remote and fallback local providers.
  /// </summary>
  /**
   * No worklog repository parameter: ProviderManager no longer reads or writes
   * the sync queue. OfflineSyncWorker is its sole owner, and having a second
   * dispatcher here is what let the same row be POSTed twice.
   */
  constructor(settingsRepo?: SettingsRepository) {
    this._settingsRepo = settingsRepo || new SettingsRepository();

    const openProjectProvider = new OpenProjectProvider();
    const adHocProvider = new AdHocProvider();

    this.registerProvider(openProjectProvider);
    this.registerProvider(adHocProvider);

    this.reinitializeProviders();

    this._activeProviderId = this._settingsRepo.getSetting('active_provider_id', 'openproject');
  }

  /// <summary>
  /// Reads a provider setting, falling back to the single shared default for that key.
  /// </summary>
  private readSetting(key: ProviderSettingKeyValue): string {
    return this._settingsRepo.getSetting(key, PROVIDER_SETTING_DEFAULTS[key]);
  }

  /// <summary>
  /// Re-reads stored domain credentials and status mappings from database settings.
  /// </summary>
  public reinitializeProviders(): void {
    const opProvider = this._providers.get('openproject');
    if (opProvider) {
      void opProvider.initialize({
        domain: this.readSetting(ProviderSettingKey.OP_DOMAIN),
        apiToken: this.readSetting(ProviderSettingKey.OP_API_KEY),
        opStatusInProgress: this.readSetting(ProviderSettingKey.OP_STATUS_IN_PROGRESS),
        opStatusToTest: this.readSetting(ProviderSettingKey.OP_STATUS_TO_TEST),
        opStatusToReview: this.readSetting(ProviderSettingKey.OP_STATUS_TO_REVIEW),
        opCompletionAction: this.readSetting(ProviderSettingKey.OP_COMPLETION_ACTION)
      })
        .catch(err => console.error('[ProviderManager] opProvider.initialize failed:', err));
    }

    const adHocProvider = this._providers.get('adhoc');
    if (adHocProvider) {
      void adHocProvider.initialize({
        fallbackKey: this.readSetting(ProviderSettingKey.FALLBACK_TICKET_KEY)
      })
        .catch(err => console.error('[ProviderManager] adHocProvider.initialize failed:', err));
    }
  }

  /// <summary>
  /// Registers a task provider instance with the provider registry.
  /// </summary>
  public registerProvider(provider: ITaskProvider): void {
    this._providers.set(provider.providerId, provider);
  }

  /// <summary>
  /// Retrieves a specific task provider by its ID.
  /// </summary>
  public getProvider(providerId: string): ITaskProvider | undefined {
    return this._providers.get(providerId);
  }

  /// <summary>
  /// Retrieves the currently active task provider instance.
  /// </summary>
  public getActiveProvider(): ITaskProvider {
    return this._providers.get(this._activeProviderId) || this._providers.get('openproject')!;
  }

  /// <summary>
  /// Sets the active task provider identifier.
  /// </summary>
  public setActiveProviderId(providerId: string): void {
    if (this._providers.has(providerId)) {
      this._activeProviderId = providerId;
      this._settingsRepo.setSetting('active_provider_id', providerId);
    }
  }

  /// <summary>
  /// Fetches remote or local projects from the active provider.
  /// </summary>
  public async getProjects(): Promise<ProjectDTO[]> {
    return this.getActiveProvider().getProjects();
  }

  /// <summary>
  /// Fetches remote or local tasks for a project from the active provider.
  /// </summary>
  public async getTasks(projectId: string): Promise<TaskDTO[]> {
    return this.getActiveProvider().getTasks(projectId);
  }

  /// <summary>
  /// Updates remote task status on the active provider.
  /// </summary>
  public async updateTaskStatus(taskId: string, status: 'in_progress' | 'to_test' | 'to_review' | 'done'): Promise<boolean> {
    return this.getActiveProvider().updateTaskStatus(taskId, status);
  }

  /// <summary>
  /// Logs spent time to the active provider and triggers background queue flushing on success.
  /// </summary>
  public async logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }> {
    try {
      // Deliberately does not drain the sync queue on success. OfflineSyncWorker
      // is the queue's sole dispatcher; a second one here raced it and could
      // POST the same row twice, billing the time to the provider twice.
      return await this.getActiveProvider().logTime(payload);
    } catch (err) {
      console.warn(`[ProviderManager] Direct logTime to ${this._activeProviderId} failed. Worklog buffered locally.`, err);
      return { success: false };
    }
  }

  /// <summary>
  /// Processes all pending worklogs in SQLite worklog_sync_queue.
  /// </summary>
  /**
   * Sends a worklog through a *named* provider.
   *
   * The queue records which provider each row was created for. Dispatching via
   * the active provider instead means that switching provider mid-day delivers
   * everything still queued to whichever one happens to be selected -- posting
   * OpenProject worklogs into AdHoc, where they vanish.
   */
  public async logTimeForProvider(
    providerId: string,
    payload: WorklogPayload
  ): Promise<{ success: boolean; remoteWorklogId?: string }> {
    const provider = this._providers.get(providerId);
    if (!provider) {
      throw new Error(`No registered provider with id "${providerId}"`);
    }
    return provider.logTime(payload);
  }
}

