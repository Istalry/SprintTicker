import { ProjectDTO } from './dtos';

/**
 * "Only my projects": which projects the lists offer.
 *
 * A provider lists every project the user can see -- for OpenProject, every
 * project they are a member of -- while the tasks it fetches follow the task
 * scope, "assigned to me" by default. So most projects in the picker held
 * nothing to pick. This hides those, everywhere a project is chosen: the
 * Projects tab, the window's task picker and the bar's own picker.
 *
 * It filters on open tasks, not on an assignee: tasks carry no assignee here,
 * and under the default scope every task fetched is the user's anyway. Under
 * "everything open" or a custom query the same switch means "projects with
 * something open", which is what the scope asked for.
 *
 * One rule in one place, because the three lists are drawn by two processes:
 * main draws the bar's, the renderer the window's, and a copy in each would
 * drift the way the notification defaults once did (CLAUDE.md section 3).
 */

/** The settings key. On by default: the user asked for the shorter list. */
export const ONLY_PROJECTS_WITH_TASKS_KEY = 'only_projects_with_tasks';
export const ONLY_PROJECTS_WITH_TASKS_DEFAULT = true;

export interface ProjectFilterResult<T> {
  /** The projects to list, in the order given. */
  visible: T[];
  /** How many the switch hid, so a list can say so rather than look short. */
  hiddenCount: number;
}

/**
 * The projects to list.
 *
 * - A project whose open-task count is unknown is kept: a provider's own
 *   project list carries no count, and hiding on a guess would lose one.
 * - `keepIds` stay whatever they hold: the project selected in the Projects
 *   tab, so one just created does not vanish before it has a task, and the
 *   running session's.
 * - If the switch would leave nothing, everything is listed. That is a first
 *   launch, or a provider that has not synced yet, and an empty picker there
 *   reads as data lost.
 */
export function filterProjectsWithTasks<T extends ProjectDTO>(
  projects: readonly T[],
  enabled: boolean,
  keepIds: readonly string[] = []
): ProjectFilterResult<T> {
  if (!enabled) return { visible: [...projects], hiddenCount: 0 };
  const visible = projects.filter(
    p => p.openTaskCount === undefined || p.openTaskCount > 0 || keepIds.includes(p.id)
  );
  if (visible.length === 0) return { visible: [...projects], hiddenCount: 0 };
  return { visible, hiddenCount: projects.length - visible.length };
}

/**
 * The project a list opens on: the first with an open task, else the first.
 * An unknown count counts as open, as above. Empty string for no projects.
 */
export function firstProjectWithTasks(projects: readonly ProjectDTO[]): string {
  return (projects.find(p => (p.openTaskCount ?? 1) > 0) ?? projects[0])?.id ?? '';
}
