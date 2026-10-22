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
