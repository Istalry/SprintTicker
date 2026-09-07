import { WindowsNotificationSettingsDTO, NotificationSourceRule } from './dtos';

/**
 * The single source of the Windows notification listener's seeded defaults.
 *
 * Main and the renderer each used to carry their own copy, and the copies
 * disagreed -- main seeded Slack as HIGH_PRIORITY and Discord as DEFAULT, the
 * settings view seeded the reverse. Whichever process wrote to SQLite first
 * decided what the user actually got, so the effective default depended on
 * whether the settings screen had been opened before the first notification
 * arrived.
 *
 * Which app is "more important" is not a decision this file makes. These modes
 * only assign an app to one of two priority classes; how those classes behave
 * during Lunch and Away is the user's choice in the priority panel. The values
 * below are a starting point, not a policy.
 */
export const DEFAULT_NOTIFICATION_SOURCE_RULES: readonly NotificationSourceRule[] = [
  // hideMessageBody defaults on for the two chat apps: their bodies are direct
  // messages, and the bar is readable by anyone walking past the desk. It is a
  // starting point like the modes above, not a policy -- the panel can turn it
  // on for any source, or off for these.
  { appId: 'discord', appName: 'Discord', iconId: 'discord', priorityMode: 'DEFAULT', hideMessageBody: true },
  { appId: 'slack', appName: 'Slack', iconId: 'slack', priorityMode: 'HIGH_PRIORITY', hideMessageBody: true },
  { appId: 'antigravity', appName: 'Antigravity', iconId: 'antigravity', priorityMode: 'DEFAULT' },
  { appId: 'gmail', appName: 'Gmail / Outlook', iconId: 'gmail', priorityMode: 'DEFAULT' },
  { appId: 'battery', appName: 'System Battery', iconId: 'battery', priorityMode: 'HIGH_PRIORITY' },
  { appId: 'windows', appName: 'Windows System', iconId: 'windows', priorityMode: 'DEFAULT' }
];

/** How often the PowerShell poller reads the Windows notification database. */
export const DEFAULT_NOTIFICATION_POLLING_INTERVAL_SECONDS = 2;

/** How long a notification banner holds the display before releasing its lock. */
export const DEFAULT_NOTIFICATION_TIMEOUT_SECONDS = 10;

/**
 * Builds a fresh copy of the seeded settings.
 *
 * A function rather than a shared constant so a caller mutating the returned
 * `sourceRules` -- which the settings view does, on every edit -- cannot reach
 * back into the defaults the other process is reading.
 */
export function createDefaultNotificationSettings(): WindowsNotificationSettingsDTO {
  return {
    enableListener: true,
    notificationTimeoutSeconds: DEFAULT_NOTIFICATION_TIMEOUT_SECONDS,
    pollingIntervalSeconds: DEFAULT_NOTIFICATION_POLLING_INTERVAL_SECONDS,
    sourceRules: DEFAULT_NOTIFICATION_SOURCE_RULES.map(rule => ({ ...rule }))
  };
}
