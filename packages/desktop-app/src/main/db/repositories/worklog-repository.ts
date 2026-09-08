import { DatabaseConnection } from '../database-connection';
import { localDayBoundsUtc } from '../../../shared/local-date';

export interface WorklogRecord {
  id: string;
  sessionId: string;
  taskId: string;
  durationSeconds: number;
  startedAtUtc: string;
  comment: string;
  createdAtUtc: string;
}

export type SyncQueueStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

export interface SyncQueueRecord {
  id: string;
  providerId: string;
  taskId: string;
  durationSeconds: number;
  startedAtUtc: string;
  comment: string;
  createdAtUtc: string;
  retryCount: number;
  status: SyncQueueStatus;
  /** Earliest time this row may be retried; null means immediately. */
  nextAttemptAtUtc: string | null;
  /** When the current SYNCING claim was taken, for stale-claim recovery. */
  claimedAtUtc: string | null;
  /** Message from the most recent failed attempt. */
  lastError: string | null;
}

/** Raw column shape of a worklog_sync_queue row. */
interface SyncQueueRow {
  id: string;
  provider_id: string;
  task_id: string;
  duration_seconds: number;
  started_at_utc: string;
  comment: string;
  created_at_utc: string;
  retry_count: number;
  status: SyncQueueStatus;
  next_attempt_at_utc: string | null;
  claimed_at_utc: string | null;
  last_error: string | null;
}

