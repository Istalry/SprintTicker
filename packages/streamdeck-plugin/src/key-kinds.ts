/**
 * The plugin's actions: what a user can drag onto a key. One list, read by
 * the actions, the faces and the asset generator; `manifest.json` repeats
 * the UUIDs because Stream Deck reads them from there, and a test holds the
 * two equal.
 */

/** Reverse-DNS, as the manifest requires; the Unity plugin's id, too. */
export const PLUGIN_UUID = 'io.github.istalry.sprintticker';

export const KEY_KINDS = [
  /** The running session: pause or resume it, or pick a task when none runs. */
  'session',
  /** Ends the session, task left open. */
  'not-done',
  /** Ends it and marks the task done; asks first when it is no longer the user's. */
  'done',
  /** Keeps nothing; always asks first. */
  'discard',
  /** Opens the window's task picker. */
  'switch',
  /** Starts one task, chosen per key. */
  'favourite',
  /** Yes to the prompt holding the bar. */
  'yes',
  /** No to it. Never the same key as yes, whatever the press length. */
  'no',
  /** Away, and back. */
  'away'
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

/**
 * What the favourite's property inspector sends: the one request it makes.
 * Kept here rather than beside the SDK's actions so a test can hold
 * `ui/favourite.html` to it without loading the SDK.
 */
export const LIST_TASKS_MESSAGE = 'list-tasks';

/** A favourite key's settings, kept by Stream Deck per key. */
export interface FavouriteSettings {
  taskId?: string;
  /** Kept with the id so the key can still name its task while the app is closed. */
  taskKey?: string;
  taskTitle?: string;
}

/**
 * A favourite's settings from what Stream Deck hands back: whatever the
 * property inspector wrote, or an older version of it. Anything not a string
 * is dropped.
 */
export function parseFavourite(raw: unknown): FavouriteSettings {
  if (typeof raw !== 'object' || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const settings: FavouriteSettings = {};
  for (const name of ['taskId', 'taskKey', 'taskTitle'] as const) {
    if (typeof r[name] === 'string' && r[name]) settings[name] = r[name];
  }
  return settings;
}
