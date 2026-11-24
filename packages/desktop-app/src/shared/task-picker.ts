import { ArgumentNullException, ProjectDTO, TaskDTO } from './dtos';
import { orderTasksForSelection } from './task-order';
import { TaskOwnership } from './task-ownership';

/**
 * The task picker's model (redesign P7, S7–S8, S12): what each group holds
 * and in which order, from one snapshot main answers. Pure, so the window's
 * picker, the picker window and the command palette list the same tasks in
 * the same order, and the tests read the rules without a DOM.
 */

/** What the picker was opened to do. */
export type PickerMode =
  /** Nothing runs: start a task. */
  | 'start'
  /** A task runs: switch to another. From an interruption, its time may go along. */
  | 'switch'
  /** Put the open ad-hoc session on a task. */
  | 'assign'
  /** Put an interruption's time on a task (S12, S12b). */
  | 'place'
  /** Put an entry already logged on another task. */
  | 'move';

/** Everything the picker lists, read in one round trip (`tasks:get-picker`). */
export interface PickerDataDTO {
  /** The task to switch back to, or null. */
  previous: TaskDTO | null;
  /** The last tasks timed, newest first, each once (`RECENT_TASKS_LIMIT`). */
  recent: TaskDTO[];
  /** Starred, most recently starred first. */
  starred: TaskDTO[];
  /** Every task the lists hold, whoever's, across projects; no ad-hoc work. */
  tasks: TaskDTO[];
  /**
   * The user's own work (ad-hoc tasks), newest first: found by the search
   * wherever the picker offers "A task of my own" (2026-11-24). Absent from
   * an answer of a version before it.
   */
  own?: TaskDTO[];
  projects: ProjectDTO[];
  /** Seconds logged per project over the last `PICKER_USAGE_DAYS`: "most used". */
  projectSeconds: Record<string, number>;
}

/** How far back "most used" looks. */
export const PICKER_USAGE_DAYS = 30;

/** Where "most used" starts counting: `PICKER_USAGE_DAYS` before `now`. */
export function pickerUsageSince(now: Date): string {
  const since = new Date(now);
  since.setDate(since.getDate() - PICKER_USAGE_DAYS);
  return since.toISOString();
}

/** Rows of "Assigned to me" shown before "all N of my open tasks". */
export const PICKER_MINE_PREVIEW = 5;

/**
 * A search that finds more than this many tasks shows `PICKER_SEARCH_PER_PROJECT`
 * of each project, then "N more in <project>". At 1,000 tasks the first
 * letter typed matched nearly all of them, and drawing 881 rows froze the
 * picker for 130 ms on that keystroke (the dry run at scale, P15b).
 */
export const PICKER_SEARCH_SHOWN = 60;

/** Tasks shown per project while a search finds more than `PICKER_SEARCH_SHOWN`. */
export const PICKER_SEARCH_PER_PROJECT = 8;

/** Whether a mode puts time on a real task, so ad-hoc work is never offered. */
export function needsRealTask(mode: PickerMode): boolean {
  return mode === 'assign' || mode === 'place' || mode === 'move';
}

/** Whether a mode offers "+ A task of my own". */
export function offersOwnTask(mode: PickerMode): boolean {
  return mode === 'start' || mode === 'switch';
}

/**
 * A project key and a space at the start of the search ("pf ", "pf 40")
 * filters to that project (S7c); what follows is searched inside it. Only an
 * exact key matches, so "pfx " filters nothing.
 */
export function parseProjectPrefix(
  query: string,
  projects: readonly ProjectDTO[]
): { project: ProjectDTO; rest: string } | null {
  if (projects === null || projects === undefined) throw new ArgumentNullException('projects');
  const match = /^\s*(\S+)\s(.*)$/s.exec(query ?? '');
  if (!match) return null;
  const key = match[1].toLowerCase();
  const project = projects.find(p => p.key.toLowerCase() === key);
  return project ? { project, rest: match[2].trimStart() } : null;
}

/**
 * Whether what was typed reads as one task's key, for "Fetch MG-77 from
 * Jira": letters, a dash and a number (`MG-77`), or an OpenProject id
 * (`#1234`, `1234`).
 */
