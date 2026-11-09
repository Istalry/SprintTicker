/**
 * The plugin's actions: what a user can drag onto a key. One list, read by
 * the actions, the faces and the asset generator; `manifest.json` repeats
 * the UUIDs because Stream Deck reads them from there, and a test holds the
 * two equal.
 */

/** Reverse-DNS, as the manifest requires; the Unity plugin's id, too. */
export const PLUGIN_UUID = 'io.github.istalry.sprintticker';

export const KEY_KINDS = [
  /**
   * The running session: a press pauses or resumes it, or opens the task
   * picker when nothing runs; held, it opens the picker whatever runs.
   */
  'session',
  /** Starts an interruption, whatever runs: a timer at once. */
  'interrupt',
  /**
   * The answer keys, the layout the user chose (2026-11-09): three keys
   * showing whichever answers apply, so Session, Interrupt and these fill a
   * Mini's six keys with one to spare. A says yes or DONE, B no or NOT
   * DONE; C is DISCARD whatever is asked, so the one key that throws work
   * away never changes under a finger. See `answerKind`.
   */
  'answer-a',
  'answer-b',
  'answer-c',
  /*
   * The five fixed ends the answer keys replace. Hidden from Stream Deck's list
   * (`VisibleInActionsList`) but still declared and still working, so a
   * deck laid out with them keeps its keys.
   */
  /** Ends the session, task left open. */
  'not-done',
  /** Ends it and marks the task done; asks first when it is no longer the user's. */
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

/** What an answer key can mean: one of the fixed keys it stands in for. */
export type FixedKind = Exclude<KeyKind, AnswerKind>;

/** The kinds the answer keys replace, kept working and hidden from the list. */
export const HIDDEN_KINDS: readonly KeyKind[] = ['not-done', 'done', 'discard', 'yes', 'no'];

export function isAnswerKind(kind: KeyKind): kind is AnswerKind {
  return (ANSWER_KINDS as readonly string[]).includes(kind);
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
