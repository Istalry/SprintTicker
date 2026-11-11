/**
 * Interrupt: a timer started at once, on a new ad-hoc task under a name the
 * app makes up, for the user to name or move to a task afterwards.
 *
 * Shared because the window, the mini timer and History show the same name
 * the bar does, and tell an unnamed interruption the same way.
 */
import { ArgumentException } from './dtos';

/** What an interruption's task is called until the user names it. */
export const INTERRUPTION_TITLE_PREFIX = 'Interruption';

/**
 * Whether a session is ad-hoc work, by its flag or its task id: a row
 * started again from a list carries `isAdHoc = false` (see isAdHocTaskId).
 */
export function isAdHocSession(session: { isAdHoc: boolean; taskId: string }): boolean {
  return session.isAdHoc || session.taskId.startsWith(ADHOC_TASK_ID_PREFIX);
}

/** The id prefix of an ad-hoc task; main's `IdPrefix.ADHOC_TASK` is held to it by a test. */
export const ADHOC_TASK_ID_PREFIX = 'adhoc_';

/** Longest name an ad-hoc task takes: a line in a timesheet, not a note. */
export const AD_HOC_TITLE_MAX_CHARS = 120;

/**
 * The name an ad-hoc task is given, trimmed, for the window and main to
 * refuse the same names.
 *
 * @throws ArgumentException for an empty name or one past the limit.
 */
export function checkAdHocTitle(title: unknown): string {
  const name = typeof title === 'string' ? title.trim() : '';
  if (!name) throw new ArgumentException('An ad-hoc task needs a name.', 'title');
  if (name.length > AD_HOC_TITLE_MAX_CHARS) {
    throw new ArgumentException(`A name is at most ${AD_HOC_TITLE_MAX_CHARS} characters.`, 'title');
  }
  return name;
}

/**
 * The made-up name: `Interruption 14:32`, in local time. The time is what
 * tells two of a day apart in History, and a name the user would not type.
 */
export function interruptionTitle(at: Date): string {
  const hh = String(at.getHours()).padStart(2, '0');
  const mm = String(at.getMinutes()).padStart(2, '0');
  return `${INTERRUPTION_TITLE_PREFIX} ${hh}:${mm}`;
}

/**
 * Where an interruption was started from (migration 15). `legacy` is an
 * interruption of the model before it -- an unsorted ad-hoc task's worklog --
 * carried over as a fragment.
 */
export const INTERRUPTION_SOURCES = ['window', 'mini', 'tray', 'bar', 'deck', 'shortcut', 'notification', 'legacy'] as const;
export type InterruptionSource = (typeof INTERRUPTION_SOURCES)[number];

export function isInterruptionSource(value: unknown): value is InterruptionSource {
  return typeof value === 'string' && (INTERRUPTION_SOURCES as readonly string[]).includes(value);
}

/**
 * The interruption running, as every surface reads it (§ 11.4 of the
 * plan): one fragment of a run, and the task it holds as it was.
 */
export interface RunningInterruptionDTO {
  id: string;
  /** The user's name for it, or null: shown as `title`. */
  name: string | null;
  /** The name, or the one the app makes up (`Interruption 14:32`). */
  title: string;
  startedAtUtc: string;
  /** 1 for the first fragment of the run, 2 for the next (Another)... */
  index: number;
  source: InterruptionSource;
  /** The session it holds, paused with reason `interruption`; null when nothing was open. */
  interruptedSessionId: string | null;
  interruptedTaskKey: string | null;
  interruptedTaskTitle: string | null;
  /** The held session was paused already: Back leaves it paused. */
  interruptedWasPaused: boolean;
  /** The task chosen for its time while it runs (S9): placed there when it ends. */
  chosenTask?: { id: string; key: string; title: string };
}

/** An interruption that ended and waits to be placed, kept off, or left for later. */
export interface InterruptionToPlaceDTO {
  id: string;
  name: string | null;
  title: string;
  startedAtUtc: string;
  endedAtUtc: string;
  durationSeconds: number;
  source: InterruptionSource;
  /** What it interrupted, for the context the list shows ("during MG-12"). */
  interruptedTaskKey: string | null;
  /** 1, 2... within its run, and the run's length: "2 of 3". */
  index: number;
  ofRun: number;
}

/** The interruptions waiting, counted for a badge. */
export interface ToPlaceSummaryDTO {
  count: number;
  seconds: number;
}
