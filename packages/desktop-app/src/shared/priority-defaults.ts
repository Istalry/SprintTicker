import { PriorityRule } from './dtos';

/**
 * The priority hierarchy the display engine ships with.
 *
 * Shared because the priority panel used to keep its own table, and the two
 * disagreed on every single value -- the panel put an editor's build failure
 * above Away mode and omitted the end-of-day rule entirely, so the first paint showed
 * an ordering the device never used.
 *
 * Order and numbers here are a starting point the user is expected to change.
 * What each rule does during Lunch and Away is entirely their choice; nothing
 * in the code should assume a particular ranking.
 */
/**
 * The session tracker's event: the user's own screen, the lowest claim on the
 * display. Named because the renderer has to tell it from a screen that
 * genuinely holds the display.
 */
export const ACTIVE_TRACKER_EVENT = 'activeTrackerPriority';

/**
 * The bar's task picker, opened by a press on the bar. It had no rule, so it
 * took the default 50 and was queued under anything above that -- Lunch
 * first: START during lunch opened a picker nobody could see, and the wheel
 * then moved through it blind.
 */
export const BAR_MENU_EVENT = 'menuPriority';

/** "Resume it anyway?", asked after lunch about a task no longer the user's. */
export const RESUME_PROMPT_EVENT = 'resumePromptPriority';

/**
 * NOTHING TIMING, drawn once when the "nothing timing" reminder fires in
 * working hours and let go of at the answer (D4, P14e). Below the stand-up's
 * prompt, above the notifications; shown in Work only, where it is asked.
 */
export const NOTHING_TIMING_EVENT = 'nothingTimingPriority';

/** The stand-up's prompt, and the end-of-day wrap-up's: the prompts a Stream Deck key answers. */
export const STANDUP_PROMPT_EVENT = 'standupPromptPriority';
export const EOD_WRAP_UP_EVENT = 'eodWrapUpPriority';

export const DEFAULT_PRIORITY_RULES: readonly PriorityRule[] = [
  {
    id: 'away_mode',
    eventName: 'awayModePriority',
    priority: 100,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'SUPPRESS',
    actionOnAway: 'DISPLAY'
  },
  {
    id: 'bar_menu',
    eventName: BAR_MENU_EVENT,
    priority: 97,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'DISPLAY',
    actionOnAway: 'DISPLAY'
  },
  {
    id: 'lunch_mode',
    eventName: 'lunchModePriority',
    priority: 95,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'DISPLAY',
    actionOnAway: 'SUPPRESS'
  },
  {
    id: 'eod_wrapup',
    eventName: EOD_WRAP_UP_EVENT,
    priority: 80,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'SUPPRESS',
    actionOnAway: 'DISPLAY'
  },
  {
    id: 'resume_prompt',
    eventName: RESUME_PROMPT_EVENT,
    priority: 76,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'SUPPRESS',
    actionOnAway: 'QUEUE'
  },
  {
    id: 'standup_prompt',
    eventName: STANDUP_PROMPT_EVENT,
    priority: 75,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'SUPPRESS',
    actionOnAway: 'DISPLAY'
  },
  {
    id: 'nothing_timing',
    eventName: NOTHING_TIMING_EVENT,
    priority: 74,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'SUPPRESS',
    actionOnAway: 'SUPPRESS'
  },
  {
    id: 'high_notification',
    eventName: 'highNotificationPriority',
    priority: 70,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'DISPLAY',
    actionOnAway: 'DISPLAY'
  },
  {
    id: 'messaging_alert',
    eventName: 'messagingPriority',
    priority: 65,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'SUPPRESS',
    actionOnAway: 'SUPPRESS'
  },
  {
    id: 'active_tracker',
    eventName: ACTIVE_TRACKER_EVENT,
    priority: 45,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'QUEUE',
    actionOnAway: 'QUEUE'
  }
];

/**
 * Rules of features that are gone. A database keeps the rule set the user
 * last saved, so without this they would come back with it: in the engine,
 * which matches events by name, and in the priority panel as rows that rank
 * nothing. The break prompt went first; the Unity Editor's three screens went
 * on 2026-11-09.
 */
const RETIRED_PRIORITY_RULES: ReadonlySet<string> = new Set([
  'breakPromptPriority', 'break_prompt',
  'unityBuildFailurePriority', 'unity_exception',
  'unityCompilingPriority', 'unity_compiling',
  'unityPlayModePriority', 'unity_playmode'
]);

/** Whether a stored rule belongs to a feature that is gone, by its event or its id. */
export function isRetiredPriorityRule(rule: Pick<PriorityRule, 'id' | 'eventName'>): boolean {
  return RETIRED_PRIORITY_RULES.has(rule.eventName) || RETIRED_PRIORITY_RULES.has(rule.id);
}
