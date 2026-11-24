import { WorklogCorrectionService } from './services/worklog-correction-service';
import { app, BrowserWindow, globalShortcut, Notification, powerMonitor, screen, shell } from 'electron';
import path from 'path';
import { LoggerInterceptor } from './diagnostics/logger-interceptor';

// Initialize memory log interceptor immediately
LoggerInterceptor.getInstance().intercept();
import { DatabaseConnection } from './db/database-connection';
import { TaskRepository } from './db/repositories/task-repository';
import { WorklogRepository } from './db/repositories/worklog-repository';
import { SettingsRepository } from './db/repositories/settings-repository';
import { SessionRepository } from './db/repositories/session-repository';
import { ProjectRepository } from './db/repositories/project-repository';
import { TimeTrackingEngine } from './engine/time-tracking-engine';
import { BusyBarDriver } from './hardware/busybar-driver';
import { DisplayRenderer } from './hardware/display-renderer';
import { InputDecoder } from './hardware/input-decoder';
import { IPCHandlerRegistry } from './ipc/ipc-handler-registry';
import { followBar } from './services/follow-bar';
import { ProviderEventService } from './services/provider-event-service';
import { ElectronToastPresenter } from './services/toast-presenter';
import { MainWindowCloseGuard } from './windows/main-window-close';
import { WindowPromptOutlet } from './windows/prompt-outlet';
import { inWorkingHours, ReminderService } from './services/reminder-service';
import { MorningService } from './services/morning-service';
import { WorkingCalendar } from './services/working-calendar';
import { APP_USER_MODEL_ID } from './app-identity';
import { BitmapIconId } from '../shared/dtos';
import { NOTHING_TIMING_EVENT } from '../shared/priority-defaults';
import { WindowsNotificationListenerService } from './services/windows-notification-listener-service';
import { WebhookServer } from './api/webhook-server';
import { DeckServer } from './api/deck-server';
import { DeckActionService } from './services/deck-action-service';
import { DeckIconMotions } from './services/deck-icon-motion';
import { defaultAnimationsDir, loadAnimationSequence } from './hardware/animation-sequence';
import { DECK_PATH } from '../shared/deck-protocol';
import { localApiPortFrom } from './api/local-api-port';
import { UndoService } from './services/undo-service';
import { undoableSessionEnding } from './services/undoable-commands';
import { openTaskPickerInMainWindow, openWindowOn, revealMainWindow } from './windows/main-window-actions';
import { UndoToasts } from './windows/undo-toasts';
import { MiniOnInterruption } from './windows/mini-on-interruption';
import { UNDO_WINDOW_MS } from './sync/sync-constants';
import { ForegroundRaiser } from './windows/foreground-raiser';
import { ProviderManager } from './providers/provider-manager';

import { PriorityPreemptionEngine } from './services/priority-preemption-engine';
import { ContextScheduleService } from './services/context-schedule-service';
import { PresenceMonitor } from './services/presence-monitor';
import { ForgottenSessionService } from './services/forgotten-session-service';
import { FirstRunService } from './services/first-run-service';
import { NoticeService } from './services/notice-service';
import { DECK_PLUGIN_PACK, DECK_PLUGIN_RESOURCE } from '../shared/first-run';
import { JiraProvider } from './providers/jira-provider';
import { OpenProjectProvider } from './providers/openproject-provider';
import { CustomServerProvider } from './providers/custom-server-provider';
import { ProviderId } from '../shared/provider-names';
import { existsSync } from 'fs';
import { TrayManager } from './tray/tray-manager';
import { MiniWindowManager, Rectangle } from './windows/mini-window-manager';
import { PickerWindowManager } from './windows/picker-window-manager';
import { enableZoom } from './windows/window-zoom';
import { MINI_WINDOW_HASH } from '../shared/mini-window';
import { MINI_WINDOW_TOP_LEVEL } from './windows/window-constants';
import { PickerWindowMode, pickerWindowHash } from '../shared/picker-window';
import { IPCChannel } from '../shared/ipc-channels';
import { DEVICE_APPLICATION_NAME, DEVICE_CONFIG_SETTING_KEY, DEFAULT_DEVICE_CONFIG } from '../shared/device-constants';
import { DeviceConfigDTO, ScheduleSettingsDTO } from '../shared/dtos';
import { normalizeScheduleSettings } from '../shared/schedule-defaults';
import { FlowSettingKey, readCloseToTray, readStartSideEffects } from '../shared/flow-settings';
import { UpdateChecker } from './updater/update-checker';
import { LaunchAtLoginService, launchedHidden } from './services/launch-at-login';
import { ShortcutService } from './services/shortcut-service';
import { COLOR_THEME_KEY, DEFAULT_COLOR_THEME, isColorThemeId } from '../shared/color-theme';
import { UPDATE_CHECK_INTERVAL_MS, UPDATE_CHECK_STARTUP_DELAY_MS } from './updater/update-constants';

