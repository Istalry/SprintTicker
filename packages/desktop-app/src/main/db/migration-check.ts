import type Database from 'better-sqlite3';
import { LATEST_SCHEMA_VERSION, RECOVERED_SESSION_COMMENT, runMigrations } from './migrations';
import { ArgumentNullException } from '../../shared/dtos';

/**
 * What a migration must not lose, counted before and after it runs.
 *
 * Counted rather than compared row by row because the migrations legitimately
 * change rows: migration 5 names orphaned tasks, migration 6 closes duplicate
 * sessions and logs their time. What they may never do is lose a worklog or
 * a second of tracked time, which is what these totals catch.
 */
export interface MigrationCensus {
  version: number;
  worklogs: number;
  trackedSeconds: number;
  tasks: number;
  /** Worklogs whose task does not exist: history no name can be put to. */
  orphanWorklogs: number;
  /** Distinct task ids among those, each of which should become a task. */
  orphanTaskIds: number;
  openSessions: number;
  /** Worklogs written by a migration for a session it had to close. */
  recoveredWorklogs: number;
}

export interface TombstoneTask {
  id: string;
  key: string;
  title: string;
  projectId: string;
}

export interface RecoveredWorklog {
  taskKey: string;
  taskTitle: string;
  startedAtUtc: string;
  closedAtUtc: string;
  durationSeconds: number;
}

export interface MigrationCheckReport {
  before: MigrationCensus;
  after: MigrationCensus;
  latestVersion: number;
  /** Tasks kept only so history can name them (migration 5). */
  tombstones: TombstoneTask[];
  recovered: RecoveredWorklog[];
  foreignKeyViolations: number;
  /** Empty when the migration kept everything; otherwise, what it did not. */
  problems: string[];
}

const OPEN_STATUSES = "('TRACKING', 'PAUSED')";

function tableExists(db: Database.Database, table: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  return columns.some(c => c.name === column);
}

