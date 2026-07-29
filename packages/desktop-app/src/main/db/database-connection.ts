import Database from 'better-sqlite3';
import path from 'path';

/**
 * Singleton database connection wrapper managing SQLite database lifecycle,
 * pragma settings, and schema migrations.
 */
export class DatabaseConnection {
  private static instance: DatabaseConnection | null = null;
  private db: Database.Database;

  constructor(dbPath?: string) {
    let defaultDir = process.cwd();
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const electron = require('electron');
      if (electron?.app?.getPath) {
        defaultDir = electron.app.getPath('userData');
      }
    } catch {
      // Not running in Electron environment
    }
    const defaultPath = path.join(defaultDir, 'antigravity-busybar.db');
    this.db = new Database(dbPath || defaultPath);
    try {
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('journal_mode = WAL');
    } catch {
      // Memory databases or test instances skip WAL pragma safely
    }
    this.initTables();
  }

  public static getInstance(dbPath?: string): DatabaseConnection {
    if (!DatabaseConnection.instance) {
      DatabaseConnection.instance = new DatabaseConnection(dbPath);
    }
    return DatabaseConnection.instance;
  }

  public static resetInstance(): void {
    if (DatabaseConnection.instance) {
      DatabaseConnection.instance.close();
      DatabaseConnection.instance = null;
    }
  }

  public getDb(): Database.Database {
    return this.db;
  }

  /**
   * Initializes all required database tables matching technical specifications.
   */
  private initTables(): void {
    const schemaSql = `
      CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          key TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          provider_id TEXT NOT NULL DEFAULT 'local',
          created_at_utc TEXT NOT NULL
      );

      INSERT OR IGNORE INTO projects (id, key, name, provider_id, created_at_utc)
      VALUES
        ('PROJ', 'PROJ', 'Default Project', 'jira', datetime('now')),
        ('UNITY', 'UNITY', 'Unity Engine Project', 'local', datetime('now')),
        ('ADMIN', 'ADMIN', 'Administrative Overhead', 'local', datetime('now'));

      CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          key TEXT NOT NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('todo', 'in_progress', 'done')),
          created_at_utc TEXT NOT NULL
      );

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

      CREATE TABLE IF NOT EXISTS paused_intervals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          paused_at_utc TEXT NOT NULL,
          resumed_at_utc TEXT,
          FOREIGN KEY(session_id) REFERENCES active_sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS worklogs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          duration_seconds INTEGER NOT NULL,
          started_at_utc TEXT NOT NULL,
          comment TEXT NOT NULL,
          created_at_utc TEXT NOT NULL
      );

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

      CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
      );
    `;

    this.db.exec(schemaSql);
  }

  public close(): void {
    if (this.db && this.db.open) {
      this.db.close();
    }
  }

  public wipeAllData(): void {
    if (!this.db || !this.db.open) return;

    this.db.exec(`
      DELETE FROM worklog_sync_queue;
      DELETE FROM worklogs;
      DELETE FROM paused_intervals;
      DELETE FROM active_sessions;
      DELETE FROM tasks;
      DELETE FROM projects;
    `);
  }
}
