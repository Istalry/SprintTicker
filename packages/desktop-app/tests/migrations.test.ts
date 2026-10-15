import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { runMigrations, MIGRATIONS, LATEST_SCHEMA_VERSION, TOMBSTONE_PROJECT_ID, RECOVERED_SESSION_COMMENT } from '../src/main/db/migrations';

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

  it('Migration004_TasksFromBefore_KeepTheirDataWithNoPriority', () => {
    // Stop at version 3, write a task as that build would, then upgrade.
    for (const migration of MIGRATIONS.filter(m => m.version <= 3)) migration.up(db);
    db.pragma('user_version = 3');
    db.prepare(
      "INSERT INTO tasks (id, project_id, key, title, status, created_at_utc) VALUES ('t1', 'p1', 'A-1', 'Kept', 'todo', '2026-01-01T00:00:00.000Z')"
    ).run();

    runMigrations(db);

    const row = db.prepare<[], { title: string; priority_rank: number | null }>(
      "SELECT title, priority_rank FROM tasks WHERE id = 't1'"
    ).get();
    expect(row).toEqual({ title: 'Kept', priority_rank: null });
  });

  it('Migration007_TasksFromBefore_HaveNoDescriptionUntilTheNextSync', () => {
    for (const migration of MIGRATIONS.filter(m => m.version <= 6)) migration.up(db);
    db.pragma('user_version = 6');
    db.prepare(
      "INSERT INTO tasks (id, project_id, key, title, status, created_at_utc) VALUES ('t1', 'p1', 'A-1', 'Kept', 'todo', '2026-01-01T00:00:00.000Z')"
    ).run();

    runMigrations(db);

    expect(db.prepare("SELECT title, description FROM tasks WHERE id = 't1'").get()).toEqual({ title: 'Kept', description: null });
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

  describe('migration 5: worklogs reference their task', () => {
    /** A version-4 database, as the build before this one leaves it. */
    function atVersion4(): void {
      for (const migration of MIGRATIONS.filter(m => m.version <= 4)) migration.up(db);
      db.pragma('user_version = 4');
    }

    function session(id: string, taskId: string, key: string, title: string): void {
      db.prepare(
        `INSERT INTO active_sessions (id, project_id, task_id, task_key, task_title, start_time_utc, status)
         VALUES (?, 'P9', ?, ?, ?, '2026-03-01T09:00:00.000Z', 'COMPLETED')`
      ).run(id, taskId, key, title);
    }

    function worklog(id: string, sessionId: string, taskId: string, createdAt = '2026-03-01T10:00:00.000Z'): void {
      db.prepare(
        `INSERT INTO worklogs (id, session_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc)
         VALUES (?, ?, ?, 900, '2026-03-01T09:00:00.000Z', 'work', ?)`
      ).run(id, sessionId, taskId, createdAt);
    }

    const task = (id: string) =>
      db.prepare<[string], { project_id: string; key: string; title: string; archived_at_utc: string | null }>(
        'SELECT project_id, key, title, archived_at_utc FROM tasks WHERE id = ?'
      ).get(id);

    it('Migration005_WorklogOfADeletedTask_KeepsItsTimeUnderANamedArchivedTask', () => {
      // The sync prune deleted tasks that worklogs still referenced. The
      // session that produced the worklog kept the name the bar showed.
      atVersion4();
      session('s1', '10001', 'SCRUM-2', 'Fix the login');
      worklog('w1', 's1', '10001');

      runMigrations(db);

      expect(task('10001')).toMatchObject({ project_id: 'P9', key: 'SCRUM-2', title: 'Fix the login' });
      expect(task('10001')?.archived_at_utc).not.toBeNull();
      expect(db.prepare('SELECT COUNT(*) AS n FROM worklogs').get()).toEqual({ n: 1 });
    });

    it('Migration005_OrphanWithNoSessionEither_IsStillKept', () => {
      atVersion4();
      worklog('w1', 'gone-session', 'lost-task');

      runMigrations(db);

      expect(task('lost-task')).toMatchObject({ project_id: TOMBSTONE_PROJECT_ID, key: 'lost-task', title: 'lost-task' });
      expect(db.prepare('SELECT id FROM worklogs').all()).toEqual([{ id: 'w1' }]);
    });

    it('Migration005_TaskRenamedBetweenSessions_TakesTheLatestName', () => {
      atVersion4();
      session('s1', '10001', 'SCRUM-2', 'Old title');
      session('s2', '10001', 'SCRUM-2', 'New title');
      worklog('w1', 's1', '10001', '2026-03-01T10:00:00.000Z');
      worklog('w2', 's2', '10001', '2026-03-02T10:00:00.000Z');

      runMigrations(db);

      expect(task('10001')?.title).toBe('New title');
    });

    it('Migration005_TaskThatStillExists_IsLeftAsItWas', () => {
      atVersion4();
      db.prepare(
        "INSERT INTO tasks (id, project_id, key, title, status, created_at_utc) VALUES ('t1', 'p1', 'A-1', 'Live', 'todo', '2026-01-01T00:00:00.000Z')"
      ).run();
      worklog('w1', 's1', 't1');

      runMigrations(db);

      expect(task('t1')).toEqual({ project_id: 'p1', key: 'A-1', title: 'Live', archived_at_utc: null });
    });

    it('Migration005_FromThenOn_TheConstraintHolds', () => {
      // `NO ACTION` on delete: a path that forgets to archive fails loudly
      // instead of orphaning history again.
      db.pragma('foreign_keys = ON');
      atVersion4();
      worklog('w1', 's1', 'orphan');
      runMigrations(db);

      expect(() => worklog('w2', 's1', 'never-existed')).toThrow(/FOREIGN KEY/);
      expect(() => db.prepare("DELETE FROM tasks WHERE id = 'orphan'").run()).toThrow(/FOREIGN KEY/);
    });

    it('Migration005_RebuiltTable_KeepsItsIndexes', () => {
      runMigrations(db);

      const indexes = db
        .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'worklogs'")
        .all()
        .map(r => r.name);
      expect(indexes).toEqual(expect.arrayContaining(['idx_worklogs_task_id', 'idx_worklogs_session_id', 'idx_worklogs_created_at']));
    });
  });

  describe('migration 6: at most one open session', () => {
    /** A version-5 database, as the build before this one leaves it. */
    function atVersion5(): void {
      for (const migration of MIGRATIONS.filter(m => m.version <= 5)) migration.up(db);
      db.pragma('user_version = 5');
      db.prepare(
        "INSERT INTO tasks (id, project_id, key, title, status, created_at_utc) VALUES ('t1', 'P1', 'A-1', 'Task', 'todo', '2026-01-01T00:00:00.000Z')"
      ).run();
    }

    function open(id: string, start: string, extra: { status?: string; taskId?: string; paused?: number; pauseStart?: string } = {}): void {
      db.prepare(
        `INSERT INTO active_sessions (id, project_id, task_id, task_key, task_title, start_time_utc, status, total_paused_seconds, last_pause_start_utc)
         VALUES (?, 'P1', ?, 'K-1', 'Named in the session', ?, ?, ?, ?)`
      ).run(id, extra.taskId ?? 't1', start, extra.status ?? 'TRACKING', extra.paused ?? 0, extra.pauseStart ?? null);
    }

    const status = (id: string) =>
      db.prepare<[string], { status: string }>('SELECT status FROM active_sessions WHERE id = ?').get(id)?.status;
    const recovered = () =>
      db
        .prepare<[string], { session_id: string; duration_seconds: number; created_at_utc: string }>(
          'SELECT session_id, duration_seconds, created_at_utc FROM worklogs WHERE comment = ?'
        )
        .all(RECOVERED_SESSION_COMMENT);

    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => vi.restoreAllMocks());

    it('Migration006_OlderSessionLeftOpen_IsClosedWhereTheNextBeganAndItsTimeKept', () => {
      // The newer one is what the app shows and resumes; the older one was
      // invisible, never stopped, and its time never logged.
      atVersion5();
      open('old', '2026-03-01T09:00:00.000Z');
      open('new', '2026-03-01T10:00:00.000Z');

      runMigrations(db);

      expect(status('old')).toBe('COMPLETED');
      expect(status('new')).toBe('TRACKING');
      expect(recovered()).toEqual([{ session_id: 'old', duration_seconds: 3600, created_at_utc: '2026-03-01T10:00:00.000Z' }]);
    });

    it('Migration006_OlderSessionPaused_CountsThePauseUpToTheNextStart', () => {
      // 60 minutes open, 10 already paused, and paused again for the last 20.
      atVersion5();
      open('old', '2026-03-01T09:00:00.000Z', { status: 'PAUSED', paused: 600, pauseStart: '2026-03-01T09:40:00.000Z' });
      open('new', '2026-03-01T10:00:00.000Z');

      runMigrations(db);

      expect(recovered()[0].duration_seconds).toBe(1800);
    });

    it('Migration006_OlderSessionsTaskIsGone_NamesItFromTheSession', () => {
      // The worklog needs a task row under the foreign key from migration 5.
      db.pragma('foreign_keys = ON');
      atVersion5();
      open('old', '2026-03-01T09:00:00.000Z', { taskId: 'pruned' });
      open('new', '2026-03-01T10:00:00.000Z');

      runMigrations(db);

      expect(db.prepare("SELECT key, title FROM tasks WHERE id = 'pruned'").get()).toEqual({ key: 'K-1', title: 'Named in the session' });
      expect(recovered()).toHaveLength(1);
    });

    it('Migration006_OneOpenSession_IsLeftRunning', () => {
      atVersion5();
      open('only', '2026-03-01T09:00:00.000Z');

      runMigrations(db);

      expect(status('only')).toBe('TRACKING');
      expect(recovered()).toEqual([]);
    });

    it('Migration006_FromThenOn_ASecondOpenSessionIsRefused', () => {
      atVersion5();
      open('first', '2026-03-01T09:00:00.000Z');
      runMigrations(db);

      expect(() => open('second', '2026-03-01T10:00:00.000Z', { status: 'PAUSED' })).toThrow(/UNIQUE/);
      db.prepare("UPDATE active_sessions SET status = 'COMPLETED' WHERE id = 'first'").run();
      expect(() => open('second', '2026-03-01T10:00:00.000Z')).not.toThrow();
    });
  });

  describe('migration 8: a queued send knows its worklog', () => {
    /** A version-7 database with one task, as the build before this one leaves it. */
    function atVersion7(): void {
      for (const migration of MIGRATIONS.filter(m => m.version <= 7)) migration.up(db);
      db.pragma('user_version = 7');
      db.prepare(
        "INSERT INTO tasks (id, project_id, key, title, status, created_at_utc) VALUES ('t1', 'P1', 'A-1', 'Task', 'todo', '2026-01-01T00:00:00.000Z')"
      ).run();
    }

    /** A worklog and, when `queued`, the row the engine wrote beside it: same task, start and duration. */
    function stopped(worklogId: string, start: string, seconds: number, queueId?: string): void {
      db.prepare(
        `INSERT INTO worklogs (id, session_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc)
         VALUES (?, 's1', 't1', ?, ?, 'work', ?)`
      ).run(worklogId, seconds, start, start);
      if (queueId) queued(queueId, start, seconds);
    }

    function queued(id: string, start: string, seconds: number): void {
      db.prepare(
        `INSERT INTO worklog_sync_queue (id, provider_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc, status)
         VALUES (?, 'jira', 't1', ?, ?, 'work', ?, 'SYNCED')`
      ).run(id, seconds, start, start);
    }

    const row = (id: string) =>
      db.prepare<[string], { worklog_id: string | null; operation: string; remote_worklog_id: string | null; origin_sync_id: string | null }>(
        'SELECT worklog_id, operation, remote_worklog_id, origin_sync_id FROM worklog_sync_queue WHERE id = ?'
      ).get(id);

    it('Migration008_RowWrittenBesideItsWorklog_IsTiedToIt', () => {
      atVersion7();
      stopped('w1', '2026-03-01T09:00:00.000Z', 900, 'q1');
      stopped('w2', '2026-03-01T10:00:00.000Z', 900, 'q2');

      runMigrations(db);

      expect(row('q1')).toEqual({ worklog_id: 'w1', operation: 'CREATE', remote_worklog_id: null, origin_sync_id: null });
      expect(row('q2')?.worklog_id).toBe('w2');
    });

    it('Migration008_TwoIdenticalWorklogs_TiesNeither', () => {
      // Which entry at the provider is which cannot be told; a wrong tie
      // would correct the other one.
      atVersion7();
      stopped('w1', '2026-03-01T09:00:00.000Z', 900, 'q1');
      stopped('w2', '2026-03-01T09:00:00.000Z', 900, 'q2');

      runMigrations(db);

      expect(row('q1')?.worklog_id).toBeNull();
      expect(row('q2')?.worklog_id).toBeNull();
    });

    it('Migration008_TwoRowsForOneWorklog_TiesNeither', () => {
      atVersion7();
      stopped('w1', '2026-03-01T09:00:00.000Z', 900, 'q1');
      queued('q2', '2026-03-01T09:00:00.000Z', 900);

      runMigrations(db);

      expect(row('q1')?.worklog_id).toBeNull();
      expect(row('q2')?.worklog_id).toBeNull();
    });

    it('Migration008_RowWithoutItsWorklog_StaysUntied', () => {
      atVersion7();
      queued('q1', '2026-03-01T09:00:00.000Z', 900);
      stopped('w1', '2026-03-01T09:00:00.000Z', 600);

      runMigrations(db);

      expect(row('q1')?.worklog_id).toBeNull();
    });

    it('Migration008_FromThenOn_AnUnknownOperationIsRefused', () => {
      atVersion7();
      runMigrations(db);

      expect(() =>
        db.prepare(
          `INSERT INTO worklog_sync_queue (id, provider_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc, status, operation)
           VALUES ('q9', 'jira', 't1', 60, '2026-03-01T09:00:00.000Z', '', '2026-03-01T09:00:00.000Z', 'PENDING', 'MOVE')`
        ).run()
      ).toThrow(/CHECK/);
    });
  });

  describe('migration 9: a session knows its provider', () => {
    /** A version-8 database with a Jira project, an OpenProject one as the old adapter saved it, and an ad-hoc one. */
    function atVersion8(): void {
      for (const migration of MIGRATIONS.filter(m => m.version <= 8)) migration.up(db);
      db.pragma('user_version = 8');
      const project = db.prepare(
        "INSERT INTO projects (id, key, name, provider_id, created_at_utc) VALUES (?, ?, ?, ?, '2026-01-01T00:00:00.000Z')"
      );
      project.run('J', 'J', 'Jira project', 'jira');
      project.run('OP', 'OP', 'OpenProject project', 'local');
    }

    function session(id: string, projectId: string, adHoc = false, status = 'COMPLETED'): void {
      db.prepare(
        `INSERT INTO active_sessions (id, project_id, task_id, task_key, task_title, is_ad_hoc, start_time_utc, status)
         VALUES (?, ?, 't', 'T-1', 'Task', ?, '2026-03-01T09:00:00.000Z', ?)`
      ).run(id, projectId, adHoc ? 1 : 0, status);
    }

    const providerOf = (id: string) =>
      db.prepare<[string], { provider_id: string | null }>('SELECT provider_id FROM active_sessions WHERE id = ?').get(id)?.provider_id;

    it('Migration009_SessionOnAJiraProject_TakesJira', () => {
      atVersion8();
      session('s1', 'J', false, 'TRACKING');

      runMigrations(db);

      expect(providerOf('s1')).toBe('jira');
    });

    it('Migration009_ProjectHoldingTheOldDefault_IsNotKnown', () => {
      // 'local' is what every OpenProject project held: it is not "made here",
      // and reading it so would keep a running OpenProject session's time back.
      atVersion8();
      session('s1', 'OP', false, 'TRACKING');

      runMigrations(db);

      expect(providerOf('s1')).toBeNull();
    });

    it('Migration009_AdHocOrProjectGone_IsNotKnown', () => {
      atVersion8();
      session('s1', 'J', true);
      session('s2', 'GONE');

      runMigrations(db);

      expect(providerOf('s1')).toBeNull();
      expect(providerOf('s2')).toBeNull();
    });
  });

  describe('migration 10: a project key is not unique', () => {
    const insert = (id: string, key: string, providerId: string) =>
      db.prepare(
        "INSERT INTO projects (id, key, name, provider_id, created_at_utc) VALUES (?, ?, ?, ?, '2026-01-01T00:00:00.000Z')"
      ).run(id, key, `Project ${id}`, providerId);

    it('Migration010_ExistingProjects_AreKeptAsTheyWere', () => {
      for (const migration of MIGRATIONS.filter(m => m.version <= 9)) migration.up(db);
      db.pragma('user_version = 9');
      insert('10000', 'WEB', 'jira');
      insert('MINE', 'MINE', 'sprintticker');

      runMigrations(db);

      expect(db.prepare('SELECT id, key, name, provider_id FROM projects ORDER BY id').all()).toEqual([
        { id: '10000', key: 'WEB', name: 'Project 10000', provider_id: 'jira' },
        { id: 'MINE', key: 'MINE', name: 'Project MINE', provider_id: 'sprintticker' }
      ]);
    });

    it('Migration010_FromThenOn_TwoProjectsMayShareAKey', () => {
      // A Jira WEB and an OpenProject web, or one made here: the second used
      // to fail to save, silently.
      runMigrations(db);
      insert('10000', 'WEB', 'jira');

      expect(() => insert('WEB', 'WEB', 'sprintticker')).not.toThrow();
    });
  });
});
