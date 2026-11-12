import { chordProblem, DEFAULT_INTERRUPT_ACCELERATOR } from './interrupt-shortcut';
import type { StandupTaskDTO } from './dtos';

/**
 * The settings the redesigned flows read (P4), with their defaults: one
 * place, as `provider-settings.ts` is for the providers, so main and the
 * window cannot ship two defaults for the same key.
 *
 * Stored as JSON in the `settings` table; no schema change. Each reader
 * takes whatever is stored -- nothing, an older shape, a value hand-edited
 * into nonsense -- and answers a whole, valid value, filling what is missing
 * from the default. A stored value never makes a flow throw.
 */

export const FlowSettingKey = {
  /** A name for a server on the SprintTicker Provider API (`providerDisplayName`). */
  PROVIDER_DISPLAY_NAME: 'provider_display_name',
  /** Whether starting a task moves and assigns it, and after how long (S20). */
  START_SIDE_EFFECTS: 'start_side_effects',
  /** The state "Done" moves a task to, per project. */
  DONE_STATE_BY_PROJECT: 'done_state_by_project',
  /** How long before each "still...?" prompt, in minutes. */
  PROMPT_DELAYS: 'prompt_delays',
  /** The global shortcuts' chords. */
  SHORTCUTS: 'shortcuts',
  /** Whether closing the window hides it to the tray. */
  CLOSE_TO_TRAY: 'close_to_tray',
  /** The task the stand-up is timed on, or none: an ad-hoc task kept here. */
  STANDUP_TASK: 'standup_task',
  /** Whether the first interruption's explanation was put away (S9): it shows once. */
  FIRST_INTERRUPTION_SEEN: 'first_interruption_seen',
  /** Whether the mini timer's one-line tour of its buttons was put away (S25): it shows once. */
  MINI_TOUR_SEEN: 'mini_tour_seen'
} as const;

export interface StartSideEffectsSetting {
  enabled: boolean;
  /** Seconds of TRACKING, pauses not counted, before the task is moved and assigned. */
  afterSeconds: number;
}

export interface DoneStateByProjectSetting {
  /** The provider's state for Done, or null for the completion action set in Account. */
  default: string | null;
  overrides: Record<string, string>;
}

export interface PromptDelaysSetting {
  nothingTiming: number;
  longPause: number;
  standupRunning: number;
  interruptionRunning: number;
}

export interface ShortcutChord {
  enabled: boolean;
  accelerator: string;
}

export interface ShortcutsSetting {
  interrupt: ShortcutChord;
  switch: ShortcutChord;
  previous: ShortcutChord;
  back: ShortcutChord;
}

/** What a global shortcut does (P12e). */
export type ShortcutAction = keyof ShortcutsSetting;

/** In the order Settings lists them. */
export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = ['interrupt', 'switch', 'previous', 'back'];

export const DEFAULT_START_SIDE_EFFECTS: StartSideEffectsSetting = { enabled: true, afterSeconds: 120 };

export const DEFAULT_DONE_STATE_BY_PROJECT: DoneStateByProjectSetting = { default: null, overrides: {} };

export const DEFAULT_PROMPT_DELAYS: PromptDelaysSetting = {
  nothingTiming: 10,
  longPause: 30,
  standupRunning: 25,
  interruptionRunning: 20
};

/**
 * On by default (the plan's §2 assumption); a chord another app holds reads
 * "taken", never on. The Interrupt chord is the one the app already offered.
 */
export const DEFAULT_SHORTCUTS: ShortcutsSetting = {
  interrupt: { enabled: true, accelerator: DEFAULT_INTERRUPT_ACCELERATOR },
  switch: { enabled: true, accelerator: 'Ctrl+Alt+Shift+S' },
  previous: { enabled: true, accelerator: 'Ctrl+Alt+Shift+P' },
  back: { enabled: true, accelerator: 'Ctrl+Alt+Shift+B' }
};

export const DEFAULT_CLOSE_TO_TRAY = true;

/** The longest delay a prompt may be given, in minutes: a working day. */
const MAX_PROMPT_DELAY_MINUTES = 8 * 60;

/** The longest wait before a start moves a task, in seconds: an hour. */
const MAX_SIDE_EFFECT_SECONDS = 60 * 60;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const wholeNumberIn = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export function readProviderDisplayName(stored: unknown): string | null {
  return nonEmptyString(stored);
}

