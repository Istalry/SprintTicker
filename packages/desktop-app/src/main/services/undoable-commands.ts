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
import { ManualWorklogDTO, WorklogCorrectionDTO, WorklogSplitDTO } from '../../shared/worklog-correction';
import { createId, IdPrefix } from '../db/id-generator';

/** What an undoable command reaches. */
export interface UndoableDeps {
  db: Database.Database;
  undo: UndoService;
  engine: Pick<TimeTrackingEngine, 'getCurrentSession' | 'stopSession' | 'discardSession' | 'resumeAfterUndo'> &
    Partial<Pick<TimeTrackingEngine, 'isInterrupted'>>;
}

/**
 * The rows a session's end writes: the session, its task, its worklogs and
 * their sends -- and, for an interruption, its fragment (whose id is the
 * session id of its view).
 */
function sessionScopes(sessionId: string, taskId: string): RowScope[] {
  return [
    { table: 'interruptions', where: 'id = ?', params: [sessionId] },
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

/**
 * The session an interruption held, which its end now resumes (2026-11-16):
 * Undo puts it back paused for the interruption, as it was.
 */
function heldScopes(heldSessionId: string | null | undefined): RowScope[] {
  if (!heldSessionId) return [];
  return [
    { table: 'active_sessions', where: 'id = ?', params: [heldSessionId] },
    { table: 'paused_intervals', where: 'session_id = ?', params: [heldSessionId] }
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
function reopen(deps: UndoableDeps, point: RestorePoint, heldSessionId: string | null = null): boolean {
  const open = deps.engine.getCurrentSession();
  // An interruption ended resumes the session it held: that one does not
  // stand in the way of bringing the interruption back -- the restore point
  // puts it back paused for it.
  if (open && !(heldSessionId && open.sessionId === heldSessionId)) return false;
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
  const point = RestorePoint.capture(deps.db, [
    ...sessionScopes(active.sessionId, active.taskId),
    ...heldScopes(active.interruption?.interruptedSessionId)
  ]);
  const held: Array<() => void> = [];
  const result = completeSession(
    {
      stopSession: (c, d) => deps.engine.stopSession(c, d, { holdRemote: send => held.push(send) }),
      isInterrupted: () => deps.engine.isInterrupted?.() ?? false
    },
    renderer,
    comment,
    markDone
  );
  if (!result.success) return result;
  point.seal();
  const fragment = active.interruption;
  deps.undo.offer({
    kind: 'stop',
    // A fragment waits to be placed; work kept here queues nothing.
    outcome: fragment ? 'to-place' : point.queuesSends() ? 'sent' : 'kept',
    label: fragment
      ? undoLabel('stop', fragment.title, formatHoursAndMinutes(active.elapsedSeconds))
      : undoLabel(markDone ? 'done' : 'stop', active.taskKey, formatHoursAndMinutes(result.loggedSeconds)),
    undo: () => reopen(deps, point, fragment?.interruptedSessionId ?? null),
    commit: () => held.forEach(send => send()),
    ...(fragment?.interruptedSessionId ? { resumes: fragment.interruptedSessionId } : {})
  });
  return result;
}

/** Discard, held: nothing was written, and Undo brings the session back. */
export function discardUndoably(deps: UndoableDeps): { success: boolean; discardedSeconds: number } {
  const active = deps.engine.getCurrentSession();
  if (!active) return { success: false, discardedSeconds: 0 };
  const point = RestorePoint.capture(deps.db, [
    ...sessionScopes(active.sessionId, active.taskId),
    ...heldScopes(active.interruption?.interruptedSessionId)
  ]);
  const result = deps.engine.discardSession();
  if (!result.success) return result;
  point.seal();
  const fragment = active.interruption;
  deps.undo.offer({
    kind: 'discard',
    outcome: 'nothing',
    label: undoLabel('discard', fragment ? fragment.title : active.taskKey, formatHoursAndMinutes(result.discardedSeconds)),
    undo: () => reopen(deps, point, fragment?.interruptedSessionId ?? null),
    ...(fragment?.interruptedSessionId ? { resumes: fragment.interruptedSessionId } : {})
  });
  return result;
}

/** What the worklog edits reach, besides the undo. */
export interface WorklogEditDeps extends Pick<UndoableDeps, 'db' | 'undo'> {
  worklogs: Pick<WorklogRepository, 'getWorklogById'>;
  corrections: Pick<WorklogCorrectionService, 'correct' | 'reassign' | 'remove' | 'add' | 'split' | 'keepOff'>;
  /** Called after an undo put rows back, so the window reads them again. */
  onRestored: () => void;
}

function offerWorklogUndo(
  deps: WorklogEditDeps,
  point: RestorePoint,
  kind: 'correct' | 'move' | 'delete' | 'add' | 'split' | 'keep-off',
  label: string
): void {
  point.seal();
  deps.undo.offer({
    kind,
    label,
    outcome: point.queuesSends() ? 'sent' : 'kept',
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

/** A refused entry kept off its provider (P11c): Undo puts its refused send back. */
export function keepOffUndoably(deps: WorklogEditDeps, worklogId: string): WorklogRecord {
  const before = worklogOrThrow(deps, worklogId);
  const point = RestorePoint.capture(deps.db, worklogScopes(worklogId, [before.taskId]));
  const kept = deps.corrections.keepOff(worklogId);
  offerWorklogUndo(deps, point, 'keep-off', undoLabel('keep-off', kept.taskKey ?? kept.taskId, formatHoursAndMinutes(kept.durationSeconds)));
  return kept;
}

/** Time added by hand, held: Undo takes the entry and its send away again. */
export function addUndoably(deps: WorklogEditDeps, entry: ManualWorklogDTO): WorklogRecord {
  // Named before it exists, so the restore point covers the rows it adds.
  const worklogId = createId(IdPrefix.WORKLOG);
  const point = RestorePoint.capture(deps.db, worklogScopes(worklogId, [entry.taskId]));
  const added = deps.corrections.add(entry, worklogId);
  offerWorklogUndo(deps, point, 'add', undoLabel('add', added.taskKey ?? added.taskId, formatHoursAndMinutes(added.durationSeconds)));
  return added;
}

/** A split in two, held: Undo puts the entry back whole and takes the second piece away, with their sends. */
export function splitUndoably(deps: WorklogEditDeps, worklogId: string, split: WorklogSplitDTO): { first: WorklogRecord; second: WorklogRecord } {
  const before = worklogOrThrow(deps, worklogId);
  // Named before they exist, so the restore point covers the rows they add:
  // the second entry, and the own work it may go on, which Undo takes away.
  const secondId = createId(IdPrefix.WORKLOG);
  const ownTaskId = createId(IdPrefix.ADHOC_TASK);
  const targetId = split.ownTitle?.trim() ? ownTaskId : split.taskId ?? ownTaskId;
  const point = RestorePoint.capture(deps.db, [
    ...worklogScopes(worklogId, [before.taskId, targetId]),
    ...worklogScopes(secondId, [targetId]).slice(1)
  ]);
  const pieces = deps.corrections.split(worklogId, split, secondId, ownTaskId);
  offerWorklogUndo(deps, point, 'split', undoLabel('split', before.taskKey ?? before.taskId, formatHoursAndMinutes(before.durationSeconds)));
  return pieces;
}

/** A deletion, held: Undo brings the worklog back with its sends. */
export function deleteUndoably(deps: WorklogEditDeps, worklogId: string): void {
  const before = worklogOrThrow(deps, worklogId);
  const point = RestorePoint.capture(deps.db, worklogScopes(worklogId, [before.taskId]));
  deps.corrections.remove(worklogId);
  offerWorklogUndo(deps, point, 'delete', undoLabel('delete', before.taskKey ?? before.taskId, formatHoursAndMinutes(before.durationSeconds)));
}

/**
 * End my day (S17, P10a), held: `stopForWrapUp` ends the interruption and
 * the session it holds, and Undo reopens both as they were. `onCommit` runs
 * once Undo has passed -- the optional shutdown waits for it -- and `onUndo`
 * when it is used, to cancel that shutdown. Offered even when nothing was
 * running, so the shutdown has the same ten seconds to be taken back.
 */
export function endDayUndoably(
  deps: UndoableDeps,
  stopForWrapUp: () => void,
  hooks: { onCommit?: () => void; onUndo?: () => void } = {}
): void {
  const active = deps.engine.getCurrentSession();
  const held = active?.interruption?.interruptedSessionId ?? null;
  const point = RestorePoint.capture(deps.db, [
    ...(active ? sessionScopes(active.sessionId, active.taskId) : []),
    ...(held ? sessionScopes(held, '') : [])
  ]);
  stopForWrapUp();
  point.seal();
  deps.undo.offer({
    kind: 'end-day',
    outcome: point.queuesSends() ? 'sent' : 'kept',
    label: undoLabel('end-day', ''),
    undo: () => {
      hooks.onUndo?.();
      return active ? reopen(deps, point) : true;
    },
    commit: () => hooks.onCommit?.()
  });
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
