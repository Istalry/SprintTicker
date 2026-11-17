import type { WindowRoute } from '../shared/window-route';
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

import type { NoticeKind, NoticesDTO, SyncHealthDTO } from '../shared/sync-health';
import type { ConnectionTestDTO, ConnectionTestRequestDTO, DeskDetectionDTO } from '../shared/first-run';
import type { ProviderEventSettingsDTO, ProviderEventTestResultDTO } from '../shared/provider-events';
import type { ManualWorklogDTO, WorklogCorrectionDTO } from '../shared/worklog-correction';
import type { DayShare } from '../shared/work-split';
import type { TaskVisibility } from '../shared/task-visibility';
import type { FlowSettingKeyValue, FlowSettingValues, ShortcutAction, ShortcutChord } from '../shared/flow-settings';
import type { InterruptionSource, InterruptionToPlaceDTO } from '../shared/interruption';
import type { PickerDataDTO } from '../shared/task-picker';
import type { BarInputDTO } from '../shared/bar-input';
import type {
  ActiveSessionDTO,
  TaskDTO,
  ProjectDTO,
  ProviderSettingsDTO,
  ProviderSettingsUpdateDTO,
  DeviceStatusDTO,
  PriorityMatrixConfig,
  PriorityRule,
  UserMode,
  ScheduleSettingsDTO,
  ResumePromptDTO,
  CeremonyPromptDTO,
  StandupTaskDTO,
  ReminderDTO,
  MorningDTO,
  WeekEndedDTO,
  ForgottenSessionReviewDTO,
  ForgottenSessionResolutionDTO,
  WorklogDTO,
  WeekChangeDTO,
  UndoStateDTO,
  WindowsNotificationSettingsDTO,
  WindowsNotificationEventDTO,
  NotificationLogEntryDTO,
  NotificationListenerStatusDTO,
  BitmapIconId,
  HardwareDisplayStateDTO,
  ScreenIconDTO,
  OpStatusDTO,
  DeviceConfigDTO,
  UpdateStatusDTO,
  LaunchAtLoginStatusDTO,
  ShortcutsStatusDTO,
  ColorThemeId,
  ProviderSyncResult,
  SyncQueueSnapshotDTO,
  ProjectsUpdatedPayload,
  PreviewScreenId,
  DiscardSessionResultDTO,
  ProviderCapabilitiesDTO
} from '../shared/dtos';

export interface IElectronAPI {
  // Session Controls
  getCurrentSession: () => Promise<ActiveSessionDTO | null>;
  /**
   * Interrupt: starts a timer at once on a new ad-hoc task named for the time,
   * to name or assign afterwards; the task it stops is asked about when it ends.
   */
  startInterruption: () => Promise<ActiveSessionDTO>;
  /** Names the open ad-hoc session and its task; refused for a provider's task. */
  renameSession: (title: string) => Promise<ActiveSessionDTO>;
  /** Assigns the open ad-hoc session to a task, keeping its start: all its time goes there. */
  assignSession: (taskId: string) => Promise<ActiveSessionDTO>;
  startTask: (taskId: string, isAdHoc?: boolean, customTitle?: string) => Promise<ActiveSessionDTO>;
  pauseSession: () => Promise<ActiveSessionDTO>;
  resumeSession: () => Promise<ActiveSessionDTO>;
  completeSession: (comment?: string, markDone?: boolean) => Promise<{ success: boolean; loggedSeconds: number }>;
  /** Ends the session keeping nothing -- no worklog, nothing sent. Confirm with the user first. */
  discardSession: () => Promise<DiscardSessionResultDTO>;
  /** The open session's time per local day, were it stopped now: one entry unless it crosses midnight. */
  getSessionDays: () => Promise<DayShare[]>;
  /** A session left running overnight, paused at the last activity and awaiting an answer; null when none. */
  getForgottenReview: () => Promise<ForgottenSessionReviewDTO | null>;
  /** Answers it. False when nothing was being asked any more. */
  resolveForgottenSession: (resolution: ForgottenSessionResolutionDTO) => Promise<boolean>;

