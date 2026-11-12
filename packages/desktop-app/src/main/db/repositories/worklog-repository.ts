import { DatabaseConnection } from '../database-connection';
import { ArgumentNullException, WeekChangeDTO } from '../../../shared/dtos';
import { localDateKey, localDayBoundsUtc } from '../../../shared/local-date';
import { WorklogCorrectionDTO, WorklogSyncState } from '../../../shared/worklog-correction';
import { hasTaskPage } from '../../../shared/task-page';
import { isAdHocTaskId } from '../id-generator';
import { UNDO_WINDOW_MS } from '../../sync/sync-constants';

export interface WorklogRecord {
  id: string;
  sessionId: string;
  taskId: string;
  durationSeconds: number;
  startedAtUtc: string;
  comment: string;
  createdAtUtc: string;
  /** The task's key, as the user knows it -- `SCRUM-2`, not Jira's `10001`. Read-only; filled on reads. */
  taskKey?: string;
  /** The task's title. Read-only; filled on reads. */
  taskTitle?: string;
  /** Where it stands with its provider. Read-only; filled on reads. */
  syncState?: WorklogSyncState;
  /** Whether its task has a page on a provider (`hasTaskPage`). Read-only; filled on reads. */
  hasTaskPage?: boolean;
  /** Logged on ad-hoc work, which no provider has. Read-only; filled on reads. */
  adHoc?: true;
  /** Its task is an interruption not yet named or assigned (migration 13). Read-only; filled on reads. */
  unsorted?: true;
  /** The key of the earlier entry holding this one back (`held-overlap`). Read-only; filled on reads. */
  overlapsTaskKey?: string;
  /** Time that started as an interruption, placed on this task (Today's ⚡). Read-only; filled on reads. */
  fromInterruption?: true;
  /** Its task's project. Read-only; filled on reads. */
  projectId?: string;
  projectName?: string;
  /** What its provider holds, by the last send it answered; absent when it holds nothing. Read-only. */
  providerSeconds?: number;
}

/**
 * An entry's start and end in whole milliseconds, for the overlap rule of
 * `shared/overlap.ts`. Rounded: julianday is a double, and a piece ending at
 * midnight must not read as running a hair past the next one's start.
 */
const START_MS = (alias: string) =>
  `CAST(ROUND((julianday(${alias}.started_at_utc) - 2440587.5) * 86400000) AS INTEGER)`;

/**
 * The earlier worklog that `w` overlaps, by the rule of `shared/overlap.ts`:
 * it starts first (the lower id on a tie), ends after `w` begins, and is not
 * a piece of the same session. Used as `EXISTS (...)` and to name it.
 */
const OVERLAPPING_EARLIER = (w: string) => `
  SELECT o.id FROM worklogs o
   WHERE o.id <> ${w}.id AND o.session_id <> ${w}.session_id
     AND (${START_MS('o')} < ${START_MS(w)} OR (${START_MS('o')} = ${START_MS(w)} AND o.id < ${w}.id))
     AND ${START_MS('o')} + o.duration_seconds * 1000 > ${START_MS(w)}`;

/** A worklog row joined to its task. */
interface WorklogRow {
  id: string;
  session_id: string;
  task_id: string;
  duration_seconds: number;
  started_at_utc: string;
  comment: string;
  created_at_utc: string;
  task_key: string | null;
  task_title: string | null;
  task_unsorted: number | null;
  task_project_id: string | null;
  project_provider_id: string | null;
  project_name: string | null;
  provider_seconds: number | null;
  create_status: SyncQueueStatus | null;
  correction_status: SyncQueueStatus | null;
  overlaps_task_key: string | null;
  from_interruption: number | null;
}

/**
 * Worklogs with the name of their task.
 *
 * The join can be trusted because `worklogs.task_id` is a foreign key and a
 * task with worklogs is archived rather than deleted (migration 5). It is a
 * LEFT JOIN all the same, so a row the constraint somehow missed still shows
 * its time.
 */
