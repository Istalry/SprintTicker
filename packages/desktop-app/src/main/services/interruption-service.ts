import type Database from 'better-sqlite3';
import type { TimeTrackingEngine } from '../engine/time-tracking-engine';
import type { WorklogCorrectionService } from './worklog-correction-service';
import type { UndoService } from './undo-service';
import { RestorePoint, RowScope } from '../db/restore-point';
import { ArgumentException, ArgumentNullException } from '../../shared/dtos';
import { InterruptionToPlaceDTO } from '../../shared/interruption';
import { undoLabel } from '../../shared/words';
import { formatHoursAndMinutes } from '../../shared/time-format';

/** What placing reaches. */
export interface InterruptionServiceDeps {
  engine: Pick<
    TimeTrackingEngine,
    | 'placeInterruption'
    | 'markLegacyInterruptionPlaced'
    | 'legacyWorklogOf'
    | 'keepInterruptionOff'
    | 'discardInterruption'
    | 'renameInterruption'
    | 'getInterruptionsToPlace'
  >;
  /** Moves an old-model interruption's entry, which already exists, to the task. */
  corrections?: Pick<WorklogCorrectionService, 'reassign'>;
  db?: Database.Database;
  undo?: UndoService;
  /** Called after an undo put rows back, so the window reads them again. */
  onRestored?: () => void;
  getTaskKey: (taskId: string) => string | null;
}

/**
 * Placing, keeping off and discarding interruptions that ended (P6): what
 * the window's lists, the wrap-up and History do with them. The running
 * interruption's own actions -- Back, Another, Stop, Switch -- are the
 * engine's, which every surface already reaches.
 *
 * Placing and discarding offer Undo for ten seconds, as any send does (P5):
 * the rows are put back by a restore point, never by an inverse written here.
 */
export class InterruptionService {
  private readonly _deps: InterruptionServiceDeps;

  constructor(deps: InterruptionServiceDeps) {
    if (!deps?.engine) throw new ArgumentNullException('engine');
    this._deps = deps;
  }

  public getToPlace(): InterruptionToPlaceDTO[] {
    return this._deps.engine.getInterruptionsToPlace();
  }

  public rename(id: string, name: string): void {
    if (!id) throw new ArgumentNullException('id');
    this._deps.engine.renameInterruption(id, name);
  }

  /**
   * Places each interruption on the task: a worklog of its span, sent like
   * any other entry. An earlier interruption -- an ad-hoc worklog of the
   * model before -- is placed by moving that worklog.
   */
  public place(ids: readonly string[], taskId: string): void {
    if (!ids?.length) throw new ArgumentException('Choose at least one interruption to place.', 'ids');
    if (!taskId) throw new ArgumentNullException('taskId');
    const waiting = new Map(this._deps.engine.getInterruptionsToPlace().map(f => [f.id, f]));
    for (const id of ids) {
      if (!waiting.has(id)) throw new ArgumentException(`Interruption ${id} is not waiting to be placed.`, 'ids');
    }
    const point = this.capture(ids, taskId);
    for (const id of ids) {
      const legacy = this._deps.engine.legacyWorklogOf(id);
      if (legacy) {
        if (!this._deps.corrections) throw new Error('Moving an earlier interruption needs the worklog corrections.');
        // A move: the correction service retires the ad-hoc task it empties.
        this._deps.corrections.reassign(legacy, taskId);
        this._deps.engine.markLegacyInterruptionPlaced(id, taskId);
      } else {
        this._deps.engine.placeInterruption(id, taskId);
      }
    }
    const seconds = ids.reduce((sum, id) => sum + (waiting.get(id)?.durationSeconds ?? 0), 0);
    this.offer(point, 'place', this._deps.getTaskKey(taskId) ?? taskId, seconds);
  }

  /** Keeps each off the provider: in History as ad-hoc work, never sent. */
  public keepOff(ids: readonly string[]): void {
    if (!ids?.length) throw new ArgumentException('Choose at least one interruption to keep off.', 'ids');
    for (const id of ids) this._deps.engine.keepInterruptionOff(id);
  }

  /** Discards one that ended and waits; its time is kept nowhere. */
  public discard(id: string): boolean {
    if (!id) throw new ArgumentNullException('id');
    const fragment = this._deps.engine.getInterruptionsToPlace().find(f => f.id === id);
    const point = this.capture([id], null);
    const result = this._deps.engine.discardInterruption(id);
    if (result.success) this.offer(point, 'discard', fragment?.title ?? id, result.discardedSeconds);
    return result.success;
  }

  private capture(ids: readonly string[], taskId: string | null): RestorePoint | null {
    if (!this._deps.db || !this._deps.undo) return null;
    const marks = ids.map(() => '?').join(', ');
    const scopes: RowScope[] = [
      { table: 'interruptions', where: `id IN (${marks})`, params: ids },
      {
        table: 'tasks',
        where: `id IN (SELECT task_id FROM worklogs WHERE id IN (SELECT legacy_worklog_id FROM interruptions WHERE id IN (${marks})))` +
          (taskId ? ' OR id = ?' : ''),
        params: taskId ? [...ids, taskId] : ids
      },
      {
        table: 'worklogs',
        where: `session_id IN (${marks}) OR id IN (SELECT legacy_worklog_id FROM interruptions WHERE id IN (${marks}))`,
        params: [...ids, ...ids]
      },
      {
        table: 'worklog_sync_queue',
        where: `worklog_id IN (SELECT id FROM worklogs WHERE session_id IN (${marks})) ` +
          `OR worklog_id IN (SELECT legacy_worklog_id FROM interruptions WHERE id IN (${marks}))`,
        params: [...ids, ...ids]
      }
    ];
    return RestorePoint.capture(this._deps.db, scopes);
  }

  private offer(point: RestorePoint | null, kind: 'place' | 'discard', key: string, seconds: number): void {
    if (!point || !this._deps.undo) return;
    point.seal();
    this._deps.undo.offer({
      kind,
      outcome: kind === 'discard' ? 'nothing' : point.queuesSends() ? 'sent' : 'kept',
      label: undoLabel(kind, key, formatHoursAndMinutes(seconds)),
      undo: () => {
        if (!point.restore()) return false;
        this._deps.onRestored?.();
        return true;
      }
    });
  }
}