function mapSyncQueueRow(r: SyncQueueRow): SyncQueueRecord {
  return {
    id: r.id,
    providerId: r.provider_id,
    taskId: r.task_id,
    durationSeconds: r.duration_seconds,
    startedAtUtc: r.started_at_utc,
    comment: r.comment,
    createdAtUtc: r.created_at_utc,
    retryCount: r.retry_count,
    status: r.status,
    nextAttemptAtUtc: r.next_attempt_at_utc,
    claimedAtUtc: r.claimed_at_utc,
    lastError: r.last_error
  };
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
   * The connection this repository reads and writes through.
   *
   * Exposed so a collaborator constructed as a fallback can bind to the *same*
   * database rather than silently resolving the DatabaseConnection singleton,
   * which opens a second, on-disk connection and deadlocks schema migrations.
   */
  public getConnection(): DatabaseConnection {
    return this.dbConn;
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
   * Pending rows that are due for an attempt now.
   *
   * Rows waiting out a backoff window are excluded, so a caller cannot retry
   * them early just by asking for the queue.
   */
  public getPendingQueueItems(nowUtc: string = new Date().toISOString()): SyncQueueRecord[] {
    const stmt = this.dbConn.getDb().prepare<[string], SyncQueueRow>(
      `SELECT * FROM worklog_sync_queue
        WHERE status = 'PENDING'
          AND (next_attempt_at_utc IS NULL OR next_attempt_at_utc <= ?)
        ORDER BY created_at_utc ASC`
    );
    return stmt.all(nowUtc).map(mapSyncQueueRow);
  }

  /**
   * Everything the sync panel needs in one read: counts by status, plus the
   * rows that have not been delivered.
   *
   * `SYNCED` rows are counted and not listed -- they are history, and the
   * point of the panel is what has *not* arrived. Ordered newest first because
   * a failure being diagnosed is almost always the most recent one.
   *
   * This exists because a worklog that never reached the provider was
   * indistinguishable from one that was never queued. Each row already carried
   * `last_error` and `retry_count`; nothing read them, so diagnosing a missing
   * worklog meant running the app from a terminal and reading the console.
   */
  public getSyncQueueSnapshot(limit: number = 50): {
    counts: { pending: number; syncing: number; synced: number; failed: number };
    items: SyncQueueRecord[];
  } {
    const db = this.dbConn.getDb();
    const counts = { pending: 0, syncing: 0, synced: 0, failed: 0 };

    const tallied = db
      .prepare<[], { status: SyncQueueStatus; total: number }>(
        'SELECT status, COUNT(*) AS total FROM worklog_sync_queue GROUP BY status'
      )
      .all();
    for (const row of tallied) {
      const key = row.status.toLowerCase() as keyof typeof counts;
      if (key in counts) counts[key] = row.total;
    }

    const items = db
      .prepare<[number], SyncQueueRow>(
        `SELECT * FROM worklog_sync_queue
          WHERE status <> 'SYNCED'
          ORDER BY created_at_utc DESC
          LIMIT ?`
      )
      .all(limit)
      .map(mapSyncQueueRow);

    return { counts, items };
  }

  /**
   * Atomically takes ownership of a pending row.
   *
   * The status check and the write are a single statement, so two concurrent
   * dispatchers cannot both win: only one transition out of PENDING can report
   * `changes === 1`. Returns the claimed row, or null if another dispatcher got
   * there first.
   *
   * This replaces a read-then-write pattern in which the sync worker and
   * ProviderManager each selected the same PENDING set and each POSTed it,
   * billing the same time to the provider twice.
   */
  public claimSyncItem(id: string, nowUtc: string = new Date().toISOString()): SyncQueueRecord | null {
    const db = this.dbConn.getDb();
    const result = db
      .prepare(
        `UPDATE worklog_sync_queue
            SET status = 'SYNCING', claimed_at_utc = ?
          WHERE id = ? AND status = 'PENDING'`
      )
      .run(nowUtc, id);

    if (result.changes !== 1) return null;

    const row = db
      .prepare<[string], SyncQueueRow>('SELECT * FROM worklog_sync_queue WHERE id = ?')
      .get(id);
    return row ? mapSyncQueueRow(row) : null;
  }

  /** Marks a claimed row as delivered. */
  public markSyncItemSynced(id: string): void {
    this.dbConn
      .getDb()
      .prepare(
        `UPDATE worklog_sync_queue
            SET status = 'SYNCED', claimed_at_utc = NULL, last_error = NULL
          WHERE id = ?`
      )
      .run(id);
  }

  /**
   * Parks a claimed row without spending the rest of its retry budget.
   *
   * For a failure that repeating cannot fix -- a revoked API key, a provider
   * with no credentials. The claim is released and the reason recorded, but
   * `retry_count` is left alone so that if the row is requeued the attempt
   * ceiling still means what it says.
   *
   * FAILED is not terminal: requeueFailedItems() returns these rows to PENDING,
   * and entering credentials is what triggers it.
   */
  public parkSyncItemAsFailed(id: string, errorMessage: string): void {
    this.dbConn
      .getDb()
      .prepare(
        `UPDATE worklog_sync_queue
            SET status = 'FAILED', claimed_at_utc = NULL, last_error = ?
          WHERE id = ?`
      )
      .run(errorMessage.slice(0, 500), id);
  }

  /**
   * Releases a claimed row after a failed attempt.
   *
   * Returns it to PENDING behind a backoff deadline until the attempt ceiling
   * is reached, at which point it parks as FAILED. FAILED is not terminal: a
   * migration requeues such rows on upgrade, and requeueFailedItems() does so
   * on demand.
   */
  public releaseSyncItemAfterFailure(
    id: string,
    errorMessage: string,
    backoffMs: number,
    maxAttempts: number,
    nowMs: number = Date.now()
  ): void {
    this.dbConn
      .getDb()
      .prepare(
        `UPDATE worklog_sync_queue
            SET retry_count = retry_count + 1,
                status = CASE WHEN retry_count + 1 >= ? THEN 'FAILED' ELSE 'PENDING' END,
                next_attempt_at_utc = ?,
                claimed_at_utc = NULL,
                last_error = ?
          WHERE id = ?`
      )
      .run(maxAttempts, new Date(nowMs + backoffMs).toISOString(), errorMessage.slice(0, 500), id);
  }

  /**
   * Returns rows stuck in SYNCING to PENDING.
   *
   * A claim is taken immediately before the network call and released after it,
   * so a row can only be left SYNCING if the process died in between. Without
   * this, that worklog would never be retried.
   *
   * Known limitation: if the provider accepted the worklog but the app died
   * before the row was marked SYNCED, reclaiming re-POSTs it. The OpenProject
   * v3 API offers no idempotency key, so the sync id is embedded in the comment
   * to make any duplicate identifiable afterwards.
   */
  public reclaimStaleSyncItems(timeoutMs: number, nowMs: number = Date.now()): number {
    const cutoff = new Date(nowMs - timeoutMs).toISOString();
    return this.dbConn
      .getDb()
      .prepare(
        `UPDATE worklog_sync_queue
            SET status = 'PENDING', claimed_at_utc = NULL
          WHERE status = 'SYNCING'
            AND (claimed_at_utc IS NULL OR claimed_at_utc <= ?)`
      )
      .run(cutoff).changes;
  }

  /** Returns parked FAILED rows to PENDING with their retry budget restored. */
  public requeueFailedItems(): number {
    return this.dbConn
      .getDb()
      .prepare(
        `UPDATE worklog_sync_queue
            SET status = 'PENDING', retry_count = 0, next_attempt_at_utc = NULL
          WHERE status = 'FAILED'`
      )
      .run().changes;
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
   * Increments retry count and sets status to FAILED only if maxRetries limit is reached.
   */
  public incrementRetryCount(id: string, maxRetries: number = 3): void {
    const stmt = this.dbConn.getDb().prepare(`
      UPDATE worklog_sync_queue
      SET retry_count = retry_count + 1,
          status = CASE WHEN retry_count + 1 >= ? THEN 'FAILED' ELSE 'PENDING' END
      WHERE id = ?
    `);

    stmt.run(maxRetries, id);
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
   *
   * The date is the user's local day. It used to be matched with strftime over
   * created_at_utc and no 'localtime' modifier, which grouped by the UTC day
   * instead -- so east of UTC anything logged before the offset appeared under
   * the previous day, and west of UTC an evening's work appeared under the next
   * one. See local-date.ts for why the bounds are computed in JavaScript rather
   * than in SQL.
   */
  public getWorklogsByDate(dateString: string): WorklogRecord[] {
    if (!dateString) return this.getTodaysWorklogs();

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return [];

      const stmt = db.prepare<[string, string], {
        id: string;
        session_id: string;
        task_id: string;
        duration_seconds: number;
        started_at_utc: string;
        comment: string;
        created_at_utc: string;
      }>(
        `SELECT * FROM worklogs
          WHERE created_at_utc >= ? AND created_at_utc < ?
          ORDER BY created_at_utc DESC`
      );

      // Half-open, so an entry exactly at local midnight belongs to the day
      // beginning then rather than the one ending.
      const { startUtc, endUtc } = localDayBoundsUtc(dateString);
      const rows = stmt.all(startUtc, endUtc);
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
