import type { ActiveSessionDTO, BitmapIconId, TaskDTO } from '../../shared/dtos';
import { DECK_MAX_RECENT } from '../../shared/deck-protocol';
import { BarWord } from '../../shared/words';

/** What an entry of the bar's menu does when Pause picks it. */
export type BarMenuAction = 'DONE' | 'DISCARD' | 'PREVIOUS' | 'RECENT' | 'OPEN_APP';

/**
 * One entry of the wheel's menu (redesign P14c): one per screen, the icon
 * saying what kind, row 0 what it acts on, row 1 the verb.
 */
export interface BarMenuEntry {
  action: BarMenuAction;
  icon: BitmapIconId;
  /** Row 0: the task's key, or the verb where there is no task. */
  label: string;
  /** Row 1, beside the position. */
  detail: string;
  /** The task a PREVIOUS or RECENT entry starts. */
  task?: TaskDTO;
}

/** What the menu is built from: the state, read where the deck reads it. */
export interface BarMenuState {
  session: ActiveSessionDTO | null;
  previous: TaskDTO | null;
  /** The picker's recent tasks, newest first, as the deck's Recent keys read them. */
  recent: TaskDTO[];
}

/**
 * The menu's entries, in the order the wheel meets them (§19.1):
 *
 * - timing or paused: DONE, DISCARD, the previous task, up to three recent
 *   ones, OPEN APP;
 * - an interruption: DISCARD and OPEN APP -- no task is chosen during one
 *   (the deck trial's rule, 2026-11-12);
 * - nothing running: the previous task, the recent ones, OPEN APP.
 *
 * STOP is not here: it is Pause twice. The recent tasks are the deck's three,
 * with the open task and the previous one left out, so no task shows twice.
 */
export function barMenuEntries({ session, previous, recent }: BarMenuState): BarMenuEntry[] {
  const open = session && session.status !== 'COMPLETED' ? session : null;
  const openApp: BarMenuEntry = { action: 'OPEN_APP', icon: 'windows', label: BarWord.OPEN_APP, detail: '' };
  if (open?.interruption) {
    return [{ action: 'DISCARD', icon: 'interruption', label: keyOf(open), detail: BarWord.DISCARD }, openApp];
  }
  const entries: BarMenuEntry[] = [];
  if (open) {
    entries.push(
      { action: 'DONE', icon: 'task_done', label: keyOf(open), detail: BarWord.DONE },
      { action: 'DISCARD', icon: 'stop', label: keyOf(open), detail: BarWord.DISCARD }
    );
  }
  const shown = new Set<string>(open ? [open.taskId] : []);
  if (previous && !shown.has(previous.id)) {
    entries.push({ action: 'PREVIOUS', icon: 'play', label: previous.key || previous.title, detail: BarWord.PREVIOUS, task: previous });
    shown.add(previous.id);
  }
  for (const task of recent.filter(t => !shown.has(t.id)).slice(0, DECK_MAX_RECENT)) {
    entries.push({ action: 'RECENT', icon: 'task', label: task.key || task.title, detail: BarWord.RECENT, task });
  }
  entries.push(openApp);
  return entries;
}

/** An ad-hoc session's key is the shared fallback ticket; its name says more. */
function keyOf(session: ActiveSessionDTO): string {
  return session.isAdHoc || session.interruption ? session.taskTitle || session.taskKey : session.taskKey || session.taskTitle;
}
