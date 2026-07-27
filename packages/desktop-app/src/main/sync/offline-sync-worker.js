import { WorklogRepository } from '../db/repositories/worklog-repository';
/**
 * Background worker service managing offline worklog retry queueing, periodic network sync,
 * and external provider reconciliation.
 */
export class OfflineSyncWorker {
    worklogRepo;
    provider;
    syncIntervalMs;
    timerId = null;
    isProcessing = false;
    isOnline = true;
    constructor(provider, worklogRepo, syncIntervalMs = 60000) {
        this.provider = provider;
        this.worklogRepo = worklogRepo || new WorklogRepository();
        this.syncIntervalMs = syncIntervalMs;
    }
    /**
     * Starts the periodic background sync worker loop.
     */
    start() {
        if (this.timerId)
            return;
        console.log(`[OfflineSyncWorker] Starting background sync worker (Interval: ${this.syncIntervalMs / 1000}s)`);
        this.timerId = setInterval(() => {
            this.processPendingQueue();
        }, this.syncIntervalMs);
        // Initial run on boot
        this.processPendingQueue();
    }
    /**
     * Stops the background worker.
     */
    stop() {
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
    }
    setOnlineStatus(online) {
        this.isOnline = online;
    }
    setProvider(provider) {
        this.provider = provider;
    }
    /**
     * Processes all PENDING items in the worklog_sync_queue SQLite table.
     */
    async processPendingQueue() {
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
                    const result = await this.provider.logTime({
                        taskId: item.taskId,
                        durationSeconds: item.durationSeconds,
                        startedAtUtc: item.startedAtUtc,
                        comment: item.comment,
                        isAdHoc: item.providerId === 'adhoc'
                    });
                    if (result.success) {
                        this.worklogRepo.updateSyncItemStatus(item.id, 'SYNCED');
                        succeeded++;
                    }
                    else {
                        this.worklogRepo.updateSyncItemStatus(item.id, 'FAILED');
                        failed++;
                    }
                }
                catch (err) {
                    console.error(`[OfflineSyncWorker] Failed to sync worklog ${item.id}:`, err);
                    this.worklogRepo.updateSyncItemStatus(item.id, 'FAILED');
                    failed++;
                }
            }
            console.log(`[OfflineSyncWorker] Sync complete. Succeeded: ${succeeded}, Failed: ${failed}`);
            return { processed: pendingItems.length, succeeded, failed };
        }
        finally {
            this.isProcessing = false;
        }
    }
}
//# sourceMappingURL=offline-sync-worker.js.map