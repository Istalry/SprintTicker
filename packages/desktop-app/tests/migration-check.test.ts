import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { checkMigration, takeCensus } from '../src/main/db/migration-check';
import { MIGRATIONS, LATEST_SCHEMA_VERSION, runMigrations } from '../src/main/db/migrations';
import { ArgumentNullException } from '../src/shared/dtos';

/**
 * `pnpm db:check-migration` runs this on a copy of a real database before a
 * build that migrates it ships. A check that cannot fail checks nothing, so
 * every rule has a test where the migration breaks it and the report says so.
 */
describe('checkMigration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    if (db.open) db.close();
    vi.restoreAllMocks();
  });

  /**
   * A version-4 database with what the migrations since were written to
   * repair: a worklog whose task was deleted, and two sessions left open.
   */
  function atVersion4WithDamage(): void {
    for (const migration of MIGRATIONS.filter(m => m.version <= 4)) migration.up(db);
    db.pragma('user_version = 4');
    db.prepare(
      `INSERT INTO tasks (id, project_id, key, title, status, created_at_utc)
       VALUES ('t1', 'P1', 'A-1', 'Kept task', 'todo', '2026-01-01T00:00:00.000Z')`
    ).run();
    const session = db.prepare(
      `INSERT INTO active_sessions (id, project_id, task_id, task_key, task_title, start_time_utc, status)
       VALUES (?, 'P1', ?, ?, ?, ?, ?)`
    );
    session.run('s-gone', 'gone', 'A-9', 'Deleted task', '2026-03-01T09:00:00.000Z', 'COMPLETED');
    session.run('s-old', 't1', 'A-1', 'Kept task', '2026-03-02T09:00:00.000Z', 'TRACKING');
    session.run('s-new', 't1', 'A-1', 'Kept task', '2026-03-02T10:00:00.000Z', 'TRACKING');
    worklog('w1', 's-gone', 'gone');
  }

  function worklog(id: string, sessionId: string, taskId: string): void {
    db.prepare(
      `INSERT INTO worklogs (id, session_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc)
       VALUES (?, ?, ?, 900, '2026-03-01T09:00:00.000Z', 'work', '2026-03-01T09:15:00.000Z')`
    ).run(id, sessionId, taskId);
  }

  it('CheckMigration_RealMigrationsOnDamagedHistory_FindNothingLost', () => {
    atVersion4WithDamage();

    const report = checkMigration(db);

    expect(report.problems).toEqual([]);
    expect(report.after.version).toBe(LATEST_SCHEMA_VERSION);
    expect(report.before.orphanTaskIds).toBe(1);
    expect(report.tombstones.map(t => t.key)).toEqual(['A-9']);
    expect(report.recovered).toHaveLength(1);
    expect(report.after.worklogs).toBe(report.before.worklogs + 1);
    expect(report.foreignKeyViolations).toBe(0);
  });

  it('CheckMigration_AlreadyCurrent_ChangesNothingAndPasses', () => {
    atVersion4WithDamage();
    runMigrations(db);

    const report = checkMigration(db);

    expect(report.problems).toEqual([]);
    expect(report.after).toEqual(report.before);
  });

  it('CheckMigration_MigrationLosesAWorklog_SaysSo', () => {
    atVersion4WithDamage();

    const report = checkMigration(db, d => {
      runMigrations(d);
      d.prepare("DELETE FROM worklogs WHERE id = 'w1'").run();
    });

    // The recovered session's worklog makes up the count's total, which is
    // why the rule counts recoveries rather than comparing totals.
    expect(report.problems).toEqual(['Worklogs went from 1 to 1, but only 1 were written for recovered sessions.']);
  });

  it('CheckMigration_MigrationShortensAWorklog_SaysSo', () => {
    atVersion4WithDamage();
    runMigrations(db);

    const report = checkMigration(db, d => {
      d.prepare("UPDATE worklogs SET duration_seconds = 0 WHERE id = 'w1'").run();
    });

    expect(report.problems).toEqual(['Tracked time went down, from 4500 s to 3600 s.']);
  });

  it('CheckMigration_MigrationStopsShort_SaysWhereAndWhatItLeft', () => {
    atVersion4WithDamage();

    const report = checkMigration(db, () => undefined);

    expect(report.problems).toEqual([
      `The schema stopped at version 4, not ${LATEST_SCHEMA_VERSION}.`,
      'There are 1 tasks; expected at least 2, one for each existing task and each orphaned task id.',
      '1 worklogs still name a task that does not exist.',
      '2 sessions are still open; at most one may be.'
    ]);
  });

  it('CheckMigration_MigrationClosesTheLastOpenSession_SaysSo', () => {
    // Only a duplicate is closed; the session the bar shows stays open.
    atVersion4WithDamage();

    const report = checkMigration(db, d => {
      runMigrations(d);
      d.prepare("UPDATE active_sessions SET status = 'COMPLETED' WHERE id = 's-new'").run();
      d.prepare(
        `INSERT INTO worklogs (id, session_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc)
         SELECT 'w-extra', session_id, task_id, 60, started_at_utc, comment, created_at_utc
         FROM worklogs WHERE session_id = 's-old'`
      ).run();
    });

    expect(report.problems).toEqual(['2 sessions were closed and logged, but only 1 were duplicates.']);
  });

  it('CheckMigration_MigrationLeavesABrokenReference_SaysSo', () => {
    atVersion4WithDamage();

    const report = checkMigration(db, d => {
      runMigrations(d);
      d.pragma('foreign_keys = OFF');
      d.prepare(
        `INSERT INTO worklogs (id, session_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc)
         VALUES ('w-bad', 's-gone', 'nowhere', 0, '2026-03-01T09:00:00.000Z', 'work', '2026-03-01T09:00:00.000Z')`
      ).run();
    });

    expect(report.problems).toContain('1 rows violate a foreign key.');
    expect(report.problems).toContain('1 worklogs still name a task that does not exist.');
  });

  it('TakeCensus_DatabaseWithNoTables_CountsZero', () => {
    // A brand-new file: nothing to lose, and nothing to fail on.
    expect(takeCensus(db)).toEqual({
      version: 0,
      worklogs: 0,
      trackedSeconds: 0,
      tasks: 0,
      orphanWorklogs: 0,
      orphanTaskIds: 0,
      openSessions: 0,
      recoveredWorklogs: 0
    });
  });

  it('CheckMigration_NoDatabase_Throws', () => {
    expect(() => checkMigration(null as unknown as Database.Database)).toThrow(ArgumentNullException);
    expect(() => takeCensus(null as unknown as Database.Database)).toThrow(ArgumentNullException);
  });
});
