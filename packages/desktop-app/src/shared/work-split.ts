import { PauseIntervalDTO } from './dtos';
import { localDateKey } from './local-date';

/**
 * How a session's time becomes worklogs: one per stretch of work, never
 * across local midnight.
 *
 * A session used to give one worklog, filed under the day it began, so
 * 23:00 to 01:00 put two hours on Monday and none on Tuesday, and a session
 * paused overnight and resumed in the morning put the morning's work on the
 * evening before. Timesheets are per day; the provider files a worklog by
 * its start, so the only way to put time on the right day is to send it
 * as several.
 *
 * The split is made when the session ends, never by a timer at midnight: a
 * timer would move the session's start, which the forgotten-session check
 * reads, and would send hours the user has not confirmed -- and it misses
 * midnight on a machine asleep.
 */

/** One worklog of a session: when its work began, and how long it ran. */
export interface WorkPiece {
  startedAtUtc: string;
  durationSeconds: number;
}

/** A pause at least this long ends a worklog, by default. 0 never does. */
export const DEFAULT_SPLIT_PAUSE_MINUTES = 15;

/** Longer than any working day: past it, a pause is not a setting but a typo. */
export const MAX_SPLIT_PAUSE_MINUTES = 480;

/** Why a split threshold cannot be kept, or null when it can. */
export function checkSplitPauseMinutes(minutes: unknown): string | null {
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 0 || minutes > MAX_SPLIT_PAUSE_MINUTES) {
    return `A pause that splits a worklog is 0 (never) to ${MAX_SPLIT_PAUSE_MINUTES} whole minutes.`;
  }
  return null;
}

interface Span {
  from: number;
  to: number;
}

/**
 * The stretches worked between the start and the end, in milliseconds.
 *
 * Only a pause that ends after it began removes time here. One that ends
 * before -- the clock set back during it -- counts negative in the session's
 * total (`workedSecondsUntil`), and that total is what the pieces add up to:
 * {@link splitWork} hands the difference to a piece, so the jump is neither
 * lost nor counted twice.
 */
function workedSpans(start: number, end: number, pauses: readonly PauseIntervalDTO[]): Span[] {
  const cuts = pauses
    .map(p => ({ from: Date.parse(p.fromUtc), to: Date.parse(p.toUtc) }))
    .filter(p => Number.isFinite(p.from) && Number.isFinite(p.to) && p.to > p.from)
    .map(p => ({ from: Math.max(start, p.from), to: Math.min(end, p.to) }))
    .filter(p => p.to > p.from)
    .sort((a, b) => a.from - b.from);

  const spans: Span[] = [];
  let cursor = start;
  for (const cut of cuts) {
    if (cut.from > cursor) spans.push({ from: cursor, to: cut.from });
    cursor = Math.max(cursor, cut.to);
  }
  if (end > cursor) spans.push({ from: cursor, to: end });
  return spans;
}

