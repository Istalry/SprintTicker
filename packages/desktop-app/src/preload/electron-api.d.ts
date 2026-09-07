/**
 * The contract between the preload bridge and the renderer.
 *
 * Kept in a .d.ts so both tsconfigs can include it with zero runtime footprint:
 * the renderer needs the `Window.electronAPI` global, but must never pull in
 * `electron` itself, which `src/preload/index.ts` imports.
 *
 * `src/preload/index.ts` annotates its implementation object as `IElectronAPI`.
 * That annotation is what makes drift a compile error rather than a runtime
 * `undefined is not a function` in the renderer, so keep it.
 */

import type {
  ActiveSessionDTO,
  TaskDTO,
  ProjectDTO,
  ProviderSettingsDTO,
  ProviderSettingsUpdateDTO,
  HardwareBindingConfig,
  DeviceStatusDTO,
  PriorityMatrixConfig,
  PriorityRule,
  UserMode,
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
  HardwareDisplayStateDTO,
  OpStatusDTO,
  DeviceConfigDTO,
  UpdateStatusDTO
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
  getProviders: () => Promise<ProviderSettingsDTO>;
  setActiveProvider: (payload: ProviderSettingsUpdateDTO) => Promise<boolean>;
  fetchOpenProjectStatuses: (domain: string, apiKey: string) => Promise<{ success: boolean; data?: OpStatusDTO[]; error?: string }>;
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
  // The bridge accepts either shape; the interface said only the first, so a
  // renderer passing a bare rule array was a type error against a call that
  // works fine at runtime.
  savePriorityRules: (config: PriorityMatrixConfig | PriorityRule[]) => Promise<boolean>;
  // Implemented in the bridge but previously absent here, so every renderer
  // call site had to guard with `if (window.electronAPI.setUserMode)` and lost
  // all type checking on the argument.
  setUserMode: (mode: UserMode) => Promise<boolean>;
  getUserMode: () => Promise<UserMode>;
  onUserModeUpdated?: (callback: (mode: UserMode) => void) => () => void;

  // Device Management
  getDeviceStatus: () => Promise<DeviceStatusDTO>;
  getDeviceConfig: () => Promise<DeviceConfigDTO>;
  setDeviceConfig: (config: DeviceConfigDTO) => Promise<boolean>;
  onDeviceStatusChanged: (callback: (status: DeviceStatusDTO) => void) => () => void;

  // Schedule & Ceremonies
  getScheduleSettings: () => Promise<ScheduleSettingsDTO>;
  saveScheduleSettings: (settings: ScheduleSettingsDTO) => Promise<boolean>;
  triggerStandupPrompt: () => Promise<{ success: boolean }>;
  cancelStandupPrompt: () => Promise<boolean>;
  triggerEodPrompt: () => Promise<{ success: boolean }>;
  triggerEodWrapUp: (options?: { shouldShutdown?: boolean }) => Promise<{ success: boolean; savedUnityScenes: boolean; savedVSCode: boolean }>;
  cancelEodWrapUp: () => Promise<boolean>;
  updateCeremonyPrompt: (type: 'STANDUP' | 'LUNCH' | 'EOD', title: string) => Promise<boolean>;
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
  simulateNotification: (payload: { appId: string; appName: string; title: string; body: string; iconId?: BitmapIconId; iconPath?: string }) => Promise<WindowsNotificationEventDTO>;
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

  // Diagnostics
  exportDiagnosticLogs: () => Promise<boolean>;

  // Updates
  checkForUpdate: () => Promise<UpdateStatusDTO>;
  getUpdateCheckEnabled: () => Promise<boolean>;
  setUpdateCheckEnabled: (enabled: boolean) => Promise<boolean>;
  openReleasePage: (url: string) => Promise<boolean>;
  onUpdateStatus: (callback: (status: UpdateStatusDTO) => void) => () => void;

  // Unity Plugin Injector & Gitignore
  unityInjector: UnityInjectorAPI;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
