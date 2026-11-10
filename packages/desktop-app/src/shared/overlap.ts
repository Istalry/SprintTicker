/**
 * Entries that overlap in time (S15b): the later one is not sent until the
 * overlap is fixed, since the same hour billed twice is the error a
 * timesheet reviewer finds first.
 *
 * The rule, here and in the queue's SQL (`WorklogRepository`):
 * - an entry runs from its start for its duration;
 * - of two entries, the **earlier** is the one that starts first, the lower
 *   id on a tie, and the later one is held;
 * - they overlap when the earlier ends after the later begins -- touching is
 *   not overlapping, so the pieces of a session split at midnight are not;
 * - two pieces of one session never overlap: they come from one timer, and
 *   the rounding settled on the longest piece can stretch it past its
 *   neighbour's start by a second.
 *
 * Only what is not yet sent is held; an entry already at the provider stays
 * there, and Check my week lists both kinds.
 */
export interface TimedEntry {
  id: string;
  sessionId?: string;
  startedAtUtc: string;
  durationSeconds: number;
}

export interface Overlap<T extends TimedEntry = TimedEntry> {
  earlier: T;
  later: T;
  /** How long they share, in whole seconds. */
  seconds: number;
}

const startMs = (entry: TimedEntry): number => Date.parse(entry.startedAtUtc);
const endMs = (entry: TimedEntry): number => startMs(entry) + entry.durationSeconds * 1000;

/** Whether `a` counts as earlier than `b`. */
function isEarlier(a: TimedEntry, b: TimedEntry): boolean {
  const byStart = startMs(a) - startMs(b);
  return byStart !== 0 ? byStart < 0 : a.id < b.id;
}

/** The overlap of two entries, or null: none, the same entry, or one session's pieces. */
export function overlapOf<T extends TimedEntry>(a: T, b: T): Overlap<T> | null {
  if (a.id === b.id) return null;
  if (a.sessionId && a.sessionId === b.sessionId) return null;
  const [earlier, later] = isEarlier(a, b) ? [a, b] : [b, a];
  const shared = Math.min(endMs(earlier), endMs(later)) - startMs(later);
  if (!(shared > 0)) return null;
  return { earlier, later, seconds: Math.ceil(shared / 1000) };
}

/** Every overlapping pair, each once, the earlier entry first. */
export function findOverlaps<T extends TimedEntry>(entries: readonly T[]): Overlap<T>[] {
  const found: Overlap<T>[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const overlap = overlapOf(entries[i], entries[j]);
      if (overlap) found.push(overlap);
    }
  }
  return found;
}

/** The earlier entry that holds `entry` back, or null when nothing does. */
export function heldByOverlap<T extends TimedEntry>(entry: T, sameDay: readonly T[]): T | null {
  for (const other of sameDay) {
    const overlap = overlapOf(entry, other);
    if (overlap && overlap.later.id === entry.id) return overlap.earlier;
  }
  return null;
}
