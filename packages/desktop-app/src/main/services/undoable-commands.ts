import type Database from 'better-sqlite3';
import type { TimeTrackingEngine } from '../engine/time-tracking-engine';
import type { DisplayRenderer } from '../hardware/display-renderer';
import type { WorklogRecord, WorklogRepository } from '../db/repositories/worklog-repository';
import type { WorklogCorrectionService } from './worklog-correction-service';
import { RestorePoint, RowScope } from '../db/restore-point';
import { UndoService } from './undo-service';
import { completeSession, SessionEnding } from './session-commands';
import { undoLabel } from '../../shared/words';
import { formatHoursAndMinutes } from '../../shared/time-format';
import { WorklogCorrectionDTO } from '../../shared/worklog-correction';

/** What an undoable command reaches. */
export interface UndoableDeps {
  db: Database.Database;
  undo: UndoService;
  engine: Pick<TimeTrackingEngine, 'getCurrentSession' | 'stopSession' | 'discardSession' | 'resumeAfterUndo'>;
}

/** The rows a session's end writes: the session, its task, its worklogs and their sends. */
function sessionScopes(sessionId: string, taskId: string): RowScope[] {
  return [
    { table: 'active_sessions', where: 'id = ?', params: [sessionId] },
    { table: 'tasks', where: 'id = ?', params: [taskId] },
    { table: 'worklogs', where: 'session_id = ?', params: [sessionId] },
    {
      table: 'worklog_sync_queue',
      where: 'worklog_id IN (SELECT id FROM worklogs WHERE session_id = ?)',
      params: [sessionId]
    }
  ];
}

/** The rows a change to one worklog touches: it, its sends, and the tasks it moves between. */
function worklogScopes(worklogId: string, taskIds: readonly string[]): RowScope[] {
  return [
    { table: 'tasks', where: `id IN (${taskIds.map(() => '?').join(', ')})`, params: taskIds },
    { table: 'worklogs', where: 'id = ?', params: [worklogId] },
    { table: 'worklog_sync_queue', where: 'worklog_id = ?', params: [worklogId] }
  ];
}

/**
 * Puts a session back and has the engine take it up -- refused while another
 * session is open: the one open session is a unique index, and the user has
 * moved on.
 */
function reopen(deps: UndoableDeps, point: RestorePoint): boolean {
  if (deps.engine.getCurrentSession()) return false;
  if (!point.restore()) return false;
  deps.engine.resumeAfterUndo();
  return true;
}

/**
 * Stop (or Done) as the window's, the deck's: logs the session, holds its
 * sends and its Done transition, and offers Undo. Undo reopens the session
 * as it was -- same id, pauses kept, the timer running on.
 */
export function stopUndoably(
  deps: UndoableDeps,
  renderer: Pick<DisplayRenderer, 'renderTaskCompletionConfetti' | 'renderTaskLogged'>,
  comment?: string,
  markDone?: boolean
): { success: boolean; loggedSeconds: number } {
  const active = deps.engine.getCurrentSession();
  if (!active) return { success: false, loggedSeconds: 0 };
  const point = RestorePoint.capture(deps.db, sessionScopes(active.sessionId, active.taskId));
  const held: Array<() => void> = [];
  const result = completeSession(
    { stopSession: (c, d) => deps.engine.stopSession(c, d, { holdRemote: send => held.push(send) }) },
    renderer,
    comment,
    markDone
  );
  if (!result.success) return result;
  point.seal();
  deps.undo.offer({
    kind: 'stop',
    label: undoLabel(markDone ? 'done' : 'stop', active.taskKey, formatHoursAndMinutes(result.loggedSeconds)),
    undo: () => reopen(deps, point),
    commit: () => held.forEach(send => send())
  });
  return result;
}