  // The first run (S1-S3, P11a)
  /** True once, at the first launch of an install never set up; false after. */
  shouldShowFirstRun: () => Promise<boolean>;
  /** Finished or put off: it does not open on its own again. */
  finishFirstRun: () => Promise<void>;
  /** Tests what the user typed, saving nothing; a failure is the answer, never a throw. */
  testProviderConnection: (request: ConnectionTestRequestDTO) => Promise<ConnectionTestDTO>;
  /** What is on the desk now: the bar answering, Stream Deck installed or connected. */
  detectDesk: () => Promise<DeskDetectionDTO | null>;
  /** Opens the Stream Deck plugin the app ships, so Stream Deck asks to install it. */
  installDeckPlugin: () => Promise<boolean>;
  /** "make one ↗": the page that makes a token, which main builds from the provider and the address typed. */
  openTokenPage: (providerId: 'jira' | 'openproject', site: string) => Promise<boolean>;

  // S31's states (P11b)
  /** How the provider's sync is going: first sync, not answering, refused. */
  getSyncHealth: () => Promise<SyncHealthDTO>;
  onSyncHealth: (callback: (health: SyncHealthDTO) => void) => () => void;
  /** Today's one-time notices: an update just installed, no account yet. */
  getNotices: () => Promise<NoticesDTO>;
  dismissNotice: (kind: NoticeKind) => Promise<NoticesDTO>;

  // One entry refused (P11c)
  /** Main opening the window on a place: the tray's End my day…, a toast (P12). */
  onOpenRoute: (callback: (route: WindowRoute) => void) => () => void;
  /** The entries their provider refused for good, oldest first. */
  getRefusedWorklogs: () => Promise<WorklogDTO[]>;
  /** Keeps a refused entry off its provider: local time on its task, undoable. */
  keepWorklogOff: (worklogId: string) => Promise<WorklogDTO>;
  onForgottenReview: (callback: (review: ForgottenSessionReviewDTO | null) => void) => () => void;
  onSessionUpdated: (callback: (session: ActiveSessionDTO | null) => void) => () => void;

  // Worklogs
  getTodaysWorklogs: () => Promise<WorklogDTO[]>;
  onWorklogsUpdated: (callback: (worklogs: WorklogDTO[]) => void) => () => void;
  /** The last action Undo can take back, or null. */
  getUndo: () => Promise<UndoStateDTO | null>;
  /** Takes it back; false when its window ended or something was already sent. */
  runUndo: () => Promise<boolean>;
  onUndoChanged: (callback: (state: UndoStateDTO | null) => void) => () => void;
  /** Interrupt (P6); during an interruption, Another. */
  interrupt: (options?: { source?: InterruptionSource; startedAtUtc?: string }) => Promise<ActiveSessionDTO>;
  anotherInterruption: () => Promise<ActiveSessionDTO>;
  /** Back to the held task; `addGapMinutes` counts the gap since a Stop as work. */
  backFromInterruption: (addGapMinutes?: number) => Promise<ActiveSessionDTO | null>;
  stopInterruption: () => Promise<ActiveSessionDTO | null>;
  switchFromInterruption: (taskId: string, takeAlong: boolean) => Promise<ActiveSessionDTO>;
  /** The running interruption, or one waiting (`id`); ten seconds to undo. */
  discardInterruption: (id?: string) => Promise<boolean>;
  renameInterruption: (id: string, name: string) => Promise<void>;
  /** The running interruption began at `atUtc` (S9's "started 5 min ago"); clamped by main. */
  moveInterruptionStart: (atUtc: string) => Promise<ActiveSessionDTO>;
  /** Where the running interruption's time goes when it ends; null is Later. */
  chooseInterruptionTask: (taskId: string | null) => Promise<ActiveSessionDTO>;
  placeInterruption: (id: string, taskId: string) => Promise<void>;
  placeInterruptions: (ids: string[], taskId: string) => Promise<void>;
  keepInterruptionOff: (id: string) => Promise<void>;
  getInterruptionsToPlace: () => Promise<InterruptionToPlaceDTO[]>;
  onInterruptionsUpdated: (callback: (waiting: InterruptionToPlaceDTO[]) => void) => () => void;
  /** A flow setting (`shared/flow-settings.ts`), whole and valid. */
  getFlowSetting: <K extends FlowSettingKeyValue>(key: K) => Promise<FlowSettingValues[K]>;
  /** Stores one; answers the value as stored, after its reader made it valid. */
  saveFlowSetting: <K extends FlowSettingKeyValue>(key: K, value: FlowSettingValues[K]) => Promise<FlowSettingValues[K]>;

  // Providers, Projects & Tasks
  getProviders: () => Promise<ProviderSettingsDTO>;
  /** What the active provider can do; a control it lacks is hidden. */
  getProviderCapabilities: () => Promise<ProviderCapabilitiesDTO>;
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

