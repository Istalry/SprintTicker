import type Database from 'better-sqlite3';
import { createId, IdPrefix } from './id-generator';

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

/**
 * Migration 4 gives a task the provider's priority, as a rank (0 most urgent).
 *
 * Nullable with no default: existing rows have no priority until the next sync
 * brings one, and a local task never has one. Adding a nullable column rewrites
 * nothing, so this is safe on a database with history in it.
 */
const M004_TASK_PRIORITY = `
  ALTER TABLE tasks ADD COLUMN priority_rank INTEGER;
`;

/**
 * Where a tombstone task goes when nothing records its project. Not a real
 * project row: `tasks.project_id` has no foreign key, and an archived task is
 * listed under no project anyway.
 */
export const TOMBSTONE_PROJECT_ID = 'ARCHIVED';

/**
 * Migration 5 makes `worklogs.task_id` a foreign key to `tasks`.
 *
 * It could not simply be declared: the sync prune and project deletion had
 * already deleted tasks that surviving worklogs reference (audit F-01, F-25),
 * so a constraint alone would refuse to rebuild the table on exactly the
 * databases with the most history. Those orphans get a **tombstone** -- an
 * archived task row -- instead of being dropped, because a worklog is billable
 * time the user recorded and losing it to a schema change would be the worst
 * outcome available here.
 *
 * A tombstone is named from the session its worklog came from, since
 * `active_sessions` kept the key and title the bar showed; the task id stands
 * in only when that session is gone too.
 *
 * `archived_at_utc` is what hides a row from the task lists while history can
 * still name it. From here on a task with worklogs is archived rather than
 * deleted, and the constraint -- `NO ACTION` on delete -- is what makes a path
 * that forgets fail loudly rather than orphan history again.
 */
function m005WorklogTaskForeignKey(db: Database.Database): void {
  const now = new Date().toISOString();
  db.exec('ALTER TABLE tasks ADD COLUMN archived_at_utc TEXT;');

  db.prepare(`
    INSERT INTO tasks (id, project_id, key, title, status, created_at_utc, archived_at_utc)
    SELECT
        o.task_id,
        COALESCE(s.project_id, ?),
        COALESCE(s.task_key, o.task_id),
        COALESCE(s.task_title, o.task_id),
        'done',
        o.first_logged_at,
        ?
    FROM (
        SELECT task_id, MIN(created_at_utc) AS first_logged_at
        FROM worklogs
        WHERE task_id NOT IN (SELECT id FROM tasks)
        GROUP BY task_id
    ) o
    LEFT JOIN active_sessions s ON s.id = (
        SELECT w.session_id FROM worklogs w
        JOIN active_sessions ws ON ws.id = w.session_id
        WHERE w.task_id = o.task_id
        ORDER BY w.created_at_utc DESC
        LIMIT 1
    )
  `).run(TOMBSTONE_PROJECT_ID, now);

  db.exec(`
    CREATE TABLE worklogs_v2 (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL,
        started_at_utc TEXT NOT NULL,
        comment TEXT NOT NULL,
        created_at_utc TEXT NOT NULL,
        FOREIGN KEY(task_id) REFERENCES tasks(id)
    );

    INSERT INTO worklogs_v2 (id, session_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc)
    SELECT id, session_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc
    FROM worklogs;

    DROP TABLE worklogs;
    ALTER TABLE worklogs_v2 RENAME TO worklogs;

    -- Dropped with the old table; the same three as migration 3.
    CREATE INDEX idx_worklogs_task_id    ON worklogs(task_id);
    CREATE INDEX idx_worklogs_session_id ON worklogs(session_id);
    CREATE INDEX idx_worklogs_created_at ON worklogs(created_at_utc);
    CREATE INDEX idx_tasks_archived      ON tasks(project_id, archived_at_utc);
  `);
}

/** Comment on the worklog migration 6 writes for a session it had to close. */
export const RECOVERED_SESSION_COMMENT =
  'Recovered: this session was never stopped. Closed where the next session began; not sent to the provider.';

interface OpenSessionRow {
  id: string;
  project_id: string;
  task_id: string;
  task_key: string;
  task_title: string;
  start_time_utc: string;
  status: 'TRACKING' | 'PAUSED';
  total_paused_seconds: number;
  last_pause_start_utc: string | null;
}

