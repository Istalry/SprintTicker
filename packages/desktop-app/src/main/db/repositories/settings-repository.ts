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
   * Retrieves a setting value by key. Returns defaultVal if key is not found.
   */
  public getSetting<T>(key: string, defaultValue: T): T {
    if (!key) throw new Error('Setting key is required');

    const stmt = this.dbConn.getDb().prepare<[string], { value: string }>(
      'SELECT value FROM settings WHERE key = ?'
    );
    const row = stmt.get(key);

    if (!row) return defaultValue;

    try {
      return JSON.parse(row.value) as T;
    } catch {
      return row.value as unknown as T;
    }
  }

  /**
   * Saves a setting value under key.
   */
  public setSetting<T>(key: string, value: T): void {
    if (!key) throw new Error('Setting key is required');

    const serialized = typeof value === 'string' ? value : JSON.stringify(value);

    const stmt = this.dbConn.getDb().prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    stmt.run(key, serialized);
  }
}
