import { ITaskProvider, WorklogPayload } from './task-provider-interface';
import { JiraProvider } from './jira-provider';
import { AdHocProvider } from './adhoc-provider';
import { NotionProvider } from './notion-provider';
import { OpenProjectProvider } from './openproject-provider';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { WorklogRepository } from '../db/repositories/worklog-repository';
import { ProjectDTO, TaskDTO } from '../../shared/dtos';

/**
 * Service managing registered Task Providers (Jira, AdHoc, Notion), provider credentials,
 * active provider selection, and offline worklog queue flushing.
 */
export class ProviderManager {
  private providers: Map<string, ITaskProvider> = new Map();
  private activeProviderId: string = 'jira';
  private settingsRepo: SettingsRepository;
  private worklogRepo: WorklogRepository;

  constructor(settingsRepo?: SettingsRepository, worklogRepo?: WorklogRepository) {
    this.settingsRepo = settingsRepo || new SettingsRepository();
    this.worklogRepo = worklogRepo || new WorklogRepository();

    this.registerProvider(new JiraProvider());
    this.registerProvider(new AdHocProvider());
    this.registerProvider(new NotionProvider());
    this.registerProvider(new OpenProjectProvider());

    this.activeProviderId = this.settingsRepo.getSetting('active_provider_id', 'jira');
  }

  public registerProvider(provider: ITaskProvider): void {
    this.providers.set(provider.providerId, provider);
  }

  public getActiveProvider(): ITaskProvider {
    return this.providers.get(this.activeProviderId) || this.providers.get('jira')!;
  }

  public setActiveProviderId(providerId: string): void {
    if (this.providers.has(providerId)) {
      this.activeProviderId = providerId;
      this.settingsRepo.setSetting('active_provider_id', providerId);
    }
  }

  public async getProjects(): Promise<ProjectDTO[]> {
    return this.getActiveProvider().getProjects();
  }

  public async getTasks(projectId: string): Promise<TaskDTO[]> {
    return this.getActiveProvider().getTasks(projectId);
  }

  public async updateTaskStatus(taskId: string, status: 'in_progress' | 'to_test' | 'to_review' | 'done'): Promise<boolean> {
    return this.getActiveProvider().updateTaskStatus(taskId, status);
  }

  public async logTime(payload: WorklogPayload): Promise<{ success: boolean; remoteWorklogId?: string }> {
    try {
      const result = await this.getActiveProvider().logTime(payload);
      if (result.success) {
        // Automatically flush pending offline queue items if online request succeeded
        this.flushPendingSyncQueue().catch(err => console.warn('[ProviderManager] Sync queue flush warning:', err));
      }
      return result;
    } catch (err) {
      console.warn(`[ProviderManager] Direct logTime to ${this.activeProviderId} failed. Worklog buffered locally.`, err);
      return { success: false };
    }
  }

  /**
   * Processes all pending worklogs in SQLite worklog_sync_queue.
   */
  public async flushPendingSyncQueue(): Promise<{ syncedCount: number; failedCount: number }> {
    const pendingItems = this.worklogRepo.getPendingQueueItems();
    let syncedCount = 0;
    let failedCount = 0;

    for (const item of pendingItems) {
      const provider = this.providers.get(item.providerId) || this.getActiveProvider();
      try {
        const res = await provider.logTime({
          taskId: item.taskId,
          durationSeconds: item.durationSeconds,
          startedAtUtc: item.startedAtUtc,
          comment: item.comment,
          isAdHoc: item.taskId.startsWith('ADHOC')
        });

        if (res.success) {
          this.worklogRepo.updateSyncItemStatus(item.id, 'SYNCED');
          syncedCount++;
        } else {
          this.worklogRepo.updateSyncItemStatus(item.id, 'FAILED');
          failedCount++;
        }
      } catch {
        this.worklogRepo.updateSyncItemStatus(item.id, 'FAILED');
        failedCount++;
      }
    }

    return { syncedCount, failedCount };
  }
}