/**
 * Migration 6 allows at most one open session -- `TRACKING` or `PAUSED` -- with
 * a partial unique index.
 *
 * The engine has always meant there to be one: starting a task stops the
 * current session first, and `getActiveSession` reads only the newest open
 * row. But nothing enforced it (audit F-25), so a crash or a race between the
 * two could leave an older row open. That row was invisible from then on --
 * never shown, never stopped, its time never logged.
 *
 * The index would refuse to build over such rows, which is why it waited for
 * a repair: every open session but the newest -- the one the app already
 * shows -- is closed where the next session began, the latest it can have
 * run, and its time is written as a local worklog saying so. Not queued for
 * the provider: the end is inferred, and sending an inferred duration to a
 * timesheet is a decision for the user, who can see it in history.
 *
 * The SQL that names a missing task repeats `TaskRepository.ensureTaskExists`
 * on purpose. A migration is frozen once shipped, so it must not call code
 * that may change after it.
 */
function m006OneOpenSession(db: Database.Database): void {
  const open = db
    .prepare<[], OpenSessionRow>(
      `SELECT id, project_id, task_id, task_key, task_title, start_time_utc, status,
              total_paused_seconds, last_pause_start_utc
       FROM active_sessions
       WHERE status IN ('TRACKING', 'PAUSED')
       ORDER BY start_time_utc DESC, rowid DESC`
    )
    .all();

  const nextStart = db.prepare<[string, string], { start_time_utc: string }>(
    `SELECT start_time_utc FROM active_sessions
     WHERE start_time_utc >= ? AND id <> ?
     ORDER BY start_time_utc ASC LIMIT 1`
  );
  const close = db.prepare(
    "UPDATE active_sessions SET status = 'COMPLETED', total_paused_seconds = ?, last_pause_start_utc = NULL WHERE id = ?"
  );
  const ensureTask = db.prepare(`
    INSERT INTO tasks (id, project_id, key, title, status, created_at_utc, archived_at_utc)
    VALUES (?, ?, ?, ?, 'done', ?, ?)
    ON CONFLICT(id) DO NOTHING
  `);
  const log = db.prepare(`
    INSERT INTO worklogs (id, session_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  // The first row is the newest, the one getActiveSession returns: it stays open.
  for (const session of open.slice(1)) {
    const endIso = nextStart.get(session.start_time_utc, session.id)!.start_time_utc;
    const end = Date.parse(endIso);
    const openPause =
      session.status === 'PAUSED' && session.last_pause_start_utc
        ? Math.max(0, Math.floor((end - Date.parse(session.last_pause_start_utc)) / 1000))
        : 0;
    const paused = session.total_paused_seconds + openPause;
    const seconds = Math.max(0, Math.floor((end - Date.parse(session.start_time_utc)) / 1000) - paused);

    close.run(paused, session.id);
    ensureTask.run(session.task_id, session.project_id, session.task_key, session.task_title, now, now);
    log.run(createId(IdPrefix.WORKLOG), session.id, session.task_id, seconds, session.start_time_utc, RECOVERED_SESSION_COMMENT, endIso);
  }

  if (open.length > 1) {
    console.warn(`[Migrations] Closed ${open.length - 1} session(s) left open behind the current one; their time is in history.`);
  }

  db.exec(`
    CREATE UNIQUE INDEX idx_active_sessions_one_open
      ON active_sessions((1))
      WHERE status IN ('TRACKING', 'PAUSED');
  `);
}

/** Ordered, append-only migration list. */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial-schema', up: db => db.exec(M001_INITIAL_SCHEMA) },
  { version: 2, name: 'sync-queue-claim-and-backoff', up: m002RebuildSyncQueue },
  { version: 3, name: 'query-indexes', up: db => db.exec(M003_INDEXES) },
  { version: 4, name: 'task-priority-rank', up: db => db.exec(M004_TASK_PRIORITY) },
  { version: 5, name: 'worklog-task-foreign-key', up: m005WorklogTaskForeignKey },
  { version: 6, name: 'one-open-session', up: m006OneOpenSession }
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