let mainWindow: BrowserWindow | null = null;
let dbConnection: DatabaseConnection | null = null;
let engine: TimeTrackingEngine | null = null;
let undoService: UndoService | null = null;
let undoToasts: UndoToasts | null = null;
let miniOnInterruption: MiniOnInterruption | null = null;
let driver: BusyBarDriver | null = null;
let inputDecoder: InputDecoder | null = null;
let renderer: DisplayRenderer | null = null;
let webhookServer: WebhookServer | null = null;
let deckServer: DeckServer | null = null;
let ipcRegistry: IPCHandlerRegistry | null = null;
let trayManager: TrayManager | null = null;
/**
 * A quit under way: the tray's Quit, or Windows ending the session. The
 * window's close hides it to the tray otherwise (P12a), and must never hold
 * a quit -- End my day's shutdown included.
 */
let quitting = false;
let closeGuard: MainWindowCloseGuard | null = null;
let windowsNotificationService: WindowsNotificationListenerService | null = null;
let contextScheduleService: ContextScheduleService | null = null;
let presenceMonitor: PresenceMonitor | null = null;
let forgottenSessionService: ForgottenSessionService | null = null;
let updateChecker: UpdateChecker | null = null;
let updateCheckTimer: NodeJS.Timeout | null = null;
let miniWindowManager: MiniWindowManager | null = null;
let pickerWindowManager: PickerWindowManager | null = null;
let providerEventService: ProviderEventService | null = null;
let shortcutService: ShortcutService | null = null;
let reminderService: ReminderService | null = null;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      // Started hidden at login, the window has never been shown.
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * The web preferences every SprintTicker window gets: the preload bridge and
 * nothing more. Shared so the mini timer cannot end up with a laxer copy.
 */
const WINDOW_WEB_PREFERENCES: Electron.WebPreferences = {
  preload: path.join(__dirname, '../preload/index.js'),
  nodeIntegration: false,
  contextIsolation: true,
  // The preload imports only contextBridge and ipcRenderer, both of which
  // are available to a sandboxed preload, so this costs nothing here. It
  // stops costing nothing the moment someone reaches for `fs` in preload,
  // which is the point.
  sandbox: true
};

/**
 * Locks a window to the app's own bundle and loads it, at `hash` if given.
 *
 * This application never opens a second window of the renderer's choosing and
 * never navigates away from its own bundle. Both are denied rather than
 * filtered: there is no allowed destination to filter for, and a guard that
 * lists exceptions invites one. If an outbound link is ever needed, route it
 * through shell.openExternal deliberately -- letting the renderer navigate is
 * how a compromised page gets to keep the preload bridge.
 */
function secureAndLoad(win: BrowserWindow, hash?: string): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`[Main] Blocked window.open to ${url}`);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env.VITE_DEV_SERVER_URL;
    if (devServer && url.startsWith(devServer)) return;
    event.preventDefault();
    console.warn(`[Main] Blocked navigation to ${url}`);
  });

  const devServer = process.env.VITE_DEV_SERVER_URL;
  if (devServer) {
    void win.loadURL(hash ? `${devServer}#${hash}` : devServer)
      .catch(err => console.error('[Main] loadURL failed:', err));
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
      .catch(err => console.error('[Main] loadFile failed:', err));
  }
}

/** Builds the mini timer: frameless, always on top, out of the taskbar. */
function createMiniWindow(bounds: Rectangle, options: { inactive?: boolean } = {}): BrowserWindow {
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#0F172A',
    webPreferences: WINDOW_WEB_PREFERENCES
  });
  // Kept there by MiniWindowManager, which sets it again when it may be lost.
  win.setAlwaysOnTop(true, MINI_WINDOW_TOP_LEVEL);
  win.setMenu(null);
  // Opened by a device's interruption, it must not take the focus (P12d).
  win.once('ready-to-show', () => (options.inactive ? win.showInactive() : win.show()));
  secureAndLoad(win, MINI_WINDOW_HASH);
  return win;
}

/**
 * Builds the picker window (redesign P7b): frameless, on top, in the taskbar
 * while open so Alt+Tab reaches it. Hidden until `ready-to-show`; the
 * manager shows and raises it.
 */
