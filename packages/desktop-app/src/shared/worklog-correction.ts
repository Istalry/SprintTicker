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

/** What a correction may change. The task stays: Jira cannot move a worklog between issues. */
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
 * - `sent`: at the provider.
 * - `correction-pending` / `correction-failed`: a correction or deletion is
 *   on its way, or parked.
 */
export type WorklogSyncState = 'local' | 'pending' | 'sent' | 'failed' | 'correction-pending' | 'correction-failed';

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
