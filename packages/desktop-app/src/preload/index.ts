import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPCChannel } from '../shared/ipc-channels';
import {
  ActiveSessionDTO,
  TaskDTO,
  ProjectDTO,
  HardwareBindingConfig,
  DeviceStatusDTO,
  PriorityMatrixConfig,
  ScheduleSettingsDTO,
  UnityProjectInjectionResult,
  WorklogDTO,
  UnitySettingsDTO,
  UnityTelemetryDTO,
  MessagingSettingsDTO,
  MessagingTestResultDTO,
  WindowsNotificationSettingsDTO,
  WindowsNotificationEventDTO,
  NotificationLogEntryDTO,
  NotificationListenerStatusDTO,
  BitmapIconId,
  HardwareDisplayStateDTO
} from '../shared/dtos';

export interface UnityInjectorAPI {
  setupGitignore: () => Promise<{ success: boolean; path: string; message: string }>;
  checkGitignore: () => Promise<{ configured: boolean; path?: string }>;
  scanAndInject: (rootFolder: string) => Promise<UnityProjectInjectionResult[]>;
  removeInjection: (projectPath: string) => Promise<boolean>;
  openFolderPicker: () => Promise<string | null>;
}

export interface IElectronAPI {
  // Session Controls
  getCurrentSession: () => Promise<ActiveSessionDTO | null>;
  startTask: (taskId: string, isAdHoc?: boolean, customTitle?: string) => Promise<ActiveSessionDTO>;
  pauseSession: () => Promise<ActiveSessionDTO>;
  resumeSession: () => Promise<ActiveSessionDTO>;
  completeSession: (comment?: string, markDone?: boolean) => Promise<{ success: boolean; loggedSeconds: number }>;
  discardSession: () => Promise<boolean>;
  onSessionUpdated: (callback: (session: ActiveSessionDTO | null) => void) => () => void;

  // Worklogs
  getTodaysWorklogs: () => Promise<WorklogDTO[]>;
  onWorklogsUpdated: (callback: (worklogs: WorklogDTO[]) => void) => () => void;

  // Providers, Projects & Tasks
  getProviders: () => Promise<{ activeProviderId: string; fallbackTicketKey: string; jiraDomain: string; providers: Array<{ id: string; name: string }> }>;
  setActiveProvider: (payload: { providerId: string; jiraDomain?: string; fallbackTicketKey?: string }) => Promise<boolean>;
  getProjects: () => Promise<ProjectDTO[]>;
  createProject: (payload: { id: string; key: string; name: string; providerId?: string }) => Promise<boolean>;
  renameProject: (payload: { id: string; name: string; key: string }) => Promise<boolean>;
  deleteProject: (id: string) => Promise<boolean>;
  getTasks: (projectId: string) => Promise<TaskDTO[]>;
  deleteTask: (taskId: string) => Promise<boolean>;
  updateTask: (task: TaskDTO) => Promise<boolean>;
  importTasks: (projectId: string, tasks: Array<{ key: string; title: string; status?: 'todo' | 'in_progress' | 'done' }>) => Promise<TaskDTO[]>;
  reconcileRemoteState: () => Promise<{ activeTask?: TaskDTO; remoteLoggedTimeToday: number }>;

  // Worklog History & Reports
  getWorklogsByDate: (dateString: string) => Promise<WorklogDTO[]>;
  getDailyWorklogSummary: (dateString: string) => Promise<{
    date: string;
    totalSeconds: number;
    tasksCount: number;
    items: Array<{ taskId: string; key: string; title: string; durationSeconds: number; comment: string }>;
  }>;

  // Hardware Rebindings
  getInputBindings: () => Promise<HardwareBindingConfig>;
  saveInputBindings: (config: HardwareBindingConfig) => Promise<boolean>;
  injectRemoteKey: (key: string) => Promise<boolean>;
  onHardwareInputEvent: (callback: (event: { inputKey: string; actionAssigned: string }) => void) => () => void;

  // Priority Rules
  getPriorityRules: () => Promise<PriorityMatrixConfig>;
  savePriorityRules: (config: PriorityMatrixConfig) => Promise<boolean>;
  onUserModeUpdated?: (callback: (mode: UserMode) => void) => () => void;

