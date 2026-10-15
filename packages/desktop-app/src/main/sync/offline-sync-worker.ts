import { SyncQueueRecord, WorklogRepository } from '../db/repositories/worklog-repository';
import { isProviderRequestError, ProviderRequestError } from '../providers/provider-errors';
import {
  MAX_SYNC_ATTEMPTS,
  SYNC_CLAIM_TIMEOUT_MS,
  computeBackoffMs,
  syncMarker,
  withSyncMarker
} from './sync-constants';
import { ProjectDTO, TaskDTO, ProviderSyncResult, TaskLeftReason } from '../../shared/dtos';
import { ProjectRepository } from '../db/repositories/project-repository';
import { TaskRepository } from '../db/repositories/task-repository';
import { ProviderManager } from '../providers/provider-manager';
import { isAdHocTaskId } from '../db/id-generator';

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
  /** Set when a dispatch was asked for during a pass; drained before it ends. */
  private rerunRequested: boolean = false;
  private isSyncingProjects: boolean = false;
  private isOnline: boolean = true;
  /** The tasks no prune may take: the one the running session tracks. */
  private getProtectedTaskIds: () => string[] = () => [];
  /** Protected tasks the provider stopped listing at the last sync. */
  private unlistedTaskIds: Set<string> = new Set();
  /** Why each unlisted task left, once its provider has said. */
  private unlistedReasons: Map<string, TaskLeftReason> = new Map();
  private unlistedListeners: Set<() => void> = new Set();

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
   * Names the tasks the prune must leave alone: the one being tracked.
   *
   * A task reassigned, closed or moved on the provider leaves the user's
   * scope, and the next sync used to retire it -- deleted outright if no time
   * had been logged on it yet -- while it was being tracked. The session ran
   * on, but the task vanished from the lists, and finishing it as done did
   * nothing at all: there was no row left to mark. The time is real, so the
   * task stays until the session ends; the sync after that retires it.
   */
  public protectTasks(getProtectedTaskIds: () => string[]): void {
    this.getProtectedTaskIds = getProtectedTaskIds;
  }

  /** True when a protected task was missing from what the provider listed at the last sync. */
  public isUnlisted(taskId: string): boolean {
    return this.unlistedTaskIds.has(taskId);
  }

  /** Why an unlisted task left the list, or undefined while that is not known. */
  public unlistedReason(taskId: string): TaskLeftReason | undefined {
    return this.unlistedReasons.get(taskId);
  }

  /** Called when the set of unlisted tasks changes, so the session can say so. */
  public onUnlistedChanged(listener: () => void): () => void {
    this.unlistedListeners.add(listener);
    return () => this.unlistedListeners.delete(listener);
  }

  private setUnlisted(taskIds: string[], reasonsLearnt = false): void {
    const next = new Set(taskIds);
    const changed = next.size !== this.unlistedTaskIds.size || [...next].some(id => !this.unlistedTaskIds.has(id));
    this.unlistedTaskIds = next;
    for (const id of [...this.unlistedReasons.keys()]) {
      if (!next.has(id)) this.unlistedReasons.delete(id);
    }
    if (changed || reasonsLearnt) this.notifyUnlisted();
  }

  private notifyUnlisted(): void {
    for (const listener of this.unlistedListeners) {
      try {
        listener();
      } catch (err) {
        console.error('[OfflineSyncWorker] Unlisted-task listener failed:', err);
      }
    }
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
      // The tracked task survives the prune whatever the provider says, and so
      // does its project. Ad-hoc tasks are never the provider's to list.
      const protectedIds = this.getProtectedTaskIds().filter(id => id && !isAdHocTaskId(id));
      const listedIds = new Set([...tasksByProject.values()].flat().map(t => t.id));
      const protectedProjectIds = protectedIds
        .map(id => this.taskRepo.getTaskById(id)?.projectId)
        .filter((id): id is string => Boolean(id));

      for (const p of projects) {
        this.projectRepo.saveProject(p);
        const tasks = tasksByProject.get(p.id) ?? [];
        for (const t of tasks) {
          this.taskRepo.saveTask(t);
        }
        // Remove tasks closed or deleted on the remote provider.
        this.taskRepo.deleteTasksNotIn(p.id, [...tasks.map(t => t.id), ...protectedIds]);
      }
      this.projectRepo.deleteProjectsNotIn([...projects.map(p => p.id), ...protectedProjectIds]);

      const unlisted = protectedIds.filter(id => !listedIds.has(id));
      if (unlisted.length > 0) {
        console.log(`[OfflineSyncWorker] Tracked task(s) no longer listed by the provider, kept until the session ends: ${unlisted.join(', ')}`);
      }
      // The reason first, so the session is re-sent once, saying both.
      const reasonsLearnt = await this.explainUnlisted(unlisted);
      this.setUnlisted(unlisted, reasonsLearnt);

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
   * Asks each unlisted task's provider why it left: closed, reassigned or
   * gone. They used to read the same -- NOT YOURS -- and confirming FINISH
   * on a task already closed fired the completion transition, which on
   * OpenProject moved it out of Closed again. A failed read leaves the reason
   * unknown and the sync is not failed for it: the list is already saved.
   * True when a reason was learnt; the caller tells the listeners.
   */
  private async explainUnlisted(taskIds: string[]): Promise<boolean> {
    let learnt = false;
    for (const id of taskIds) {
      if (this.unlistedReasons.has(id)) continue;
      const provider = this.providerOfTask(id);
      if (!provider?.getTaskStanding) continue;
      try {
        const standing = await provider.getTaskStanding(id);
        this.unlistedReasons.set(id, standing === 'open' ? 'reassigned' : standing);
        learnt = true;
      } catch (err) {
        console.warn(`[OfflineSyncWorker] Could not read where ${id} stands; it is shown as no longer yours.`, err);
      }
    }
    return learnt;
  }

  /** The provider a task came from, by its project; the active one when that is not known. */
  private providerOfTask(taskId: string) {
    const manager = this.providerManager as Partial<ProviderManager>;
    const projectId = this.taskRepo.getTaskById(taskId)?.projectId;
    const providerId = projectId ? this.projectRepo.getProviderIdOf(projectId) : null;
    const named = providerId && typeof manager.getProvider === 'function' ? manager.getProvider(providerId) : undefined;
    if (named) return named;
    return typeof manager.getActiveProvider === 'function' ? manager.getActiveProvider() : undefined;
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
    if (this.isProcessing) {
      // Coalesce rather than drop. A stop that lands while a pass is in flight
      // used to get no dispatch of its own and waited out the whole interval,
      // which for the app's core loop -- finish one task, start and finish the
      // next -- is the common case rather than a corner: a pass involves a
      // network round trip, so the second stop lands inside it.
      this.rerunRequested = true;
      return { processed: 0, succeeded: 0, failed: 0 };
    }
    if (!this.isOnline) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    this.isProcessing = true;
    const total = { processed: 0, succeeded: 0, failed: 0 };
    try {
      // Re-drains only while something asked during the previous pass. Rows
      // released behind a backoff are not due yet, so a failing provider
      // cannot spin this loop.
      do {
        this.rerunRequested = false;
        const pass = await this.runQueuePass();
        total.processed += pass.processed;
        total.succeeded += pass.succeeded;
        total.failed += pass.failed;
        // A correction waits for the send before it, so it was not due
        // when this pass began; one more pass delivers it now rather than
        // at the next interval. It ends: a delivered row is never due
        // again, and a failed one waits out its backoff.
        if (pass.succeeded > 0) this.rerunRequested = true;
      } while (this.rerunRequested);
    } finally {
      this.isProcessing = false;
    }

    return total;
  }

  /**
   * One drain of every due row. Callers go through `processPendingQueue`, which
   * owns the single-dispatcher guard this deliberately does not repeat.
   */
  private async runQueuePass(): Promise<{ processed: number; succeeded: number; failed: number }> {
    let processed = 0;
    let succeeded = 0;
    let failed = 0;
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
        const result = await this.dispatch(item);

        if (result.success) {
          this.worklogRepo.markSyncItemSynced(item.id, result.remoteWorklogId);
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
  }

  /** Sends one claimed row: a worklog, or a correction or deletion of one already sent. */
  private async dispatch(item: SyncQueueRecord): Promise<{ success: boolean; remoteWorklogId?: string }> {
    if (item.operation === 'CREATE') {
      const earlier = await this.findEarlierSend(item);
      if (earlier) return { success: true, remoteWorklogId: earlier };
      return this.providerManager.logTimeForProvider(item.providerId, {
        taskId: item.taskId,
        durationSeconds: item.durationSeconds,
        startedAtUtc: item.startedAtUtc,
        // Tagged so a re-POST after a crashed claim is identifiable, and so
        // a correction can find the entry when its id is not known.
        comment: withSyncMarker(item.comment, item.id),
        isAdHoc: item.providerId === 'adhoc'
      });
    }

    const provider = this.providerManager.getProvider(item.providerId);
    if (!provider?.findWorklog || !provider.updateWorklog || !provider.deleteWorklog) {
      // Permanent: the same provider will be just as unable in an hour.
      throw new ProviderRequestError(
        item.providerId,
        'protocol',
        `${provider?.providerName ?? item.providerId} cannot correct a worklog it holds.`,
        { status: 400 }
      );
    }

    // The entry is the one the original send made: its id, once known, is on
    // that row, and its marker is what finds it when it is not.
    const originId = item.originSyncId ?? item.id;
    const origin = this.worklogRepo.getSyncItem(originId);
    let remoteId = item.remoteWorklogId ?? origin?.remoteWorklogId ?? null;
    if (!remoteId) {
      remoteId = await provider.findWorklog(item.taskId, origin?.startedAtUtc ?? item.startedAtUtc, syncMarker(originId));
      if (remoteId) this.worklogRepo.setRemoteWorklogId(originId, remoteId);
    }

    if (!remoteId) {
      if (item.operation === 'DELETE') {
        // Nothing carries the marker any more: the entry is already gone,
        // which is what a deletion asks for.
        console.log(`[OfflineSyncWorker] Worklog ${item.worklogId} not found at ${provider.providerName}; nothing to delete.`);
        return { success: true };
      }
      throw new ProviderRequestError(
        item.providerId,
        'protocol',
        `Not found in ${provider.providerName}: the worklog may have been deleted or edited there. Correct it there by hand.`,
        { status: 404 }
      );
    }

    if (item.operation === 'UPDATE') {
      await provider.updateWorklog(item.taskId, remoteId, {
        taskId: item.taskId,
        durationSeconds: item.durationSeconds,
        startedAtUtc: item.startedAtUtc,
        // The original marker, never this row's: the next search goes by it.
        comment: withSyncMarker(item.comment, originId),
        isAdHoc: false
      });
    } else {
      await provider.deleteWorklog(item.taskId, remoteId);
    }
    return { success: true };
  }

  /**
   * The provider's id for an entry an earlier attempt at this row already
   * made, or null.
   *
   * A send whose answer was lost may have been recorded, and a second POST
   * bills the time twice -- neither API takes an idempotency key. So a row
   * sent before is looked for by its marker first. A first attempt is not:
   * nothing can be there yet, and the search costs a request. A failed
   * search fails the attempt, which then waits out its backoff: sending
   * blind is the duplicate this exists to prevent.
   */
  private async findEarlierSend(item: SyncQueueRecord): Promise<string | null> {
    if (item.sendAttempts <= 1) return null;
    const provider = this.providerManager.getProvider(item.providerId);
    if (!provider?.findWorklog) return null;
    const remoteId = await provider.findWorklog(item.taskId, item.startedAtUtc, syncMarker(item.id));
    if (remoteId) {
      console.log(
        `[OfflineSyncWorker] Worklog ${item.id} was already recorded by ${provider.providerName} ` +
          `(entry ${remoteId}); not sending it again.`
      );
    }
    return remoteId;
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