const SELECT_WORKLOGS = `
  SELECT w.*, t.key AS task_key, t.title AS task_title, t.unsorted AS task_unsorted,
         t.project_id AS task_project_id, p.provider_id AS project_provider_id, p.name AS project_name,
         (SELECT CASE q.operation WHEN 'DELETE' THEN NULL ELSE q.duration_seconds END FROM worklog_sync_queue q
           WHERE q.worklog_id = w.id AND q.task_id = w.task_id AND q.status = 'SYNCED'
           ORDER BY q.rowid DESC LIMIT 1) AS provider_seconds,
         (SELECT q.status FROM worklog_sync_queue q
           WHERE q.worklog_id = w.id AND q.operation = 'CREATE' AND q.task_id = w.task_id
           ORDER BY q.rowid DESC LIMIT 1) AS create_status,
         (SELECT q.status FROM worklog_sync_queue q
           WHERE q.worklog_id = w.id AND q.operation <> 'CREATE' AND q.status <> 'SYNCED'
           ORDER BY q.rowid DESC LIMIT 1) AS correction_status,
         (SELECT ot.key FROM worklogs ow JOIN tasks ot ON ot.id = ow.task_id
           WHERE ow.id = (${OVERLAPPING_EARLIER('w')} ORDER BY o.started_at_utc LIMIT 1)) AS overlaps_task_key,
         EXISTS (SELECT 1 FROM interruptions i
           WHERE i.placed_worklog_id = w.id OR i.legacy_worklog_id = w.id) AS from_interruption
  FROM worklogs w
  LEFT JOIN tasks t ON t.id = w.task_id
  LEFT JOIN projects p ON p.id = t.project_id`;

/** Where a worklog stands, from its send and its latest open correction. */
function syncStateOf(
  createStatus: SyncQueueStatus | null,
  correctionStatus: SyncQueueStatus | null,
  overlapped: boolean
): WorklogSyncState {
  if (correctionStatus) return correctionStatus === 'FAILED' ? 'correction-failed' : 'correction-pending';
  // Held only while it waits: one claimed or sent already is past holding.
  if (overlapped && (createStatus === 'PENDING' || createStatus === 'FAILED')) return 'held-overlap';
  switch (createStatus) {
    case null:
      return 'local';
    case 'SYNCED':
      return 'sent';
    case 'FAILED':
      return 'failed';
    default:
      return 'pending';
  }
}

function toRecord(r: WorklogRow): WorklogRecord {
  const record: WorklogRecord = {
    id: r.id,
    sessionId: r.session_id,
    taskId: r.task_id,
    durationSeconds: r.duration_seconds,
    startedAtUtc: r.started_at_utc,
    comment: r.comment,
    createdAtUtc: r.created_at_utc
  };
  if (r.task_key !== null) record.taskKey = r.task_key;
  if (r.task_title !== null) record.taskTitle = r.task_title;
  record.syncState = syncStateOf(r.create_status ?? null, r.correction_status ?? null, r.overlaps_task_key != null);
  if (record.syncState === 'held-overlap' && r.overlaps_task_key) record.overlapsTaskKey = r.overlaps_task_key;
  record.hasTaskPage = hasTaskPage(r.task_project_id, r.project_provider_id);
  if (isAdHocTaskId(r.task_id)) record.adHoc = true;
  if (r.task_unsorted === 1) record.unsorted = true;
  if (r.from_interruption === 1) record.fromInterruption = true;
  if (r.task_project_id !== null) record.projectId = r.task_project_id;
  if (r.project_name !== null) record.projectName = r.project_name;
  if (r.provider_seconds !== null) record.providerSeconds = r.provider_seconds;
  return record;
}

export type SyncQueueStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

/** What a queue row asks of the provider (migration 8). */
export type SyncQueueOperation = 'CREATE' | 'UPDATE' | 'DELETE';

export interface SyncQueueRecord {
  id: string;
  providerId: string;
  taskId: string;
  durationSeconds: number;
  startedAtUtc: string;
  comment: string;
  createdAtUtc: string;
  retryCount: number;
  status: SyncQueueStatus;
  /** Earliest time this row may be retried; null means immediately. */
  nextAttemptAtUtc: string | null;
  /** When the current SYNCING claim was taken, for stale-claim recovery. */
  claimedAtUtc: string | null;
  /** Message from the most recent failed attempt. */
  lastError: string | null;
  /** The local worklog this row sends or corrects; null for a row nothing could be linked to. */
  worklogId: string | null;
  operation: SyncQueueOperation;
  /** The provider's id for the entry, once a `CREATE` has been answered with one. */
  remoteWorklogId: string | null;
  /** For an `UPDATE` or `DELETE`: the `CREATE` row whose marker the remote comment carries. */
  originSyncId: string | null;
  /**
   * Times this row has been claimed for sending, the current claim included.
   * Never reset (migration 11): above 1, an earlier attempt may have reached
   * the provider.
   */
  sendAttempts: number;
}

/** Raw column shape of a worklog_sync_queue row. */
interface SyncQueueRow {
  id: string;
  provider_id: string;
  task_id: string;
  duration_seconds: number;
  started_at_utc: string;
  comment: string;
  created_at_utc: string;
  retry_count: number;
  status: SyncQueueStatus;
  next_attempt_at_utc: string | null;
  claimed_at_utc: string | null;
  last_error: string | null;
  worklog_id: string | null;
  operation: SyncQueueOperation;
  remote_worklog_id: string | null;
  origin_sync_id: string | null;
  send_attempts: number;
}