/** Discard, held: nothing was written, and Undo brings the session back. */
export function discardUndoably(deps: UndoableDeps): { success: boolean; discardedSeconds: number } {
  const active = deps.engine.getCurrentSession();
  if (!active) return { success: false, discardedSeconds: 0 };
  const point = RestorePoint.capture(deps.db, sessionScopes(active.sessionId, active.taskId));
  const result = deps.engine.discardSession();
  if (!result.success) return result;
  point.seal();
  deps.undo.offer({
    kind: 'discard',
    label: undoLabel('discard', active.taskKey, formatHoursAndMinutes(result.discardedSeconds)),
    undo: () => reopen(deps, point)
  });
  return result;
}

/** What the worklog edits reach, besides the undo. */
export interface WorklogEditDeps extends Pick<UndoableDeps, 'db' | 'undo'> {
  worklogs: Pick<WorklogRepository, 'getWorklogById'>;
  corrections: Pick<WorklogCorrectionService, 'correct' | 'reassign' | 'remove'>;
  /** Called after an undo put rows back, so the window reads them again. */
  onRestored: () => void;
}

function offerWorklogUndo(
  deps: WorklogEditDeps,
  point: RestorePoint,
  kind: 'correct' | 'move' | 'delete',
  label: string
): void {
  point.seal();
  deps.undo.offer({
    kind,
    label,
    undo: () => {
      if (!point.restore()) return false;
      deps.onRestored();
      return true;
    }
  });
}

function worklogOrThrow(deps: WorklogEditDeps, worklogId: string): WorklogRecord {
  const worklog = deps.worklogs.getWorklogById(worklogId);
  // The service throws its own refusal for an unknown worklog.
  return worklog ?? ({ id: worklogId, taskId: '', durationSeconds: 0 } as WorklogRecord);
}

/** A correction, held, with Undo putting the worklog and its sends back. */
export function correctUndoably(deps: WorklogEditDeps, worklogId: string, correction: WorklogCorrectionDTO): WorklogRecord {
  const before = worklogOrThrow(deps, worklogId);
  const point = RestorePoint.capture(deps.db, worklogScopes(worklogId, [before.taskId]));
  const corrected = deps.corrections.correct(worklogId, correction);
  offerWorklogUndo(deps, point, 'correct', undoLabel('correct', corrected.taskKey ?? corrected.taskId, formatHoursAndMinutes(corrected.durationSeconds)));
  return corrected;
}

/** A move to another task, held: Undo puts it back on the task it left, its ad-hoc task too. */
export function moveUndoably(deps: WorklogEditDeps, worklogId: string, taskId: string): WorklogRecord {
  const before = worklogOrThrow(deps, worklogId);
  const point = RestorePoint.capture(deps.db, worklogScopes(worklogId, [before.taskId, taskId]));
  const moved = deps.corrections.reassign(worklogId, taskId);
  offerWorklogUndo(deps, point, 'move', undoLabel('move', moved.taskKey ?? moved.taskId, formatHoursAndMinutes(moved.durationSeconds)));
  return moved;
}

/** A deletion, held: Undo brings the worklog back with its sends. */
export function deleteUndoably(deps: WorklogEditDeps, worklogId: string): void {
  const before = worklogOrThrow(deps, worklogId);
  const point = RestorePoint.capture(deps.db, worklogScopes(worklogId, [before.taskId]));
  deps.corrections.remove(worklogId);
  offerWorklogUndo(deps, point, 'delete', undoLabel('delete', before.taskKey ?? before.taskId, formatHoursAndMinutes(before.durationSeconds)));
}

/** Stop, Done and Discard with Undo: what main hands the window and the deck. */
export function undoableSessionEnding(
  deps: UndoableDeps,
  renderer: Pick<DisplayRenderer, 'renderTaskCompletionConfetti' | 'renderTaskLogged'>
): SessionEnding {
  return {
    complete: (comment, markDone) => stopUndoably(deps, renderer, comment, markDone),
    discard: () => discardUndoably(deps)
  };
}
