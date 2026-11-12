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

/** What End my day reads of the session running, if any. */
export interface RunningForEndOfDay {
  elapsedSeconds: number;
  /** An interruption: its time is placed, not sent. */
  interruption: boolean;
  /** Its time goes to a provider: not ad-hoc work, nor a project made here. */
  sendable: boolean;
}

export interface EndOfDayFigures {
  loggedSeconds: number;
  /** What the provider holds of today: the last answered sends. */
  sentSeconds: number;
  /** What ending the day sends: the session running, and the entries waiting or refused. */
  toSendSeconds: number;
  toPlaceSeconds: number;
}

/**
 * End my day's figures (S17, P10a): its header line and its button, from the
 * same entries the list shows, so "send 1h 45m" is what the rows add up to.
 * An entry an overlap holds is not counted to send: it waits until fixed.
 */
export function endOfDayFigures(
  entries: ReadonlyArray<CountedEntry & { providerSeconds?: number }>,
  running: RunningForEndOfDay | null,
  waitingToPlaceSeconds: number
): EndOfDayFigures {
  const sum = (list: ReadonlyArray<{ durationSeconds: number }>) => list.reduce((total, e) => total + e.durationSeconds, 0);
  const runningWork = running && !running.interruption ? running.elapsedSeconds : 0;
  return {
    loggedSeconds: sum(entries) + runningWork,
    sentSeconds: entries.reduce((total, e) => total + (e.providerSeconds ?? 0), 0),
    toSendSeconds: sum(entries.filter(e => e.syncState === 'pending' || e.syncState === 'failed'))
      + (running?.sendable && !running.interruption ? running.elapsedSeconds : 0),
    toPlaceSeconds: waitingToPlaceSeconds + (running?.interruption ? running.elapsedSeconds : 0)
  };
}