function createPickerWindow(bounds: Rectangle, mode: PickerWindowMode, ids: readonly string[]): BrowserWindow {
  const win = new BrowserWindow({
    ...bounds,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    show: false,
    title: 'SprintTicker',
    backgroundColor: '#0F172A',
    webPreferences: WINDOW_WEB_PREFERENCES
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setMenu(null);
  secureAndLoad(win, pickerWindowHash(mode, ids));
  return win;
}

/**
 * The bar icon for a provider's banners. Anything unlisted gets the bell,
 * which makes the banner spend a row naming the app instead.
 */
const PROVIDER_BANNER_ICONS: Partial<Record<string, BitmapIconId>> = {
  openproject: 'openproject',
  jira: 'jira'
};

/**
 * The login item starts the app with `--hidden`: no window over whatever the
 * user opens first, only the tray, the bar and the mini timer. The window is
 * made all the same -- closing it is what quits the app -- and the tray, or
 * starting the app again, shows it.
 */
const createWindow = (hidden: boolean = false): void => {
  mainWindow = new BrowserWindow({
    show: !hidden,
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0F172A',
    webPreferences: WINDOW_WEB_PREFERENCES
  });

  mainWindow.setMenu(null);
  // The menu held the zoom keys; the dashboard keeps them (A11).
  enableZoom(mainWindow.webContents);
  secureAndLoad(mainWindow);

  mainWindow.on('close', event => {
    closeGuard?.onClose(event);
  });
  // Windows logging off or shutting down: the close that follows is a quit.
  mainWindow.on('query-session-end', () => { quitting = true; });
  mainWindow.on('session-end', () => { quitting = true; });

  mainWindow.on('closed', () => {
    mainWindow = null;
    // With the dashboard, or the always-on-top timer would keep the app
    // running with no way back to it but the tray.
    miniWindowManager?.dispose();
    pickerWindowManager?.dispose();
  });
};

void bootstrap();

/**
 * Runs first-instance startup.
 *
 * Guarded by the single-instance lock rather than registered unconditionally:
 * `app.quit()` does not stop the current tick, so without this a second launch
 * still ran the whole of startup -- opening the database, spawning the
 * notification poller, connecting to the hardware -- before the process died.
 */
async function bootstrap(): Promise<void> {
  if (!gotTheLock) return;
  await app.whenReady();
  try {
    await startApplication();
  } catch (err) {
    console.error('[Main] Fatal error during startup:', err);
    app.quit();
  }
}

async function startApplication(): Promise<void> {
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  }
  console.log('[Main] Starting SprintTicker Application...');

  // 1. Initialize SQLite Database & Repositories
  dbConnection = DatabaseConnection.getInstance();
  const taskRepo = new TaskRepository(dbConnection);
  const worklogRepo = new WorklogRepository(dbConnection);
  const settingsRepo = new SettingsRepository(dbConnection);
  const sessionRepo = new SessionRepository(dbConnection);
  const projectRepo = new ProjectRepository(dbConnection);

  const providerManager = new ProviderManager(settingsRepo, { appVersion: app.getVersion() });

  // 2. Initialize Time Tracking Engine.
  // Construction is side-effect free; initialize() starts the sync worker and
  // recovers a session left behind by a crash.
  // The pause that splits a worklog is read at each stop, so a change in
  // Ceremonies applies to the next one without a restart.
  engine = new TimeTrackingEngine(
    sessionRepo,
    worklogRepo,
    taskRepo,
    providerManager,
    projectRepo,
    () => normalizeScheduleSettings(settingsRepo.getSetting<ScheduleSettingsDTO>('schedule_settings', {})).splitPauseMinutes! * 60,
    // Read at each start and each tick, so Settings applies without a restart.
    () => readStartSideEffects(settingsRepo.getSetting<unknown>(FlowSettingKey.START_SIDE_EFFECTS, null))
  );
  engine.initialize();

  // 3. Initialize Hardware Driver, Display Renderer & Input Decoder
  const forceMock = process.argv.includes('--mock-hardware') || process.env.MOCK_HARDWARE === 'true';
  // Read before constructing: the address is a user setting, not a constant.
  // This used to be the literal '10.0.4.20', which made a bar on Wi-Fi or
  // behind a proxy unreachable with no way to say so.
  const deviceConfig = settingsRepo.getSetting<DeviceConfigDTO>(
    DEVICE_CONFIG_SETTING_KEY,
    DEFAULT_DEVICE_CONFIG
  );
  driver = new BusyBarDriver({
    ipAddress: deviceConfig.ipAddress || DEFAULT_DEVICE_CONFIG.ipAddress,
    apiToken: deviceConfig.apiToken || '',
    forceMock,
    // `!== false`, not truthiness: a row saved before no-bar mode existed has
    // no `enabled`, and an upgrade must leave that bar on.
    enabled: deviceConfig.enabled !== false
  });
  await driver.connect();

  renderer = new DisplayRenderer(driver);
  renderer.setShowIdleClockFallback(deviceConfig.showIdleClockFallback);
  // The key colour the user chose, which a restart used to forget.
  const storedTheme = settingsRepo.getSetting<unknown>(COLOR_THEME_KEY, DEFAULT_COLOR_THEME);
  renderer.setColorTheme(isColorThemeId(storedTheme) ? storedTheme : DEFAULT_COLOR_THEME);
  inputDecoder = new InputDecoder(driver, engine);

  // 4. Initialize the local webhook server
  // Another port only for a check run beside the user's own app (local-api-port.ts).
  const localApiPort = localApiPortFrom(process.argv);
  webhookServer = new WebhookServer(localApiPort);
  await webhookServer.start();
  console.log(`[Main] Webhook server listening on http://127.0.0.1:${localApiPort}`);

  webhookServer.onInputEvent(key => {
    if (driver) {
      void driver.injectRemoteKey(key)
        .catch(err => console.error('[Main] driver.injectRemoteKey failed:', err));
    }
  });

  // 5. Register IPC Handlers and Bi-directional State Broadcasts
  const priorityEngine = new PriorityPreemptionEngine(settingsRepo);
  renderer.setPriorityEngine(priorityEngine);
  inputDecoder.setPriorityEngine(priorityEngine);
  inputDecoder.setRenderer(renderer);
  // The interruptions waiting to be placed, on the task's screen (D5, P14e):
  // read at each draw, which every placement, keep and discard notifies.
  const counted = engine;
  renderer.setToPlaceSource(() => counted.getToPlaceSummary().count);
  inputDecoder.setWindowFocusCallback(() => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  const activeDriver = driver;
  const bannerRenderer = renderer;
  // The app's own toasts, which the notification listener never mirrors to the bar.
  const toasts = new ElectronToastPresenter({
    isSupported: () => Notification.isSupported(),
    create: options => new Notification(options),
    openExternal: url => shell.openExternal(url),
    // A toast leads to its subject (P12c): the window, open on that place.
    openRoute: route => { openWindowOn(mainWindow, route); }
  });
  providerEventService = new ProviderEventService({
    getActiveProvider: () => providerManager.getActiveProvider(),
    settings: settingsRepo,
    toasts,
    bar: {
      isEnabled: () => activeDriver.isEnabled(),
      show: (banner, providerId) => {
        bannerRenderer.renderNotificationBanner({ ...banner, iconId: PROVIDER_BANNER_ICONS[providerId] ?? 'bell' });
      }
    }
  });
  providerEventService.start();
  const sendingAlerts = providerEventService;
  engine.getSyncWorker().onSendingStopped(providerId => {
    sendingAlerts.reportSendingStopped(providerManager.getProvider(providerId)?.providerName ?? providerId);
  });
  engine.onTaskClaim(report => {
    const provider = report.providerId ? providerManager.getProvider(report.providerId) : providerManager.getActiveProvider();
    sendingAlerts.reportTaskClaim(report, provider?.providerName ?? 'your provider');
  });
  windowsNotificationService = new WindowsNotificationListenerService(settingsRepo, priorityEngine, renderer);
  const listener = windowsNotificationService;
  followBar(activeDriver, () => listener.startListening(), () => listener.stopListening(), 'Windows notification mirroring');

  contextScheduleService = new ContextScheduleService(
    priorityEngine,
    settingsRepo,
    engine,
    renderer,
    () => mainWindow,
    // OpenProject's holidays, when it is set up; the weekdays alone otherwise.
    new WorkingCalendar(settingsRepo, (from, to) => providerManager.getNonWorkingDays(from, to))
  );

  // Questions reach every window and, while the dashboard is hidden, a toast
  // whose click opens it. Nothing here takes the focus (P8c).
  const promptOutlet = new WindowPromptOutlet({
    getWindows: () => BrowserWindow.getAllWindows(),
    getDashboard: () => mainWindow,
    toasts
  });
  contextScheduleService.setPromptOutlet(promptOutlet);

  presenceMonitor = new PresenceMonitor(settingsRepo, () => powerMonitor.getSystemIdleTime());
  forgottenSessionService = new ForgottenSessionService(engine, settingsRepo, presenceMonitor, () => mainWindow);
  forgottenSessionService.setPromptOutlet(promptOutlet, () => { revealMainWindow(mainWindow); });

  // The "still...?" questions, asked once each on the schedule's tick (P8d).
  const daySchedule = contextScheduleService;
  const tracker = engine;
  const calendar = new WorkingCalendar(settingsRepo, (from, to) => providerManager.getNonWorkingDays(from, to));
  // The reminders' hours: WORK, a working day, stand-up to wrap-up. The
  // tray's ! and the mini timer's loud "Nothing timing" read the same.
  const workingNow = (): boolean =>
    priorityEngine.getUserMode() === 'WORK' &&
    inWorkingHours(new Date(), settingsRepo.getSetting<ScheduleSettingsDTO>('schedule_settings', {}), dateKey => calendar.isWorkingDay(dateKey));
  reminderService = new ReminderService({
    getSession: () => tracker.getCurrentSession(),
    subscribe: listener => tracker.subscribe(listener),
    getSetting: (key, fallback) => settingsRepo.getSetting(key, fallback),
    getUserMode: () => priorityEngine.getUserMode(),
    isWorkingDay: dateKey => calendar.isWorkingDay(dateKey),
    isStandupSession: session => daySchedule.isStandup(session),
    getResumePrompt: () => daySchedule.getResumePrompt(),
    outlet: () => promptOutlet,
    // NOTHING TIMING on the bar (P14e): drawn when asked, and let go of when
    // it goes -- answered, or ended by a start -- which hands the display
    // back through the engine, one render (CLAUDE.md §5). A release of a
    // lock not held only drops it from the set-aside screens.
    onReminder: reminder => {
      if (reminder?.kind === 'nothing-timing') bannerRenderer.renderNothingTiming();
      else priorityEngine.releaseActiveLock(NOTHING_TIMING_EVENT);
    }
  });
  const reminders = reminderService;
  daySchedule.onChecked(() => reminders.evaluate());
  // Back from a lock with the task still timing: maybe a question (2026-11-17).
  daySchedule.onAwayEnded(span => reminders.noteAway(span));
  // Asked is a state until answered, not an alert: refused under a screen
  // above it -- the stand-up's prompt still up -- it comes back when the
  // display frees, as the bar's menu does, and never after its answer.
  priorityEngine.addBackgroundScreen([NOTHING_TIMING_EVENT], () => {
    if (reminders.getReminder()?.kind === 'nothing-timing') bannerRenderer.renderNothingTiming();
  });
  // The morning card (P8e2): read by Today when it opens.
  const morning = new MorningService({
    isWorkingDay: dateKey => calendar.isWorkingDay(dateKey),
    getSetting: (key, fallback) => settingsRepo.getSetting(key, fallback),
    setSetting: (key, value) => settingsRepo.setSetting(key, value),
    hasSession: () => tracker.getCurrentSession() !== null,
    loggedOn: dateKey => worklogRepo.getWorklogsByDate(dateKey).length > 0,
    recentTasks: limit => taskRepo.getRecent(limit),
    lastEndOf: taskId => worklogRepo.getLastEndOf(taskId),
    listedTasks: () => taskRepo.getAllListed(),
    schedule: () => settingsRepo.getSetting('schedule_settings', {})
  });
  const forgotten = forgottenSessionService;
  const presence = presenceMonitor;
  // Back at the machine: look before anything records the new presence.
  powerMonitor.on('resume', () => forgotten.check());
  powerMonitor.on('unlock-screen', () => forgotten.check());
  // Leaving it: the last input is the presence to judge the return by.
  powerMonitor.on('lock-screen', () => presence.record());
  powerMonitor.on('suspend', () => presence.record());
  // Prepended, so it runs before InputDecoder's listener: a first press on
  // Monday that resumed or paused the session would otherwise hide that it
  // was left running all weekend.
  driver.prependListener('input', () => forgotten.check({ barInput: true }));

  // Reads its own version rather than being told one, so a packaged build and
  // a dev run cannot disagree about what is installed.
  updateChecker = new UpdateChecker(app.getVersion(), settingsRepo);

  // Starting with Windows. Brought up to date while still enabled: an entry
  // from an earlier version opened the window at every login.
  const launchAtLogin = new LaunchAtLoginService(app, {
    platform: process.platform,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    portableExecutable: process.env.PORTABLE_EXECUTABLE_FILE
  });
  try {
    launchAtLogin.refresh();
  } catch (err) {
    // The registry refusing a write leaves the entry as it was, which still starts the app.
    console.warn('[Main] Could not bring the startup entry up to date:', err);
  }

  miniWindowManager = new MiniWindowManager({
    createWindow: createMiniWindow,
    screen,
    settings: settingsRepo,
    appHasFocus: () => BrowserWindow.getFocusedWindow() !== null
  });
  // Windows can drop the mini timer's always-on-top over a sleep, a lock or
  // a display change; it takes the top back once the desktop has settled.
  const miniTop = miniWindowManager;
  const reclaimMiniTop = (): void => miniTop.reclaimTopSoon();
  powerMonitor.on('resume', reclaimMiniTop);
  powerMonitor.on('unlock-screen', reclaimMiniTop);
  screen.on('display-added', reclaimMiniTop);
  screen.on('display-removed', reclaimMiniTop);
  screen.on('display-metrics-changed', reclaimMiniTop);

  // A press on a Stream Deck key reaches Stream Deck, not this app, so
  // Windows would keep a window it opens behind whatever is in front: the
  // raiser asks for it.
  const foregroundRaiser = new ForegroundRaiser();
  // The picker as its own window, for the tray, the mini timer and the deck.
  // The main window's picker stays its fallback until it has run packaged.
  pickerWindowManager = new PickerWindowManager({
    createWindow: createPickerWindow,
    screen,
    raiser: foregroundRaiser,
    // Place has no picker of the window's own: Today's interruption card asks it.
    fallback: (mode, raise) => mode === 'place' || mode === 'place-ended'
      ? openWindowOn(mainWindow, 'today')
      : openTaskPickerInMainWindow(mainWindow, raise ? foregroundRaiser : undefined, mode),
    // Choosing a task does nothing during an interruption (2026-11-12).
    refuses: mode => mode === 'start' && Boolean(engine?.isInterrupted())
  });
  const pickers = pickerWindowManager;
  // Pause on the bar with nothing running (P14b): the picker over the app in
  // use, raised past the foreground lock, since the press reached the bar.
  inputDecoder?.setOpenPickerCallback(() => { pickers.open('start', { raise: true }); });

  // The user's Stop on an interruption takes the task up again, and the
  // run's parts still to place come up at once, each to name and place on
  // its own, in front of the app in use -- the user's choice (2026-11-12,
  // kept on 2026-11-16), and the one prompt that takes the focus. Only that
  // Stop (`stop-back`): not Back, nor the engine's own end at lunch or the
  // wrap-up. After the engine's listeners: a window opened from inside one
  // is a second notification's work (CLAUDE.md §5).
  if (engine) {
    const ending = engine;
    ending.onInterruptionEnded(({ fragment, how }) => {
      if (how !== 'stop-back') return;
      setImmediate(() => {
        const ids = ending.getRunToPlace(fragment.id);
        if (ids.length > 0) pickers.open('place-ended', { raise: true, ids });
      });
    });
  }

  // The global shortcuts (P12e): Interrupt, Switch, Previous and Back from
  // any app, on by default; a chord another app holds reads "taken".
  const schedule = contextScheduleService;
  const minis = miniWindowManager;
  const timer = engine;
  shortcutService = new ShortcutService({
    shortcuts: globalShortcut,
    settings: settingsRepo,
    commands: {
      interrupt: () => {
        if (!schedule) throw new Error('The schedule service is not running.');
        return schedule.interrupt('shortcut');
      },
      back: () => timer.backFromInterruption(),
      // Pressed in another app: raised past Windows' foreground lock, as the
      // deck's picker is (CLAUDE.md §3).
      openPicker: () => { pickers.open('start', { raise: true }); },
      previous: () => {
        const task = timer.getPreviousTask();
        if (!task) return null;
        timer.startTask(task.id, false, task.title);
        return task.key;
      }
    },
    getCurrentSession: () => engine?.getCurrentSession() ?? null,
    isSeen: () =>
      (mainWindow !== null && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized()) ||
      minis.isOpen() ||
      (activeDriver.isEnabled() && activeDriver.getDeviceStatus().connected),
    toasts
  });
  shortcutService.start();

  // Undo (P5): the last Stop, Done, Discard or worklog edit, held with its
  // sends for UNDO_WINDOW_MS. The window and the deck end sessions through
  // the same undoable commands.
  undoService = new UndoService();
  const undo = undoService;
  // An action taken with the window hidden -- the tray's Stop, the deck, the
  // bar -- says it can be undone, and the toast opens the Undo bar (P12c).
  const dashboardOnScreen = (): boolean =>
    mainWindow !== null && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized();
  const quietMini = miniWindowManager;
  undoToasts = new UndoToasts({
    onUndoChanged: listener => undo.onChanged(listener),
    // The mini timer's Undo row says it too (P12d).
    isDashboardOnScreen: () => dashboardOnScreen() || quietMini.isOpen(),
    toasts,
    seconds: Math.round(UNDO_WINDOW_MS / 1000)
  });
  undoToasts.start();
  // An interruption from the bar, the deck or the shortcut puts the mini
  // timer on screen, without the focus, to name it (P12d).
  miniOnInterruption = new MiniOnInterruption({
    subscribe: listener => tracker.subscribe(listener),
    isDashboardOnScreen: dashboardOnScreen,
    openMini: () => quietMini.openQuietly()
  });
  miniOnInterruption.start();
  const sessionEnding = undoableSessionEnding({ db: dbConnection.getDb(), undo, engine }, renderer);
  // The wheel's menu (P14c): its DONE and DISCARD end a session as the
  // window's do, with Undo; its recent tasks are the deck's.
  inputDecoder?.setMenuDeps({
    sessionEnding,
    recentTasks: limit => taskRepo.getRecent(limit)
  });
  // A session started makes a held stop final: undoing it would reopen a
  // second session beside the new one.
  // The task an interruption held, which its Stop resumes, is not a new one:
  // that stop stays undoable (2026-11-16).
  engine.subscribe(session => {
    const kind = undo.currentKind();
    if (session && (kind === 'stop' || kind === 'discard' || kind === 'end-day') && session.sessionId !== undo.currentResumes()) {
      undo.commitPending();
    }
  });

  ipcRegistry = new IPCHandlerRegistry({
    undo,
    sessionEnding,
    engine,
    taskRepo,
    settingsRepo,
    driver,
    inputDecoder,
    renderer,
    getWindow: () => mainWindow,
    getWindows: () => BrowserWindow.getAllWindows(),
    miniWindow: miniWindowManager,
    pickerWindow: pickers,
    worklogRepo,
    providerEvents: providerEventService,
    priorityEngine,
    contextScheduleService,
    forgottenSessionService,
    notices: new NoticeService(settingsRepo, app.getVersion()),
    firstRun: new FirstRunService({
      settings: settingsRepo,
      isProviderConfigured: () => providerManager.isRemoteConfigured(),
      hasHistory: () => worklogRepo.hasAnyWorklog(),
      makeProvider: id =>
        id === 'jira'
          ? new JiraProvider()
          : id === 'openproject'
            ? new OpenProjectProvider()
            : id === ProviderId.CUSTOM
              ? new CustomServerProvider({ appVersion: app.getVersion() })
              : null,
      deviceStatus: () => driver?.getDeviceStatus() ?? null,
      deckInstalled: () => existsSync(path.join(app.getPath('appData'), 'Elgato', 'StreamDeck')),
      // The socket opens after the registry; until then no deck is connected.
      decksConnected: () => deckServer?.getClientCount() ?? 0,
      pluginPath: () => {
        const pack = streamDeckPluginPath();
        return existsSync(pack) ? pack : null;
      },
      openPath: target => shell.openPath(target),
      openExternal: url => shell.openExternal(url)
    }),
    reminders: reminderService,
    morning,
    isWorkingNow: workingNow,
    worklogCorrections: new WorklogCorrectionService(worklogRepo, providerManager, () => {
      // Wakes the worker when the hold ends, as a stop does: a correction
      // should not wait out the five-minute interval to reach the provider.
      engine!.getSyncWorker().dispatchAfterHold();
    }, Date.now, {
      // A move follows the engine's rules for where time goes.
      getTask: taskId => taskRepo.getTaskById(taskId),
      destinationOf: taskId => engine!.sendDestinationOfTask(taskId),
      retireAdHocIfUnused: taskId => engine!.retireAdHocTaskIfUnused(taskId),
      createOwnTask: (title, taskId) => engine!.createOwnTask(title, taskId)
    }),
    windowsNotificationService,
    providerManager,
    syncWorker: engine.getSyncWorker(),
    updateChecker,
    launchAtLogin,
    shortcuts: shortcutService,
    webhookServer
  });
  ipcRegistry.registerAllHandlers();
  scheduleUpdateChecks();

  // The Stream Deck plugin's socket, on the same port. After the registry:
  // a prompt key answers through InputDecoder, whose answers the registry
  // routes to the ceremonies.
  const interrupting = contextScheduleService;
  deckServer = new DeckServer(new DeckActionService({
    engine,
    renderer,
    priorityEngine,
    inputDecoder,
    openPicker: () => pickers.open('start', { raise: true }),
    interrupt: () => {
      // A refusal the key shows, never a press that does nothing.
      if (!interrupting) throw new Error('The schedule service is not running.');
      interrupting.interrupt('deck');
    },
    // Protocol 2's keys read what the window and the tray read.
    schedule: interrupting ?? undefined,
    isWorkingNow: workingNow,
    recentTasks: limit => taskRepo.getRecent(limit),
    // The Session key moves as the bar's icon does, from the same frames.
    iconMotions: new DeckIconMotions(name => loadAnimationSequence(defaultAnimationsDir(), name)),
    sessionEnding
  }));
  const deck = deckServer;
  webhookServer.onUpgrade(DECK_PATH, (req, socket, head) => deck.handleUpgrade(req, socket, head));

  // 6. Create Window & Render Initial State
  closeGuard = new MainWindowCloseGuard({
    closeToTray: () => readCloseToTray(settingsRepo.getSetting<unknown>(FlowSettingKey.CLOSE_TO_TRAY, null)),
    isQuitting: () => quitting,
    hide: () => mainWindow?.hide(),
    settings: settingsRepo,
    toasts
  });
  createWindow(launchedHidden(process.argv));
  if (mainWindow && engine) {
    const schedule = contextScheduleService;
    const window = mainWindow;
    trayManager = new TrayManager(
      mainWindow,
      engine,
      miniWindowManager,
      launchAtLogin,
      schedule ? () => { schedule.interrupt('tray'); } : undefined,
      pickers,
      schedule
        ? {
            // Today's Stop: one click, Undo for 10 s; an interruption ends.
            stop: () => { sessionEnding.complete(undefined, false); },
            chooseMode: mode => schedule.chooseMode(mode),
            getMode: () => priorityEngine.getUserMode(),
            endDay: () => { openWindowOn(window, 'end-day'); },
            inWorkingHours: workingNow,
            countWaiting: () => worklogRepo.countUnsent()
          }
        : undefined
    );
    trayManager.initialize();
  }
  miniWindowManager.restore();
  // Before the first render: a session left running since Friday is drawn
  // paused at Friday's last activity, not as 62 hours -- and one the app was
  // closed under this morning, at the last activity before it closed (P10c).
  forgottenSessionService.check({ atStart: true });
  forgottenSessionService.start();
  renderer.renderActiveSession(engine.getCurrentSession());

  // Connect engine ticks to display renderer and IPC window broadcast for live matrix timer updates
  engine.on('tick', session => {
    renderer?.renderActiveSession(session);
    // Every window, the mini timer included.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPCChannel.ON_SESSION_UPDATED, session);
    }
  });
  console.log('[Main] Initialization completed successfully.');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

// Before any window closes. app.quit() -- the tray's Quit -- closes windows in
// no promised order, and a mini timer that went first would read as closed by
// the user and stay closed at the next launch.
/**
 * The Stream Deck plugin the installer carries (`extraResources`), or the
 * one `pnpm deck:pack` last built, in development.
 */
function streamDeckPluginPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, ...DECK_PLUGIN_RESOURCE.split('/'))
    : path.resolve(__dirname, '../../../streamdeck-plugin/dist', DECK_PLUGIN_PACK);
}

