/**
 * The plugin's actions: what a user can drag onto a key. One list, read by
 * the actions, the faces and the asset generator; `manifest.json` repeats
 * the UUIDs because Stream Deck reads them from there, and a test holds the
 * two equal -- in this order, which is the action list's.
 */

/** Reverse-DNS, as the manifest requires; the app's own id, too. */
export const PLUGIN_UUID = 'io.github.istalry.sprintticker';

export const KEY_KINDS = [
  /**
   * The running session: a press pauses or resumes it, or opens the task
   * picker when nothing runs or an interruption does; held, it opens the
   * picker whatever runs.
   */
  'session',
  /** Starts an interruption, whatever runs; during one, ANOTHER. */
  'interrupt',
  /** Starts the task timed before this one; blank during an interruption (P13). */
  'previous',
  /**
   * The answer keys, the layout the user chose (2026-11-09), with one
   * meaning per position since 0.6.0 (S29): A says yes -- DONE, BACK,
   * JOIN, RESUME, END STAND-UP -- B stops or waits, C throws away, and a
   * key with nothing to do is blank. See `answerKind`.
   */
  'answer-a',
  'answer-b',
  'answer-c',
  /** Optional keys that start the first, second or third recent task (P13). */
  'recent-1',
  'recent-2',
  'recent-3',
  /*
   * The five fixed ends the answer keys replace. Hidden from Stream Deck's list
   * (`VisibleInActionsList`) but still declared and still working, so a
   * deck laid out with them keeps its keys.
   */
  /** Ends the session, task left open: STOP. */
  'not-done',
  /** Ends it and marks the task done; always asks first. */
  'done',
  /** Keeps nothing; always asks first. */
  'discard',
  /** Yes to the prompt holding the bar. */
  'yes',
  /** No to it. Never the same key as yes, whatever the press length. */
  'no'
] as const;

export type KeyKind = (typeof KEY_KINDS)[number];

/** The answer keys, whose meaning follows the state. */
export const ANSWER_KINDS = ['answer-a', 'answer-b', 'answer-c'] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

/** The Recent keys, by position: `recent-1` starts the newest. */
export const RECENT_KINDS = ['recent-1', 'recent-2', 'recent-3'] as const;
export type RecentKind = (typeof RECENT_KINDS)[number];

/** A key that is itself whatever the state: every kind but the answer keys. */
export type FixedKind = Exclude<KeyKind, AnswerKind>;

/**
 * What a key means now. An answer key stands in for one of the fixed ends
 * or answers, or for one of two meanings no fixed key has -- BACK during an
 * interruption, END STAND-UP while it runs -- or for nothing: `blank`.
 */
export type Meaning = FixedKind | 'back' | 'end-standup' | 'blank';

/** The kinds the answer keys replace, kept working and hidden from the list. */
export const HIDDEN_KINDS: readonly KeyKind[] = ['not-done', 'done', 'discard', 'yes', 'no'];

export function isAnswerKind(kind: KeyKind): kind is AnswerKind {
  return (ANSWER_KINDS as readonly string[]).includes(kind);
}

export function isRecentKind(kind: Meaning): kind is RecentKind {
  return (RECENT_KINDS as readonly string[]).includes(kind);
}

/** Which recent task a Recent key starts, from 1. */
export function recentIndex(kind: RecentKind): number {
  return RECENT_KINDS.indexOf(kind) + 1;
}

export function actionUuid(kind: KeyKind): string {
  return `${PLUGIN_UUID}.${kind}`;
}

/** The kind an action UUID names, or null for one this plugin does not declare. */
export function kindOfUuid(uuid: string): KeyKind | null {
  const prefix = `${PLUGIN_UUID}.`;
  if (!uuid.startsWith(prefix)) return null;
  const kind = uuid.slice(prefix.length);
  return (KEY_KINDS as readonly string[]).includes(kind) ? (kind as KeyKind) : null;
}