function mapSyncQueueRow(r: SyncQueueRow): SyncQueueRecord {
  return {
    id: r.id,
    providerId: r.provider_id,
    taskId: r.task_id,
    durationSeconds: r.duration_seconds,
    startedAtUtc: r.started_at_utc,
    comment: r.comment,
    createdAtUtc: r.created_at_utc,
    retryCount: r.retry_count,
    status: r.status,
    nextAttemptAtUtc: r.next_attempt_at_utc,
    claimedAtUtc: r.claimed_at_utc,
    lastError: r.last_error,
    worklogId: r.worklog_id,
    operation: r.operation,
    remoteWorklogId: r.remote_worklog_id,
    originSyncId: r.origin_sync_id,
    sendAttempts: r.send_attempts
  };
}

/**
 * Repository layer for worklogs and offline worklog retry queue management.
 */
export class WorklogRepository {
  private dbConn: DatabaseConnection;
  private readonly holdMs: number;

  /**
   * `holdMs` is how long a row written now waits before it is due: the undo
   * window (`UNDO_WINDOW_MS`). A test of the worker's own rules passes 0,
   * and the hold is tested where it is the subject.
   */
  constructor(dbConn?: DatabaseConnection, options: { holdMs?: number } = {}) {
    this.dbConn = dbConn || DatabaseConnection.getInstance();
    this.holdMs = options.holdMs ?? UNDO_WINDOW_MS;
  }

  /** How long a row written now waits before it is due. */
  public getHoldMs(): number {
    return this.holdMs;
  }

