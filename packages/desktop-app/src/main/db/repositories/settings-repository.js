import { DatabaseConnection } from '../database-connection';
/**
 * Repository layer for key-value application settings persistence in SQLite.
 */
export class SettingsRepository {
    dbConn;
    constructor(dbConn) {
        this.dbConn = dbConn || DatabaseConnection.getInstance();
    }
    /**
     * Retrieves a setting value by key. Returns defaultVal if key is not found.
     */
    getSetting(key, defaultValue) {
        if (!key)
            throw new Error('Setting key is required');
        const stmt = this.dbConn.getDb().prepare('SELECT value FROM settings WHERE key = ?');
        const row = stmt.get(key);
        if (!row)
            return defaultValue;
        try {
            return JSON.parse(row.value);
        }
        catch {
            return row.value;
        }
    }
    /**
     * Saves a setting value under key.
     */
    setSetting(key, value) {
        if (!key)
            throw new Error('Setting key is required');
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        const stmt = this.dbConn.getDb().prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
        stmt.run(key, serialized);
    }
}
//# sourceMappingURL=settings-repository.js.map