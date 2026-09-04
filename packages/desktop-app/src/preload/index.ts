import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPCChannel } from '../shared/ipc-channels';
import type { IElectronAPI } from './electron-api';
import type {
  ActiveSessionDTO,
  BitmapIconId,
  TaskDTO,
  DeviceStatusDTO,
  HardwareBindingConfig,
  PriorityMatrixConfig,
  PriorityRule,
  ProviderSettingsUpdateDTO,
  ScheduleSettingsDTO,
  UserMode,
  WorklogDTO,
  UnitySettingsDTO,
  UnityTelemetryDTO,
  MessagingSettingsDTO,
  WindowsNotificationSettingsDTO,
  NotificationLogEntryDTO,
  HardwareDisplayStateDTO,
  DeviceConfigDTO
} from '../shared/dtos';

const electronAPI: IElectronAPI = {
  // Session Controls
  getCurrentSession: () => ipcRenderer.invoke(IPCChannel.GET_CURRENT_SESSION),
  startTask: (taskId: string, isAdHoc?: boolean, customTitle?: string) =>
    ipcRenderer.invoke(IPCChannel.START_TASK, { taskId, isAdHoc, customTitle }),
  pauseSession: () => ipcRenderer.invoke(IPCChannel.PAUSE_SESSION),
  resumeSession: () => ipcRenderer.invoke(IPCChannel.RESUME_SESSION),
  completeSession: (comment?: string, markDone?: boolean) => ipcRenderer.invoke(IPCChannel.COMPLETE_SESSION, { comment, markDone }),
  discardSession: () => ipcRenderer.invoke(IPCChannel.DISCARD_SESSION),
  onSessionUpdated: (callback: (session: ActiveSessionDTO | null) => void) => {
    const handler = (_event: IpcRendererEvent, session: ActiveSessionDTO | null) => callback(session);
    ipcRenderer.on(IPCChannel.ON_SESSION_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_SESSION_UPDATED, handler);
  },

  // Worklogs
  getTodaysWorklogs: () => ipcRenderer.invoke(IPCChannel.GET_TODAYS_WORKLOGS),
  onWorklogsUpdated: (callback: (worklogs: WorklogDTO[]) => void) => {
    const handler = (_event: IpcRendererEvent, worklogs: WorklogDTO[]) => callback(worklogs);
    ipcRenderer.on(IPCChannel.ON_WORKLOGS_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_WORKLOGS_UPDATED, handler);
  },

  // Providers, Projects & Tasks
  getProviders: () => ipcRenderer.invoke(IPCChannel.GET_PROVIDERS),
  setActiveProvider: (payload: ProviderSettingsUpdateDTO) =>
    ipcRenderer.invoke(IPCChannel.SET_ACTIVE_PROVIDER, payload),
  fetchOpenProjectStatuses: (domain: string, apiKey: string) =>
    ipcRenderer.invoke(IPCChannel.FETCH_OP_STATUSES, { domain, apiKey }),
  getProjects: () => ipcRenderer.invoke(IPCChannel.GET_PROJECTS),
  createProject: (payload: { id: string; key: string; name: string; providerId?: string }) =>
    ipcRenderer.invoke(IPCChannel.CREATE_PROJECT, payload),
  renameProject: (payload: { id: string; name: string; key: string }) =>
    ipcRenderer.invoke(IPCChannel.RENAME_PROJECT, payload),
  deleteProject: (id: string) => ipcRenderer.invoke(IPCChannel.DELETE_PROJECT, id),
  getTasks: (projectId: string) => ipcRenderer.invoke(IPCChannel.GET_TASKS, projectId),
  deleteTask: (taskId: string) => ipcRenderer.invoke(IPCChannel.DELETE_TASK, taskId),
  updateTask: (task: TaskDTO) => ipcRenderer.invoke(IPCChannel.UPDATE_TASK, task),
  importTasks: (projectId: string, tasks: Array<{ key: string; title: string; status?: 'todo' | 'in_progress' | 'done' }>) =>
    ipcRenderer.invoke(IPCChannel.IMPORT_TASKS, { projectId, tasks }),
  reconcileRemoteState: () => ipcRenderer.invoke(IPCChannel.RECONCILE_REMOTE_STATE),

  // Worklog History & Reports
  getWorklogsByDate: (dateString: string) => ipcRenderer.invoke(IPCChannel.GET_WORKLOGS_BY_DATE, dateString),
  getDailyWorklogSummary: (dateString: string) => ipcRenderer.invoke(IPCChannel.GET_DAILY_WORKLOG_SUMMARY, dateString),

  // Database Management
  wipeAllData: () => ipcRenderer.invoke(IPCChannel.WIPE_ALL_DATA),

  // Hardware Rebindings
  getInputBindings: () => ipcRenderer.invoke(IPCChannel.GET_INPUT_BINDINGS),
  saveInputBindings: (config: HardwareBindingConfig) =>
    ipcRenderer.invoke(IPCChannel.SAVE_INPUT_BINDINGS, config),
  injectRemoteKey: (key: string) => ipcRenderer.invoke(IPCChannel.INJECT_REMOTE_KEY, key),
  onHardwareInputEvent: (callback: (event: { inputKey: string; actionAssigned: string }) => void) => {
    const handler = (_event: IpcRendererEvent, data: { inputKey: string; actionAssigned: string }) => callback(data);
    ipcRenderer.on(IPCChannel.ON_HARDWARE_INPUT_EVENT, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_HARDWARE_INPUT_EVENT, handler);
  },

  // Priority Rules
  getPriorityRules: () => ipcRenderer.invoke(IPCChannel.GET_PRIORITY_RULES),
  savePriorityRules: (config: PriorityMatrixConfig | PriorityRule[]) =>
    ipcRenderer.invoke(IPCChannel.SAVE_PRIORITY_RULES, config),
  setUserMode: (mode: string) => ipcRenderer.invoke(IPCChannel.SET_USER_MODE, mode),
  getUserMode: () => ipcRenderer.invoke(IPCChannel.GET_USER_MODE),
  onUserModeUpdated: (callback: (mode: UserMode) => void) => {
    const handler = (_event: IpcRendererEvent, mode: UserMode) => callback(mode);
    ipcRenderer.on(IPCChannel.ON_USER_MODE_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_USER_MODE_UPDATED, handler);
  },

  // Device Management
  getDeviceStatus: () => ipcRenderer.invoke(IPCChannel.GET_DEVICE_STATUS),
  getDeviceConfig: () => ipcRenderer.invoke(IPCChannel.GET_DEVICE_CONFIG),
  setDeviceConfig: (config: DeviceConfigDTO) => ipcRenderer.invoke(IPCChannel.SET_DEVICE_CONFIG, config),
  onDeviceStatusChanged: (callback: (status: DeviceStatusDTO) => void) => {
    const handler = (_event: IpcRendererEvent, status: DeviceStatusDTO) => callback(status);
    ipcRenderer.on(IPCChannel.ON_DEVICE_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_DEVICE_STATUS_CHANGED, handler);
  },

  // Schedule & Ceremonies
  getScheduleSettings: () => ipcRenderer.invoke(IPCChannel.GET_SCHEDULE_SETTINGS),
  saveScheduleSettings: (settings: ScheduleSettingsDTO) =>
    ipcRenderer.invoke(IPCChannel.SAVE_SCHEDULE_SETTINGS, settings),
  triggerStandupPrompt: () => ipcRenderer.invoke(IPCChannel.TRIGGER_STANDUP_PROMPT),
  cancelStandupPrompt: () => ipcRenderer.invoke(IPCChannel.CANCEL_STANDUP_PROMPT),
  triggerEodPrompt: () => ipcRenderer.invoke(IPCChannel.TRIGGER_EOD_PROMPT),
  triggerEodWrapUp: (options?: { shouldShutdown?: boolean }) => ipcRenderer.invoke(IPCChannel.TRIGGER_EOD_WRAP_UP, options),
  cancelEodWrapUp: () => ipcRenderer.invoke(IPCChannel.CANCEL_EOD_WRAP_UP),
  updateCeremonyPrompt: (type: 'STANDUP' | 'LUNCH' | 'EOD', title: string) => ipcRenderer.invoke(IPCChannel.UPDATE_CEREMONY_PROMPT, { type, title }),
  snoozeCeremony: (type: 'STANDUP' | 'EOD', minutes = 10) => ipcRenderer.invoke(IPCChannel.SNOOZE_CEREMONY, { type, minutes }),
  onCeremonyPrompt: (callback: (prompt: { type: 'STANDUP' | 'LUNCH' | 'EOD'; title: string }) => void) => {
    const handler = (_event: IpcRendererEvent, prompt: { type: 'STANDUP' | 'LUNCH' | 'EOD'; title: string }) =>
      callback(prompt);
    ipcRenderer.on(IPCChannel.ON_CEREMONY_PROMPT, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_CEREMONY_PROMPT, handler);
  },

  // Unity Telemetry & Audio Settings
  getUnitySettings: () => ipcRenderer.invoke(IPCChannel.GET_UNITY_SETTINGS),
  saveUnitySettings: (settings: UnitySettingsDTO) =>
    ipcRenderer.invoke(IPCChannel.SAVE_UNITY_SETTINGS, settings),
  getUnityTelemetry: () => ipcRenderer.invoke(IPCChannel.GET_UNITY_TELEMETRY),
  onUnityTelemetryUpdated: (callback: (telemetry: UnityTelemetryDTO) => void) => {
    const handler = (_event: IpcRendererEvent, telemetry: UnityTelemetryDTO) => callback(telemetry);
    ipcRenderer.on(IPCChannel.ON_UNITY_TELEMETRY_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_UNITY_TELEMETRY_UPDATED, handler);
  },

  // Messaging Integration & Windows Notification Listener
  getMessagingSettings: () => ipcRenderer.invoke(IPCChannel.GET_MESSAGING_SETTINGS),
  saveMessagingSettings: (settings: MessagingSettingsDTO) =>
    ipcRenderer.invoke(IPCChannel.SAVE_MESSAGING_SETTINGS, settings),
  testMessagingIntegration: (channelName: string) =>
    ipcRenderer.invoke(IPCChannel.TEST_MESSAGING_INTEGRATION, channelName),
  getNotificationSettings: () => ipcRenderer.invoke(IPCChannel.GET_NOTIFICATION_SETTINGS),
  saveNotificationSettings: (settings: Partial<WindowsNotificationSettingsDTO>) =>
    ipcRenderer.invoke(IPCChannel.SAVE_NOTIFICATION_SETTINGS, settings),
  simulateNotification: (payload: { appId: string; appName: string; title: string; body: string; iconId?: BitmapIconId; iconPath?: string }) =>
    ipcRenderer.invoke(IPCChannel.SIMULATE_NOTIFICATION, payload),
  getNotificationListenerStatus: () => ipcRenderer.invoke(IPCChannel.GET_NOTIFICATION_LISTENER_STATUS),
  onNotificationLog: (callback: (entry: NotificationLogEntryDTO) => void) => {
    const handler = (_event: IpcRendererEvent, entry: NotificationLogEntryDTO) => callback(entry);
    ipcRenderer.on(IPCChannel.ON_NOTIFICATION_LOG, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_NOTIFICATION_LOG, handler);
  },
  openNotificationSettings: () => ipcRenderer.invoke(IPCChannel.OPEN_NOTIFICATION_SETTINGS),

  // Hardware Display Animation & Screen Emulator
  getDisplayState: () => ipcRenderer.invoke(IPCChannel.GET_DISPLAY_STATE),
  onDisplayStateUpdated: (callback: (state: HardwareDisplayStateDTO) => void) => {
    const handler = (_event: IpcRendererEvent, state: HardwareDisplayStateDTO) => callback(state);
    ipcRenderer.on(IPCChannel.ON_DISPLAY_STATE_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_DISPLAY_STATE_UPDATED, handler);
  },
  setRearOledMode: (mode: string) => ipcRenderer.invoke(IPCChannel.SET_REAR_OLED_MODE, mode),
  setColorTheme: (theme: string) => ipcRenderer.invoke(IPCChannel.SET_COLOR_THEME, theme),
  triggerConfettiBurst: () => ipcRenderer.invoke(IPCChannel.TRIGGER_CONFETTI_BURST),

  // Diagnostics
  exportDiagnosticLogs: () => ipcRenderer.invoke(IPCChannel.EXPORT_DIAGNOSTIC_LOGS),

  // Unity Plugin Injector & Gitignore
  unityInjector: {
    setupGitignore: () => ipcRenderer.invoke(IPCChannel.SETUP_GITIGNORE),
    checkGitignore: () => ipcRenderer.invoke(IPCChannel.CHECK_GITIGNORE),
    scanAndInject: (rootFolder: string) => ipcRenderer.invoke(IPCChannel.SCAN_AND_INJECT, rootFolder),
    removeInjection: (projectPath: string) => ipcRenderer.invoke(IPCChannel.REMOVE_INJECTION, projectPath),
    openFolderPicker: () => ipcRenderer.invoke(IPCChannel.OPEN_FOLDER_PICKER)
  }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
