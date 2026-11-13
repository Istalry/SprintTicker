import type Database from 'better-sqlite3';

/**
 * The tables an undo may put back. Named, never interpolated from input.
 * Each has a text key and so a separate `rowid`; in a table keyed by an
 * INTEGER PRIMARY KEY (`paused_intervals`) the rowid *is* the key and
 * `SELECT rowid` names it otherwise.
 */
export type RestorableTable = 'worklogs' | 'worklog_sync_queue' | 'tasks' | 'active_sessions' | 'interruptions';

/** Some rows of one table: `where` is SQL over it, with `?` bound from `params`. */
export interface RowScope {
  table: RestorableTable;
  where: string;
  params: readonly unknown[];
}

type Row = Record<string, unknown> & { rowid: number };

interface Snapshot {
  scope: RowScope;
  rows: Row[];
}

const read = (db: Database.Database, scope: RowScope): Row[] =>
  db.prepare(`SELECT rowid, * FROM ${scope.table} WHERE ${scope.where} ORDER BY rowid`).all(...scope.params) as Row[];

const sameRow = (a: Row, b: Row): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
};

/**
 * Some rows as they were before an action, to put back if it is undone.
 *
 * Generic on purpose: a stop writes worklogs, queue rows and the session; a
 * move rewrites a worklog, drops and adds queue rows and may delete an
 * ad-hoc task. Recording each action's inverse by hand is a second copy of
 * every rule those actions follow. This records the rows, before and just
 * after, and puts the "before" back -- with their rowids, which the queue's
 * order on a worklog reads (`getPendingQueueItems`).
 *
 * **Nothing is undone once anything was sent.** `isUntouched` compares the
 * queue rows with what the action left: a row the worker has claimed since
 * (SYNCING, SYNCED, an attempt counted) differs, and the undo is refused.
 * The hold (UNDO_WINDOW_MS) is what keeps them unclaimed until then. The
 * other tables are not compared: a sync rewriting a task meanwhile does not
 * make an undo unsafe, only less exact.
 */
export class RestorePoint {
  private readonly _db: Database.Database;
  private readonly _before: Snapshot[];
  private _after: Snapshot[] | null = null;

  private constructor(db: Database.Database, scopes: readonly RowScope[]) {
    this._db = db;
    this._before = scopes.map(scope => ({ scope, rows: read(db, scope) }));
  }

  /** Records the rows `scopes` select, before the action. */
  public static capture(db: Database.Database, scopes: readonly RowScope[]): RestorePoint {
    return new RestorePoint(db, scopes);
  }

  /** Records what the action left, which an undo checks nothing has moved past. */
  public seal(): void {
    this._after = this._before.map(({ scope }) => ({ scope, rows: read(this._db, scope) }));
  }

  /**
   * True when the action queued something for the provider: a queue row it
   * added or changed. Read after `seal`, to say "Sent in 7 s" only then.
   */
  public queuesSends(): boolean {
    if (!this._after) return false;
    for (const { scope, rows } of this._after) {
      if (scope.table !== 'worklog_sync_queue') continue;
      const before = this._before.find(b => b.scope === scope)?.rows ?? [];
      const byRowid = new Map(before.map(row => [row.rowid, row]));
      if (rows.some(row => !byRowid.has(row.rowid) || !sameRow(byRowid.get(row.rowid)!, row))) return true;
    }
    return false;
  }

  /** True when every queue row is as the action left it: nothing claimed or sent since. */
  public isUntouched(): boolean {
    if (!this._after) return false;
    for (const { scope, rows } of this._after) {
      if (scope.table !== 'worklog_sync_queue') continue;
      const now = read(this._db, scope);
      if (now.length !== rows.length) return false;
      for (let i = 0; i < rows.length; i++) if (!sameRow(rows[i], now[i])) return false;
    }
    return true;
  }

  /**
   * Puts the rows back as they were, in one transaction, if nothing was sent
   * since. Rows the action added are deleted, rows it changed rewritten,
   * rows it removed inserted again. Scopes are restored in reverse, so a
   * child (a queue row, a worklog) goes before the parent it names.
   *
   * @returns false, changing nothing, when a queue row moved on.
   */
  public restore(): boolean {
    if (!this._after) throw new Error('A restore point is sealed before it is restored.');
    const undo = this._db.transaction((): boolean => {
      if (!this.isUntouched()) return false;
      const deletions = [...this._before].reverse();
      for (const { scope } of deletions) {
        const keep = new Set(this._before.find(b => b.scope === scope)!.rows.map(r => r.rowid));
        for (const row of read(this._db, scope)) {
          if (!keep.has(row.rowid)) this._db.prepare(`DELETE FROM ${scope.table} WHERE rowid = ?`).run(row.rowid);
        }
      }
      // Rewritten in place where the row is still there, never REPLACEd:
      // REPLACE deletes whatever else holds a unique key -- the one open
      // session, a task its worklogs name.
      for (const { scope, rows } of this._before) {
        for (const row of rows) {
          const columns = Object.keys(row).filter(c => c !== 'rowid');
          const exists = this._db.prepare(`SELECT 1 FROM ${scope.table} WHERE rowid = ?`).get(row.rowid);
          if (exists) {
            this._db
              .prepare(`UPDATE ${scope.table} SET ${columns.map(c => `${c} = ?`).join(', ')} WHERE rowid = ?`)
              .run(...columns.map(c => row[c]), row.rowid);
          } else {
            this._db
              .prepare(`INSERT INTO ${scope.table} (rowid, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`)
              .run(row.rowid, ...columns.map(c => row[c]));
          }
        }
      }
      return true;
    });
    return undo();
  }
}
