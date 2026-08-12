import { WorklogRepository } from '../db/repositories/worklog-repository';
import { ProjectRepository } from '../db/repositories/project-repository';
import { TaskRepository } from '../db/repositories/task-repository';
import { ProviderManager } from '../providers/provider-manager';

/**
 * Background worker service managing offline worklog retry queueing, periodic network sync,
 * and external provider reconciliation.
 */
export class OfflineSyncWorker {
  private worklogRepo: WorklogRepository;
  private projectRepo: ProjectRepository;
  private taskRepo: TaskRepository;
  private providerManager: ProviderManager;
  private syncIntervalMs: number;
  private timerId: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;
  private isOnline: boolean = true;

  constructor(
    providerManager: ProviderManager,
    worklogRepo?: WorklogRepository,
    projectRepo?: ProjectRepository,
    taskRepo?: TaskRepository,
    syncIntervalMs: number = 300000 // 5 minutes by default
  ) {
    this.providerManager = providerManager;
    this.worklogRepo = worklogRepo || new WorklogRepository();
    this.projectRepo = projectRepo || new ProjectRepository();
    this.taskRepo = taskRepo || new TaskRepository();
    this.syncIntervalMs = syncIntervalMs;
  }

  /**
   * Starts the periodic background sync worker loop.
   */
  public start(): void {
    if (this.timerId) return;

    console.log(`[OfflineSyncWorker] Starting background sync worker (Interval: ${this.syncIntervalMs / 1000}s)`);
    this.timerId = setInterval(() => {
      this.processPendingQueue();
      this.syncTasksAndProjects();
    }, this.syncIntervalMs);

    // Initial run on boot
    this.processPendingQueue();
    this.syncTasksAndProjects();
  }

  /**
   * Stops the background worker.
   */
  public stop(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  public setOnlineStatus(online: boolean): void {
    this.isOnline = online;
  }

  public async syncTasksAndProjects(): Promise<void> {
    if (!this.isOnline) return;
    try {
      console.log(`[OfflineSyncWorker] Fetching latest projects and tasks...`);
      const projects = await this.providerManager.getProjects();
      const activeProjectIds = projects.map(p => p.id);

      for (const p of projects) {
        this.projectRepo.saveProject(p);
        const tasks = await this.providerManager.getTasks(p.id);
        const activeTaskIds = tasks.map(t => t.id);

        for (const t of tasks) {
          this.taskRepo.saveTask(t);
        }
        
        // Delete tasks that were removed or closed on the remote provider
        this.taskRepo.deleteTasksNotIn(p.id, activeTaskIds);
      }

      // Delete projects that were removed on the remote provider
      this.projectRepo.deleteProjectsNotIn(activeProjectIds);

      console.log(`[OfflineSyncWorker] Successfully synced projects and tasks.`);
    } catch (e) {
      console.error(`[OfflineSyncWorker] Failed to sync tasks and projects:`, e);
    }
  }

  /**
   * Processes all PENDING items in the worklog_sync_queue SQLite table.
   */
  public async processPendingQueue(): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (this.isProcessing || !this.isOnline) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    this.isProcessing = true;
    let succeeded = 0;
    let failed = 0;

    try {
      const pendingItems = this.worklogRepo.getPendingQueueItems();
      if (pendingItems.length === 0) {
        this.isProcessing = false;
        return { processed: 0, succeeded: 0, failed: 0 };
      }

      console.log(`[OfflineSyncWorker] Processing ${pendingItems.length} pending worklogs in SQLite sync queue...`);

      for (const item of pendingItems) {
        try {
          const result = await this.providerManager.logTime({
            taskId: item.taskId,
            durationSeconds: item.durationSeconds,
            startedAtUtc: item.startedAtUtc,
            comment: item.comment,
            isAdHoc: item.providerId === 'adhoc'
          });

          if (result.success) {
            this.worklogRepo.updateSyncItemStatus(item.id, 'SYNCED');
            succeeded++;
          } else {
            this.worklogRepo.incrementRetryCount(item.id, 3);
            failed++;
          }
        } catch (err) {
          console.error(`[OfflineSyncWorker] Failed to sync worklog ${item.id}:`, err);
          this.worklogRepo.incrementRetryCount(item.id, 3);
          failed++;
        }
      }

      console.log(`[OfflineSyncWorker] Sync complete. Succeeded: ${succeeded}, Failed: ${failed}`);
      return { processed: pendingItems.length, succeeded, failed };
    } finally {
      this.isProcessing = false;
    }
  }
}
