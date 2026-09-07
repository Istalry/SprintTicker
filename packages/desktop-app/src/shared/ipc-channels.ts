/**
 * Enumeration of all IPC channel names used for communication
 * between Electron Main and Renderer processes.
 */
export enum IPCChannel {
  // Session & Timer Controls
  GET_CURRENT_SESSION = 'session:get-current',
  START_TASK = 'session:start-task',
  PAUSE_SESSION = 'session:pause',
  RESUME_SESSION = 'session:resume',
  COMPLETE_SESSION = 'session:complete',
  DISCARD_SESSION = 'session:discard',
  ON_SESSION_UPDATED = 'session:on-updated',

  // Task Provider & Task Query
  GET_PROVIDERS = 'provider:get-all',
  SET_ACTIVE_PROVIDER = 'provider:set-active',
  GET_PROJECTS = 'provider:get-projects',
  GET_TASKS = 'provider:get-tasks',
  CREATE_AD_HOC_TASK = 'provider:create-adhoc',
  RECONCILE_REMOTE_STATE = 'provider:reconcile',
  FETCH_OP_STATUSES = 'provider:fetch-op-statuses',

  // Projects & Tasks Management
  CREATE_PROJECT = 'projects:create',
  RENAME_PROJECT = 'projects:rename',
  DELETE_PROJECT = 'projects:delete',
  DELETE_TASK = 'tasks:delete',
  UPDATE_TASK = 'tasks:update',
  IMPORT_TASKS = 'tasks:import',
  GET_WORKLOGS_BY_DATE = 'worklogs:get-by-date',
  GET_DAILY_WORKLOG_SUMMARY = 'worklogs:get-daily-summary',
  WIPE_ALL_DATA = 'db:wipe-all-data',

  // Hardware Input Rebindings
  GET_INPUT_BINDINGS = 'input:get-bindings',
  SAVE_INPUT_BINDINGS = 'input:save-bindings',
  INJECT_REMOTE_KEY = 'input:inject-remote-key',
  ON_HARDWARE_INPUT_EVENT = 'input:on-hardware-event',

  // Priority Matrix & Display
  GET_PRIORITY_RULES = 'priority:get-rules',
  SAVE_PRIORITY_RULES = 'priority:save-rules',
  SET_USER_MODE = 'priority:set-user-mode',
  GET_USER_MODE = 'priority:get-user-mode',
  ON_USER_MODE_UPDATED = 'priority:on-user-mode-updated',

  // Device Management & SDK
  GET_DEVICE_STATUS = 'device:get-status',
  GET_DEVICE_CONFIG = 'device:get-config',
  SET_DEVICE_CONFIG = 'device:set-config',
  ON_DEVICE_STATUS_CHANGED = 'device:on-status-changed',

  // Ceremonies & Schedule
  GET_SCHEDULE_SETTINGS = 'schedule:get-settings',
  SAVE_SCHEDULE_SETTINGS = 'schedule:save-settings',
  TRIGGER_EOD_PROMPT = 'schedule:trigger-eod-prompt',
  TRIGGER_EOD_WRAP_UP = 'schedule:trigger-eod-wrapup',
  CANCEL_EOD_WRAP_UP = 'schedule:cancel-eod-wrapup',
  TRIGGER_STANDUP_PROMPT = 'schedule:trigger-standup-prompt',
  CANCEL_STANDUP_PROMPT = 'schedule:cancel-standup-prompt',
  SNOOZE_CEREMONY = 'schedule:snooze-ceremony',
  ON_CEREMONY_PROMPT = 'schedule:on-ceremony-prompt',
  UPDATE_CEREMONY_PROMPT = 'schedule:update-ceremony-prompt',

  // Unity Injector & Gitignore
  SETUP_GITIGNORE = 'unity-injector:setup-gitignore',
  CHECK_GITIGNORE = 'unity-injector:check-gitignore',
  SCAN_AND_INJECT = 'unity-injector:scan-and-inject',
  REMOVE_INJECTION = 'unity-injector:remove-injection',
  OPEN_FOLDER_PICKER = 'dialog:open-folder-picker',

  // Worklogs
  GET_TODAYS_WORKLOGS = 'worklog:get-todays',
  ON_WORKLOGS_UPDATED = 'worklog:on-updated',

  // Unity Telemetry & Audio Settings
  GET_UNITY_SETTINGS = 'unity:get-settings',
  SAVE_UNITY_SETTINGS = 'unity:save-settings',
  GET_UNITY_TELEMETRY = 'unity:get-telemetry',
  ON_UNITY_TELEMETRY_UPDATED = 'unity:on-telemetry-updated',

  // Messaging Integration & Windows Notification Listener
  GET_MESSAGING_SETTINGS = 'messaging:get-settings',
  SAVE_MESSAGING_SETTINGS = 'messaging:save-settings',
  TEST_MESSAGING_INTEGRATION = 'messaging:test-integration',
  GET_NOTIFICATION_SETTINGS = 'notifications:get-settings',
  SAVE_NOTIFICATION_SETTINGS = 'notifications:save-settings',
  SIMULATE_NOTIFICATION = 'notifications:simulate',
  GET_NOTIFICATION_LISTENER_STATUS = 'notifications:get-listener-status',
  ON_NOTIFICATION_LOG = 'notifications:on-log',
  OPEN_NOTIFICATION_SETTINGS = 'notifications:open-settings',

  // Hardware Display Animation & Live Emulator
  GET_DISPLAY_STATE = 'display:get-state',
  ON_DISPLAY_STATE_UPDATED = 'display:on-state-updated',
  SET_REAR_OLED_MODE = 'display:set-rear-oled-mode',
  SET_COLOR_THEME = 'display:set-color-theme',
  TRIGGER_CONFETTI_BURST = 'display:trigger-confetti-burst',

  // Diagnostics
  EXPORT_DIAGNOSTIC_LOGS = 'diagnostics:export-logs',

  // Updates. A notification only -- nothing is downloaded or installed.
  CHECK_FOR_UPDATE = 'updates:check',
  GET_UPDATE_CHECK_ENABLED = 'updates:get-enabled',
  SET_UPDATE_CHECK_ENABLED = 'updates:set-enabled',
  OPEN_RELEASE_PAGE = 'updates:open-release-page',
  ON_UPDATE_STATUS = 'updates:on-status'
}
