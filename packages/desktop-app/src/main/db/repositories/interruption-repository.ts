import { DatabaseConnection } from '../database-connection';
import { ArgumentNullException } from '../../../shared/dtos';
import { InterruptionSource } from '../../../shared/interruption';

/** A fragment as stored (migration 15). */
export interface InterruptionRecord {
  id: string;
  startedAtUtc: string;
  endedAtUtc: string | null;
  name: string | null;
  source: InterruptionSource;
  interruptedSessionId: string | null;
  interruptedWasPaused: boolean;
  afterId: string | null;
  placedTaskId: string | null;
  placedWorklogId: string | null;
  keptOff: boolean;
  discardedAtUtc: string | null;
  legacyWorklogId: string | null;
  /** The open pause's start, or null when it is not paused (migration 17). */
  pausedAtUtc: string | null;
  /** The seconds of its pauses already ended. */
  pausedSeconds: number;
}

interface Row {
  id: string;
  started_at_utc: string;
  ended_at_utc: string | null;
  name: string | null;
  source: InterruptionSource;
  interrupted_session_id: string | null;
  interrupted_was_paused: number;
  after_id: string | null;
  placed_task_id: string | null;
  placed_worklog_id: string | null;
  kept_off: number;
  discarded_at_utc: string | null;
  legacy_worklog_id: string | null;
  paused_at_utc: string | null;
  paused_seconds: number | null;
}

const toRecord = (row: Row): InterruptionRecord => ({
  id: row.id,
  startedAtUtc: row.started_at_utc,
  endedAtUtc: row.ended_at_utc,
  name: row.name,
  source: row.source,
  interruptedSessionId: row.interrupted_session_id,
  interruptedWasPaused: row.interrupted_was_paused === 1,
  afterId: row.after_id,
  placedTaskId: row.placed_task_id,
  placedWorklogId: row.placed_worklog_id,
  keptOff: row.kept_off === 1,
  discardedAtUtc: row.discarded_at_utc,
  legacyWorklogId: row.legacy_worklog_id,
  pausedAtUtc: row.paused_at_utc ?? null,
  pausedSeconds: row.paused_seconds ?? 0
});

/**
 * The interruptions, one row per fragment (migration 15). One runs at most
 * -- the unique index refuses a second -- and an ended one waits until it is
 * placed, kept off or discarded.
 */
export class InterruptionRepository {
  private readonly _db: DatabaseConnection;

  constructor(dbConn: DatabaseConnection) {
    if (!dbConn) throw new ArgumentNullException('dbConn');
    this._db = dbConn;
  }

