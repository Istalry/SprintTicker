import { ITaskProvider, WorklogPayload } from './task-provider-interface';
import { AdHocProvider } from './adhoc-provider';
import { OpenProjectProvider } from './openproject-provider';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { WorklogRepository } from '../db/repositories/worklog-repository';
import { ProjectDTO, TaskDTO } from '../../shared/dtos';

/**
 * Service managing registered Task Providers (OpenProject and AdHoc), provider credentials,
 * active provider selection, and offline worklog queue flushing.
 */
export class ProviderManager {
  private _providers: Map<string, ITaskProvider> = new Map();
  private _activeProviderId: string = 'openproject';
  private _settingsRepo: SettingsRepository;
  private _worklogRepo: WorklogRepository;

  /// <summary>
  /// Initializes the Task Provider Manager, registering default remote and fallback local providers.
  /// </summary>
  constructor(settingsRepo?: SettingsRepository, worklogRepo?: WorklogRepository) {
    this._settingsRepo = settingsRepo || new SettingsRepository();
    this._worklogRepo = worklogRepo || new WorklogRepository();

    const openProjectProvider = new OpenProjectProvider();
    const adHocProvider = new AdHocProvider();

    this.registerProvider(openProjectProvider);
    this.registerProvider(adHocProvider);

    this.reinitializeProviders();

    this._activeProviderId = this._settingsRepo.getSetting('active_provider_id', 'openproject');
  }

  /// <summary>
  /// Re-reads stored domain credentials and status mappings from database settings.
  /// </summary>
  public reinitializeProviders(): void {
    const opProvider = this._providers.get('openproject');
    if (opProvider) {
      opProvider.initialize({
        domain: this._settingsRepo.getSetting('op_domain', 'http://192.168.0.139:8090/'),
        apiToken: this._settingsRepo.getSetting('op_api_key', ''),
        opStatusInProgress: this._settingsRepo.getSetting('op_status_in_progress', 'In progress'),
        opStatusToTest: this._settingsRepo.getSetting('op_status_to_test', 'In testing'),
        opStatusToReview: this._settingsRepo.getSetting('op_status_to_review', 'Developed'),
        opCompletionAction: this._settingsRepo.getSetting('op_completion_action', 'to_review')
      });
    }

    const adHocProvider = this._providers.get('adhoc');
    if (adHocProvider) {
      adHocProvider.initialize({
        fallbackKey: this._settingsRepo.getSetting('fallback_ticket_key', 'MISC-1')
      });
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
      const result = await this.getActiveProvider().logTime(payload);
      if (result.success) {
        // Automatically flush pending offline queue items if online request succeeded
        this.flushPendingSyncQueue().catch(err => console.warn('[ProviderManager] Sync queue flush warning:', err));
      }
      return result;
    } catch (err) {
      console.warn(`[ProviderManager] Direct logTime to ${this._activeProviderId} failed. Worklog buffered locally.`, err);
      return { success: false };
    }
  }

  /// <summary>
  /// Processes all pending worklogs in SQLite worklog_sync_queue.
  /// </summary>
  public async flushPendingSyncQueue(): Promise<{ syncedCount: number; failedCount: number }> {
    const pendingItems = this._worklogRepo.getPendingQueueItems();
    let syncedCount = 0;
    let failedCount = 0;

    for (const item of pendingItems) {
      const provider = this._providers.get(item.providerId) || this.getActiveProvider();
      try {
        const res = await provider.logTime({
          taskId: item.taskId,
          durationSeconds: item.durationSeconds,
          startedAtUtc: item.startedAtUtc,
          comment: item.comment,
          isAdHoc: item.taskId.startsWith('ADHOC')
        });

        if (res.success) {
          this._worklogRepo.updateSyncItemStatus(item.id, 'SYNCED');
          syncedCount++;
        } else {
          this._worklogRepo.updateSyncItemStatus(item.id, 'FAILED');
          failedCount++;
        }
      } catch (err) {
        console.warn(`[ProviderManager] Failed to log queued worklog item ${item.id}:`, err);
        this._worklogRepo.updateSyncItemStatus(item.id, 'FAILED');
        failedCount++;
      }
    }

    return { syncedCount, failedCount };
  }
}