  /** When a row written at `nowMs` is first due. */
  private heldUntilUtc(nowMs: number = Date.now()): string {
    return new Date(nowMs + this.holdMs).toISOString();
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
   * Saves a finalized worklog record to SQLite.
   */
  public saveWorklog(record: WorklogRecord): void {
    if (!record.id || !record.taskId || record.durationSeconds < 0) {
      throw new Error('Valid Worklog ID, Task ID, and non-negative duration are required');
    }

    const stmt = this.dbConn.getDb().prepare(`
      INSERT INTO worklogs (id, session_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.id,
      record.sessionId,
      record.taskId,
      record.durationSeconds,
      record.startedAtUtc,
      record.comment,
      record.createdAtUtc
    );
  }

  /**
   * Enqueues a worklog to the offline retry queue, held for the undo window.
   *
   * `worklogId` names the local worklog the row sends, which is what lets
   * that worklog be corrected once it has been sent.
   *
   * `waitsFor` names another row this send is not made before: a split's
   * second piece waits for the first piece's shortening (P9e), so the
   * provider never holds the same minutes on both. It is stored in
   * `origin_sync_id`, which on a correction names the send it corrects; on a
   * CREATE it means only this wait, and nothing that reads corrections
   * (`getUnsentCorrectionsOf`, the worker's lookup of the entry) reads it.
   */
  public enqueueSyncItem(payload: {
    id: string;
    providerId: string;
    taskId: string;
    durationSeconds: number;
    startedAtUtc: string;
    comment: string;
    worklogId?: string | null;
    waitsFor?: string | null;
  }): void {
    // Held for the undo window (UNDO_WINDOW_MS): not due before it ends.
    const stmt = this.dbConn.getDb().prepare(`
      INSERT INTO worklog_sync_queue (
        id, provider_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc, status, worklog_id,
        next_attempt_at_utc, origin_sync_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?)
    `);

    const now = Date.now();
    stmt.run(
      payload.id,
      payload.providerId,
      payload.taskId,
      payload.durationSeconds,
      payload.startedAtUtc,
      payload.comment,
      new Date(now).toISOString(),
      payload.worklogId ?? null,
      this.heldUntilUtc(now),
      payload.waitsFor ?? null
    );
  }

  /**
   * Pending rows that are due for an attempt now.
   *
   * Rows waiting out a backoff window are excluded, so a caller cannot retry
   * them early just by asking for the queue.
   */
  public getPendingQueueItems(nowUtc: string = new Date().toISOString()): SyncQueueRecord[] {
    const stmt = this.dbConn.getDb().prepare<[string], SyncQueueRow>(
      `SELECT * FROM worklog_sync_queue q
        WHERE status = 'PENDING'
          AND (next_attempt_at_utc IS NULL OR next_attempt_at_utc <= ?)
          -- The later entry of an overlap is not sent until it is fixed
          -- (shared/overlap.ts). Only a first send: an entry already at the
          -- provider stays there, and its corrections go.
          AND NOT (q.operation = 'CREATE' AND q.worklog_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM worklogs w WHERE w.id = q.worklog_id AND EXISTS (${OVERLAPPING_EARLIER('w')})))
          -- A split's second piece waits for the first's shortening
          -- (enqueueSyncItem's waitsFor). A row dropped since releases it.
          AND NOT (q.operation = 'CREATE' AND q.origin_sync_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM worklog_sync_queue awaited WHERE awaited.id = q.origin_sync_id AND awaited.status <> 'SYNCED'))
          -- A correction waits for whatever came before it on the same
          -- worklog: an UPDATE sent ahead of its CREATE names no entry.
          AND NOT EXISTS (
            SELECT 1 FROM worklog_sync_queue earlier
             WHERE q.worklog_id IS NOT NULL
               AND earlier.worklog_id = q.worklog_id
               AND earlier.rowid < q.rowid
               AND earlier.status <> 'SYNCED')
        ORDER BY created_at_utc ASC, rowid ASC`
    );
    return stmt.all(nowUtc).map(mapSyncQueueRow);
  }

  /**
   * Everything the sync panel needs in one read: counts by status, plus the
   * rows that have not been delivered.
   *
   * `SYNCED` rows are counted and not listed -- they are history, and the
   * point of the panel is what has *not* arrived. Ordered newest first because
   * a failure being diagnosed is almost always the most recent one.
   *
   * This exists because a worklog that never reached the provider was
   * indistinguishable from one that was never queued. Each row already carried
   * `last_error` and `retry_count`; nothing read them, so diagnosing a missing
   * worklog meant running the app from a terminal and reading the console.
   */
  public getSyncQueueSnapshot(limit: number = 50): {
    counts: { pending: number; syncing: number; synced: number; failed: number };
    items: SyncQueueRecord[];
  } {
    const db = this.dbConn.getDb();
    const counts = { pending: 0, syncing: 0, synced: 0, failed: 0 };

    const tallied = db
      .prepare<[], { status: SyncQueueStatus; total: number }>(
        'SELECT status, COUNT(*) AS total FROM worklog_sync_queue GROUP BY status'
      )
      .all();
    for (const row of tallied) {
      const key = row.status.toLowerCase() as keyof typeof counts;
      if (key in counts) counts[key] = row.total;
    }

    const items = db
      .prepare<[number], SyncQueueRow>(
        `SELECT * FROM worklog_sync_queue
          WHERE status <> 'SYNCED'
          ORDER BY created_at_utc DESC
          LIMIT ?`
      )
      .all(limit)
      .map(mapSyncQueueRow);

    return { counts, items };
  }

  /**
   * Atomically takes ownership of a pending row.
   *
   * The status check and the write are a single statement, so two concurrent
   * dispatchers cannot both win: only one transition out of PENDING can report
   * `changes === 1`. Returns the claimed row, or null if another dispatcher got
   * there first.
   *
   * This replaces a read-then-write pattern in which the sync worker and
   * ProviderManager each selected the same PENDING set and each POSTed it,
   * billing the same time to the provider twice.
   */
  public claimSyncItem(id: string, nowUtc: string = new Date().toISOString()): SyncQueueRecord | null {
    const db = this.dbConn.getDb();
    const result = db
      .prepare(
        `UPDATE worklog_sync_queue
            SET status = 'SYNCING', claimed_at_utc = ?, send_attempts = send_attempts + 1
          WHERE id = ? AND status = 'PENDING'`
      )
      .run(nowUtc, id);

    if (result.changes !== 1) return null;
    return this.getSyncItem(id);
  }

  /** One worklog, with its task's name and its sync state, or null. */
  public getWorklogById(id: string): WorklogRecord | null {
    const row = this.dbConn
      .getDb()
      .prepare<[string], WorklogRow>(`${SELECT_WORKLOGS} WHERE w.id = ?`)
      .get(id);
    return row ? toRecord(row) : null;
  }

  /** Rewrites a worklog's duration, start and comment. True when there was one to rewrite. */
  public rewriteWorklog(id: string, correction: WorklogCorrectionDTO): boolean {
    return (
      this.dbConn
        .getDb()
        .prepare('UPDATE worklogs SET duration_seconds = ?, started_at_utc = ?, comment = ? WHERE id = ?')
        .run(correction.durationSeconds, correction.startedAtUtc, correction.comment, id).changes === 1
    );
  }

  /**
   * Points a worklog at another task, with the comment it will carry there.
   * True when there was one to move. `task_id` is a foreign key: the task
   * must exist.
   */
  public retargetWorklog(id: string, taskId: string, comment: string): boolean {
    return (
      this.dbConn
        .getDb()
        .prepare('UPDATE worklogs SET task_id = ?, comment = ? WHERE id = ?')
        .run(taskId, comment, id).changes === 1
    );
  }

  /** How many worklogs name `taskId`. */
  public countWorklogsOf(taskId: string): number {
    const row = this.dbConn.getDb().prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM worklogs WHERE task_id = ?').get(taskId);
    return row?.n ?? 0;
  }

  /** Deletes a worklog row. True when there was one. */
  public deleteWorklog(id: string): boolean {
    return this.dbConn.getDb().prepare('DELETE FROM worklogs WHERE id = ?').run(id).changes === 1;
  }

  /**
   * The latest row that sends `worklogId` (a CREATE) to the task it is on,
   * whatever its state, or null when it was never queued for it.
   *
   * For its current task: a worklog moved to a project made here keeps the
   * CREATE of the entry it had, which a DELETE has taken off since, and a
   * correction aimed at that entry would only park on a 404.
   */
  public getSendOf(worklogId: string): SyncQueueRecord | null {
    const row = this.dbConn
      .getDb()
      .prepare<[string, string], SyncQueueRow>(
        `SELECT * FROM worklog_sync_queue
          WHERE worklog_id = ? AND operation = 'CREATE'
            AND task_id = (SELECT task_id FROM worklogs WHERE id = ?)
          ORDER BY rowid DESC LIMIT 1`
      )
      .get(worklogId, worklogId);
    return row ? mapSyncQueueRow(row) : null;
  }

  /**
   * The corrections of the entry `originSyncId` sent for `worklogId`, not
   * yet claimed or delivered: PENDING or FAILED.
   *
   * By the send they correct, not by the worklog alone: a worklog moved to
   * another task has a DELETE of its previous entry queued under the same
   * worklog id, and dropping it with the new entry's corrections would leave
   * the previous entry at its provider for good.
   */
  public getUnsentCorrectionsOf(worklogId: string, originSyncId: string): SyncQueueRecord[] {
    return this.dbConn
      .getDb()
      .prepare<[string, string], SyncQueueRow>(
        `SELECT * FROM worklog_sync_queue
          WHERE worklog_id = ? AND origin_sync_id = ? AND operation <> 'CREATE' AND status IN ('PENDING', 'FAILED')
          ORDER BY rowid ASC`
      )
      .all(worklogId, originSyncId)
      .map(mapSyncQueueRow);
  }

  /**
   * Points a send never attempted at another task and provider, with a fresh
   * start: the provider it named never hears of it.
   *
   * Only while unclaimed *and* never attempted (`send_attempts`, never the
   * retry budget) -- checked in the statement itself. False otherwise: an
   * attempt may have made the entry, and the caller deletes it instead.
   */
  public retargetUnsentSyncItem(id: string, providerId: string, taskId: string, comment: string): boolean {
    return (
      this.dbConn
        .getDb()
        .prepare(
          `UPDATE worklog_sync_queue
              SET provider_id = ?, task_id = ?, comment = ?,
                  status = 'PENDING', retry_count = 0, next_attempt_at_utc = ?, last_error = NULL
            WHERE id = ? AND status IN ('PENDING', 'FAILED') AND send_attempts = 0`
        )
        .run(providerId, taskId, comment, this.heldUntilUtc(), id).changes === 1
    );
  }

  /**
   * Rewrites what an unclaimed row will send, and gives it a fresh start: a
   * row parked for what it used to say may well go through now.
   *
   * Only while PENDING or FAILED -- checked in the statement itself, so a
   * row the worker claims in between is not changed under it. False then,
   * and the caller queues a correction behind it instead.
   */
  public rewriteUnsentSyncItem(id: string, correction: WorklogCorrectionDTO): boolean {
    return (
      this.dbConn
        .getDb()
        .prepare(
          `UPDATE worklog_sync_queue
              SET duration_seconds = ?, started_at_utc = ?, comment = ?,
                  status = 'PENDING', retry_count = 0, next_attempt_at_utc = ?, last_error = NULL
            WHERE id = ? AND status IN ('PENDING', 'FAILED')`
        )
        .run(correction.durationSeconds, correction.startedAtUtc, correction.comment, this.heldUntilUtc(), id).changes === 1
    );
  }

  /** Drops an unclaimed row (PENDING or FAILED). False when it was claimed or delivered meanwhile. */
  public dropUnsentSyncItem(id: string): boolean {
    return (
      this.dbConn
        .getDb()
        .prepare("DELETE FROM worklog_sync_queue WHERE id = ? AND status IN ('PENDING', 'FAILED')")
        .run(id).changes === 1
    );
  }

  /**
   * Queues a correction or a deletion of a worklog already sent, behind
   * whatever is queued for it (see getPendingQueueItems). `originSyncId` is
   * the row that sent it: its marker is what finds the entry, and its
   * `remote_worklog_id` is the entry's id once known.
   */
  public enqueueCorrection(payload: {
    id: string;
    operation: 'UPDATE' | 'DELETE';
    worklogId: string;
    originSyncId: string;
    providerId: string;
    taskId: string;
    durationSeconds: number;
    startedAtUtc: string;
    comment: string;
  }): void {
    this.dbConn
      .getDb()
      .prepare(
        `INSERT INTO worklog_sync_queue (
           id, provider_id, task_id, duration_seconds, started_at_utc, comment, created_at_utc, status,
           worklog_id, operation, origin_sync_id, next_attempt_at_utc
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?)`
      )
      .run(
        payload.id,
        payload.providerId,
        payload.taskId,
        payload.durationSeconds,
        payload.startedAtUtc,
        payload.comment,
        new Date().toISOString(),
        payload.worklogId,
        payload.operation,
        payload.originSyncId,
        this.heldUntilUtc()
      );
  }

  /** Records the provider's id for the entry a send made, once a search has found it. */
  public setRemoteWorklogId(syncId: string, remoteWorklogId: string): void {
    this.dbConn
      .getDb()
      .prepare('UPDATE worklog_sync_queue SET remote_worklog_id = ? WHERE id = ?')
      .run(remoteWorklogId, syncId);
  }

  /** One queue row, whatever its state, or null when there is none. */
  public getSyncItem(id: string): SyncQueueRecord | null {
    const row = this.dbConn
      .getDb()
      .prepare<[string], SyncQueueRow>('SELECT * FROM worklog_sync_queue WHERE id = ?')
      .get(id);
    return row ? mapSyncQueueRow(row) : null;
  }

  /**
   * Marks a claimed row as delivered, keeping the id the provider gave the
   * entry when it gave one -- the only handle a later correction has on it.
   * A row that already knows its id keeps it when the answer carries none.
   */
  public markSyncItemSynced(id: string, remoteWorklogId?: string): void {
    this.dbConn
      .getDb()
      .prepare(
        `UPDATE worklog_sync_queue
            SET status = 'SYNCED', claimed_at_utc = NULL, last_error = NULL,
                remote_worklog_id = COALESCE(?, remote_worklog_id)
          WHERE id = ?`
      )
      .run(remoteWorklogId ?? null, id);
  }

  /**
   * Parks a claimed row without spending the rest of its retry budget.
   *
   * For a failure that repeating cannot fix -- a revoked API key, a provider
   * with no credentials. The claim is released and the reason recorded, but
   * `retry_count` is left alone so that if the row is requeued the attempt
   * ceiling still means what it says.
   *
   * FAILED is not terminal: requeueFailedItems() returns these rows to PENDING,
   * and entering credentials is what triggers it.
   */
  public parkSyncItemAsFailed(id: string, errorMessage: string): void {
    this.dbConn
      .getDb()
      .prepare(
        `UPDATE worklog_sync_queue
            SET status = 'FAILED', claimed_at_utc = NULL, last_error = ?
          WHERE id = ?`
      )
      .run(errorMessage.slice(0, 500), id);
  }

  /**
   * Releases a claimed row after a failed attempt.
   *
   * Returns it to PENDING behind a backoff deadline until the attempt ceiling
   * is reached, at which point it parks as FAILED. FAILED is not terminal: a
   * migration requeues such rows on upgrade, and requeueFailedItems() does so
   * on demand.
   */
  public releaseSyncItemAfterFailure(
    id: string,
    errorMessage: string,
    backoffMs: number,
    maxAttempts: number,
    nowMs: number = Date.now()
  ): void {
    this.dbConn
      .getDb()
      .prepare(
        `UPDATE worklog_sync_queue
            SET retry_count = retry_count + 1,
                status = CASE WHEN retry_count + 1 >= ? THEN 'FAILED' ELSE 'PENDING' END,
                next_attempt_at_utc = ?,
                claimed_at_utc = NULL,
                last_error = ?
          WHERE id = ?`
      )
      .run(maxAttempts, new Date(nowMs + backoffMs).toISOString(), errorMessage.slice(0, 500), id);
  }

  /**
   * Returns rows stuck in SYNCING to PENDING.
   *
   * A claim is taken immediately before the network call and released after it,
   * so a row can only be left SYNCING if the process died in between. Without
   * this, that worklog would never be retried.
   *
   * If the provider accepted the worklog but the app died before the row was
   * marked SYNCED, the provider holds it already. Neither API takes an
   * idempotency key, so the sync id is embedded in the comment, and the worker
   * looks for it before sending a row a second time (`send_attempts`).
   */
  public reclaimStaleSyncItems(timeoutMs: number, nowMs: number = Date.now()): number {
    const cutoff = new Date(nowMs - timeoutMs).toISOString();
    return this.dbConn
      .getDb()
      .prepare(
        `UPDATE worklog_sync_queue
            SET status = 'PENDING', claimed_at_utc = NULL
          WHERE status = 'SYNCING'
            AND (claimed_at_utc IS NULL OR claimed_at_utc <= ?)`
      )
      .run(cutoff).changes;
  }

  /** Returns parked FAILED rows to PENDING with their retry budget restored. */
  public requeueFailedItems(): number {
    return this.dbConn
      .getDb()
      .prepare(
        `UPDATE worklog_sync_queue
            SET status = 'PENDING', retry_count = 0, next_attempt_at_utc = NULL
          WHERE status = 'FAILED'`
      )
      .run().changes;
  }

  /**
   * Updates sync queue item status and increments retry count.
   */
  public updateSyncItemStatus(id: string, status: 'SYNCED' | 'FAILED'): void {
    const stmt = this.dbConn.getDb().prepare(`
      UPDATE worklog_sync_queue
      SET status = ?, retry_count = retry_count + 1
      WHERE id = ?
    `);

    stmt.run(status, id);
  }

  /**
   * Increments retry count and sets status to FAILED only if maxRetries limit is reached.
   */
  public incrementRetryCount(id: string, maxRetries: number = 3): void {
    const stmt = this.dbConn.getDb().prepare(`
      UPDATE worklog_sync_queue
      SET retry_count = retry_count + 1,
          status = CASE WHEN retry_count + 1 >= ? THEN 'FAILED' ELSE 'PENDING' END
      WHERE id = ?
    `);

    stmt.run(maxRetries, id);
  }

  /**
   * The worklogs of the user's current day, newest first.
   *
   * It used to be the latest fifty whatever their day, under a table headed
   * "Today's Logged Work" with a total beside it -- so each morning the total
   * opened on yesterday's hours and disagreed with Work History for the same
   * date. The day is the local one, as everywhere a date names a day of work
   * (see local-date.ts).
   */
  public getTodaysWorklogs(now: Date = new Date()): WorklogRecord[] {
    return this.getWorklogsByDate(localDateKey(now));
  }

  /**
   * Retrieves the worklogs of a specific YYYY-MM-DD date: those that began
   * that day.
   *
   * By its start, as Jira (`started`) and OpenProject (`spentOn`) file it.
   * It used to be the day the worklog was written -- its stop -- so a
   * session from 17:00 to 01:00 showed under the second day here and under
   * the first at the provider. No index serves `started_at_utc`; the table is
   * small, and one would need a migration.
   *
   * The date is the user's local day. It used to be matched with strftime over
   * created_at_utc and no 'localtime' modifier, which grouped by the UTC day
   * instead -- so east of UTC anything logged before the offset appeared under
   * the previous day, and west of UTC an evening's work appeared under the next
   * one. See local-date.ts for why the bounds are computed in JavaScript rather
   * than in SQL.
   */
  /** A session's entries, in order: one, or a piece per day and long pause (`splitWork`). */
  public getWorklogsOfSession(sessionId: string): WorklogRecord[] {
    if (!sessionId) throw new ArgumentNullException('sessionId');
    return this.dbConn.getDb()
      .prepare<[string], WorklogRow>(`${SELECT_WORKLOGS} WHERE w.session_id = ? ORDER BY w.started_at_utc`)
      .all(sessionId)
      .map(toRecord);
  }

  /** When the task's latest entry ended (its start plus its time), or null when it has none. */
  public getLastEndOf(taskId: string): string | null {
    if (!taskId) throw new ArgumentNullException('taskId');
    const row = this.dbConn.getDb()
      .prepare<[string], { started_at_utc: string; duration_seconds: number }>(
        'SELECT started_at_utc, duration_seconds FROM worklogs WHERE task_id = ? ORDER BY started_at_utc DESC LIMIT 1'
      )
      .get(taskId);
    return row ? new Date(Date.parse(row.started_at_utc) + row.duration_seconds * 1000).toISOString() : null;
  }

  /**
   * The worklogs begun on the local days `fromKey` to `toKey`, both
   * included, in the order worked: a week (S15) or an export.
   */
  public getWorklogsBetween(fromKey: string, toKey: string): WorklogRecord[] {
    if (!fromKey) throw new ArgumentNullException('fromKey');
    if (!toKey) throw new ArgumentNullException('toKey');
    const { startUtc } = localDayBoundsUtc(fromKey);
    const { endUtc } = localDayBoundsUtc(toKey);
    return this.dbConn.getDb()
      .prepare<[string, string], WorklogRow>(
        `${SELECT_WORKLOGS} WHERE w.started_at_utc >= ? AND w.started_at_utc < ? ORDER BY w.started_at_utc`
      )
      .all(startUtc, endUtc)
      .map(toRecord);
  }

  /**
   * The sends queued since `sinceUtc` for time begun on the local days
   * `fromKey` to `toKey` (Check my week, P9d): what moved in a week after it
   * closed. Read from the queue rather than the worklogs, since a deletion
   * leaves no worklog, and a correction rewrites its row in place.
   */
  public getQueuedChangesBetween(fromKey: string, toKey: string, sinceUtc: string): WeekChangeDTO[] {
    if (!fromKey) throw new ArgumentNullException('fromKey');
    if (!toKey) throw new ArgumentNullException('toKey');
    if (!sinceUtc) throw new ArgumentNullException('sinceUtc');
    const { startUtc } = localDayBoundsUtc(fromKey);
    const { endUtc } = localDayBoundsUtc(toKey);
    const rows = this.dbConn.getDb()
      .prepare<[string, string, string], {
        id: string; operation: WeekChangeDTO['operation']; task_key: string | null; started_at_utc: string;
        duration_seconds: number; created_at_utc: string; status: SyncQueueStatus;
      }>(
        `SELECT q.id, q.operation, t.key AS task_key, q.started_at_utc, q.duration_seconds, q.created_at_utc, q.status
           FROM worklog_sync_queue q
           LEFT JOIN tasks t ON t.id = q.task_id
          WHERE q.started_at_utc >= ? AND q.started_at_utc < ? AND q.created_at_utc >= ?
          ORDER BY q.created_at_utc`
      )
      .all(startUtc, endUtc, sinceUtc);
    return rows.map(row => ({
      id: row.id,
      operation: row.operation,
      taskKey: row.task_key,
      startedAtUtc: row.started_at_utc,
      durationSeconds: row.duration_seconds,
      queuedAtUtc: row.created_at_utc,
      state: row.status === 'SYNCED' ? 'sent' : row.status === 'FAILED' ? 'failed' : 'waiting'
    }));
  }

  public getWorklogsByDate(dateString: string): WorklogRecord[] {
    if (!dateString) return this.getTodaysWorklogs();

    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return [];

      const stmt = db.prepare<[string, string], WorklogRow>(
        `${SELECT_WORKLOGS}
          WHERE w.started_at_utc >= ? AND w.started_at_utc < ?
          ORDER BY w.started_at_utc DESC`
      );

      // Half-open, so an entry exactly at local midnight belongs to the day
      // beginning then rather than the one ending.
      const { startUtc, endUtc } = localDayBoundsUtc(dateString);
      return stmt.all(startUtc, endUtc).map(toRecord);
    } catch (err) {
      console.warn(`[WorklogRepository] Failed to fetch worklogs for date ${dateString}:`, err);
      return [];
    }
  }

  /**
   * Every worklog of an interruption still to sort, whatever its day, newest
   * first: what History lists until each is named or assigned.
   */
  public getUnsortedWorklogs(): WorklogRecord[] {
    try {
      const db = this.dbConn.getDb();
      if (!db || !db.open) return [];
      return db.prepare<[], WorklogRow>(
        `${SELECT_WORKLOGS}
          WHERE t.unsorted = 1
          ORDER BY w.started_at_utc DESC`
      ).all().map(toRecord);
    } catch (err) {
      console.warn('[WorklogRepository] Failed to fetch the worklogs to sort:', err);
      return [];
    }
  }

  /**
   * Generates a daily summary report of hours and tasks for a given YYYY-MM-DD date.
   */
  public getDailySummary(dateString: string): {
    date: string;
    totalSeconds: number;
    tasksCount: number;
    items: Array<{
      taskId: string;
      key: string;
      title: string;
      durationSeconds: number;
      comment: string;
      unsorted?: true;
    }>;
  } {
    const logs = this.getWorklogsByDate(dateString);
    let totalSeconds = 0;
    const taskMap = new Map<string, { taskId: string; key: string; title: string; durationSeconds: number; comment: string; unsorted?: true }>();

    for (const log of logs) {
      totalSeconds += log.durationSeconds;
      const existing = taskMap.get(log.taskId);
      if (existing) {
        existing.durationSeconds += log.durationSeconds;
        if (log.comment && !existing.comment.includes(log.comment)) {
          existing.comment += `; ${log.comment}`;
        }
      } else {
        // Named from the task row. This used to guess: the key was whatever
        // followed the first underscore in the id -- the random half of an
        // ad-hoc id, all of a Jira `10001` -- and the title was the worklog's
        // comment, which is "Completed session via SprintTicker" for nearly
        // every session.
        taskMap.set(log.taskId, {
          taskId: log.taskId,
          key: log.taskKey ?? log.taskId,
          title: log.taskTitle ?? log.taskId,
          durationSeconds: log.durationSeconds,
          comment: log.comment,
          ...(log.unsorted ? { unsorted: true as const } : {})
        });
      }
    }

    const items = Array.from(taskMap.values());
    return {
      date: dateString,
      totalSeconds,
      tasksCount: items.length,
      items
    };
  }
}