  public open(fragment: {
    id: string;
    startedAtUtc: string;
    source: InterruptionSource;
    interruptedSessionId: string | null;
    interruptedWasPaused: boolean;
    afterId: string | null;
  }): void {
    this._db.getDb().prepare(`
      INSERT INTO interruptions (id, started_at_utc, source, interrupted_session_id, interrupted_was_paused, after_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      fragment.id,
      fragment.startedAtUtc,
      fragment.source,
      fragment.interruptedSessionId,
      fragment.interruptedWasPaused ? 1 : 0,
      fragment.afterId
    );
  }

  public get(id: string): InterruptionRecord | null {
    const row = this._db.getDb().prepare<[string], Row>('SELECT * FROM interruptions WHERE id = ?').get(id);
    return row ? toRecord(row) : null;
  }

  public getRunning(): InterruptionRecord | null {
    const row = this._db.getDb().prepare<[], Row>('SELECT * FROM interruptions WHERE ended_at_utc IS NULL').get();
    return row ? toRecord(row) : null;
  }

  /** Moves a running fragment's start ("started 5 min ago"); an ended one keeps its span. */
  public setStart(id: string, startedAtUtc: string): void {
    this._db.getDb().prepare('UPDATE interruptions SET started_at_utc = ? WHERE id = ? AND ended_at_utc IS NULL').run(startedAtUtc, id);
  }

  /**
   * Ends a running fragment. A pause still open ends with it, its seconds
   * kept: stopped while paused, the fragment's time is what ran before.
   */
  public close(id: string, endedAtUtc: string): void {
    this._db.getDb().prepare(`
      UPDATE interruptions
         SET paused_seconds = paused_seconds + ${OPEN_PAUSE_SECONDS_SQL},
             paused_at_utc = NULL,
             ended_at_utc = ?
       WHERE id = ? AND ended_at_utc IS NULL
    `).run(endedAtUtc, endedAtUtc, id);
  }

  /** Pauses a running fragment at `atUtc`; one already paused stays as it is. */
  public pause(id: string, atUtc: string): void {
    this._db.getDb()
      .prepare('UPDATE interruptions SET paused_at_utc = ? WHERE id = ? AND ended_at_utc IS NULL AND paused_at_utc IS NULL')
      .run(atUtc, id);
  }

  /** Resumes a paused fragment at `atUtc`, its pause's seconds kept. */
  public resume(id: string, atUtc: string): void {
    this._db.getDb().prepare(`
      UPDATE interruptions
         SET paused_seconds = paused_seconds + ${OPEN_PAUSE_SECONDS_SQL},
             paused_at_utc = NULL
       WHERE id = ? AND ended_at_utc IS NULL AND paused_at_utc IS NOT NULL
    `).run(atUtc, id);
  }

  public rename(id: string, name: string): void {
    this._db.getDb().prepare('UPDATE interruptions SET name = ? WHERE id = ?').run(name, id);
  }

  public markPlaced(id: string, taskId: string, worklogId: string | null): void {
    this._db.getDb()
      .prepare('UPDATE interruptions SET placed_task_id = ?, placed_worklog_id = ? WHERE id = ?')
      .run(taskId, worklogId, id);
  }

  public markKeptOff(id: string, worklogId: string | null): void {
    this._db.getDb().prepare('UPDATE interruptions SET kept_off = 1, placed_worklog_id = ? WHERE id = ?').run(worklogId, id);
  }

  public markDiscarded(id: string, atUtc: string): void {
    // A running fragment ends here; a pause still open ends with it, as in `close`.
    this._db.getDb().prepare(`
      UPDATE interruptions
         SET paused_seconds = paused_seconds + CASE WHEN ended_at_utc IS NULL THEN ${OPEN_PAUSE_SECONDS_SQL} ELSE 0 END,
             paused_at_utc = CASE WHEN ended_at_utc IS NULL THEN NULL ELSE paused_at_utc END,
             discarded_at_utc = ?,
             ended_at_utc = COALESCE(ended_at_utc, ?)
       WHERE id = ?
    `).run(atUtc, atUtc, atUtc, id);
  }

  /** Ended, and neither placed, kept off nor discarded: oldest first. */
  public getToPlace(): InterruptionRecord[] {
    return this._db.getDb().prepare<[], Row>(`
      SELECT * FROM interruptions
       WHERE ended_at_utc IS NOT NULL AND discarded_at_utc IS NULL
         AND placed_task_id IS NULL AND kept_off = 0
       ORDER BY started_at_utc, id
    `).all().map(toRecord);
  }

  /** The fragments of `id`'s run, first to last, discarded ones included: the run is what was lived. */
  public getRun(id: string): InterruptionRecord[] {
    const all = new Map<string, InterruptionRecord>();
    let first = this.get(id);
    while (first?.afterId) {
      const before = this.get(first.afterId);
      if (!before) break;
      first = before;
    }
    if (!first) return [];
    const run = [first];
    all.set(first.id, first);
    for (;;) {
      const next = this._db.getDb()
        .prepare<[string], Row>('SELECT * FROM interruptions WHERE after_id = ? ORDER BY started_at_utc LIMIT 1')
        .get(run[run.length - 1].id);
      if (!next || all.has(next.id)) break;
      const record = toRecord(next);
      all.set(record.id, record);
      run.push(record);
    }
    return run;
  }

  /** The latest fragment that held `sessionId`, ended or not. */
  public getLatestFor(sessionId: string): InterruptionRecord | null {
    const row = this._db.getDb()
      .prepare<[string], Row>('SELECT * FROM interruptions WHERE interrupted_session_id = ? ORDER BY started_at_utc DESC, id DESC LIMIT 1')
      .get(sessionId);
    return row ? toRecord(row) : null;
  }

  /** Creates the fragment of an old-model interruption's worklog, as migration 15 does for the ones it finds. */
  public adoptLegacyWorklog(worklog: { id: string; startedAtUtc: string; durationSeconds: number }): void {
    const ended = new Date(Date.parse(worklog.startedAtUtc) + worklog.durationSeconds * 1000).toISOString();
    this._db.getDb().prepare(`
      INSERT OR IGNORE INTO interruptions (id, started_at_utc, ended_at_utc, source, legacy_worklog_id)
      VALUES (?, ?, ?, 'legacy', ?)
    `).run(`legacy_${worklog.id}`, worklog.startedAtUtc, ended, worklog.id);
  }
}

/**
 * The open pause's seconds up to the time bound as the next parameter, in
 * SQL: whole seconds, as `interruptionSeconds` counts them. Zero with no
 * pause open.
 */
const OPEN_PAUSE_SECONDS_SQL =
  "CASE WHEN paused_at_utc IS NULL THEN 0 ELSE MAX(0, CAST(ROUND((julianday(?) - julianday(paused_at_utc)) * 86400) AS INTEGER)) END";

/**
 * A fragment's length in whole seconds: to its end, or to `nowIso` while it
 * runs, less its pauses -- the ended ones and the one still open.
 */
export function interruptionSeconds(
  fragment: Pick<InterruptionRecord, 'startedAtUtc' | 'endedAtUtc'> & Partial<Pick<InterruptionRecord, 'pausedAtUtc' | 'pausedSeconds'>>,
  nowIso?: string
): number {
  const end = fragment.endedAtUtc ?? nowIso ?? new Date().toISOString();
  const endMs = Date.parse(end);
  const openPause = fragment.pausedAtUtc ? Math.max(0, Math.round((endMs - Date.parse(fragment.pausedAtUtc)) / 1000)) : 0;
  const span = Math.floor((endMs - Date.parse(fragment.startedAtUtc)) / 1000);
  return Math.max(0, span - (fragment.pausedSeconds ?? 0) - openPause);
}
