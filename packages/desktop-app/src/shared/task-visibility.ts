import { TaskDTO } from './dtos';
import { TaskOwnership } from './task-ownership';

/**
 * Which tasks the lists show besides the user's own.
 *
 * The sync keeps tasks nobody is assigned and a teammate's in progress
 * (`keptByDefaultScope`); whether a list shows them is this setting. One
 * setting for the window's lists and the bar's picker, read on both sides of
 * the bridge, so it lives here rather than as a copy in each (CLAUDE.md
 * section 3).
 */
export interface TaskVisibility {
  /** Tasks nobody is assigned. */
  unassigned: boolean;
  /** Tasks assigned to someone else. */
  others: boolean;
}

/** The settings key. */
export const TASK_VISIBILITY_KEY = 'task_visibility';

/**
 * Free work shown, a teammate's hidden: chosen by the user (2026-10-16). Free
 * work is work they may take; a teammate's is context, asked for when wanted.
 */
export const DEFAULT_TASK_VISIBILITY: Readonly<TaskVisibility> = Object.freeze({ unassigned: true, others: false });

/** Whether a value is a complete visibility, as the setter requires. */
export function isTaskVisibility(value: unknown): value is TaskVisibility {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.unassigned === 'boolean' && typeof candidate.others === 'boolean';
}

/**
 * A stored value as a visibility. A field missing or of the wrong type takes
 * its default, so a damaged setting never hides the user's own work -- which
 * no setting hides anyway.
 */
export function parseTaskVisibility(value: unknown): TaskVisibility {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    unassigned: typeof candidate.unassigned === 'boolean' ? candidate.unassigned : DEFAULT_TASK_VISIBILITY.unassigned,
    others: typeof candidate.others === 'boolean' ? candidate.others : DEFAULT_TASK_VISIBILITY.others
  };
}

/** What reads a stored setting: main's settings repository, named without importing it. */
export interface SettingsReader {
  getSetting<T>(key: string, defaultValue: T): T;
}

/** The visibility as stored, for main's two readers: the IPC getter and the bar's picker. */
export function readTaskVisibility(settings: SettingsReader): TaskVisibility {
  return parseTaskVisibility(settings.getSetting<unknown>(TASK_VISIBILITY_KEY, DEFAULT_TASK_VISIBILITY));
}

/** Whether a list shows a task. The user's own always. */
export function isTaskShown(task: Pick<TaskDTO, 'ownership'>, visibility: TaskVisibility): boolean {
  switch (task.ownership ?? TaskOwnership.MINE) {
    case TaskOwnership.UNASSIGNED:
      return visibility.unassigned;
    case TaskOwnership.OTHER:
      return visibility.others;
    default:
      return true;
  }
}

export interface TaskVisibilityResult<T> {
  /** The tasks to list, in the order given. */
  visible: T[];
  /** How many the setting hid, so a list can say so rather than look short. */
  hiddenCount: number;
}

/**
 * The tasks a list shows. `keepIds` stay whoever's they are: the running
 * session's task, so hiding a teammate's work does not take away the row the
 * user stops their own session from.
 */
export function visibleTasks<T extends Pick<TaskDTO, 'id' | 'ownership'>>(
  tasks: readonly T[],
  visibility: TaskVisibility,
  keepIds: readonly string[] = []
): TaskVisibilityResult<T> {
  const visible = tasks.filter(t => isTaskShown(t, visibility) || keepIds.includes(t.id));
  return { visible, hiddenCount: tasks.length - visible.length };
}

/** Whose a task is, as the window says it: null for the user's own. */
export function ownerLabel(task: Pick<TaskDTO, 'ownership' | 'assigneeName'>): string | null {
  switch (task.ownership ?? TaskOwnership.MINE) {
    case TaskOwnership.UNASSIGNED:
      return 'Unassigned';
    case TaskOwnership.OTHER:
      return task.assigneeName?.trim() || 'Someone else';
    default:
      return null;
  }
}

/**
 * Whose a task is, in as few characters as the bar's row 1 allows: empty for
 * the user's own, `free` for nobody's, `@` and the first name for a
 * teammate's. Row 1 holds the key and about a word more before the list
 * position, so a full name or "unassigned" would push out everything else.
 */
export function ownerTag(task: Pick<TaskDTO, 'ownership' | 'assigneeName'>): string {
  switch (task.ownership ?? TaskOwnership.MINE) {
    case TaskOwnership.UNASSIGNED:
      return 'free';
    case TaskOwnership.OTHER: {
      const firstName = task.assigneeName?.trim().split(/\s+/)[0];
      return firstName ? `@${firstName}` : '@other';
    }
    default:
      return '';
  }
}