  // Worklog History & Reports
  getWorklogsByDate: (dateString: string) => Promise<WorklogDTO[]>;
  /** The worklogs of local days `from` to `to` (YYYY-MM-DD, both included), oldest first: History's week (S15). */
  getWorklogsRange: (from: string, to: string) => Promise<WorklogDTO[]>;
  /** Saves those days' worklogs as CSV where the user chooses; the path, or null when cancelled. */
  exportWorklogsCsv: (from: string, to: string) => Promise<string | null>;
  /** Check my week: the sends queued for a closed week after it closed; null while the week is open. */
  getWeekChanges: (day: string) => Promise<WeekChangeDTO[] | null>;
  /** Split in two (S16c): shortens the entry to end at `atUtc` and puts the rest on `taskId`, with Undo. */
  splitWorklog: (worklogId: string, atUtc: string, taskId: string) => Promise<{ first: WorklogDTO; second: WorklogDTO }>;
  /** Every worklog of an interruption still to sort, newest first. */
  getUnsortedWorklogs: () => Promise<WorklogDTO[]>;
  /** Stars a task; answers the starred tasks the lists hold. */
  starTask: (taskId: string) => Promise<TaskDTO[]>;
  unstarTask: (taskId: string) => Promise<TaskDTO[]>;
  getStarredTasks: () => Promise<TaskDTO[]>;
  /** Everything the task picker lists, in one read. */
  getPickerData: () => Promise<PickerDataDTO>;
  /** One task by the key typed, kept like a synced one; null when the provider has none. */
  fetchTaskByKey: (key: string) => Promise<TaskDTO | null>;
  /** The last tasks timed, each once, newest first; unnamed interruptions left out. */
  getRecentTasks: () => Promise<TaskDTO[]>;
  /** The task to switch back to, or null. */
  getPreviousTask: () => Promise<TaskDTO | null>;
  /** Names ad-hoc work after the fact; renames the open session too when it is that task. */
  renameAdHocTask: (taskId: string, title: string) => Promise<void>;
  /** Moves a worklog to another task, here and at the providers through the queue. Rejects with the reason when refused. */
  moveWorklog: (worklogId: string, taskId: string) => Promise<WorklogDTO>;
  /** Adds time nobody timed (S16b), sent like any entry, with Undo. Rejects with the reason when refused. */
  addWorklog: (entry: ManualWorklogDTO) => Promise<WorklogDTO>;
  /** The time so far on the open session goes to `taskId`, which then runs (S5b). */
  moveSessionTo: (taskId: string) => Promise<ActiveSessionDTO>;
  /** Corrects a worklog here and queues the change for its provider. Rejects with the reason when refused. */
  updateWorklog: (worklogId: string, correction: WorklogCorrectionDTO) => Promise<WorklogDTO>;
  /** Deletes a worklog here and queues its deletion at the provider. */
  deleteWorklog: (worklogId: string) => Promise<boolean>;
  getDailyWorklogSummary: (dateString: string) => Promise<{
    date: string;
    totalSeconds: number;
    tasksCount: number;
    /** `unsorted` marks an interruption not yet named or assigned. */
    items: Array<{ taskId: string; key: string; title: string; durationSeconds: number; comment: string; unsorted?: true }>;
  }>;

