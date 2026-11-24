/**
 * Work of the user's own started on the fly (LOCAL-WORK-AND-CALENDAR.md §2):
 * `Project: Task: note` typed in the picker, or the same three fields in its
 * form. Shared, so the picker reads a line the way main makes it.
 */

/** What to start: a task in a project of the user's own, or in *Your own work* without one. */
export interface OwnWork {
  title: string;
  /** A project of the user's own, by name; made when none has it. Absent: *Your own work*. */
  project?: string;
  /** The entry's note, kept on the session until Stop. */
  note?: string;
}

/** A project name, a task name and a note are each kept to this, as a title is elsewhere. */
export const OWN_WORK_FIELD_MAX = 200;
/** A project key made from a name: as long as a Jira key usually is. */
const OWN_PROJECT_KEY_MAX = 6;
/** The key of a project whose name has no letter or digit to make one of. */
const OWN_PROJECT_KEY_FALLBACK = 'OWN';

/**
 * Splits at a colon followed by a space -- never a bare colon, so "Sync at
 * 10:30" stays one name. One such colon is `Project: Task`, two or more add
 * the note, which keeps any colon after the second.
 */
const SEPARATOR = /:\s+/;

/**
 * Reads the picker's one line. A piece left empty -- `Dash:` alone, `: Backup`
 * -- leaves the line a plain name, as it was before projects could be named.
 */
export function parseOwnWorkLine(line: string): OwnWork {
  const text = line.trim();
  const pieces = text.split(SEPARATOR);
  if (pieces.length < 2) return { title: text };
  const [project, title, ...rest] = pieces.map(piece => piece.trim());
  if (!project || !title) return { title: text };
  const note = rest.join(': ').trim();
  return note ? { project, title, note } : { project, title };
}

/** The same name, whatever its case and spacing: "Backup  files" is "backup files". */
export function sameOwnName(a: string, b: string): boolean {
  return normalise(a) === normalise(b);
}

function normalise(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * The key a new project of the user's own gets from its name: its letters
 * and digits, upper case, six at most -- DASH for "Dash" -- with a number
 * after it when another project, of any provider, has that key already.
 */
export function ownProjectKeyFor(name: string, takenKeys: readonly string[]): string {
  const base = name.normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, OWN_PROJECT_KEY_MAX)
    || OWN_PROJECT_KEY_FALLBACK;
  const taken = new Set(takenKeys.map(key => key.toUpperCase()));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!taken.has(`${base}${n}`)) return `${base}${n}`;
  }
}

/** The next task key in a project: DASH-1, then one past the highest DASH-n there. */
export function nextOwnTaskKey(projectKey: string, existingKeys: readonly string[]): string {
  const prefix = `${projectKey.toUpperCase()}-`;
  const highest = existingKeys.reduce((max, key) => {
    if (!key.toUpperCase().startsWith(prefix)) return max;
    const n = Number(key.slice(prefix.length));
    return Number.isInteger(n) && n > max ? n : max;
  }, 0);
  return `${prefix}${highest + 1}`;
}

/**
 * Checks what the picker or a bridge call sends: a name and an optional
 * project and note, each a string within `OWN_WORK_FIELD_MAX`.
 *
 * @returns the work with its pieces trimmed, or null when it is not one.
 */
export function checkOwnWork(value: unknown): OwnWork | null {
  if (!value || typeof value !== 'object') return null;
  const { title, project, note } = value as Record<string, unknown>;
  const piece = (v: unknown): string | null | undefined =>
    v === undefined || v === null ? undefined : typeof v === 'string' && v.trim().length <= OWN_WORK_FIELD_MAX ? v.trim() : null;
  const name = piece(title);
  const inProject = piece(project);
  const withNote = piece(note);
  if (!name || inProject === null || withNote === null) return null;
  return { title: name, ...(inProject ? { project: inProject } : {}), ...(withNote ? { note: withNote } : {}) };
}
