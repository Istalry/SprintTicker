import type { ManualWorklogDTO, WorklogCorrectionDTO } from '../../src/shared/worklog-correction';
import { vi } from 'vitest';
import type { IElectronAPI } from '../../src/preload/electron-api';
import type { ActiveSessionDTO, DeviceStatusDTO, HardwareDisplayStateDTO, ShortcutsStatusDTO } from '../../src/shared/dtos';
import type { ShortcutAction, ShortcutChord } from '../../src/shared/flow-settings';

/** The four global shortcuts as main answers them by default: on, each holding its chord. */
export const SHORTCUTS: ShortcutsStatusDTO = {
  interrupt: { enabled: true, accelerator: 'Ctrl+Alt+Shift+I', registered: true, problem: null },
  switch: { enabled: true, accelerator: 'Ctrl+Alt+Shift+S', registered: true, problem: null },
  previous: { enabled: true, accelerator: 'Ctrl+Alt+Shift+P', registered: true, problem: null },
  back: { enabled: true, accelerator: 'Ctrl+Alt+Shift+B', registered: true, problem: null }
};
import { DEFAULT_DEVICE_CONFIG, EMPTY_DISPLAY_HEALTH } from '../../src/shared/device-constants';
import { DEFAULT_PRIORITY_RULES } from '../../src/shared/priority-defaults';
import { DEFAULT_TASK_VISIBILITY, type TaskVisibility } from '../../src/shared/task-visibility';
import { DEFAULT_PROVIDER_EVENT_SETTINGS, type ProviderEventSettingsDTO } from '../../src/shared/provider-events';
import {
  DEFAULT_NOTIFICATION_POLLING_INTERVAL_SECONDS,
  DEFAULT_NOTIFICATION_SOURCE_RULES,
  DEFAULT_NOTIFICATION_TIMEOUT_SECONDS
} from '../../src/shared/notification-defaults';
import { normalizeScheduleSettings } from '../../src/shared/schedule-defaults';
import { readFlowSetting, type FlowSettingKeyValue } from '../../src/shared/flow-settings';

/**
 * A `window.electronAPI` for the renderer's tests: every member of the bridge,
 * answering as an unconfigured install on a connected bar would.
 *
 * Typed as the whole `IElectronAPI`, not a `Partial`. That is the point of it:
 * a method added to the bridge fails `pnpm typecheck` here until the mock
 * learns it, and a method removed fails wherever a test still calls it -- the
 * same guarantee the `: IElectronAPI` annotation gives the real preload. A
 * partial mock would let a view call something the bridge no longer has, and
 * the test would pass on `undefined`.
 *
 * Subscriptions hand back their callback through `emit`, so a test can push
 * an update the way main would.
 */
export interface ElectronApiMock {
  api: IElectronAPI;
  /** Delivers `payload` to every renderer subscribed to `channel`. */
  emit: <K extends SubscriptionKey>(channel: K, payload: SubscriptionPayload<K>) => void;
}

type SubscriptionKey = {
  // `infer` rather than a fixed payload type: parameters are contravariant, so
  // no single payload type would match every subscription.
  [K in keyof IElectronAPI]-?: NonNullable<IElectronAPI[K]> extends (callback: (payload: infer _P) => void) => () => void
    ? K
    : never;
}[keyof IElectronAPI];

type SubscriptionPayload<K extends SubscriptionKey> =
  NonNullable<IElectronAPI[K]> extends (callback: (payload: infer P) => void) => () => void ? P : never;

export const CONNECTED_DEVICE: DeviceStatusDTO = {
  enabled: true,
  connected: true,
  ipAddress: DEFAULT_DEVICE_CONFIG.ipAddress,
  connectionType: 'usb',
  frontBrightness: null,
  backBrightness: null,
  batteryPercent: 80,
  firmwareVersion: '1.2.4',
  webSocketPingMs: 4,
  framesSent: 0,
  framesFailed: 0,
  displayHealth: EMPTY_DISPLAY_HEALTH
};

/** No-bar mode, as the driver reports it: not dialling, so never connected. */
export const NO_BAR_DEVICE: DeviceStatusDTO = {
  ...CONNECTED_DEVICE,
  enabled: false,
  connected: false,
  webSocketPingMs: 0
};

export const TRACKING_SESSION: ActiveSessionDTO = {
  sessionId: 'S-1',
  projectId: 'P-1',
  taskId: 'T-1',
  taskKey: 'SPR-142',
  taskTitle: 'Rework the pause menu',
  isAdHoc: false,
  status: 'TRACKING',
  startTimeUtc: '2026-09-30T08:00:00.000Z',
  totalPausedSeconds: 0,
  elapsedSeconds: 5025
};