  // Hardware input
  injectRemoteKey: (key: string) => Promise<boolean>;
  onHardwareInputEvent: (callback: (event: { inputKey: string; actionAssigned: string }) => void) => () => void;
  /** Every input the bar sends, with what came of it, `NONE` included. */
  onBarInput: (callback: (input: BarInputDTO) => void) => () => void;

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
  /** Switches the timer to the Daily Standup task; the task before it restarts when it ends. */
  /** `joinedAt`, an ISO time: "joined 5 min ago" -- the minutes come off the task it replaces. */
  joinStandup: (joinedAt?: string) => Promise<boolean>;
  /** "Start lunch? It ends 'Call with Marc'": true starts it, false works through lunch today. */
  answerLunchQuestion: (start: boolean) => Promise<boolean>;
  /** The task the stand-up is timed on and sent to; null keeps it on the local Daily Standup. */
  getStandupTask: () => Promise<StandupTaskDTO | null>;
  setStandupTask: (task: StandupTaskDTO | null) => Promise<boolean>;
  /** The week just over, until dismissed; null otherwise. */
  getWeekEnded: () => Promise<WeekEndedDTO | null>;
  /** The Monday of the last week closed, or null: time up to its Sunday asks before it is changed. */
  getLastWeekClosed: () => Promise<string | null>;
  dismissWeekEnded: () => Promise<boolean>;
  /** Pushed when a week closes, and null once it is dismissed anywhere. */
  onWeekEnded: (callback: (week: WeekEndedDTO | null) => void) => () => void;
  triggerEodPrompt: () => Promise<{ success: boolean }>;
  triggerEodWrapUp: (options?: { shouldShutdown?: boolean }) => Promise<{ success: boolean; savedVSCode: boolean }>;
  cancelEodWrapUp: () => Promise<boolean>;
  updateCeremonyPrompt: (type: 'STANDUP' | 'LUNCH' | 'EOD', title: string) => Promise<boolean>;
  snoozeCeremony: (type: 'STANDUP' | 'EOD', minutes?: number) => Promise<boolean>;
  /** The "still...?" reminder being asked, or null (P8d). */
  getReminder: () => Promise<ReminderDTO | null>;
  /** Not now, Still paused, Still on it, Still in it: final for that occurrence. */
  dismissReminder: (id: string) => Promise<boolean>;
  /**
   * "Something else…" on "Away 23 min. Was it on MG-12?": the time away
   * becomes an interruption to place, and the place picker opens. False
   * when that question is no longer asked.
   */
  giveAwayTime: (id: string) => Promise<boolean>;
  onReminder: (callback: (reminder: ReminderDTO | null) => void) => () => void;
  /** The morning card (S4b): null once the day has begun, on a day off, or once seen. */
  getMorning: () => Promise<MorningDTO | null>;
  /** The card was seen -- a start, or put away: not shown again today. */
  markMorningSeen: () => Promise<void>;
  /** The ceremony waiting on an answer, for a window opened after it was asked (P8c). */
  getCeremonyPrompt: () => Promise<CeremonyPromptDTO | null>;
  /** A ceremony asked, or null once it is answered anywhere. */
  onCeremonyPrompt: (callback: (prompt: CeremonyPromptDTO | null) => void) => () => void;
  /** After lunch: the task stopped for it is no longer the user's. Null when nothing is asked. */
  getResumePrompt: () => Promise<ResumePromptDTO | null>;
  /** Resumes the task, or leaves it. False when the question had already been answered. */
  /** `addGapMinutes`: after an interruption, the time since it ended counted as work on the task. */
  answerResumePrompt: (resume: boolean, addGapMinutes?: number, workedThrough?: boolean) => Promise<boolean>;
  onResumePrompt: (callback: (prompt: ResumePromptDTO | null) => void) => () => void;

  // Provider events: toasts and bar banners for Jira / OpenProject activity
  getProviderEventSettings: () => Promise<ProviderEventSettingsDTO>;
  /** Resolves the settings as stored, normalised -- an interval may be clamped. */
  saveProviderEventSettings: (settings: ProviderEventSettingsDTO) => Promise<ProviderEventSettingsDTO>;
  /** Sends a sample through the destinations switched on; resolves which. */
  testProviderEvents: () => Promise<ProviderEventTestResultDTO>;

  // Windows Notification Listener
  getNotificationSettings: () => Promise<WindowsNotificationSettingsDTO>;
  saveNotificationSettings: (settings: Partial<WindowsNotificationSettingsDTO>) => Promise<boolean>;
  simulateNotification: (payload: { appId: string; appName: string; title: string; body: string; iconId?: BitmapIconId; iconPath?: string }) => Promise<WindowsNotificationEventDTO>;
  getNotificationListenerStatus: () => Promise<{ status: NotificationListenerStatusDTO; logs: NotificationLogEntryDTO[] }>;
  onNotificationLog: (callback: (entry: NotificationLogEntryDTO) => void) => () => void;
  openNotificationSettings: () => Promise<boolean>;

  // Hardware Display Animation & Screen Emulator
  getDisplayState: () => Promise<HardwareDisplayStateDTO>;
  onDisplayStateUpdated: (callback: (state: HardwareDisplayStateDTO) => void) => () => void;
  /** The icon of the screen on the bar, or null for the firmware's clock. */
  getScreenIcon: () => Promise<ScreenIconDTO | null>;
  onScreenIcon: (callback: (icon: ScreenIconDTO | null) => void) => () => void;
  setColorTheme: (theme: string) => Promise<boolean>;
  /** The key colour stored, which the bar draws from start. */
  getColorTheme: () => Promise<ColorThemeId>;
  triggerConfettiBurst: () => Promise<boolean>;
  /** Draws one real screen through the actual renderer, for the debug panel. */
  previewDisplayScreen: (screen: PreviewScreenId) => Promise<boolean>;