function count(db: Database.Database, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

/**
 * Takes the census on any schema version, including one so old that a table
 * is missing: a database from before migrations existed must be countable,
 * because that is exactly the upgrade worth checking.
 */
export function takeCensus(db: Database.Database): MigrationCensus {
  if (!db) throw new ArgumentNullException('db');

  const hasWorklogs = tableExists(db, 'worklogs');
  const hasTasks = tableExists(db, 'tasks');
  const hasSessions = tableExists(db, 'active_sessions');
  const orphanFilter = hasTasks ? 'WHERE task_id NOT IN (SELECT id FROM tasks)' : '';

  return {
    version: db.pragma('user_version', { simple: true }) as number,
    worklogs: hasWorklogs ? count(db, 'SELECT COUNT(*) AS n FROM worklogs') : 0,
    trackedSeconds: hasWorklogs ? count(db, 'SELECT COALESCE(SUM(duration_seconds), 0) AS n FROM worklogs') : 0,
    tasks: hasTasks ? count(db, 'SELECT COUNT(*) AS n FROM tasks') : 0,
    orphanWorklogs: hasWorklogs ? count(db, `SELECT COUNT(*) AS n FROM worklogs ${orphanFilter}`) : 0,
    orphanTaskIds: hasWorklogs ? count(db, `SELECT COUNT(DISTINCT task_id) AS n FROM worklogs ${orphanFilter}`) : 0,
    openSessions: hasSessions
      ? count(db, `SELECT COUNT(*) AS n FROM active_sessions WHERE status IN ${OPEN_STATUSES}`)
      : 0,
    recoveredWorklogs: hasWorklogs
      ? count(db, 'SELECT COUNT(*) AS n FROM worklogs WHERE comment = ?', RECOVERED_SESSION_COMMENT)
      : 0
  };
}

/**
 * The rules a migrated database must satisfy, as sentences a user can paste
 * back. Each compares the census either side of the migration, so none of
 * them names a particular migration: a future one is held to the same rules.
 */
function findProblems(before: MigrationCensus, after: MigrationCensus, foreignKeyViolations: number): string[] {
  const problems: string[] = [];
  const recoveredByMigration = after.recoveredWorklogs - before.recoveredWorklogs;

  if (after.version !== LATEST_SCHEMA_VERSION) {
    problems.push(`The schema stopped at version ${after.version}, not ${LATEST_SCHEMA_VERSION}.`);
  }
  // Recovering a session is the only thing allowed to add a worklog, and
  // nothing is allowed to remove one.
  if (after.worklogs !== before.worklogs + recoveredByMigration) {
    problems.push(
      `Worklogs went from ${before.worklogs} to ${after.worklogs}, ` +
        `but only ${recoveredByMigration} were written for recovered sessions.`
    );
  }
  if (after.trackedSeconds < before.trackedSeconds) {
    problems.push(`Tracked time went down, from ${before.trackedSeconds} s to ${after.trackedSeconds} s.`);
  }
  // Only a duplicate is closed: of N sessions left open, one stays open.
  if (recoveredByMigration > Math.max(0, before.openSessions - 1)) {
    problems.push(
      `${recoveredByMigration} sessions were closed and logged, ` +
        `but only ${Math.max(0, before.openSessions - 1)} were duplicates.`
    );
  }
  if (after.tasks < before.tasks + before.orphanTaskIds) {
    problems.push(
      `There are ${after.tasks} tasks; expected at least ${before.tasks + before.orphanTaskIds}, ` +
        `one for each existing task and each orphaned task id.`
    );
  }
  if (after.orphanWorklogs > 0) {
    problems.push(`${after.orphanWorklogs} worklogs still name a task that does not exist.`);
  }
  if (after.openSessions > 1) {
    problems.push(`${after.openSessions} sessions are still open; at most one may be.`);
  }
  if (foreignKeyViolations > 0) {
    problems.push(`${foreignKeyViolations} rows violate a foreign key.`);
  }
  return problems;
}

/**
 * Migrates `db` and reports whether anything was lost on the way.
 *
 * Meant for a **copy** of a real database, before a build that migrates it
 * ships: the tests prove the migrations on data they invented, and this
 * proves them on data nobody invented. Run it through
 * `pnpm db:check-migration`, which makes the copy.
 *
 * `migrate` is injectable so a test can hand it a migration that does lose
 * something, and see that the report says so.
 */
export function checkMigration(
  db: Database.Database,
  migrate: (db: Database.Database) => void = runMigrations
): MigrationCheckReport {
  if (!db) throw new ArgumentNullException('db');

  const before = takeCensus(db);
  migrate(db);
  const after = takeCensus(db);

  const foreignKeyViolations = (db.pragma('foreign_key_check') as unknown[]).length;
  const tombstones =
    tableExists(db, 'tasks') && columnExists(db, 'tasks', 'archived_at_utc')
      ? db
          .prepare<[], TombstoneTask>(
            `SELECT id, key, title, project_id AS projectId FROM tasks
             WHERE archived_at_utc IS NOT NULL ORDER BY key`
          )
          .all()
      : [];
  const recovered = tableExists(db, 'worklogs')
    ? db
        .prepare<[string], RecoveredWorklog>(
          `SELECT t.key AS taskKey, t.title AS taskTitle, w.started_at_utc AS startedAtUtc,
                  w.created_at_utc AS closedAtUtc, w.duration_seconds AS durationSeconds
           FROM worklogs w LEFT JOIN tasks t ON t.id = w.task_id
           WHERE w.comment = ? ORDER BY w.started_at_utc`
        )
        .all(RECOVERED_SESSION_COMMENT)
    : [];

  return {
    before,
    after,
    latestVersion: LATEST_SCHEMA_VERSION,
    tombstones,
    recovered,
    foreignKeyViolations,
    problems: findProblems(before, after, foreignKeyViolations)
  };
}
