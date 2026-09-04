import { PriorityRule } from './dtos';

/**
 * The priority hierarchy the display engine ships with.
 *
 * Shared because the priority panel used to keep its own table, and the two
 * disagreed on every single value -- the panel put a Unity build failure above
 * Away mode and omitted the end-of-day rule entirely, so the first paint showed
 * an ordering the device never used.
 *
 * Order and numbers here are a starting point the user is expected to change.
 * What each rule does during Lunch and Away is entirely their choice; nothing
 * in the code should assume a particular ranking.
 */
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
    id: 'lunch_mode',
    eventName: 'lunchModePriority',
    priority: 95,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'DISPLAY',
    actionOnAway: 'SUPPRESS'
  },
  {
    id: 'eod_wrapup',
    eventName: 'eodWrapUpPriority',
    priority: 80,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'SUPPRESS',
    actionOnAway: 'DISPLAY'
  },
  {
    id: 'standup_prompt',
    eventName: 'standupPromptPriority',
    priority: 75,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'SUPPRESS',
    actionOnAway: 'DISPLAY'
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
    id: 'unity_exception',
    eventName: 'unityBuildFailurePriority',
    priority: 60,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'SUPPRESS',
    actionOnAway: 'SUPPRESS'
  },
  {
    id: 'unity_compiling',
    eventName: 'unityCompilingPriority',
    priority: 55,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'SUPPRESS',
    actionOnAway: 'SUPPRESS'
  },
  {
    id: 'unity_playmode',
    eventName: 'unityPlayModePriority',
    priority: 50,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'SUPPRESS',
    actionOnAway: 'DISPLAY'
  },
  {
    id: 'active_tracker',
    eventName: 'activeTrackerPriority',
    priority: 45,
    actionOnWork: 'DISPLAY',
    actionOnLunch: 'QUEUE',
    actionOnAway: 'QUEUE'
  }
];