const EMPTY_DISPLAY: HardwareDisplayStateDTO = {
  frontElements: [],
  ledColorHex: '#000000FF',
  ledMode: 'SOLID',
  colorTheme: 'emerald'
};

export function createElectronApiMock(overrides: Partial<IElectronAPI> = {}): ElectronApiMock {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const subscribe = (channel: string) =>
    vi.fn((callback: (payload: never) => void) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(callback as (payload: unknown) => void);
      listeners.set(channel, set);
      return () => set.delete(callback as (payload: unknown) => void);
    });

  const api: IElectronAPI = {
    getCurrentSession: vi.fn().mockResolvedValue(null),
    startInterruption: vi.fn().mockResolvedValue(TRACKING_SESSION),
    renameSession: vi.fn().mockResolvedValue(TRACKING_SESSION),
    assignSession: vi.fn().mockResolvedValue(TRACKING_SESSION),
    startTask: vi.fn().mockResolvedValue(TRACKING_SESSION),
    moveSessionTo: vi.fn().mockResolvedValue(TRACKING_SESSION),
    pauseSession: vi.fn().mockResolvedValue({ ...TRACKING_SESSION, status: 'PAUSED' }),
    resumeSession: vi.fn().mockResolvedValue(TRACKING_SESSION),
    completeSession: vi.fn().mockResolvedValue({ success: true, loggedSeconds: 5025 }),
    discardSession: vi.fn().mockResolvedValue({ success: true, discardedSeconds: 0 }),
    getSessionDays: vi.fn().mockResolvedValue([]),
    getForgottenReview: vi.fn().mockResolvedValue(null),
    resolveForgottenSession: vi.fn().mockResolvedValue(true),
    shouldShowFirstRun: vi.fn().mockResolvedValue(false),
    finishFirstRun: vi.fn().mockResolvedValue(undefined),
    testProviderConnection: vi.fn().mockResolvedValue({ ok: true, userName: 'Alex Moreau', projectCount: 15 }),
    detectDesk: vi.fn().mockResolvedValue({
      bar: { found: true, address: '10.0.4.20', connectionType: 'usb' },
      deck: { installed: false, connected: false }
    }),
    installDeckPlugin: vi.fn().mockResolvedValue(true),
    openTokenPage: vi.fn().mockResolvedValue(true),
    getSyncHealth: vi.fn().mockResolvedValue({ state: 'ok', providerId: 'openproject', sinceUtc: null, lastSyncedAtUtc: null, progress: null }),
    onSyncHealth: subscribe('onSyncHealth'),
    getNotices: vi.fn().mockResolvedValue({ updatedTo: null, noAccountDismissed: true }),
    dismissNotice: vi.fn().mockResolvedValue({ updatedTo: null, noAccountDismissed: true }),
    getRefusedWorklogs: vi.fn().mockResolvedValue([]),
    onOpenRoute: subscribe('onOpenRoute'),
    keepWorklogOff: vi.fn().mockImplementation(async (id: string) => ({ id })),
    onForgottenReview: subscribe('onForgottenReview'),
    onSessionUpdated: subscribe('onSessionUpdated'),

    getTodaysWorklogs: vi.fn().mockResolvedValue([]),
    onWorklogsUpdated: subscribe('onWorklogsUpdated'),
    getUndo: vi.fn().mockResolvedValue(null),
    runUndo: vi.fn().mockResolvedValue(false),
    getPickerData: vi.fn().mockResolvedValue({ previous: null, recent: [], starred: [], tasks: [], projects: [], projectSeconds: {} }),
    fetchTaskByKey: vi.fn().mockResolvedValue(null),
    interrupt: vi.fn().mockResolvedValue(null),
    anotherInterruption: vi.fn().mockResolvedValue(null),
    backFromInterruption: vi.fn().mockResolvedValue(null),
    stopInterruption: vi.fn().mockResolvedValue(null),
    switchFromInterruption: vi.fn().mockResolvedValue(null),
    discardInterruption: vi.fn().mockResolvedValue(true),
    renameInterruption: vi.fn().mockResolvedValue(undefined),
    moveInterruptionStart: vi.fn().mockResolvedValue(TRACKING_SESSION),
    chooseInterruptionTask: vi.fn().mockResolvedValue(TRACKING_SESSION),
    placeInterruption: vi.fn().mockResolvedValue(undefined),
    placeInterruptions: vi.fn().mockResolvedValue(undefined),
    keepInterruptionOff: vi.fn().mockResolvedValue(undefined),
    getInterruptionsToPlace: vi.fn().mockResolvedValue([]),
    // The mini timer's tour is put away here, or its first-open line would
    // stand in for the title in every test; mini-bar.test.tsx shows it.
    getFlowSetting: vi.fn().mockImplementation((key: FlowSettingKeyValue) =>
      Promise.resolve(key === 'mini_tour_seen' ? true : readFlowSetting(key, undefined))),
    saveFlowSetting: vi.fn().mockImplementation((key: FlowSettingKeyValue, value: unknown) => Promise.resolve(readFlowSetting(key, value))),
    onUndoChanged: subscribe('onUndoChanged'),
    onInterruptionsUpdated: subscribe('onInterruptionsUpdated'),

    getProviders: vi.fn().mockResolvedValue({
      activeProviderId: 'openproject',
      fallbackTicketKey: 'MISC-1',
      opDomain: '',
      opApiKey: '',
      opStatusInProgress: '',
      opStatusToTest: '',
      opStatusToReview: '',
      opCompletionAction: 'to_review',
      opTaskScope: 'assigned_to_me',
      opTaskQuery: '',
      jiraSite: '',
      jiraEmail: '',
      jiraApiToken: '',
      jiraTaskScope: 'assigned_to_me',
      jiraTaskQuery: '',
      jiraTransitionInProgress: '',
      jiraTransitionToTest: '',
      jiraTransitionToReview: '',
      jiraCompletionAction: 'to_review',
      providers: [{ id: 'openproject', name: 'OpenProject' }, { id: 'jira', name: 'Jira' }]
    }),
    getProviderCapabilities: vi.fn().mockResolvedValue({
      providerId: 'openproject',
      canAssign: true,
      canTransition: true,
      canFindWorklog: true,
      canFetchByKey: false,
      hasHolidays: true
    }),
    setActiveProvider: vi.fn().mockResolvedValue(true),
    fetchOpenProjectStatuses: vi.fn().mockResolvedValue({ success: true, data: [] }),
    getProjects: vi.fn().mockResolvedValue([]),
    createProject: vi.fn().mockResolvedValue(true),
    renameProject: vi.fn().mockResolvedValue(true),
    deleteProject: vi.fn().mockResolvedValue(true),
    getTasks: vi.fn().mockResolvedValue([]),
    deleteTask: vi.fn().mockResolvedValue(true),
    updateTask: vi.fn().mockResolvedValue(true),
    importTasks: vi.fn().mockResolvedValue([]),

    getWorklogsByDate: vi.fn().mockResolvedValue([]),
    getWorklogsRange: vi.fn().mockResolvedValue([]),
    getWeekChanges: vi.fn().mockResolvedValue(null),
    splitWorklog: vi.fn().mockResolvedValue({ first: {}, second: {} }),
    exportWorklogsCsv: vi.fn().mockResolvedValue('C:\\exports\\week.csv'),
    getUnsortedWorklogs: vi.fn().mockResolvedValue([]),
    starTask: vi.fn().mockResolvedValue([]),
    unstarTask: vi.fn().mockResolvedValue([]),
    getStarredTasks: vi.fn().mockResolvedValue([]),
    getRecentTasks: vi.fn().mockResolvedValue([]),
    getPreviousTask: vi.fn().mockResolvedValue(null),
    renameAdHocTask: vi.fn().mockResolvedValue(undefined),
    moveWorklog: vi.fn().mockImplementation(async (id: string, taskId: string) => ({
      id, sessionId: 's', taskId, durationSeconds: 900, startedAtUtc: '2026-11-09T09:00:00.000Z', comment: '',
      createdAtUtc: '2026-11-09T09:15:00.000Z', syncState: 'pending'
    })),
    updateWorklog: vi.fn().mockImplementation(async (id: string, correction: WorklogCorrectionDTO) => ({
      id, sessionId: 's', taskId: 't', createdAtUtc: correction.startedAtUtc, syncState: 'local', ...correction
    })),
    addWorklog: vi.fn().mockImplementation(async (entry: ManualWorklogDTO) => ({
      id: 'wl_added', sessionId: 'manual_1', createdAtUtc: entry.startedAtUtc, syncState: 'pending', ...entry
    })),
    deleteWorklog: vi.fn().mockResolvedValue(true),
    getDailyWorklogSummary: vi.fn().mockImplementation(async (date: string) => ({
      date, totalSeconds: 0, tasksCount: 0, items: []
    })),

    getInputBindings: vi.fn().mockResolvedValue({
      startButtonPress: 'TOGGLE_TRACK_PAUSE',
      wheelRotateLeft: 'NAVIGATE_QUEUE_PREV',
      wheelRotateRight: 'NAVIGATE_QUEUE_NEXT',
      wheelClick: 'TRIGGER_TASK_SELECTOR_MODAL',
      backButtonShortPress: 'DISMISS_NOTIFICATION_ALERT',
      backButtonLongPress: 'CANCEL_ACTIVE_SESSION'
    }),
    saveInputBindings: vi.fn().mockResolvedValue(true),
    injectRemoteKey: vi.fn().mockResolvedValue(true),
    onHardwareInputEvent: subscribe('onHardwareInputEvent'),

    getPriorityRules: vi.fn().mockResolvedValue({ rules: DEFAULT_PRIORITY_RULES.map(rule => ({ ...rule })) }),
    savePriorityRules: vi.fn().mockResolvedValue(true),
    setUserMode: vi.fn().mockResolvedValue(true),
    getUserMode: vi.fn().mockResolvedValue('WORK'),
    onUserModeUpdated: subscribe('onUserModeUpdated'),

    getDeviceStatus: vi.fn().mockResolvedValue(CONNECTED_DEVICE),
    getDeviceConfig: vi.fn().mockResolvedValue({ ...DEFAULT_DEVICE_CONFIG }),
    setDeviceConfig: vi.fn().mockResolvedValue(true),
    onDeviceStatusChanged: subscribe('onDeviceStatusChanged'),

    getScheduleSettings: vi.fn().mockResolvedValue(normalizeScheduleSettings({})),
    saveScheduleSettings: vi.fn().mockResolvedValue(true),
    triggerStandupPrompt: vi.fn().mockResolvedValue({ success: true }),
    cancelStandupPrompt: vi.fn().mockResolvedValue(true),
    joinStandup: vi.fn().mockResolvedValue(true),
    answerLunchQuestion: vi.fn().mockResolvedValue(true),
    getStandupTask: vi.fn().mockResolvedValue(null),
    setStandupTask: vi.fn().mockResolvedValue(true),
    getWeekEnded: vi.fn().mockResolvedValue(null),
    getLastWeekClosed: vi.fn().mockResolvedValue(null),
    dismissWeekEnded: vi.fn().mockResolvedValue(true),
    onWeekEnded: subscribe('onWeekEnded'),
    triggerEodPrompt: vi.fn().mockResolvedValue({ success: true }),
    triggerEodWrapUp: vi.fn().mockResolvedValue({ success: true, savedVSCode: false }),
    cancelEodWrapUp: vi.fn().mockResolvedValue(true),
    updateCeremonyPrompt: vi.fn().mockResolvedValue(true),
    snoozeCeremony: vi.fn().mockResolvedValue(true),
    getCeremonyPrompt: vi.fn().mockResolvedValue(null),
    getReminder: vi.fn().mockResolvedValue(null),
    dismissReminder: vi.fn().mockResolvedValue(true),
    onReminder: subscribe('onReminder'),
    getMorning: vi.fn().mockResolvedValue(null),
    markMorningSeen: vi.fn().mockResolvedValue(undefined),
    onCeremonyPrompt: subscribe('onCeremonyPrompt'),
    getResumePrompt: vi.fn().mockResolvedValue(null),
    answerResumePrompt: vi.fn().mockResolvedValue(true),
    onResumePrompt: subscribe('onResumePrompt'),

    getProviderEventSettings: vi.fn().mockResolvedValue(DEFAULT_PROVIDER_EVENT_SETTINGS),
    saveProviderEventSettings: vi.fn(async (settings: ProviderEventSettingsDTO) => settings),
    testProviderEvents: vi.fn().mockResolvedValue({ toast: true, bar: false }),
    getNotificationSettings: vi.fn().mockResolvedValue({
      enableListener: true,
      sourceRules: DEFAULT_NOTIFICATION_SOURCE_RULES.map(rule => ({ ...rule })),
      notificationTimeoutSeconds: DEFAULT_NOTIFICATION_TIMEOUT_SECONDS,
      pollingIntervalSeconds: DEFAULT_NOTIFICATION_POLLING_INTERVAL_SECONDS
    }),
    saveNotificationSettings: vi.fn().mockResolvedValue(true),
    simulateNotification: vi.fn().mockImplementation(async (payload: { appId: string; appName: string; title: string; body: string }) => ({
      ...payload, timestamp: '2026-09-30T08:00:00.000Z'
    })),
    getNotificationListenerStatus: vi.fn().mockResolvedValue({
      status: { isListening: true, strategy: 'DB_POLLING', hasSqlite3: true, hasNotifDb: true, totalCaptured: 0, totalSuppressed: 0 },
      logs: []
    }),
    onNotificationLog: subscribe('onNotificationLog'),
    openNotificationSettings: vi.fn().mockResolvedValue(true),

    getDisplayState: vi.fn().mockResolvedValue(EMPTY_DISPLAY),
    onDisplayStateUpdated: subscribe('onDisplayStateUpdated'),
    getScreenIcon: vi.fn().mockResolvedValue(null),
    onScreenIcon: subscribe('onScreenIcon'),
    setColorTheme: vi.fn().mockResolvedValue(true),
    getColorTheme: vi.fn().mockResolvedValue('emerald'),
    triggerConfettiBurst: vi.fn().mockResolvedValue(true),
    previewDisplayScreen: vi.fn().mockResolvedValue(true),

    wipeAllData: vi.fn().mockResolvedValue(true),
    exportDiagnosticLogs: vi.fn().mockResolvedValue(true),

    checkForUpdate: vi.fn().mockResolvedValue({ status: 'up-to-date', currentVersion: '1.1.0' }),
    getSystemLocale: vi.fn().mockResolvedValue('en-US'),
    toggleMiniWindow: vi.fn().mockResolvedValue(true),
    isMiniWindowOpen: vi.fn().mockResolvedValue(false),
    onMiniWindowVisibility: subscribe('onMiniWindowVisibility'),
    openTaskPicker: vi.fn().mockResolvedValue(true),
    openAssignPicker: vi.fn().mockResolvedValue(true),
    openPlacePicker: vi.fn().mockResolvedValue(true),
    getStandupRunning: vi.fn().mockResolvedValue(null),
    isWorkingNow: vi.fn().mockResolvedValue(false),
    getOnlyProjectsWithTasks: vi.fn().mockResolvedValue(true),
    setOnlyProjectsWithTasks: vi.fn(async (enabled: boolean) => enabled),
    onOnlyProjectsWithTasks: subscribe('onOnlyProjectsWithTasks'),
    getTaskVisibility: vi.fn().mockResolvedValue({ ...DEFAULT_TASK_VISIBILITY }),
    setTaskVisibility: vi.fn(async (visibility: TaskVisibility) => visibility),
    onTaskVisibility: subscribe('onTaskVisibility'),
    getUpdateCheckEnabled: vi.fn().mockResolvedValue(true),
    setUpdateCheckEnabled: vi.fn().mockResolvedValue(true),
    getLaunchAtLogin: vi.fn().mockResolvedValue({ enabled: false, available: true, reason: null }),
    setLaunchAtLogin: vi.fn(async (enabled: boolean) => ({ enabled, available: true, reason: null })),
    getShortcuts: vi.fn().mockResolvedValue(SHORTCUTS),
    setShortcut: vi.fn(async (action: ShortcutAction, chord: ShortcutChord) => ({
      ...SHORTCUTS, [action]: { ...chord, registered: chord.enabled, problem: null }
    })),
    setShortcutsRecording: vi.fn().mockResolvedValue(SHORTCUTS),
    openReleasePage: vi.fn().mockResolvedValue(true),
    openTaskPage: vi.fn().mockResolvedValue(true),
    onUpdateStatus: subscribe('onUpdateStatus'),

    syncProviderNow: vi.fn().mockResolvedValue({ status: 'not_configured', reason: 'No provider configured', projects: 0, tasks: 0 }),
    getSyncQueue: vi.fn().mockResolvedValue({
      counts: { pending: 0, syncing: 0, synced: 0, failed: 0 }, items: [], maxAttempts: 8
    }),
    retryFailedWorklogs: vi.fn().mockResolvedValue({ requeued: 0 }),
    onProjectsUpdated: subscribe('onProjectsUpdated'),
    ...overrides
  };

  const emit: ElectronApiMock['emit'] = (channel, payload) => {
    for (const listener of listeners.get(channel) ?? []) listener(payload);
  };

  return { api, emit };
}

/**
 * Puts a fresh mock on `window.electronAPI` and returns it. The setup file
 * calls it before every test; a test that needs other answers calls it again
 * with overrides, before rendering.
 */
export function installElectronApi(overrides: Partial<IElectronAPI> = {}): ElectronApiMock {
  const mock = createElectronApiMock(overrides);
  window.electronAPI = mock.api;
  return mock;
}
