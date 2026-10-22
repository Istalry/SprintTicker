import { ProjectDTO } from './dtos';
import { ADHOC_PROJECT_ID } from './adhoc-project';
import { TaskVisibility } from './task-visibility';

/**
 * "Only my projects": which projects the lists offer.
 *
 * A provider lists every project the user can see -- for OpenProject, every
 * project they are a member of -- while the tasks it fetches follow the task
 * scope, "assigned to me" by default. So most projects in the picker held
 * nothing to pick. This hides those, everywhere a project is chosen: the
 * Projects tab, the window's task picker and the bar's own picker.
 *
 * It filters on the open tasks the lists would show: the user's own, plus
 * the unassigned and teammates' ones when the task visibility shows them
 * (`task-visibility.ts`). A project holding only a teammate's work is hidden
 * while their work is. Under "everything open" or a custom query the same
 * switch means "projects with something open", which is what the scope asked
 * for.
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
  /**
   * The switch is on but found nothing assigned, so everything is listed.
   * Said beside the switch: a ticked box that changes nothing reads as broken.
   */
  nothingAssigned: boolean;
}

/** The user's own work alone: what a caller that names no visibility counts. */
const OWN_WORK_ONLY: Readonly<TaskVisibility> = Object.freeze({ unassigned: false, others: false });

/**
 * Whether a project has an open task the lists would show. An unknown count
 * counts as open: hiding on a guess would lose a project.
 */
function hasOpenTask(project: ProjectDTO, visibility: TaskVisibility): boolean {
  if (project.openTaskCount === undefined) return true;
  const shown =
    project.openTaskCount +
    (visibility.unassigned ? project.openUnassignedCount ?? 0 : 0) +
    (visibility.others ? project.openOthersCount ?? 0 : 0);
  return shown > 0;
}

/**
 * The projects to list.
 *
 * - A project whose open-task count is unknown is kept: a provider's own
 *   project list carries no count.
 * - `keepIds` stay whatever they hold: the project selected in the Projects
 *   tab, so one just created does not vanish before it has a task, and the
 *   running session's.
 * - If no project the provider gave has an open task, everything is listed.
 *   That is a first launch, a provider not synced yet, or nothing assigned to
 *   the user right now, and an empty or one-project picker there reads as
 *   data lost. Decided before `keepIds` and without the ad-hoc project: the
 *   kept project used to count as "something left", so the Projects tab
 *   showed that one project alone; and an ad-hoc task stays in progress
 *   until it is finished as done, which the mini timer's Stop, the bar's STOP
 *   and the end-of-day wrap-up never do -- so the ad-hoc project nearly always
 *   has one, and was the whole list whenever nothing was assigned.
 */
export function filterProjectsWithTasks<T extends ProjectDTO>(
  projects: readonly T[],
  enabled: boolean,
  keepIds: readonly string[] = [],
  visibility: TaskVisibility = OWN_WORK_ONLY
): ProjectFilterResult<T> {
  if (!enabled) return { visible: [...projects], hiddenCount: 0, nothingAssigned: false };
  if (!projects.some(p => p.id !== ADHOC_PROJECT_ID && hasOpenTask(p, visibility))) {
    return { visible: [...projects], hiddenCount: 0, nothingAssigned: projects.length > 0 };
  }
  const visible = projects.filter(p => hasOpenTask(p, visibility) || keepIds.includes(p.id));
  return { visible, hiddenCount: projects.length - visible.length, nothingAssigned: false };
}

/**
 * The project a list opens on: the first with an open task, else the first.
 * The ad-hoc project's open task is no reason to open on it, as above. An
 * unknown count counts as open. Empty string for no projects.
 */
export function firstProjectWithTasks(
  projects: readonly ProjectDTO[],
  visibility: TaskVisibility = OWN_WORK_ONLY
): string {
  return (projects.find(p => p.id !== ADHOC_PROJECT_ID && hasOpenTask(p, visibility)) ?? projects[0])?.id ?? '';
}