export function readStartSideEffects(stored: unknown): StartSideEffectsSetting {
  const value = isRecord(stored) ? stored : {};
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_START_SIDE_EFFECTS.enabled,
    afterSeconds: wholeNumberIn(value.afterSeconds, 0, MAX_SIDE_EFFECT_SECONDS, DEFAULT_START_SIDE_EFFECTS.afterSeconds)
  };
}

export function readDoneStateByProject(stored: unknown): DoneStateByProjectSetting {
  const value = isRecord(stored) ? stored : {};
  const overrides: Record<string, string> = {};
  if (isRecord(value.overrides)) {
    for (const [projectId, state] of Object.entries(value.overrides)) {
      const name = nonEmptyString(state);
      if (projectId && name) overrides[projectId] = name;
    }
  }
  return { default: nonEmptyString(value.default), overrides };
}

/** The state Done moves a project's task to: its override, else the default; null for the completion action. */
export function doneStateFor(setting: DoneStateByProjectSetting, projectId: string): string | null {
  return setting.overrides[projectId] ?? setting.default;
}

export function readPromptDelays(stored: unknown): PromptDelaysSetting {
  const value = isRecord(stored) ? stored : {};
  const read = (key: keyof PromptDelaysSetting): number =>
    wholeNumberIn(value[key], 1, MAX_PROMPT_DELAY_MINUTES, DEFAULT_PROMPT_DELAYS[key]);
  return {
    nothingTiming: read('nothingTiming'),
    longPause: read('longPause'),
    standupRunning: read('standupRunning'),
    interruptionRunning: read('interruptionRunning')
  };
}

export function readShortcuts(stored: unknown): ShortcutsSetting {
  const value = isRecord(stored) ? stored : {};
  const read = (key: keyof ShortcutsSetting): ShortcutChord => {
    const chord = isRecord(value[key]) ? value[key] as Record<string, unknown> : {};
    // A chord Electron would refuse, or one that takes every app's typing,
    // goes back to the default rather than reaching register().
    const accelerator = nonEmptyString(chord.accelerator);
    return {
      enabled: typeof chord.enabled === 'boolean' ? chord.enabled : DEFAULT_SHORTCUTS[key].enabled,
      accelerator: accelerator && chordProblem(accelerator) === null ? accelerator : DEFAULT_SHORTCUTS[key].accelerator
    };
  };
  return { interrupt: read('interrupt'), switch: read('switch'), previous: read('previous'), back: read('back') };
}

export function readCloseToTray(stored: unknown): boolean {
  return typeof stored === 'boolean' ? stored : DEFAULT_CLOSE_TO_TRAY;
}

/**
 * The stand-up's task (D3): its id, key and title as chosen, or null for the
 * local Daily Standup. A bare id -- the shape P4 planned and nothing wrote --
 * or anything incomplete reads as none.
 */
export function readStandupTask(stored: unknown): StandupTaskDTO | null {
  if (!isRecord(stored)) return null;
  const taskId = nonEmptyString(stored.taskId);
  const taskKey = nonEmptyString(stored.taskKey);
  if (!taskId || !taskKey || typeof stored.title !== 'string') return null;
  return { taskId, taskKey, title: stored.title };
}

/** Each flow setting's value, as its reader answers it. */
export interface FlowSettingValues {
  provider_display_name: string | null;
  start_side_effects: StartSideEffectsSetting;
  done_state_by_project: DoneStateByProjectSetting;
  prompt_delays: PromptDelaysSetting;
  shortcuts: ShortcutsSetting;
  close_to_tray: boolean;
  standup_task: StandupTaskDTO | null;
  first_interruption_seen: boolean;
  mini_tour_seen: boolean;
}

export type FlowSettingKeyValue = keyof FlowSettingValues;

const FLOW_READERS: { [K in FlowSettingKeyValue]: (stored: unknown) => FlowSettingValues[K] } = {
  provider_display_name: readProviderDisplayName,
  start_side_effects: readStartSideEffects,
  done_state_by_project: readDoneStateByProject,
  prompt_delays: readPromptDelays,
  shortcuts: readShortcuts,
  close_to_tray: readCloseToTray,
  standup_task: readStandupTask,
  first_interruption_seen: stored => stored === true,
  mini_tour_seen: stored => stored === true
};

export function isFlowSettingKey(key: unknown): key is FlowSettingKeyValue {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(FLOW_READERS, key);
}

/**
 * Any flow setting through its own reader: what the window reads, and what
 * a save stores -- so a value the window sends is stored whole and valid,
 * the same as the reader would answer for it.
 */
export function readFlowSetting<K extends FlowSettingKeyValue>(key: K, stored: unknown): FlowSettingValues[K] {
  return FLOW_READERS[key](stored);
}