/** The next local midnight after `ms`: 23 or 25 hours on, across a change of clocks. */
function nextLocalMidnight(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/**
 * The session's time between `startUtc` and `endUtc`, as worklogs: one per
 * local day worked, and a new one after any pause of `splitPauseSeconds` or
 * more (0: pauses never split). A piece starts at the first instant worked
 * in it -- after a pause across midnight, the resume. A day with no work
 * gives no piece.
 *
 * The pieces add up to `totalSeconds` exactly, which is the time the session
 * logs either way; rounding to whole seconds, and a clock set back during a
 * pause, are settled on the longest piece. With nothing worked, or a
 * total of zero, it is one piece at the session's start, as a session
 * always logged.
 */
export function splitWork(
  startUtc: string,
  endUtc: string,
  pauses: readonly PauseIntervalDTO[],
  splitPauseSeconds: number,
  totalSeconds: number
): WorkPiece[] {
  const total = Math.max(0, Math.floor(totalSeconds));
  const single = [{ startedAtUtc: startUtc, durationSeconds: total }];
  const start = Date.parse(startUtc);
  const end = Date.parse(endUtc);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || total === 0) return single;

  const splitPauseMs = Math.max(0, splitPauseSeconds) * 1000;
  const pieces: Array<{ from: number; lastTo: number; day: string; workedMs: number }> = [];
  for (const span of workedSpans(start, end, pauses)) {
    // Each local day of a span on its own.
    for (let from = span.from; from < span.to; ) {
      const to = Math.min(span.to, nextLocalMidnight(from));
      const day = localDateKey(new Date(from));
      const last = pieces[pieces.length - 1];
      const pausedLongEnough = splitPauseMs > 0 && last !== undefined && from - last.lastTo >= splitPauseMs;
      if (last && last.day === day && !pausedLongEnough) {
        last.workedMs += to - from;
        last.lastTo = to;
      } else {
        pieces.push({ from, lastTo: to, day, workedMs: to - from });
      }
      from = to;
    }
  }
  if (pieces.length === 0) return single;
  // One stretch: all of the total, from when it began -- after a pause at
  // the very start, which is where a session from before pauses were dated
  // keeps its pauses, that is the next morning rather than the night before.
  if (pieces.length === 1) return [{ startedAtUtc: new Date(pieces[0].from).toISOString(), durationSeconds: total }];

  const result = pieces.map(p => ({ startedAtUtc: new Date(p.from).toISOString(), durationSeconds: Math.floor(p.workedMs / 1000) }));
  return settleOnTheLongest(result, total) ?? single;
}

/**
 * Brings the pieces to `total`: a difference in its favour goes to the
 * longest piece, one against it comes off the longest ones in turn. Null if
 * nothing is left to log, which only a total wildly off the pieces can do.
 */
function settleOnTheLongest(pieces: WorkPiece[], total: number): WorkPiece[] | null {
  let difference = total - pieces.reduce((sum, p) => sum + p.durationSeconds, 0);
  const longestFirst = [...pieces].sort((a, b) => b.durationSeconds - a.durationSeconds);
  if (difference > 0) longestFirst[0].durationSeconds += difference;
  for (const piece of longestFirst) {
    if (difference >= 0) break;
    const taken = Math.min(piece.durationSeconds, -difference);
    piece.durationSeconds -= taken;
    difference += taken;
  }
  const kept = pieces.filter(p => p.durationSeconds > 0);
  return kept.length > 0 ? kept : null;
}

/**
 * Folds every piece shorter than the provider can record into its longer
 * neighbour, shortest first, so no time is lost to the floor: 30 seconds
 * after midnight would otherwise be a worklog Jira refuses. The neighbour
 * keeps its start. A lone piece is left as it is -- the session as a whole
 * is then below the floor, which the caller already handles.
 */
export function mergeShortPieces(pieces: readonly WorkPiece[], minimumSeconds: number): WorkPiece[] {
  const merged = pieces.map(p => ({ ...p }));
  for (;;) {
    if (merged.length < 2) return merged;
    let shortest = -1;
    merged.forEach((p, i) => {
      if (p.durationSeconds < minimumSeconds && (shortest < 0 || p.durationSeconds < merged[shortest].durationSeconds)) shortest = i;
    });
    if (shortest < 0) return merged;
    const before = merged[shortest - 1];
    const after = merged[shortest + 1];
    const into = !after || (before && before.durationSeconds >= after.durationSeconds) ? before : after;
    into.durationSeconds += merged[shortest].durationSeconds;
    merged.splice(shortest, 1);
  }
}

/** A day's share of a session: what Work History will show on that day. */
export interface DayShare {
  dateKey: string;
  seconds: number;
}

/**
 * The session's time per local day, oldest first: the days its worklogs
 * will be filed under, whatever the pause threshold. One entry for a
 * session within a day.
 */
export function workedSecondsByLocalDay(
  startUtc: string,
  endUtc: string,
  pauses: readonly PauseIntervalDTO[],
  totalSeconds: number
): DayShare[] {
  return splitWork(startUtc, endUtc, pauses, 0, totalSeconds).map(p => ({
    dateKey: localDateKey(new Date(p.startedAtUtc)),
    seconds: p.durationSeconds
  }));
}