  // Database Management
  wipeAllData: () => Promise<boolean>;

  // Diagnostics
  exportDiagnosticLogs: () => Promise<boolean>;

  // Updates
  checkForUpdate: () => Promise<UpdateStatusDTO>;
  /** Windows' regional format (`en-BE`, `fr-FR`); times are formatted in it. */
  getSystemLocale: () => Promise<string>;

  // Mini timer
  /** Opens or closes the always-on-top mini timer; resolves whether it is open. */
  toggleMiniWindow: () => Promise<boolean>;
  isMiniWindowOpen: () => Promise<boolean>;
  onMiniWindowVisibility: (callback: (open: boolean) => void) => () => void;
  /** Brings the dashboard forward with its task picker open. */
  openTaskPicker: () => Promise<boolean>;
  /** Brings the dashboard forward with its picker open to assign the open ad-hoc session to a task. */
  openAssignPicker: () => Promise<boolean>;
  /** The picker as its own window, choosing the task the running interruption goes to (P12d). */
  openPlacePicker: () => Promise<boolean>;
  /** The stand-up, when it is what runs, and the task its end starts again (P12d). */
  getStandupRunning: () => Promise<import('../shared/dtos').StandupRunningDTO | null>;
  /** In working hours now: WORK, a working day, stand-up to wrap-up (P12d). */
  isWorkingNow: () => Promise<boolean>;
  /**
   * "Only my projects": whether the Projects tab, the task picker and the
   * bar's picker hide projects with no open task. Shared by all three, so a
   * change in one is broadcast to the others.
   */
  getOnlyProjectsWithTasks: () => Promise<boolean>;
  /** Resolves the setting as stored. */
  setOnlyProjectsWithTasks: (enabled: boolean) => Promise<boolean>;
  onOnlyProjectsWithTasks: (callback: (enabled: boolean) => void) => () => void;
  /**
   * Whether the task lists -- the Projects tab, the task picker and the bar's
   * picker -- show unassigned tasks and teammates' tasks. The user's own are
   * always shown. Broadcast like the switch above.
   */
  getTaskVisibility: () => Promise<TaskVisibility>;
  /** Resolves the setting as stored; throws on anything but two booleans. */
  setTaskVisibility: (visibility: TaskVisibility) => Promise<TaskVisibility>;
  onTaskVisibility: (callback: (visibility: TaskVisibility) => void) => () => void;
  getUpdateCheckEnabled: () => Promise<boolean>;
  setUpdateCheckEnabled: (enabled: boolean) => Promise<boolean>;
  /**
   * Whether Windows starts SprintTicker at login, read back from Windows
   * each time: its Startup apps page can switch it off behind the app.
   */
  getLaunchAtLogin: () => Promise<LaunchAtLoginStatusDTO>;
  /** Resolves the state Windows reports after the change. */
  setLaunchAtLogin: (enabled: boolean) => Promise<LaunchAtLoginStatusDTO>;
  /** The four global shortcuts (P12e), and whether Windows gave the app each chord. */
  getShortcuts: () => Promise<ShortcutsStatusDTO>;
  /** Stores and registers one; rejects a chord `chordProblem` refuses or another shortcut holds. */
  setShortcut: (action: ShortcutAction, chord: ShortcutChord) => Promise<ShortcutsStatusDTO>;
  /** Lets go of every chord while a new one is recorded, so the press reaches the window. */
  setShortcutsRecording: (recording: boolean) => Promise<ShortcutsStatusDTO>;
  openReleasePage: (url: string) => Promise<boolean>;
  /**
   * Opens the task's page on the provider it came from, in the browser. Main
   * builds the URL from the provider's own site; false when there is no page
   * to open -- ad-hoc work, the app's own projects, a provider not set up.
   */
  openTaskPage: (taskId: string) => Promise<boolean>;
  onUpdateStatus: (callback: (status: UpdateStatusDTO) => void) => () => void;

  // Provider sync
  syncProviderNow: () => Promise<ProviderSyncResult>;
  getSyncQueue: () => Promise<SyncQueueSnapshotDTO>;
  retryFailedWorklogs: () => Promise<{ requeued: number }>;
  onProjectsUpdated: (callback: (payload: ProjectsUpdatedPayload) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: IElectronAPI;
  }
}
