import Database from 'better-sqlite3';
import path from 'path';
import { runMigrations, LATEST_SCHEMA_VERSION } from './migrations';

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
    const defaultPath = path.join(defaultDir, 'sprintticker.db');
    this.db = new Database(dbPath || defaultPath);
    try {
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('journal_mode = WAL');
    } catch {
      // Memory databases or test instances skip WAL pragma safely
    }
    runMigrations(this.db);
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
   * Schema version currently applied to this database.
   *
   * Exposed for diagnostics and tests; the runner keeps it at
   * LATEST_SCHEMA_VERSION after a successful open.
   */
  public getSchemaVersion(): number {
    return this.db.pragma('user_version', { simple: true }) as number;
  }

  /** Schema version this build expects. */
  public static get latestSchemaVersion(): number {
    return LATEST_SCHEMA_VERSION;
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
