/**
 * Settings, in six groups (S19–S24). Every setting the app had before the
 * redesign has an entry here, under the group it moved to, so the search box
 * finds it by the words a user would type -- including the names it used to
 * have.
 */

export type SettingsGroupId = 'general' | 'account' | 'workday' | 'devices' | 'data' | 'developer';

export interface SettingsGroup {
  id: SettingsGroupId;
  label: string;
  /** Hidden from the list until "Show developer tools" is on. */
  developerOnly?: true;
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  { id: 'general', label: 'General' },
  { id: 'account', label: 'Account' },
  { id: 'workday', label: 'My workday' },
  { id: 'devices', label: 'Desk devices' },
  { id: 'data', label: 'Data' },
  { id: 'developer', label: 'Developer', developerOnly: true }
];

/** One searchable setting: its name, other words for it, and its group. */
export interface SettingsEntry {
  label: string;
  group: SettingsGroupId;
  keywords?: readonly string[];
}

export const SETTINGS_ENTRIES: readonly SettingsEntry[] = [
  { label: 'Start with Windows', group: 'general', keywords: ['launch at login', 'startup', 'tray'] },
  { label: 'When I close the window', group: 'general', keywords: ['tray', 'quit', 'close', 'keep running'] },
  { label: 'Shortcuts', group: 'general', keywords: ['keyboard', 'hotkey', 'chord', 'interrupt', 'switch', 'previous', 'back'] },
  { label: 'Check for updates', group: 'general', keywords: ['update', 'version', 'release'] },
  { label: 'Set up again', group: 'general', keywords: ['setup wizard', 'onboarding', 'first run'] },
  { label: 'Show developer tools', group: 'general', keywords: ['debug', 'developer'] },

  { label: 'Task provider', group: 'account', keywords: ['jira', 'openproject', 'provider', 'this computer', 'ad-hoc'] },
  { label: 'Credentials', group: 'account', keywords: ['jira', 'openproject', 'token', 'api key', 'email', 'site', 'domain', 'url', 'sign in'] },
  { label: 'Tasks to fetch', group: 'account', keywords: ['scope', 'query', 'jql', 'filter'] },
  { label: 'When I start a task', group: 'account', keywords: ['in progress', 'assign', 'take', 'two minutes', 'glance', 'side effects'] },
  { label: 'When I mark a task done', group: 'account', keywords: ['transition', 'status', 'review', 'done', 'completion', 'to test', 'per project', 'workflow'] },
  { label: 'Key for tasks of my own', group: 'account', keywords: ['ad-hoc key', 'misc-1', 'fallback'] },
  { label: 'Provider notifications', group: 'account', keywords: ['assigned', 'mentioned', 'comments', 'events'] },
  { label: 'Entries waiting to send', group: 'account', keywords: ['sync queue', 'retry', 'failed', 'worklog'] },

  { label: 'Working days', group: 'workday', keywords: ['week', 'holidays', 'days off'] },
  { label: 'Stand-up', group: 'workday', keywords: ['standup', 'daily', 'meeting', 'ceremonies'] },
  { label: 'Lunch', group: 'workday', keywords: ['break', 'quiet hours'] },
  { label: 'End of day', group: 'workday', keywords: ['eod', 'wrap-up', 'shutdown'] },
  { label: 'My week closes', group: 'workday', keywords: ['closed week', 'timesheet', 'friday'] },
  { label: 'Nothing timing in working hours', group: 'workday', keywords: ['reminder', 'idle', 'not timing'] },
  { label: 'A pause that runs long', group: 'workday', keywords: ['reminder', 'paused', 'still paused'] },
  { label: 'A stand-up still running', group: 'workday', keywords: ['reminder', 'standup', 'meeting'] },
  { label: 'An interruption still running', group: 'workday', keywords: ['reminder', 'interrupt'] },
  { label: 'A long pause starts a new entry', group: 'workday', keywords: ['split', 'pause'] },
  { label: 'A timer left running overnight', group: 'workday', keywords: ['forgotten', 'overnight', 'midnight'] },

  { label: 'BUSY Bar', group: 'devices', keywords: ['device', 'firmware', 'battery', 'brightness', 'connection', 'status'] },
  { label: 'Task key color', group: 'devices', keywords: ['colour', 'theme', 'color'] },
  { label: 'Connection', group: 'devices', keywords: ['address', 'ip', 'wi-fi', 'usb', 'token', 'reconnect'] },
  { label: 'When nothing runs', group: 'devices', keywords: ['idle clock', 'clock'] },
  { label: 'Use without a bar', group: 'devices', keywords: ['no bar', 'add a busy bar'] },
  { label: 'Windows notifications on the bar', group: 'devices', keywords: ['notifications', 'apps', 'mirror', 'banner', 'privacy'] },
  { label: 'What the bar shows first', group: 'devices', keywords: ['priority', 'rules', 'levels', 'preemption'] },

  { label: 'Export logs', group: 'data', keywords: ['diagnostics', 'bug report'] },
  { label: 'Erase everything on this computer', group: 'data', keywords: ['wipe', 'factory reset', 'delete'] },

  { label: 'Bar remote', group: 'developer', keywords: ['remote control', 'keys'] },
  { label: 'Display debugger', group: 'developer', keywords: ['animation', 'scenes', 'preview'] },
  { label: 'Test notifications', group: 'developer', keywords: ['simulate', 'discord', 'slack'] },
  { label: 'Notification listener', group: 'developer', keywords: ['capture', 'database', 'logs', 'console'] },
  { label: 'Bar health', group: 'developer', keywords: ['latency', 'upload', 'screen closes', 'input console'] }
];

/**
 * The settings a search finds, in index order. Every word typed must appear
 * in the label, the keywords or the group's name. Developer entries are
 * found only while developer tools are shown.
 */
export function searchSettings(query: string, showDeveloper: boolean): SettingsEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return SETTINGS_ENTRIES.filter(entry => {
    if (entry.group === 'developer' && !showDeveloper) return false;
    const group = SETTINGS_GROUPS.find(g => g.id === entry.group)?.label ?? '';
    const haystack = [entry.label, group, ...(entry.keywords ?? [])].join(' ').toLowerCase();
    return words.every(word => haystack.includes(word));
  });
}

/** The groups the side list shows. */
export function visibleGroups(showDeveloper: boolean): SettingsGroup[] {
  return SETTINGS_GROUPS.filter(group => showDeveloper || !group.developerOnly);
}

/** Where "Show developer tools" is kept: a choice about this window only. */
export const SHOW_DEVELOPER_KEY = 'sprintticker.showDeveloperTools';