app.on('before-quit', () => {
  quitting = true;
  miniWindowManager?.dispose();
  pickerWindowManager?.dispose();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * Guards against re-entering shutdown: app.exit() below re-emits will-quit.
 */

/**
 * Runs the update check on a timer, and tells the renderer what happened.
 *
 * Deliberately quiet: the first check waits until the rest of startup is done,
 * and a failure is broadcast like any other result rather than retried. The
 * renderer shows failures too -- a check that could not run is not the same as
 * being up to date, and the updater this replaces was deleted for blurring
 * exactly that line (audit F-18).
 */
function scheduleUpdateChecks(): void {
  const runCheck = async (): Promise<void> => {
    if (!updateChecker) return;
    const currentVersion = app.getVersion();
    try {
      const status = await updateChecker.checkForUpdate();
      if (status.status === 'update-available') {
        console.log(`[Main] Update available: ${status.latestVersion} (running ${status.currentVersion}).`);
      }
      ipcRegistry?.broadcastUpdateStatus(status);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[Main] Update check failed: ${reason}`);
      ipcRegistry?.broadcastUpdateStatus({ status: 'failed', currentVersion, reason });
    }
  };

  const startupTimer = setTimeout(() => {
    void runCheck();
    updateCheckTimer = setInterval(() => void runCheck(), UPDATE_CHECK_INTERVAL_MS);
    updateCheckTimer.unref?.();
  }, UPDATE_CHECK_STARTUP_DELAY_MS);

  // unref so a pending check cannot hold the process open at quit.
  startupTimer.unref?.();
}

let isShuttingDown = false;

app.on('will-quit', event => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  // Electron does not await an async will-quit listener. The previous handler
  // was `async`, so the process exited at its first await and everything after
  // it -- disconnecting the driver, closing the database -- silently never ran.
  // preventDefault() holds the quit open until the teardown finishes, then
  // app.exit() ends it for real.
  event.preventDefault();

  // Synchronously, before anything closes the database: the presence a
  // forgotten session is judged by at the next start.
  try {
    presenceMonitor?.record();
  } catch (err) {
    console.warn('[Main] Could not record the last presence at quit:', err);
  }
  forgottenSessionService?.dispose();
  reminderService?.dispose();
  // Makes the held action final: its rows are queued already and go at the
  // next start; its Done transition is asked for now.
  undoToasts?.stop();
  miniOnInterruption?.stop();
  undoService?.dispose();
  // Synchronously too: Windows keeps a chord until the process lets go of it.
  shortcutService?.dispose();

  void (async () => {
    try {
      if (updateCheckTimer) {
        clearInterval(updateCheckTimer);
        updateCheckTimer = null;
      }
      if (contextScheduleService) {
        contextScheduleService.dispose();
      }
      providerEventService?.stop();
      if (windowsNotificationService) {
        windowsNotificationService.stopListening();
      }
      if (renderer) {
        // A pending banner release, a running confetti interval and the
        // animation player all hold timers. They are unref'd, so they cannot
        // keep the process alive, but stopping them here means the display is
        // handed back below rather than being redrawn on the way out.
        renderer.dispose();
        inputDecoder?.dispose();
      }
      if (engine) {
        engine.dispose();
      }
      // The decks first: their sockets count as the HTTP server's
      // connections, and its stop would wait on them.
      if (deckServer) {
        await deckServer.close();
      }
      if (webhookServer) {
        await webhookServer.stop();
      }
      if (driver) {
        // Hand the bar back before letting go of it. Without this the display
        // keeps showing the last frame -- "Working on FEAT-42" hours after the
        // app closed -- and every frame_0/frame_1 PNG ever uploaded stays in
        // the device's own storage under our application name.
        //
        // Each in its own try: they throw when the device refuses or is not
        // there, and a failed clear must not skip the asset cleanup, nor
        // either of them the disconnect. A bar that is unplugged at quit is
        // the ordinary case for both to fail, so they only warn.
        // Nothing to clean up on a bar the user does not have.
        if (driver.isEnabled()) {
          try {
            await driver.clearDisplay(DEVICE_APPLICATION_NAME);
          } catch (err) {
            console.warn('[Main] Could not clear the display on shutdown:', err);
          }
          try {
            await driver.deleteAppAssets(DEVICE_APPLICATION_NAME);
          } catch (err) {
            console.warn('[Main] Could not delete uploaded assets on shutdown:', err);
          }
        }
        driver.disconnect();
      }
      if (dbConnection) {
        DatabaseConnection.resetInstance();
      }
    } catch (err) {
      console.error('[Main] Error during shutdown:', err);
    } finally {
      app.exit(0);
    }
  })();
});
