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

  // Hardware Input Rebindings
  GET_INPUT_BINDINGS = 'input:get-bindings',
  SAVE_INPUT_BINDINGS = 'input:save-bindings',
  ON_HARDWARE_INPUT_EVENT = 'input:on-hardware-event',

  // Priority Matrix & Display
  GET_PRIORITY_RULES = 'priority:get-rules',
  SAVE_PRIORITY_RULES = 'priority:save-rules',

  // Device Management & SDK
  GET_DEVICE_STATUS = 'device:get-status',
  SET_DEVICE_CONFIG = 'device:set-config',
  ON_DEVICE_STATUS_CHANGED = 'device:on-status-changed',

  // Ceremonies & Schedule
  GET_SCHEDULE_SETTINGS = 'schedule:get-settings',
  SAVE_SCHEDULE_SETTINGS = 'schedule:save-settings',
  TRIGGER_EOD_WRAP_UP = 'schedule:trigger-eod-wrapup',
  ON_CEREMONY_PROMPT = 'schedule:on-ceremony-prompt',

  // Unity Injector & Gitignore
  SETUP_GITIGNORE = 'unity-injector:setup-gitignore',
  CHECK_GITIGNORE = 'unity-injector:check-gitignore',
  SCAN_AND_INJECT = 'unity-injector:scan-and-inject',
  REMOVE_INJECTION = 'unity-injector:remove-injection',
  OPEN_FOLDER_PICKER = 'dialog:open-folder-picker'
}
