import type { WorklogSyncState } from './worklog-correction';

/**
 * A day's entries counted (S14, P9a): its total, each task's share, and where
 * the sends stand. Shared because History's day, its week (P9c) and Check my
 * week (P9d) all count the same entries, and two counts of one day that
 * disagree is the stale-number hazard of §9 in a view.
 */

/** What a day count reads of an entry. */
export interface CountedEntry {
  taskId: string;
  taskKey?: string;
  taskTitle?: string;
  durationSeconds: number;
  syncState?: WorklogSyncState;
}

export interface TaskShare {
  taskId: string;
  key: string;
  title: string;
  seconds: number;
}

export interface DaySummary {
  totalSeconds: number;
  entries: number;
  /** Each task once, the most time first; a tie keeps the order met. */
  tasks: TaskShare[];
}

/** Tasks named in the one-line breakdown before "+ N": a long day stays one line. */
export const BREAKDOWN_SHOWN = 4;

export function summarizeDay(entries: readonly CountedEntry[]): DaySummary {
  const byTask = new Map<string, TaskShare>();
  let totalSeconds = 0;
  for (const entry of entries) {
    totalSeconds += entry.durationSeconds;
    const share = byTask.get(entry.taskId);
    if (share) share.seconds += entry.durationSeconds;
    else {
      byTask.set(entry.taskId, {
        taskId: entry.taskId,
        key: entry.taskKey ?? entry.taskId,
        title: entry.taskTitle ?? entry.taskKey ?? entry.taskId,
        seconds: entry.durationSeconds
      });
    }
  }
  const tasks = [...byTask.values()].sort((a, b) => b.seconds - a.seconds);
  return { totalSeconds, entries: entries.length, tasks };
}

/** Where a day's sends stand, as a few words: "all sent", "all sent but 1 correction". */
export function describeSends(entries: readonly CountedEntry[]): string {
  const count = (states: readonly (WorklogSyncState | undefined)[]) =>
    entries.filter(entry => states.includes(entry.syncState)).length;
  const sent = count(['sent']);
  const unsent: string[] = [];
  const waiting = count(['pending']);
  const corrections = count(['correction-pending', 'correction-failed']);
  const failed = count(['failed']);
  const held = count(['held-overlap']);
  if (waiting) unsent.push(`${waiting} waiting`);
  if (corrections) unsent.push(`${corrections} ${corrections === 1 ? 'correction' : 'corrections'}`);
  if (failed) unsent.push(`${failed} failed`);
  if (held) unsent.push(`${held} held for an overlap`);

  if (unsent.length === 0) return sent > 0 ? 'all sent' : entries.length > 0 ? 'kept in SprintTicker' : '';
  return sent > 0 ? `all sent but ${unsent.join(', ')}` : unsent.join(', ');
}
