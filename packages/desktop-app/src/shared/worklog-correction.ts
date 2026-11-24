/**
 * Correcting a worklog already written, shared so the window refuses exactly
 * what main refuses.
 */

/**
 * Longest comment a correction may carry.
 *
 * Not a provider limit -- Jira and OpenProject take far more -- but a worklog
 * comment is a line in a timesheet, and the marker the queue appends
 * (`syncMarker`) must survive whatever the provider does to a long text.
 */
export const WORKLOG_COMMENT_MAX_CHARS = 1000;

/**
 * What a correction may change. Not the task: Jira cannot move a worklog
 * between issues, so a move is a deletion and a new send
 * (`WorklogCorrectionService.reassign`), not a correction.
 */
export interface WorklogCorrectionDTO {
  durationSeconds: number;
  startedAtUtc: string;
  comment: string;
}

/**
 * Where a worklog stands with its provider.
 *
 * - `local`: never queued -- ad-hoc work, a session too short for the
 *   provider, a session recovered by a migration, or one sent before the
 *   queue knew its worklogs and not tied to it since (migration 8). Corrected
 *   here only.
 * - `pending` / `failed`: the send has not arrived yet, or is parked.
 * - `refused`: the provider turned the send down for good (P11c) -- time
 *   tracking off on the issue, the issue gone. Never retried; moved or kept
 *   off the provider.
 * - `sent`: at the provider.
 * - `correction-pending` / `correction-failed`: a correction or deletion is
 *   on its way, or parked.
 */
export type WorklogSyncState =
  | 'local'
  | 'pending'
  | 'sent'
  | 'failed'
  | 'refused'
  | 'correction-pending'
  | 'correction-failed'
  /** Not sent, and waiting: it overlaps an earlier entry (`shared/overlap.ts`). */
  | 'held-overlap';

/**
 * Time added by hand (S16b, "+ Add time"): an entry nobody timed, on a task,
 * sent like any other.
 */
export interface ManualWorklogDTO extends WorklogCorrectionDTO {
  /** Empty when the time goes on new work of the user's own (`ownTitle`). */
  taskId: string;
  /** New work of the user's own, by its name: its time stays here (2026-11-24). */
  ownTitle?: string;
  /** The user's own project it goes in, made when none has that name; none is Your own work. */
  ownProject?: string;
}

/**
 * Where a move, added time or a split's rest goes, as the bridge sends it:
 * a task's id -- a provider's, a project made here, or work of the user's
 * own -- or new work of the user's own by its name, in a project of theirs
 * when `ownProject` names one (LOCAL-WORK-AND-CALENDAR.md).
 */
export type WorklogTarget = string | { ownTitle: string; ownProject?: string };

/** `value` as a target, or null when it is neither a task id nor a name. */
export function readWorklogTarget(value: unknown): WorklogTarget | null {
  if (typeof value === 'string') return value ? value : null;
  const ownTitle = (value as { ownTitle?: unknown } | null)?.ownTitle;
  const ownProject = (value as { ownProject?: unknown } | null)?.ownProject;
  if (typeof ownTitle !== 'string' || !ownTitle.trim()) return null;
  if (ownProject !== undefined && typeof ownProject !== 'string') return null;
  return ownProject?.trim() ? { ownTitle, ownProject: ownProject.trim() } : { ownTitle };
}

/**
 * Why `entry` cannot be added, as a sentence, or null when it can: the rules
 * of a correction, and one more -- it ends on the day it starts, as every
 * worklog does (`splitWork`), since a provider files it under that day.
 */
export function checkManualWorklog(entry: ManualWorklogDTO, nowMs: number, minimumSeconds: number = 1): string | null {
  if (!entry.taskId && !entry.ownTitle?.trim()) return 'Choose the task the time goes to.';
  const refusal = checkWorklogCorrection(entry, nowMs, minimumSeconds);
  if (refusal) return refusal;
  const start = new Date(entry.startedAtUtc);
  const lastSecond = new Date(start.getTime() + (entry.durationSeconds - 1) * 1000);
  if (start.toDateString() !== lastSecond.toDateString()) {
    return 'An entry ends on the day it starts: add the time after midnight as another.';
  }
  return null;
}

/**
 * Why `correction` cannot be made, as a sentence for the user, or null when
 * it can.
 *
 * `minimumSeconds` is the provider's floor (`minimumLoggableSeconds`): main
 * knows it, the window does not and passes 1, and main's refusal is shown.
 */
export function checkWorklogCorrection(
  correction: WorklogCorrectionDTO,
  nowMs: number,
  minimumSeconds: number = 1
): string | null {
  const { durationSeconds, startedAtUtc, comment } = correction;
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1) {
    return 'The duration must be at least a second.';
  }
  if (durationSeconds < minimumSeconds) {
    return `The provider records at least ${Math.ceil(minimumSeconds / 60)} minute(s); a shorter worklog cannot be sent.`;
  }
  const start = Date.parse(startedAtUtc);
  if (Number.isNaN(start)) return 'The start is not a date and time.';
  if (start + durationSeconds * 1000 > nowMs) return 'The worklog cannot end in the future.';
  if (typeof comment !== 'string') return 'The comment must be text.';
  if (comment.length > WORKLOG_COMMENT_MAX_CHARS) {
    return `The comment is longer than ${WORKLOG_COMMENT_MAX_CHARS} characters.`;
  }
  return null;
}

/** Where an entry is split (S16c, P9e): the moment, and the task the second piece goes to. */
export interface WorklogSplitDTO {
  atUtc: string;
  /** The task the rest goes on: a provider's, a project made here, or work of the user's own. */
  taskId?: string;
  /** Or new work of the user's own, by its name: its time stays here (2026-11-24). */
  ownTitle?: string;
  /** The user's own project that new work goes in; none is Your own work. */
  ownProject?: string;
}

/**
 * The two pieces of an entry split at `atUtc`, in whole seconds, or why it
 * cannot be: the moment must fall inside the entry, a whole second after its
 * start and before its end. Shared, so the window's slider and main's check
 * cut at the same second.
 */
export function splitPieces(
  entry: { startedAtUtc: string; durationSeconds: number },
  atUtc: string
): { firstSeconds: number; secondSeconds: number } | string {
  const startMs = Date.parse(entry.startedAtUtc);
  const atMs = Date.parse(atUtc);
  if (Number.isNaN(atMs)) return 'Choose when the entry is split.';
  const firstSeconds = Math.round((atMs - startMs) / 1000);
  const secondSeconds = entry.durationSeconds - firstSeconds;
  if (firstSeconds < 1 || secondSeconds < 1) return 'Split it between its start and its end.';
  return { firstSeconds, secondSeconds };
}
