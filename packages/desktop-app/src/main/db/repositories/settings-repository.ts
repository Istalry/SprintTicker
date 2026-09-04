import { DatabaseConnection } from '../database-connection';

/**
 * Repository layer for key-value application settings persistence in SQLite.
 */
export class SettingsRepository {
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
   * Retrieves a setting value by key. Returns defaultVal if key is not found or DB connection is closed.
   */
  public getSetting<T>(key: string, defaultValue: T): T {
    if (!key) throw new Error('Setting key is required');

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) {
        return defaultValue;
      }

      const stmt = db.prepare<[string], { value: string }>(
        'SELECT value FROM settings WHERE key = ?'
      );
      const row = stmt.get(key);

      if (!row) return defaultValue;

      try {
        return JSON.parse(row.value) as T;
      } catch {
        return row.value as unknown as T;
      }
    } catch {
      return defaultValue;
    }
  }

  /**
   * Saves a setting value under key.
   */
  public setSetting<T>(key: string, value: T): void {
    if (!key) throw new Error('Setting key is required');

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return;

      const serialized = JSON.stringify(value);

      const stmt = db.prepare(`
        INSERT INTO settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `);

      stmt.run(key, serialized);
    } catch (err) {
      console.warn(`[SettingsRepository] Could not save setting ${key}:`, err);
    }
  }
}
