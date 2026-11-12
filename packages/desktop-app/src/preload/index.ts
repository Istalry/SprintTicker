import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { ProviderEventSettingsDTO } from '../shared/provider-events';
import type { ManualWorklogDTO, WorklogCorrectionDTO } from '../shared/worklog-correction';
import type { TaskVisibility } from '../shared/task-visibility';
import type { InterruptShortcutSetting } from '../shared/interrupt-shortcut';
import type { InterruptionToPlaceDTO } from '../shared/interruption';
import type { ConnectionTestRequestDTO } from '../shared/first-run';
import type { NoticeKind, SyncHealthDTO } from '../shared/sync-health';
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
  ResumePromptDTO,
  CeremonyPromptDTO,
  StandupTaskDTO,
  ReminderDTO,
  WeekEndedDTO,
  ForgottenSessionReviewDTO,
  ForgottenSessionResolutionDTO,
  UserMode,
  WorklogDTO,
  UndoStateDTO,
  WindowsNotificationSettingsDTO,
  NotificationLogEntryDTO,
  HardwareDisplayStateDTO,
  ScreenIconDTO,
  DeviceConfigDTO,
  UpdateStatusDTO,
  ProjectsUpdatedPayload,
  PreviewScreenId
} from '../shared/dtos';

const electronAPI: IElectronAPI = {
  // Session Controls
  getCurrentSession: () => ipcRenderer.invoke(IPCChannel.GET_CURRENT_SESSION),
  startInterruption: () => ipcRenderer.invoke(IPCChannel.START_INTERRUPTION),
  renameSession: (title: string) => ipcRenderer.invoke(IPCChannel.RENAME_SESSION, title),
  assignSession: (taskId: string) => ipcRenderer.invoke(IPCChannel.ASSIGN_SESSION, taskId),
  startTask: (taskId: string, isAdHoc?: boolean, customTitle?: string) =>
    ipcRenderer.invoke(IPCChannel.START_TASK, { taskId, isAdHoc, customTitle }),
  pauseSession: () => ipcRenderer.invoke(IPCChannel.PAUSE_SESSION),
  resumeSession: () => ipcRenderer.invoke(IPCChannel.RESUME_SESSION),
  completeSession: (comment?: string, markDone?: boolean) => ipcRenderer.invoke(IPCChannel.COMPLETE_SESSION, { comment, markDone }),
  discardSession: () => ipcRenderer.invoke(IPCChannel.DISCARD_SESSION),
  getSessionDays: () => ipcRenderer.invoke(IPCChannel.GET_SESSION_DAYS),
  getForgottenReview: () => ipcRenderer.invoke(IPCChannel.GET_FORGOTTEN_REVIEW),
  shouldShowFirstRun: () => ipcRenderer.invoke(IPCChannel.GET_FIRST_RUN),
  finishFirstRun: () => ipcRenderer.invoke(IPCChannel.FINISH_FIRST_RUN),
  testProviderConnection: (request: ConnectionTestRequestDTO) => ipcRenderer.invoke(IPCChannel.TEST_PROVIDER_CONNECTION, request),
  detectDesk: () => ipcRenderer.invoke(IPCChannel.DETECT_DESK),
  installDeckPlugin: () => ipcRenderer.invoke(IPCChannel.INSTALL_DECK_PLUGIN),
  openTokenPage: (providerId: 'jira' | 'openproject', site: string) => ipcRenderer.invoke(IPCChannel.OPEN_TOKEN_PAGE, providerId, site),
  getSyncHealth: () => ipcRenderer.invoke(IPCChannel.GET_SYNC_HEALTH),
  onSyncHealth: (callback: (health: SyncHealthDTO) => void) => {
    const handler = (_event: IpcRendererEvent, health: SyncHealthDTO) => callback(health);
    ipcRenderer.on(IPCChannel.ON_SYNC_HEALTH, handler);
    return () => { ipcRenderer.removeListener(IPCChannel.ON_SYNC_HEALTH, handler); };
  },
  getNotices: () => ipcRenderer.invoke(IPCChannel.GET_NOTICES),
  dismissNotice: (kind: NoticeKind) => ipcRenderer.invoke(IPCChannel.DISMISS_NOTICE, kind),
  resolveForgottenSession: (resolution: ForgottenSessionResolutionDTO) =>
    ipcRenderer.invoke(IPCChannel.RESOLVE_FORGOTTEN_SESSION, resolution),
  onForgottenReview: (callback: (review: ForgottenSessionReviewDTO | null) => void) => {
    const handler = (_event: IpcRendererEvent, review: ForgottenSessionReviewDTO | null) => callback(review);
    ipcRenderer.on(IPCChannel.ON_FORGOTTEN_SESSION_REVIEW, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_FORGOTTEN_SESSION_REVIEW, handler);
  },
  onSessionUpdated: (callback: (session: ActiveSessionDTO | null) => void) => {
    const handler = (_event: IpcRendererEvent, session: ActiveSessionDTO | null) => callback(session);
    ipcRenderer.on(IPCChannel.ON_SESSION_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_SESSION_UPDATED, handler);
  },

  // Undo
  getUndo: () => ipcRenderer.invoke(IPCChannel.GET_UNDO),
  runUndo: () => ipcRenderer.invoke(IPCChannel.RUN_UNDO),
  getPickerData: () => ipcRenderer.invoke(IPCChannel.GET_PICKER_DATA),
  fetchTaskByKey: (key) => ipcRenderer.invoke(IPCChannel.FETCH_TASK_BY_KEY, key),
  interrupt: (options) => ipcRenderer.invoke(IPCChannel.INTERRUPTION_START, options),
  anotherInterruption: () => ipcRenderer.invoke(IPCChannel.INTERRUPTION_ANOTHER),
  backFromInterruption: (addGapMinutes) => ipcRenderer.invoke(IPCChannel.INTERRUPTION_BACK, addGapMinutes),
  stopInterruption: () => ipcRenderer.invoke(IPCChannel.INTERRUPTION_STOP),
  switchFromInterruption: (taskId, takeAlong) => ipcRenderer.invoke(IPCChannel.INTERRUPTION_SWITCH, taskId, takeAlong),
  discardInterruption: (id) => ipcRenderer.invoke(IPCChannel.INTERRUPTION_DISCARD, id),
  renameInterruption: (id, name) => ipcRenderer.invoke(IPCChannel.INTERRUPTION_RENAME, id, name),
  moveInterruptionStart: atUtc => ipcRenderer.invoke(IPCChannel.INTERRUPTION_MOVE_START, atUtc),
  chooseInterruptionTask: taskId => ipcRenderer.invoke(IPCChannel.INTERRUPTION_CHOOSE_TASK, taskId),
  placeInterruption: (id, taskId) => ipcRenderer.invoke(IPCChannel.INTERRUPTION_PLACE, id, taskId),
  placeInterruptions: (ids, taskId) => ipcRenderer.invoke(IPCChannel.INTERRUPTION_PLACE_MANY, ids, taskId),
  keepInterruptionOff: (id) => ipcRenderer.invoke(IPCChannel.INTERRUPTION_KEEP_OFF, id),
  getInterruptionsToPlace: () => ipcRenderer.invoke(IPCChannel.INTERRUPTION_GET_TO_PLACE),
  onInterruptionsUpdated: (callback: (waiting: InterruptionToPlaceDTO[]) => void) => {
    const handler = (_event: IpcRendererEvent, waiting: InterruptionToPlaceDTO[]) => callback(waiting);
    ipcRenderer.on(IPCChannel.ON_INTERRUPTIONS_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_INTERRUPTIONS_UPDATED, handler);
  },
  getFlowSetting: (key) => ipcRenderer.invoke(IPCChannel.GET_FLOW_SETTING, key),
  saveFlowSetting: (key, value) => ipcRenderer.invoke(IPCChannel.SAVE_FLOW_SETTING, key, value),
  onUndoChanged: (callback: (state: UndoStateDTO | null) => void) => {
    const handler = (_event: IpcRendererEvent, state: UndoStateDTO | null) => callback(state);
    ipcRenderer.on(IPCChannel.ON_UNDO_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_UNDO_CHANGED, handler);
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
  getProviderCapabilities: () => ipcRenderer.invoke(IPCChannel.GET_PROVIDER_CAPABILITIES),
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

  // Worklog History & Reports
  getWorklogsByDate: (dateString: string) => ipcRenderer.invoke(IPCChannel.GET_WORKLOGS_BY_DATE, dateString),
  getWorklogsRange: (from: string, to: string) => ipcRenderer.invoke(IPCChannel.GET_WORKLOGS_RANGE, from, to),
  exportWorklogsCsv: (from: string, to: string) => ipcRenderer.invoke(IPCChannel.EXPORT_WORKLOGS_CSV, from, to),
  getWeekChanges: (day: string) => ipcRenderer.invoke(IPCChannel.GET_WEEK_CHANGES, day),
  splitWorklog: (worklogId: string, atUtc: string, taskId: string) => ipcRenderer.invoke(IPCChannel.SPLIT_WORKLOG, worklogId, atUtc, taskId),
  getUnsortedWorklogs: () => ipcRenderer.invoke(IPCChannel.GET_UNSORTED_WORKLOGS),
  starTask: (taskId: string) => ipcRenderer.invoke(IPCChannel.STAR_TASK, taskId),
  unstarTask: (taskId: string) => ipcRenderer.invoke(IPCChannel.UNSTAR_TASK, taskId),
  getStarredTasks: () => ipcRenderer.invoke(IPCChannel.GET_STARRED_TASKS),
  getRecentTasks: () => ipcRenderer.invoke(IPCChannel.GET_RECENT_TASKS),
  getPreviousTask: () => ipcRenderer.invoke(IPCChannel.GET_PREVIOUS_TASK),
  renameAdHocTask: (taskId: string, title: string) => ipcRenderer.invoke(IPCChannel.RENAME_AD_HOC_TASK, taskId, title),
  moveWorklog: (worklogId: string, taskId: string) => ipcRenderer.invoke(IPCChannel.MOVE_WORKLOG, worklogId, taskId),
  addWorklog: (entry: ManualWorklogDTO) => ipcRenderer.invoke(IPCChannel.CREATE_MANUAL_WORKLOG, entry),
  moveSessionTo: (taskId: string) => ipcRenderer.invoke(IPCChannel.MOVE_SESSION, taskId),
  updateWorklog: (worklogId: string, correction: WorklogCorrectionDTO) =>
    ipcRenderer.invoke(IPCChannel.UPDATE_WORKLOG, worklogId, correction),
  deleteWorklog: (worklogId: string) => ipcRenderer.invoke(IPCChannel.DELETE_WORKLOG, worklogId),
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
  joinStandup: (joinedAt?: string) => ipcRenderer.invoke(IPCChannel.JOIN_STANDUP, joinedAt),
  answerLunchQuestion: (start: boolean) => ipcRenderer.invoke(IPCChannel.ANSWER_LUNCH_QUESTION, start),
  getStandupTask: () => ipcRenderer.invoke(IPCChannel.GET_STANDUP_TASK),
  setStandupTask: (task: StandupTaskDTO | null) => ipcRenderer.invoke(IPCChannel.SET_STANDUP_TASK, task),
  getWeekEnded: () => ipcRenderer.invoke(IPCChannel.GET_WEEK_ENDED),
  getLastWeekClosed: () => ipcRenderer.invoke(IPCChannel.GET_LAST_WEEK_CLOSED),
  dismissWeekEnded: () => ipcRenderer.invoke(IPCChannel.DISMISS_WEEK_ENDED),
  onWeekEnded: (callback: (week: WeekEndedDTO | null) => void) => {
    const handler = (_event: IpcRendererEvent, week: WeekEndedDTO | null) => callback(week);
    ipcRenderer.on(IPCChannel.ON_WEEK_ENDED, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_WEEK_ENDED, handler);
  },
  triggerEodPrompt: () => ipcRenderer.invoke(IPCChannel.TRIGGER_EOD_PROMPT),
  triggerEodWrapUp: (options?: { shouldShutdown?: boolean }) => ipcRenderer.invoke(IPCChannel.TRIGGER_EOD_WRAP_UP, options),
  cancelEodWrapUp: () => ipcRenderer.invoke(IPCChannel.CANCEL_EOD_WRAP_UP),
  updateCeremonyPrompt: (type: 'STANDUP' | 'LUNCH' | 'EOD', title: string) => ipcRenderer.invoke(IPCChannel.UPDATE_CEREMONY_PROMPT, { type, title }),
  snoozeCeremony: (type: 'STANDUP' | 'EOD', minutes = 10) => ipcRenderer.invoke(IPCChannel.SNOOZE_CEREMONY, { type, minutes }),
  getResumePrompt: () => ipcRenderer.invoke(IPCChannel.GET_RESUME_PROMPT),
  answerResumePrompt: (resume: boolean, addGapMinutes?: number, workedThrough?: boolean) =>
    ipcRenderer.invoke(IPCChannel.ANSWER_RESUME_PROMPT, resume, addGapMinutes, workedThrough),
  onResumePrompt: (callback: (prompt: ResumePromptDTO | null) => void) => {
    const handler = (_event: IpcRendererEvent, prompt: ResumePromptDTO | null) => callback(prompt);
    ipcRenderer.on(IPCChannel.ON_RESUME_PROMPT, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_RESUME_PROMPT, handler);
  },
  getCeremonyPrompt: () => ipcRenderer.invoke(IPCChannel.GET_CEREMONY_PROMPT),
  getReminder: () => ipcRenderer.invoke(IPCChannel.GET_REMINDER),
  dismissReminder: (id: string) => ipcRenderer.invoke(IPCChannel.DISMISS_REMINDER, id),
  getMorning: () => ipcRenderer.invoke(IPCChannel.GET_MORNING),
  markMorningSeen: () => ipcRenderer.invoke(IPCChannel.MORNING_SEEN),
  onReminder: (callback: (reminder: ReminderDTO | null) => void) => {
    const handler = (_event: IpcRendererEvent, reminder: ReminderDTO | null) => callback(reminder);
    ipcRenderer.on(IPCChannel.ON_REMINDER, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_REMINDER, handler);
  },
  onCeremonyPrompt: (callback: (prompt: CeremonyPromptDTO | null) => void) => {
    const handler = (_event: IpcRendererEvent, prompt: CeremonyPromptDTO | null) => callback(prompt);
    ipcRenderer.on(IPCChannel.ON_CEREMONY_PROMPT, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_CEREMONY_PROMPT, handler);
  },

  // Provider events
  getProviderEventSettings: () => ipcRenderer.invoke(IPCChannel.GET_PROVIDER_EVENT_SETTINGS),
  saveProviderEventSettings: (settings: ProviderEventSettingsDTO) =>
    ipcRenderer.invoke(IPCChannel.SAVE_PROVIDER_EVENT_SETTINGS, settings),
  testProviderEvents: () => ipcRenderer.invoke(IPCChannel.TEST_PROVIDER_EVENTS),

  // Windows Notification Listener
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
  getScreenIcon: () => ipcRenderer.invoke(IPCChannel.GET_SCREEN_ICON),
  onScreenIcon: (callback: (icon: ScreenIconDTO | null) => void) => {
    const handler = (_event: IpcRendererEvent, icon: ScreenIconDTO | null) => callback(icon);
    ipcRenderer.on(IPCChannel.ON_SCREEN_ICON, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_SCREEN_ICON, handler);
  },
  setColorTheme: (theme: string) => ipcRenderer.invoke(IPCChannel.SET_COLOR_THEME, theme),
  getColorTheme: () => ipcRenderer.invoke(IPCChannel.GET_COLOR_THEME),
  triggerConfettiBurst: () => ipcRenderer.invoke(IPCChannel.TRIGGER_CONFETTI_BURST),
  previewDisplayScreen: (screen: PreviewScreenId) => ipcRenderer.invoke(IPCChannel.PREVIEW_DISPLAY_SCREEN, screen),

  // Diagnostics
  exportDiagnosticLogs: () => ipcRenderer.invoke(IPCChannel.EXPORT_DIAGNOSTIC_LOGS),

  // Updates. Notification only -- nothing here downloads or installs.
  checkForUpdate: () => ipcRenderer.invoke(IPCChannel.CHECK_FOR_UPDATE),
  getSystemLocale: () => ipcRenderer.invoke(IPCChannel.GET_SYSTEM_LOCALE),

  // Mini timer
  toggleMiniWindow: () => ipcRenderer.invoke(IPCChannel.MINI_TOGGLE),
  isMiniWindowOpen: () => ipcRenderer.invoke(IPCChannel.MINI_IS_OPEN),
  onMiniWindowVisibility: (callback: (open: boolean) => void) => {
    const handler = (_event: IpcRendererEvent, open: boolean) => callback(open);
    ipcRenderer.on(IPCChannel.ON_MINI_VISIBILITY, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_MINI_VISIBILITY, handler);
  },
  openTaskPicker: () => ipcRenderer.invoke(IPCChannel.OPEN_TASK_PICKER),
  openAssignPicker: () => ipcRenderer.invoke(IPCChannel.OPEN_ASSIGN_PICKER),
  getOnlyProjectsWithTasks: () => ipcRenderer.invoke(IPCChannel.GET_ONLY_PROJECTS_WITH_TASKS),
  setOnlyProjectsWithTasks: (enabled: boolean) => ipcRenderer.invoke(IPCChannel.SET_ONLY_PROJECTS_WITH_TASKS, enabled),
  onOnlyProjectsWithTasks: (callback: (enabled: boolean) => void) => {
    const handler = (_event: IpcRendererEvent, enabled: boolean) => callback(enabled);
    ipcRenderer.on(IPCChannel.ON_ONLY_PROJECTS_WITH_TASKS, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_ONLY_PROJECTS_WITH_TASKS, handler);
  },
  getTaskVisibility: () => ipcRenderer.invoke(IPCChannel.GET_TASK_VISIBILITY),
  setTaskVisibility: (visibility: TaskVisibility) => ipcRenderer.invoke(IPCChannel.SET_TASK_VISIBILITY, visibility),
  onTaskVisibility: (callback: (visibility: TaskVisibility) => void) => {
    const handler = (_event: IpcRendererEvent, visibility: TaskVisibility) => callback(visibility);
    ipcRenderer.on(IPCChannel.ON_TASK_VISIBILITY, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_TASK_VISIBILITY, handler);
  },
  getUpdateCheckEnabled: () => ipcRenderer.invoke(IPCChannel.GET_UPDATE_CHECK_ENABLED),
  setUpdateCheckEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(IPCChannel.SET_UPDATE_CHECK_ENABLED, enabled),
  getLaunchAtLogin: () => ipcRenderer.invoke(IPCChannel.GET_LAUNCH_AT_LOGIN),
  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke(IPCChannel.SET_LAUNCH_AT_LOGIN, enabled),
  getInterruptShortcut: () => ipcRenderer.invoke(IPCChannel.GET_INTERRUPT_SHORTCUT),
  setInterruptShortcut: (setting: InterruptShortcutSetting) => ipcRenderer.invoke(IPCChannel.SET_INTERRUPT_SHORTCUT, setting),
  setInterruptShortcutRecording: (recording: boolean) =>
    ipcRenderer.invoke(IPCChannel.SET_INTERRUPT_SHORTCUT_RECORDING, recording),
  openReleasePage: (url: string) => ipcRenderer.invoke(IPCChannel.OPEN_RELEASE_PAGE, url),
  openTaskPage: (taskId: string) => ipcRenderer.invoke(IPCChannel.OPEN_TASK_PAGE, taskId),
  onUpdateStatus: (callback: (status: UpdateStatusDTO) => void) => {
    const handler = (_event: IpcRendererEvent, status: UpdateStatusDTO) => callback(status);
    ipcRenderer.on(IPCChannel.ON_UPDATE_STATUS, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_UPDATE_STATUS, handler);
  },

  // Provider sync. The Projects view reads a cache only the sync worker fills,
  // so it needs to be told when that cache changes.
  syncProviderNow: () => ipcRenderer.invoke(IPCChannel.SYNC_PROVIDER_NOW),
  // The sync panel's two reads. Kept next to syncProviderNow because they are
  // the same feature: what the queue holds, and a way to push it again.
  getSyncQueue: () => ipcRenderer.invoke(IPCChannel.GET_SYNC_QUEUE),
  retryFailedWorklogs: () => ipcRenderer.invoke(IPCChannel.RETRY_FAILED_WORKLOGS),
  onProjectsUpdated: (callback: (payload: ProjectsUpdatedPayload) => void) => {
    const handler = (_event: IpcRendererEvent, payload: ProjectsUpdatedPayload) => callback(payload);
    ipcRenderer.on(IPCChannel.ON_PROJECTS_UPDATED, handler);
    return () => ipcRenderer.removeListener(IPCChannel.ON_PROJECTS_UPDATED, handler);
  }
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
