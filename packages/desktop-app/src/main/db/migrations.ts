import type Database from 'better-sqlite3';

/**
 * A single forward-only schema change.
 *
 * Migrations are append-only: once a version has shipped, its `up` is frozen.
 * Editing a released migration silently desynchronises every database that
 * already ran it, because the runner only replays versions above the stored
 * `PRAGMA user_version`.
 */
export interface Migration {
  /** Monotonic version. Must match the migration's position in MIGRATIONS. */
  readonly version: number;
  /** Human-readable label, used only in log output. */
  readonly name: string;
  /** Applies the change. Runs inside a transaction opened by the runner. */
  readonly up: (db: Database.Database) => void;
}

/**
 * Migration 1 is the schema as it existed before migrations were introduced,
 * reproduced verbatim. Every statement is `IF NOT EXISTS`, so a database
 * created by the old `initTables()` replays it as a no-op and lands on
 * version 1 with its data intact.
 */
const M001_INITIAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      provider_id TEXT NOT NULL DEFAULT 'local',
      created_at_utc TEXT NOT NULL
  );

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

/**
 * Migration 2 rebuilds `worklog_sync_queue`.
 *
 * SQLite cannot ALTER a CHECK constraint, and the queue needs a fourth state,
 * `SYNCING`, so one worker can claim a row atomically instead of two
 * dispatchers racing over the same PENDING set. It also gains
 * `next_attempt_at_utc` for exponential backoff, `claimed_at_utc` so a claim
 * left behind by a crash can be reclaimed, and `last_error` for diagnosis.
 *
 * The requeue of FAILED rows is the point of this migration. The old dispatcher
 * marked a row FAILED on its first network error with no path back, so any
 * worklog created while offline was stranded permanently: billable time the
 * user recorded and never received. Those rows return to PENDING with
 * retry_count reset, since otherwise the retry ceiling would re-fail them
 * immediately.
 */
function m002RebuildSyncQueue(db: Database.Database): void {
  db.exec(`
    CREATE TABLE worklog_sync_queue_v2 (
        id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        started_at_utc TEXT NOT NULL,
        comment TEXT NOT NULL,
        created_at_utc TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK(status IN ('PENDING', 'SYNCING', 'SYNCED', 'FAILED')),
        next_attempt_at_utc TEXT,
        claimed_at_utc TEXT,
        last_error TEXT
    );

    INSERT INTO worklog_sync_queue_v2 (
        id, provider_id, task_id, duration_seconds, started_at_utc, comment,
        created_at_utc, retry_count, status, next_attempt_at_utc, claimed_at_utc, last_error
    )
    SELECT
        id, provider_id, task_id, duration_seconds, started_at_utc, comment,
        created_at_utc,
        CASE WHEN status = 'FAILED' THEN 0 ELSE retry_count END,
        CASE WHEN status = 'FAILED' THEN 'PENDING' ELSE status END,
        NULL,
        NULL,
        NULL
    FROM worklog_sync_queue;

    DROP TABLE worklog_sync_queue;
    ALTER TABLE worklog_sync_queue_v2 RENAME TO worklog_sync_queue;
  `);
}

/**
 * Migration 3 adds the indexes the repository layer's queries already assume.
 * Each one backs a WHERE or ORDER BY that was running as a full table scan.
 */
const M003_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_tasks_project_id         ON tasks(project_id);
  CREATE INDEX IF NOT EXISTS idx_worklogs_task_id         ON worklogs(task_id);
  CREATE INDEX IF NOT EXISTS idx_worklogs_session_id      ON worklogs(session_id);
  CREATE INDEX IF NOT EXISTS idx_worklogs_created_at      ON worklogs(created_at_utc);
  CREATE INDEX IF NOT EXISTS idx_sync_queue_dispatch      ON worklog_sync_queue(status, next_attempt_at_utc);
  CREATE INDEX IF NOT EXISTS idx_paused_intervals_session ON paused_intervals(session_id);
  CREATE INDEX IF NOT EXISTS idx_active_sessions_status   ON active_sessions(status);
`;

/** Ordered, append-only migration list. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial-schema', up: db => db.exec(M001_INITIAL_SCHEMA) },
  { version: 2, name: 'sync-queue-claim-and-backoff', up: m002RebuildSyncQueue },
  { version: 3, name: 'query-indexes', up: db => db.exec(M003_INDEXES) }
];

/** Schema version a fully migrated database reports. */
export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/**
 * Applies every migration newer than the database's `user_version`.
 *
 * Each migration runs in its own transaction together with its version bump, so
 * an interrupted upgrade leaves the database on the last fully applied version
 * rather than in a half-migrated state. That guarantee depends on
 * `user_version` being transactional in SQLite, which it is.
 */
export function runMigrations(db: Database.Database): void {
  const currentVersion = db.pragma('user_version', { simple: true }) as number;

  if (currentVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Database schema version ${currentVersion} is newer than this build supports ` +
        `(${LATEST_SCHEMA_VERSION}). Refusing to open it, because an older build writing ` +
        `to a newer schema can corrupt data. Update the application instead.`
    );
  }

  const pending = MIGRATIONS.filter(m => m.version > currentVersion);
  if (pending.length === 0) return;

  console.log(
    `[Migrations] Upgrading schema ${currentVersion} -> ${LATEST_SCHEMA_VERSION} ` +
      `(${pending.length} migration(s) pending).`
  );

  for (const migration of pending) {
    const apply = db.transaction(() => {
      migration.up(db);
      // Interpolated, not bound: SQLite does not accept a parameter in a PRAGMA.
      db.pragma(`user_version = ${migration.version}`);
    });
    apply();
    console.log(`[Migrations] Applied ${migration.version}: ${migration.name}`);
  }
}
