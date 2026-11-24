import { ArgumentNullException, WorklogDTO } from './dtos';
import { ownNameKey } from './own-work';

/** One line of Today by task: a task, the day's sum, and its entries. */
export interface TaskGroup {
  key: string;
  taskKey: string;
  taskTitle?: string;
  projectName?: string;
  /** Newest first, each with its own note, ⋯ and send. */
  entries: WorklogDTO[];
  seconds: number;
}

/**
 * Today's entries one line per task (LOCAL-WORK-AND-CALENDAR.md §4): a
 * provider's task by its id; work of the user's own by its project and its
 * name, case and spacing aside, so the duplicates made before one task per
 * name still read as one. The line most recently worked on comes first.
 */
export function groupEntriesByTask(worklogs: readonly WorklogDTO[]): TaskGroup[] {
  if (!worklogs) throw new ArgumentNullException('worklogs');
  const groups = new Map<string, TaskGroup>();
  const newestFirst = [...worklogs].sort((a, b) => b.startedAtUtc.localeCompare(a.startedAtUtc));
  for (const log of newestFirst) {
    // An interruption still to name is its own: its name is the app's, not a task's.
    const key = log.adHoc && log.taskTitle && !log.unsorted
      ? `own:${log.projectId ?? ''}:${ownNameKey(log.taskTitle)}`
      : `task:${log.taskId}`;
    const group = groups.get(key);
    if (group) {
      group.entries.push(log);
      group.seconds += log.durationSeconds;
    } else {
      groups.set(key, {
        key,
        taskKey: log.taskKey ?? log.taskId,
        ...(log.taskTitle ? { taskTitle: log.taskTitle } : {}),
        ...(log.projectName ? { projectName: log.projectName } : {}),
        entries: [log],
        seconds: log.durationSeconds
      });
    }
  }
  return [...groups.values()];
}
