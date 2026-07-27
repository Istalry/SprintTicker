import Database from 'better-sqlite3';
import path from 'path';
import { ActiveSessionDTO } from '../../shared/dtos';

/**
 * Service managing SQLite database storage, migrations, and CRUD operations
 * for session timestamps and offline worklog retry queues.
 */
export class DatabaseService {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(process.cwd(), 'antigravity-busybar.db');
    this.db = new Database(finalPath);
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  /**
   * Initializes database schema tables if they do not exist.
   */
  private initSchema(): void {
    const createActiveSessionsTable = `
      CREATE TABLE IF NOT EXISTS active_sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          task_key TEXT NOT NULL,
          task_title TEXT NOT NULL,
          is_ad_hoc INTEGER NOT NULL DEFAULT 0,
          start_time_utc TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('TRACKING', 'PAUSED', 'COMPLETED')),
          total_paused_seconds INTEGER NOT NULL DEFAULT 0,
          last_pause_start_utc TEXT
      );
    `;

    const createPausedIntervalsTable = `
      CREATE TABLE IF NOT EXISTS paused_intervals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          paused_at_utc TEXT NOT NULL,
          resumed_at_utc TEXT,
          FOREIGN KEY(session_id) REFERENCES active_sessions(id) ON DELETE CASCADE
      );
    `;

    const createWorklogSyncQueueTable = `
      CREATE TABLE IF NOT EXISTS worklog_sync_queue (
          id TEXT PRIMARY KEY,
          provider_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          duration_seconds INTEGER NOT NULL,
          started_at_utc TEXT NOT NULL,
          comment TEXT NOT NULL,
          created_at_utc TEXT NOT NULL,
          retry_count INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL CHECK(status IN ('PENDING', 'SYNCED', 'FAILED'))
      );
    `;

    this.db.exec(createActiveSessionsTable);
    this.db.exec(createPausedIntervalsTable);
    this.db.exec(createWorklogSyncQueueTable);
  }

  /**
   * Retrieves the current active or paused tracking session.
   */
  public getActiveSession(): ActiveSessionDTO | null {
    const stmt = this.db.prepare<[], {
      id: string;
      project_id: string;
      task_id: string;
      task_key: string;
      task_title: string;
      is_ad_hoc: number;
      start_time_utc: string;
      status: 'TRACKING' | 'PAUSED' | 'COMPLETED';
      total_paused_seconds: number;
      last_pause_start_utc: string | null;
    }>('SELECT * FROM active_sessions WHERE status IN (\'TRACKING\', \'PAUSED\') LIMIT 1');

    const row = stmt.get();
    if (!row) return null;

    const startTime = new Date(row.start_time_utc).getTime();
    const now = Date.now();
    let elapsedSeconds = Math.floor((now - startTime) / 1000) - row.total_paused_seconds;
    if (elapsedSeconds < 0) elapsedSeconds = 0;

    return {
      sessionId: row.id,
      projectId: row.project_id,
      taskId: row.task_id,
      taskKey: row.task_key,
      taskTitle: row.task_title,
      isAdHoc: Boolean(row.is_ad_hoc),
      status: row.status,
      startTimeUtc: row.start_time_utc,
      totalPausedSeconds: row.total_paused_seconds,
      elapsedSeconds,
      lastPauseStartUtc: row.last_pause_start_utc || undefined
    };
  }

  /**
   * Inserts a new active tracking session into SQLite.
   */
  public createSession(session: Omit<ActiveSessionDTO, 'elapsedSeconds'>): void {
    if (!session.sessionId || !session.taskId || !session.projectId) {
      throw new Error('Session ID, Task ID, and Project ID are required');
    }

    const stmt = this.db.prepare(`
      INSERT INTO active_sessions (
        id, project_id, task_id, task_key, task_title, is_ad_hoc, start_time_utc, status, total_paused_seconds, last_pause_start_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      session.sessionId,
      session.projectId,
      session.taskId,
      session.taskKey,
      session.taskTitle,
      session.isAdHoc ? 1 : 0,
      session.startTimeUtc,
      session.status,
      session.totalPausedSeconds,
      session.lastPauseStartUtc || null
    );
  }

  /**
   * Updates an existing session's status and paused duration.
   */
  public updateSessionStatus(
    sessionId: string,
    status: 'TRACKING' | 'PAUSED' | 'COMPLETED',
    totalPausedSeconds: number,
    lastPauseStartUtc?: string
  ): void {
    const stmt = this.db.prepare(`
      UPDATE active_sessions 
      SET status = ?, total_paused_seconds = ?, last_pause_start_utc = ?
      WHERE id = ?
    `);

    stmt.run(status, totalPausedSeconds, lastPauseStartUtc || null, sessionId);
  }

  /**
   * Adds an entry to the worklog sync queue.
   */
  public enqueueWorklog(payload: {
    id: string;
    providerId: string;
    taskId: string;
    durationSeconds: number;
    startedAtUtc: string;
    comment: string;
  }): void {
    const stmt = this.db.prepare(`
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
   * Retrieves pending items from the worklog sync queue.
   */
  public getPendingWorklogs(): Array<{
    id: string;
    provider_id: string;
    task_id: string;
    duration_seconds: number;
    started_at_utc: string;
    comment: string;
    created_at_utc: string;
    retry_count: number;
    status: string;
  }> {
    const stmt = this.db.prepare<[], {
      id: string;
      provider_id: string;
      task_id: string;
      duration_seconds: number;
      started_at_utc: string;
      comment: string;
      created_at_utc: string;
      retry_count: number;
      status: string;
    }>('SELECT * FROM worklog_sync_queue WHERE status = \'PENDING\'');

    return stmt.all();
  }

  /**
   * Closes the database connection.
   */
  public close(): void {
    this.db.close();
  }
}
