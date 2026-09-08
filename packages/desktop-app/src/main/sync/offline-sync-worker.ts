import { WorklogRepository } from '../db/repositories/worklog-repository';
import { isProviderRequestError } from '../providers/provider-errors';
import {
  MAX_SYNC_ATTEMPTS,
  SYNC_CLAIM_TIMEOUT_MS,
  computeBackoffMs,
  withSyncMarker
} from './sync-constants';
import { ProjectDTO, TaskDTO, ProviderSyncResult } from '../../shared/dtos';
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
  private isSyncingProjects: boolean = false;
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
    // Fallback repositories bind to the worklog repository's connection. A bare
    // constructor here resolves the DatabaseConnection singleton, which opens a
    // second, on-disk database even when the caller passed an in-memory one --
    // so the worker would prune a completely different dataset from the one it
    // was told to sync.
    const conn = this.worklogRepo.getConnection();
    this.projectRepo = projectRepo || new ProjectRepository(conn);
    this.taskRepo = taskRepo || new TaskRepository(conn);
    this.syncIntervalMs = syncIntervalMs;
  }

  /**
   * Starts the periodic background sync worker loop.
   */
  public start(): void {
    if (this.timerId) return;

    console.log(`[OfflineSyncWorker] Starting background sync worker (Interval: ${this.syncIntervalMs / 1000}s)`);
    this.timerId = setInterval(() => {
      void this.processPendingQueue()
        .catch(err => console.error('[OfflineSyncWorker] processPendingQueue failed:', err));
      void this.syncTasksAndProjects()
        .catch(err => console.error('[OfflineSyncWorker] syncTasksAndProjects failed:', err));
    }, this.syncIntervalMs);

    // Initial run on boot
    void this.processPendingQueue()
      .catch(err => console.error('[OfflineSyncWorker] processPendingQueue failed:', err));
    void this.syncTasksAndProjects()
      .catch(err => console.error('[OfflineSyncWorker] syncTasksAndProjects failed:', err));
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

  /**
   * Mirrors the remote provider's projects and tasks into the local cache.
   *
   * Fetch-then-commit, in two distinct phases. Nothing is written or pruned
   * until every request has succeeded, because pruning is destructive and
   * measured against whatever the fetch returned: a failure part-way through
   * used to leave the cache reconciled against a partial view, deleting
   * everything the interrupted half would have contained.
   *
   * Any ProviderRequestError aborts the whole pass and leaves the cache exactly
   * as it was. That includes `not_configured`, which is the ordinary state
   * before the user enters credentials -- previously it returned an empty list
   * that the prune read as "the remote has nothing", wiping local data on first
   * launch.
   */
  public async syncTasksAndProjects(): Promise<ProviderSyncResult> {
    if (!this.isOnline) {
      return { status: 'skipped', reason: 'Offline.', projects: 0, tasks: 0 };
    }

    // One pass at a time. The periodic tick is no longer the only caller --
    // saving provider credentials starts one too -- and a full pass can outlive
    // the gap between them on a slow instance. Two overlapping passes would
    // each prune against their own snapshot, so the older one could delete
    // what the newer one had just written.
    if (this.isSyncingProjects) {
      return { status: 'skipped', reason: 'A sync is already running.', projects: 0, tasks: 0 };
    }
    this.isSyncingProjects = true;

    try {
      return await this.runProjectSync();
    } finally {
      this.isSyncingProjects = false;
    }
  }

  /** The body of {@link syncTasksAndProjects}, wrapped so the guard always clears. */
  private async runProjectSync(): Promise<ProviderSyncResult> {
    let projects: ProjectDTO[];
    const tasksByProject = new Map<string, TaskDTO[]>();

    // Phase 1: fetch everything. No writes.
    try {
      console.log(`[OfflineSyncWorker] Fetching latest projects and tasks...`);
      projects = await this.providerManager.getProjects();
      for (const p of projects) {
        tasksByProject.set(p.id, await this.providerManager.getTasks(p.id));
      }
    } catch (e) {
      if (isProviderRequestError(e) && e.kind === 'not_configured') {
        console.log(`[OfflineSyncWorker] Skipping sync: ${e.message}`);
        return { status: 'not_configured', reason: e.message, projects: 0, tasks: 0 };
      }
      console.error(
        `[OfflineSyncWorker] Fetch failed; local cache left untouched:`,
        e
      );
      return {
        status: 'failed',
        reason: e instanceof Error ? e.message : String(e),
        projects: 0,
        tasks: 0
      };
    }

    // Phase 2: commit the complete, verified snapshot.
    try {
      for (const p of projects) {
        this.projectRepo.saveProject(p);
        const tasks = tasksByProject.get(p.id) ?? [];
        for (const t of tasks) {
          this.taskRepo.saveTask(t);
        }
        // Remove tasks closed or deleted on the remote provider.
        this.taskRepo.deleteTasksNotIn(p.id, tasks.map(t => t.id));
      }
      this.projectRepo.deleteProjectsNotIn(projects.map(p => p.id));

      const taskCount = [...tasksByProject.values()].reduce((n, t) => n + t.length, 0);
      console.log(`[OfflineSyncWorker] Synced ${projects.length} project(s) and ${taskCount} task(s).`);
      return { status: 'synced', projects: projects.length, tasks: taskCount };
    } catch (e) {
      console.error(`[OfflineSyncWorker] Failed to commit synced projects and tasks:`, e);
      return {
        status: 'failed',
        reason: e instanceof Error ? e.message : String(e),
        projects: 0,
        tasks: 0
      };
    }
  }

  /**
   * Processes all PENDING items in the worklog_sync_queue SQLite table.
   */
  /**
   * Drains the worklog sync queue.
   *
   * The worker is the queue's only dispatcher. Each row is claimed atomically
   * before its network call, so a second pass -- or a second dispatcher -- can
   * never send the same worklog twice. On failure the row is released behind an
   * exponential backoff rather than being marked permanently FAILED, which is
   * what previously stranded billable time after a single network blip.
   */
  public async processPendingQueue(): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (this.isProcessing || !this.isOnline) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    this.isProcessing = true;
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      // Recover rows whose claim outlived the process that took it.
      const reclaimed = this.worklogRepo.reclaimStaleSyncItems(SYNC_CLAIM_TIMEOUT_MS);
      if (reclaimed > 0) {
        console.log(`[OfflineSyncWorker] Reclaimed ${reclaimed} stale in-flight worklog(s).`);
      }

      const dueItems = this.worklogRepo.getPendingQueueItems();
      if (dueItems.length === 0) {
        return { processed: 0, succeeded: 0, failed: 0 };
      }

      console.log(`[OfflineSyncWorker] Processing ${dueItems.length} due worklog(s).`);

      for (const due of dueItems) {
        // Another dispatcher may have taken this row between the SELECT and
        // here; claimSyncItem returning null means it is not ours to send.
        const item = this.worklogRepo.claimSyncItem(due.id);
        if (!item) continue;

        processed++;
        try {
          const result = await this.providerManager.logTimeForProvider(item.providerId, {
            taskId: item.taskId,
            durationSeconds: item.durationSeconds,
            startedAtUtc: item.startedAtUtc,
            // Tagged so a re-POST after a crashed claim is identifiable.
            comment: withSyncMarker(item.comment, item.id),
            isAdHoc: item.providerId === 'adhoc'
          });

          if (result.success) {
            this.worklogRepo.markSyncItemSynced(item.id);
            succeeded++;
          } else {
            // A provider that reports failure without throwing tells us
            // nothing about whether waiting would help, so it gets the
            // ordinary backoff.
            this.releaseFailure(item.id, item.retryCount, 'Provider reported failure');
            failed++;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[OfflineSyncWorker] Failed to sync worklog ${item.id}:`, err);

          if (isProviderRequestError(err) && err.isPermanent) {
            // A revoked key or an unconfigured provider will answer the same
            // way in forty seconds and in forty minutes. Spending the retry
            // budget on it means the row parks with 'attempt 5 of 5' against
            // it and no indication that the user, not the network, is what has
            // to change. Park it now, with the server's own words attached.
            //
            // Safe to park early only because entering credentials requeues
            // every FAILED row: see requeueFailedItems, called from the
            // provider settings handler. Without that this would strand
            // billable time, which is the bug this queue was rebuilt to stop.
            this.worklogRepo.parkSyncItemAsFailed(item.id, message);
          } else {
            this.releaseFailure(item.id, item.retryCount, message);
          }
          failed++;
        }
      }

      console.log(`[OfflineSyncWorker] Sync complete. Succeeded: ${succeeded}, Failed: ${failed}`);
      return { processed, succeeded, failed };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Returns every parked worklog to the queue.
   *
   * Called when provider credentials change, because that is the action that
   * fixes the failure which parked them. The count is returned so the caller
   * can say so rather than leaving the user to guess whether their stranded
   * time came back.
   */
  public requeueFailedWorklogs(): number {
    const revived = this.worklogRepo.requeueFailedItems();
    if (revived > 0) {
      console.log(`[OfflineSyncWorker] Requeued ${revived} previously failed worklog(s).`);
    }
    return revived;
  }

  /** Releases a claimed row behind a jittered exponential backoff. */
  private releaseFailure(id: string, retryCount: number, message: string): void {
    this.worklogRepo.releaseSyncItemAfterFailure(
      id,
      message,
      computeBackoffMs(retryCount),
      MAX_SYNC_ATTEMPTS
    );
  }
}