  // Device Management
  getDeviceStatus: () => Promise<DeviceStatusDTO>;
  onDeviceStatusChanged: (callback: (status: DeviceStatusDTO) => void) => () => void;

  // Schedule & Ceremonies
  getScheduleSettings: () => Promise<ScheduleSettingsDTO>;
  saveScheduleSettings: (settings: ScheduleSettingsDTO) => Promise<boolean>;
  triggerEodWrapUp: (options?: { shouldShutdown?: boolean }) => Promise<{ success: boolean; savedUnityScenes: boolean; savedVSCode: boolean }>;
  cancelEodWrapUp: () => Promise<boolean>;
  snoozeCeremony: (type: 'STANDUP' | 'EOD', minutes?: number) => Promise<boolean>;
  onCeremonyPrompt: (callback: (prompt: { type: 'STANDUP' | 'LUNCH' | 'EOD'; title: string }) => void) => () => void;

  // Unity Telemetry & Audio Settings
  getUnitySettings: () => Promise<UnitySettingsDTO>;
  saveUnitySettings: (settings: UnitySettingsDTO) => Promise<boolean>;
  getUnityTelemetry: () => Promise<UnityTelemetryDTO>;
  onUnityTelemetryUpdated: (callback: (telemetry: UnityTelemetryDTO) => void) => () => void;

  // Messaging Integration & Windows Notification Listener
  getMessagingSettings: () => Promise<MessagingSettingsDTO>;
  saveMessagingSettings: (settings: MessagingSettingsDTO) => Promise<boolean>;
  testMessagingIntegration: (channelName: string) => Promise<MessagingTestResultDTO>;
  getNotificationSettings: () => Promise<WindowsNotificationSettingsDTO>;
  saveNotificationSettings: (settings: Partial<WindowsNotificationSettingsDTO>) => Promise<boolean>;
  simulateNotification: (payload: { appId: string; appName: string; title: string; body: string; iconId?: BitmapIconId }) => Promise<WindowsNotificationEventDTO>;
  getNotificationListenerStatus: () => Promise<{ status: NotificationListenerStatusDTO; logs: NotificationLogEntryDTO[] }>;
  onNotificationLog: (callback: (entry: NotificationLogEntryDTO) => void) => () => void;
  openNotificationSettings: () => Promise<boolean>;

  // Hardware Display Animation & Screen Emulator
  getDisplayState: () => Promise<HardwareDisplayStateDTO>;
  onDisplayStateUpdated: (callback: (state: HardwareDisplayStateDTO) => void) => () => void;
  setRearOledMode: (mode: string) => Promise<boolean>;
  setColorTheme: (theme: string) => Promise<boolean>;
  triggerConfettiBurst: () => Promise<boolean>;

  // Database Management
  wipeAllData: () => Promise<boolean>;

  // Unity Plugin Injector & Gitignore
  unityInjector: UnityInjectorAPI;
}

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
  setActiveProvider: (payload: { providerId: string; jiraDomain?: string; fallbackTicketKey?: string }) =>
    ipcRenderer.invoke(IPCChannel.SET_ACTIVE_PROVIDER, payload),
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
  onDeviceStatusChanged: (callback: (status: DeviceStatusDTO) => void) => {
    const handler = (_event: IpcRendererEvent, status: DeviceStatusDTO) => callback(status);
    ipcRenderer.on(IPCChannel.ON_DEVICE_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_DEVICE_STATUS_CHANGED, handler);
  },

  // Schedule & Ceremonies
  getScheduleSettings: () => ipcRenderer.invoke(IPCChannel.GET_SCHEDULE_SETTINGS),
  saveScheduleSettings: (settings: ScheduleSettingsDTO) =>
    ipcRenderer.invoke(IPCChannel.SAVE_SCHEDULE_SETTINGS, settings),
  triggerEodWrapUp: (options?: { shouldShutdown?: boolean }) => ipcRenderer.invoke(IPCChannel.TRIGGER_EOD_WRAP_UP, options),
  cancelEodWrapUp: () => ipcRenderer.invoke(IPCChannel.CANCEL_EOD_WRAP_UP),
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
  simulateNotification: (payload: { appId: string; appName: string; title: string; body: string; iconId?: BitmapIconId }) =>
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

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
