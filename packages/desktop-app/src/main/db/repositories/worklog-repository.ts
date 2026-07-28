import { DatabaseConnection } from '../database-connection';

export interface WorklogRecord {
  id: string;
  sessionId: string;
  taskId: string;
  durationSeconds: number;
  startedAtUtc: string;
  comment: string;
  createdAtUtc: string;
}

export interface SyncQueueRecord {
  id: string;
  providerId: string;
  taskId: string;
  durationSeconds: number;
  startedAtUtc: string;
  comment: string;
  createdAtUtc: string;
  retryCount: number;
  status: 'PENDING' | 'SYNCED' | 'FAILED';
}

/**
 * Repository layer for worklogs and offline worklog retry queue management.
 */
export class WorklogRepository {
  private dbConn: DatabaseConnection;

  constructor(dbConn?: DatabaseConnection) {
    this.dbConn = dbConn || DatabaseConnection.getInstance();
  }

  /**
   * Saves a finalized worklog record to SQLite.
   */
  public saveWorklog(record: WorklogRecord): void {
    if (!record.id || !record.taskId || record.durationSeconds < 0) {
      throw new Error('Valid Worklog ID, Task ID, and non-negative duration are required');
    }

    const stmt = this.dbConn.getDb().prepare(`
      INSERT INTO worklogs (id, session_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.sessionId,
      record.taskId,
      record.durationSeconds,
      record.startedAtUtc,
      record.comment,
      record.createdAtUtc
    );
  }

  /**
   * Enqueues a worklog to the offline retry queue.
   */
  public enqueueSyncItem(payload: {
    id: string;
    providerId: string;
    taskId: string;
    durationSeconds: number;
    startedAtUtc: string;
    comment: string;
  }): void {
    const stmt = this.dbConn.getDb().prepare(`
      INSERT INTO worklog_sync_queue (
        id, provider_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
    `);

    stmt.run(
      payload.id,
      payload.providerId,
      payload.taskId,
      payload.durationSeconds,
      payload.startedAtUtc,
      payload.comment,
      new Date().toISOString()
    );
  }

  /**
   * Retrieves all pending worklog sync queue items.
   */
  public getPendingQueueItems(): SyncQueueRecord[] {
    const stmt = this.dbConn.getDb().prepare<[], {
      id: string;
      provider_id: string;
      task_id: string;
      duration_seconds: number;
      started_at_utc: string;
      comment: string;
      created_at_utc: string;
      retry_count: number;
      status: 'PENDING' | 'SYNCED' | 'FAILED';
    }>('SELECT * FROM worklog_sync_queue WHERE status = \'PENDING\'');

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
  public updateSyncItemStatus(id: string, status: 'SYNCED' | 'FAILED'): void {
    const stmt = this.dbConn.getDb().prepare(`
      UPDATE worklog_sync_queue
      SET status = ?, retry_count = retry_count + 1
      WHERE id = ?
    `);

    stmt.run(status, id);
  }

  /**
   * Retrieves today's completed worklogs from SQLite database.
   */
  public getTodaysWorklogs(): WorklogRecord[] {
    const stmt = this.dbConn.getDb().prepare<[], {
      id: string;
      session_id: string;
      task_id: string;
      duration_seconds: number;
      started_at_utc: string;
      comment: string;
      created_at_utc: string;
    }>('SELECT * FROM worklogs ORDER BY created_at_utc DESC LIMIT 50');

    const rows = stmt.all();
    return rows.map(r => ({
      id: r.id,
      sessionId: r.session_id,
      taskId: r.task_id,
      durationSeconds: r.duration_seconds,
      startedAtUtc: r.started_at_utc,
      comment: r.comment,
      createdAtUtc: r.created_at_utc
    }));
  }

  /**
   * Retrieves worklogs logged on a specific YYYY-MM-DD date.
   */
  public getWorklogsByDate(dateString: string): WorklogRecord[] {
    if (!dateString) return this.getTodaysWorklogs();

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return [];

      const stmt = db.prepare<[string], {
        id: string;
        session_id: string;
        task_id: string;
        duration_seconds: number;
        started_at_utc: string;
        comment: string;
        created_at_utc: string;
      }>('SELECT * FROM worklogs WHERE strftime(\'%Y-%m-%d\', created_at_utc) = ? ORDER BY created_at_utc DESC');

      const rows = stmt.all(dateString);
      return rows.map(r => ({
        id: r.id,
        sessionId: r.session_id,
        taskId: r.task_id,
        durationSeconds: r.duration_seconds,
        startedAtUtc: r.started_at_utc,
        comment: r.comment,
        createdAtUtc: r.created_at_utc
      }));
    } catch (err) {
      console.warn(`[WorklogRepository] Failed to fetch worklogs for date ${dateString}:`, err);
      return [];
    }
  }

  /**
   * Generates a daily summary report of hours and tasks for a given YYYY-MM-DD date.
   */
  public getDailySummary(dateString: string): {
    date: string;
    totalSeconds: number;
    tasksCount: number;
    items: Array<{
      taskId: string;
      key: string;
      title: string;
      durationSeconds: number;
      comment: string;
    }>;
  } {
    const logs = this.getWorklogsByDate(dateString);
    let totalSeconds = 0;
    const taskMap = new Map<string, { taskId: string; key: string; title: string; durationSeconds: number; comment: string }>();

    for (const log of logs) {
      totalSeconds += log.durationSeconds;
      const existing = taskMap.get(log.taskId);
      if (existing) {
        existing.durationSeconds += log.durationSeconds;
        if (log.comment && !existing.comment.includes(log.comment)) {
          existing.comment += `; ${log.comment}`;
        }
      } else {
        taskMap.set(log.taskId, {
          taskId: log.taskId,
          key: log.taskId.split('_')[1] || log.taskId,
          title: log.comment || log.taskId,
          durationSeconds: log.durationSeconds,
          comment: log.comment
        });
      }
    }

    const items = Array.from(taskMap.values());
    return {
      date: dateString,
      totalSeconds,
      tasksCount: items.length,
      items
    };
  }
}