export function looksLikeTaskKey(query: string): boolean {
  const typed = (query ?? '').trim();
  return /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(typed) || /^#?\d+$/.test(typed);
}

/**
 * Whether a task answers the search: its key, title, description or its
 * project's key or name, ignoring case. Every word must match somewhere, so
 * "lantern glow" finds "Fix the lantern glow at dusk".
 */
export function matchesSearch(task: TaskDTO, query: string, project?: ProjectDTO): boolean {
  const words = (query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [task.key, task.title, task.description ?? '', project?.key ?? '', project?.name ?? '']
    .join(' ')
    .toLowerCase();
  return words.every(word => haystack.includes(word));
}

/** One project's tasks in a search's answer. */
export interface ProjectGroup {
  project: ProjectDTO;
  tasks: TaskDTO[];
}

/**
 * The tasks answering a search, grouped by project (S8): projects in the
 * picker's order, tasks in the lists' order (`task-order.ts`), done last.
 */
export function searchByProject(
  tasks: readonly TaskDTO[],
  query: string,
  orderedProjects: readonly ProjectDTO[]
): ProjectGroup[] {
  if (!tasks) throw new ArgumentNullException('tasks');
  const byId = new Map(orderedProjects.map(p => [p.id, p]));
  const groups = new Map<string, TaskDTO[]>();
  for (const task of tasks) {
    const project = byId.get(task.projectId);
    if (!project || !matchesSearch(task, query, project)) continue;
    const list = groups.get(project.id) ?? [];
    list.push(task);
    groups.set(project.id, list);
  }
  return orderedProjects
    .filter(p => groups.has(p.id))
    .map(p => ({ project: p, tasks: orderTasksForSelection(groups.get(p.id)!) }));
}

/**
 * "Assigned to me · open" (S7, S7b): the user's own tasks not done, across
 * projects -- in progress first, then to do by priority, the lists' order.
 */
export function myOpenTasks(tasks: readonly TaskDTO[]): TaskDTO[] {
  if (!tasks) throw new ArgumentNullException('tasks');
  return orderTasksForSelection(
    tasks.filter(t => (t.ownership ?? TaskOwnership.MINE) === TaskOwnership.MINE && t.status !== 'done')
  );
}

/**
 * The projects in the picker's order: those holding a starred task first,
 * then the most used, then by name. Projects with no task listed are left out.
 */
export function orderProjects(
  projects: readonly ProjectDTO[],
  tasks: readonly TaskDTO[],
  starred: readonly TaskDTO[],
  projectSeconds: Readonly<Record<string, number>>
): ProjectDTO[] {
  if (!projects) throw new ArgumentNullException('projects');
  const withTasks = new Set(tasks.map(t => t.projectId));
  const withStar = new Set(starred.map(t => t.projectId));
  const seconds = (p: ProjectDTO) => projectSeconds[p.id] ?? 0;
  return projects
    .filter(p => withTasks.has(p.id))
    .sort((a, b) =>
      Number(withStar.has(b.id)) - Number(withStar.has(a.id)) ||
      seconds(b) - seconds(a) ||
      a.name.localeCompare(b.name)
    );
}

/** What is left in one project, by status (S7c's header). */
export interface ProjectCounts {
  total: number;
  inProgress: number;
  todo: number;
  done: number;
  /** Not done and the user's own. */
  mineLeft: number;
}

export function countProject(tasks: readonly TaskDTO[]): ProjectCounts {
  if (!tasks) throw new ArgumentNullException('tasks');
  return {
    total: tasks.length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    todo: tasks.filter(t => t.status === 'todo').length,
    done: tasks.filter(t => t.status === 'done').length,
    mineLeft: tasks.filter(t => t.status !== 'done' && (t.ownership ?? TaskOwnership.MINE) === TaskOwnership.MINE).length
  };
}

/**
 * Recent for placing (S12b): the tasks just chosen in this sitting first, then
 * the recent ones, each once. Nothing is chosen for the user: this orders a
 * menu, it never preselects.
 */
export function recentWithJustChosen(
  recent: readonly TaskDTO[],
  justChosen: readonly TaskDTO[]
): TaskDTO[] {
  const seen = new Set<string>();
  const out: TaskDTO[] = [];
  for (const task of [...justChosen, ...recent]) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    out.push(task);
  }
  return out;
}
