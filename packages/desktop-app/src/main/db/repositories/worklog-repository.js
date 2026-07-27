import { DatabaseConnection } from '../database-connection';
/**
 * Repository layer for worklogs and offline worklog retry queue management.
 */
export class WorklogRepository {
    dbConn;
    constructor(dbConn) {
        this.dbConn = dbConn || DatabaseConnection.getInstance();
    }
    /**
     * Saves a finalized worklog record to SQLite.
     */
    saveWorklog(record) {
        if (!record.id || !record.taskId || record.durationSeconds < 0) {
            throw new Error('Valid Worklog ID, Task ID, and non-negative duration are required');
        }
        const stmt = this.dbConn.getDb().prepare(`
      INSERT INTO worklogs (id, session_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(record.id, record.sessionId, record.taskId, record.durationSeconds, record.startedAtUtc, record.comment, record.createdAtUtc);
    }
    /**
     * Enqueues a worklog to the offline retry queue.
     */
    enqueueSyncItem(payload) {
        const stmt = this.dbConn.getDb().prepare(`
      INSERT INTO worklog_sync_queue (
        id, provider_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
    `);
        stmt.run(payload.id, payload.providerId, payload.taskId, payload.durationSeconds, payload.startedAtUtc, payload.comment, new Date().toISOString());
    }
    /**
     * Retrieves all pending worklog sync queue items.
     */
    getPendingQueueItems() {
        const stmt = this.dbConn.getDb().prepare('SELECT * FROM worklog_sync_queue WHERE status = \'PENDING\'');
        const rows = stmt.all();
        return rows.map(r => ({
            id: r.id,
            providerId: r.provider_id,
            taskId: r.task_id,
            durationSeconds: r.duration_seconds,
            startedAtUtc: r.started_at_utc,
            comment: r.comment,
            createdAtUtc: r.created_at_utc,
            retryCount: r.retry_count,
            status: r.status
        }));
    }
    /**
     * Updates sync queue item status and increments retry count.
     */
    updateSyncItemStatus(id, status) {
        const stmt = this.dbConn.getDb().prepare(`
      UPDATE worklog_sync_queue
      SET status = ?, retry_count = retry_count + 1
      WHERE id = ?
    `);
        stmt.run(status, id);
    }
}
//# sourceMappingURL=worklog-repository.js.map