import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { runMigrations, MIGRATIONS, LATEST_SCHEMA_VERSION } from '../src/main/db/migrations';

/**
 * The pre-migration schema, exactly as the old `initTables()` produced it.
 * Used to simulate a database created by a build that shipped before
 * migrations existed, so the upgrade path is exercised rather than assumed.
 */
const LEGACY_SCHEMA = `
  CREATE TABLE projects (
      id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      provider_id TEXT NOT NULL DEFAULT 'local', created_at_utc TEXT NOT NULL
  );
  CREATE TABLE tasks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('todo', 'in_progress', 'done')),
      created_at_utc TEXT NOT NULL
  );
  CREATE TABLE active_sessions (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, task_id TEXT NOT NULL,
      task_key TEXT NOT NULL, task_title TEXT NOT NULL, is_ad_hoc INTEGER NOT NULL DEFAULT 0,
      start_time_utc TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('TRACKING', 'PAUSED', 'COMPLETED')),
      total_paused_seconds INTEGER NOT NULL DEFAULT 0, last_pause_start_utc TEXT
  );
  CREATE TABLE paused_intervals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
      paused_at_utc TEXT NOT NULL, resumed_at_utc TEXT,
      FOREIGN KEY(session_id) REFERENCES active_sessions(id) ON DELETE CASCADE
  );
  CREATE TABLE worklogs (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, task_id TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL, started_at_utc TEXT NOT NULL,
      comment TEXT NOT NULL, created_at_utc TEXT NOT NULL
  );
  CREATE TABLE worklog_sync_queue (
      id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, task_id TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL, started_at_utc TEXT NOT NULL,
      comment TEXT NOT NULL, created_at_utc TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK(status IN ('PENDING', 'SYNCED', 'FAILED'))
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

function enqueue(
  db: Database.Database,
  id: string,
  status: 'PENDING' | 'SYNCED' | 'FAILED',
  retryCount = 0
): void {
  db.prepare(
    `INSERT INTO worklog_sync_queue
       (id, provider_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc, retry_count, status)
     VALUES (?, 'openproject', 'TASK-1', 900, '2026-01-01T09:00:00.000Z', 'work', '2026-01-01T09:15:00.000Z', ?, ?)`
  ).run(id, retryCount, status);
}

describe('Schema Migrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
  });

  afterEach(() => {
    if (db.open) db.close();
  });

  it('MigrationVersions_AreContiguousAndAscendingFromOne', () => {
    // An out-of-order or duplicated version silently skips a migration,
    // because the runner filters on `version > user_version`.
    MIGRATIONS.forEach((m, i) => expect(m.version).toBe(i + 1));
    expect(LATEST_SCHEMA_VERSION).toBe(MIGRATIONS.length);
  });

  it('RunMigrations_FreshDatabase_CreatesEverySchemaObjectAndStampsVersion', () => {
    runMigrations(db);

    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);

    const tables = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map(r => r.name);

    for (const expected of [
      'projects',
      'tasks',
      'active_sessions',
      'paused_intervals',
      'worklogs',
      'worklog_sync_queue',
      'settings'
    ]) {
      expect(tables).toContain(expected);
    }
  });

  it('RunMigrations_AlreadyMigrated_IsIdempotent', () => {
    runMigrations(db);
    const first = db.pragma('user_version', { simple: true });

    // Running again must not rebuild the queue table or throw on existing objects.
    expect(() => runMigrations(db)).not.toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(first);
  });

  it('RunMigrations_LegacyDatabase_PreservesExistingRows', () => {
    // Arrange: a database as an already-shipped build left it -- tables present,
    // user_version still 0.
    db.exec(LEGACY_SCHEMA);
    db.prepare(
      "INSERT INTO projects (id, key, name, provider_id, created_at_utc) VALUES ('p1', 'PROJ', 'Project', 'local', '2026-01-01T00:00:00.000Z')"
    ).run();
    expect(db.pragma('user_version', { simple: true })).toBe(0);

    // Act
    runMigrations(db);

    // Assert: upgraded in place, data intact.
    expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION);
    const project = db.prepare<[], { name: string }>("SELECT name FROM projects WHERE id = 'p1'").get();
    expect(project?.name).toBe('Project');
  });

  it('Migration002_RequeuesStrandedFailedRows_AndResetsTheirRetryCount', () => {
    // This is the recovery the migration exists for: the old dispatcher marked a
    // row FAILED on its first network error with no path back, stranding
    // billable time the user had already recorded.
    db.exec(LEGACY_SCHEMA);
    enqueue(db, 'stranded', 'FAILED', 1);
    enqueue(db, 'waiting', 'PENDING', 0);
    enqueue(db, 'delivered', 'SYNCED', 0);

    runMigrations(db);

    const rows = db
      .prepare<[], { id: string; status: string; retry_count: number }>(
        'SELECT id, status, retry_count FROM worklog_sync_queue ORDER BY id'
      )
      .all();
    const byId = Object.fromEntries(rows.map(r => [r.id, r]));

    // Requeued, with the retry counter cleared so the ceiling does not
    // immediately re-fail it.
    expect(byId.stranded.status).toBe('PENDING');
    expect(byId.stranded.retry_count).toBe(0);

    // Rows in other states are untouched.
    expect(byId.waiting.status).toBe('PENDING');
    expect(byId.delivered.status).toBe('SYNCED');
  });

  it('Migration002_AddsSyncingStateAndBackoffColumns', () => {
    runMigrations(db);

    const columns = db
      .prepare<[], { name: string }>('PRAGMA table_info(worklog_sync_queue)')
      .all()
      .map(c => c.name);
    expect(columns).toContain('next_attempt_at_utc');
    expect(columns).toContain('claimed_at_utc');
    expect(columns).toContain('last_error');

    // SYNCING must satisfy the rebuilt CHECK constraint; the old one rejected it.
    enqueue(db, 'claimable', 'PENDING');
    expect(() =>
      db.prepare("UPDATE worklog_sync_queue SET status = 'SYNCING' WHERE id = 'claimable'").run()
    ).not.toThrow();

    expect(() =>
      db.prepare("UPDATE worklog_sync_queue SET status = 'NONSENSE' WHERE id = 'claimable'").run()
    ).toThrow();
  });

  it('Migration003_CreatesTheDispatchIndex', () => {
    runMigrations(db);

    const indexes = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all()
      .map(r => r.name);
    expect(indexes).toContain('idx_sync_queue_dispatch');
    expect(indexes).toContain('idx_tasks_project_id');
  });

  it('RunMigrations_DatabaseFromNewerBuild_RefusesToOpen', () => {
    // Letting an older build write to a newer schema is how data gets corrupted.
    db.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    expect(() => runMigrations(db)).toThrow(/newer than this build supports/);
  });

  it('DatabaseConnection_NewConnection_ReportsLatestSchemaVersion', () => {
    const conn = new DatabaseConnection(':memory:');
    try {
      expect(conn.getSchemaVersion()).toBe(LATEST_SCHEMA_VERSION);
      expect(DatabaseConnection.latestSchemaVersion).toBe(LATEST_SCHEMA_VERSION);
    } finally {
      conn.close();
    }
  });
});
