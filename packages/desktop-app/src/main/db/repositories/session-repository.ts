import { DatabaseConnection } from '../database-connection';
import { ActiveSessionDTO } from '../../../shared/dtos';

/**
 * Repository layer for active time-tracking session state and paused interval persistence.
 */
export class SessionRepository {
  private dbConn: DatabaseConnection;

  constructor(dbConn?: DatabaseConnection) {
    this.dbConn = dbConn || DatabaseConnection.getInstance();
  }

  /**
   * Retrieves the currently active or paused tracking session.
   * Calculates accurate elapsed time using absolute UTC timestamps.
   */
  public getActiveSession(): ActiveSessionDTO | null {
    const stmt = this.dbConn.getDb().prepare<[], {
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
    }>('SELECT * FROM active_sessions WHERE status IN (\'TRACKING\', \'PAUSED\') ORDER BY start_time_utc DESC LIMIT 1');

    const row = stmt.get();
    if (!row) return null;

    const startTime = new Date(row.start_time_utc).getTime();
    const now = Date.now();
    let currentPauseDuration = 0;

    if (row.status === 'PAUSED' && row.last_pause_start_utc) {
      currentPauseDuration = Math.floor((now - new Date(row.last_pause_start_utc).getTime()) / 1000);
    }

    const effectivePausedSeconds = row.total_paused_seconds + currentPauseDuration;
    let elapsedSeconds = Math.floor((now - startTime) / 1000) - effectivePausedSeconds;
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
      totalPausedSeconds: effectivePausedSeconds,
      elapsedSeconds,
      lastPauseStartUtc: row.last_pause_start_utc || undefined
    };
  }

  /**
   * Creates a new tracking session.
   */
  public saveSession(session: Omit<ActiveSessionDTO, 'elapsedSeconds'>): void {
    if (!session.sessionId || !session.taskId || !session.projectId) {
      throw new Error('Session ID, Task ID, and Project ID are required');
    }

    const stmt = this.dbConn.getDb().prepare(`
      INSERT INTO active_sessions (
        id, project_id, task_id, task_key, task_title, is_ad_hoc, start_time_utc, status, total_paused_seconds, last_pause_start_utc
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        total_paused_seconds = excluded.total_paused_seconds,
        last_pause_start_utc = excluded.last_pause_start_utc
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
   * Updates status of an existing session.
   */
  public updateStatus(
    sessionId: string,
    status: 'TRACKING' | 'PAUSED' | 'COMPLETED',
    totalPausedSeconds: number,
    lastPauseStartUtc?: string
  ): void {
    const stmt = this.dbConn.getDb().prepare(`
      UPDATE active_sessions
      SET status = ?, total_paused_seconds = ?, last_pause_start_utc = ?
      WHERE id = ?
    `);

    stmt.run(status, totalPausedSeconds, lastPauseStartUtc || null, sessionId);
  }

  /**
   * Records a paused interval entry in paused_intervals table.
   */
  public recordPauseInterval(sessionId: string, pausedAtUtc: string, resumedAtUtc?: string): void {
    const stmt = this.dbConn.getDb().prepare(`
      INSERT INTO paused_intervals (session_id, paused_at_utc, resumed_at_utc)
      VALUES (?, ?, ?)
    `);

    stmt.run(sessionId, pausedAtUtc, resumedAtUtc || null);
  }
}
