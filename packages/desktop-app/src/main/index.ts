import { app, BrowserWindow } from 'electron';
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
import { UnityInjectorService } from './services/unity-injector-service';
import { UnityTelemetryService } from './services/unity-telemetry-service';
import { MessagingIntegrationService } from './services/messaging-service';
import { WindowsNotificationListenerService } from './services/windows-notification-listener-service';
import { WebhookServer } from './api/webhook-server';
import { ProviderManager } from './providers/provider-manager';

import { PriorityPreemptionEngine } from './services/priority-preemption-engine';
import { ContextScheduleService } from './services/context-schedule-service';
import { TrayManager } from './tray/tray-manager';
import { IPCChannel } from '../shared/ipc-channels';
import { DEVICE_APPLICATION_NAME } from '../shared/device-constants';
import { UpdateChecker } from './updater/update-checker';
import { UPDATE_CHECK_INTERVAL_MS, UPDATE_CHECK_STARTUP_DELAY_MS } from './updater/update-constants';

let mainWindow: BrowserWindow | null = null;
let dbConnection: DatabaseConnection | null = null;
let engine: TimeTrackingEngine | null = null;
let driver: BusyBarDriver | null = null;
let inputDecoder: InputDecoder | null = null;
let renderer: DisplayRenderer | null = null;
let unityInjectorService: UnityInjectorService | null = null;
let webhookServer: WebhookServer | null = null;
let ipcRegistry: IPCHandlerRegistry | null = null;
let trayManager: TrayManager | null = null;
let windowsNotificationService: WindowsNotificationListenerService | null = null;
let contextScheduleService: ContextScheduleService | null = null;
let updateChecker: UpdateChecker | null = null;
let updateCheckTimer: NodeJS.Timeout | null = null;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0F172A',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // The preload imports only contextBridge and ipcRenderer, both of which
      // are available to a sandboxed preload, so this costs nothing here. It
      // stops costing nothing the moment someone reaches for `fs` in preload,
      // which is the point.
      sandbox: true
    }
  });

  mainWindow.setMenu(null);

  // This application never opens a second window and never navigates away from
  // its own bundle. Both are denied rather than filtered: there is no allowed
  // destination to filter for, and a guard that lists exceptions invites one.
  //
  // If an outbound link is ever needed, route it through shell.openExternal
  // deliberately -- letting the renderer navigate is how a compromised page
  // gets to keep the preload bridge.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`[Main] Blocked window.open to ${url}`);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env.VITE_DEV_SERVER_URL;
    if (devServer && url.startsWith(devServer)) return;
    event.preventDefault();
    console.warn(`[Main] Blocked navigation to ${url}`);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
      .catch(err => console.error('[Main] mainWindow.loadURL failed:', err));
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
      .catch(err => console.error('[Main] mainWindow.loadFile failed:', err));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
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
    app.setAppUserModelId('com.busybar.desktop');
  }
  console.log('[Main] Starting SprintTicker Application...');

  // 1. Initialize SQLite Database & Repositories
  dbConnection = DatabaseConnection.getInstance();
  const taskRepo = new TaskRepository(dbConnection);
  const worklogRepo = new WorklogRepository(dbConnection);
  const settingsRepo = new SettingsRepository(dbConnection);
  const sessionRepo = new SessionRepository(dbConnection);
  const projectRepo = new ProjectRepository(dbConnection);

  const providerManager = new ProviderManager(settingsRepo);

  // 2. Initialize Time Tracking Engine.
  // Construction is side-effect free; initialize() starts the sync worker and
  // recovers a session left behind by a crash.
  engine = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo, providerManager, projectRepo);
  engine.initialize();

  // 3. Initialize Hardware Driver, Display Renderer & Input Decoder
  const forceMock = process.argv.includes('--mock-hardware') || process.env.MOCK_HARDWARE === 'true';
  driver = new BusyBarDriver('10.0.4.20', forceMock);
  await driver.connect();

  renderer = new DisplayRenderer(driver);
  const deviceConfig = settingsRepo.getSetting<{ showIdleClockFallback: boolean }>('device_config', { showIdleClockFallback: true });
  renderer.setShowIdleClockFallback(deviceConfig.showIdleClockFallback);
  inputDecoder = new InputDecoder(driver, engine, settingsRepo);

  // 4. Initialize the local webhook server
  webhookServer = new WebhookServer(39123);
  await webhookServer.start();
  console.log('[Main] Webhook server listening on http://127.0.0.1:39123');

  webhookServer.onInputEvent(key => {
    if (driver) {
      void driver.injectRemoteKey(key)
        .catch(err => console.error('[Main] driver.injectRemoteKey failed:', err));
    }
  });

  // 5. Register IPC Handlers and Bi-directional State Broadcasts
  unityInjectorService = new UnityInjectorService();
  const priorityEngine = new PriorityPreemptionEngine(settingsRepo);
  renderer.setPriorityEngine(priorityEngine);
  inputDecoder.setPriorityEngine(priorityEngine);
  inputDecoder.setRenderer(renderer);
  inputDecoder.setWindowFocusCallback(() => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  const unityTelemetryService = new UnityTelemetryService(settingsRepo, webhookServer, renderer, engine, priorityEngine);
  const messagingService = new MessagingIntegrationService(settingsRepo, renderer, providerManager);
  windowsNotificationService = new WindowsNotificationListenerService(settingsRepo, priorityEngine, renderer);
  windowsNotificationService.startListening();

  contextScheduleService = new ContextScheduleService(
    priorityEngine,
    settingsRepo,
    engine,
    renderer,
    () => mainWindow
  );

  // Reads its own version rather than being told one, so a packaged build and
  // a dev run cannot disagree about what is installed.
  updateChecker = new UpdateChecker(app.getVersion(), settingsRepo);

  ipcRegistry = new IPCHandlerRegistry({
    engine,
    taskRepo,
    settingsRepo,
    driver,
    inputDecoder,
    renderer,
    getWindow: () => mainWindow,
    unityInjectorService,
    worklogRepo,
    unityTelemetryService,
    messagingService,
    priorityEngine,
    contextScheduleService,
    windowsNotificationService,
    providerManager,
    syncWorker: engine.getSyncWorker(),
    updateChecker
  });
  ipcRegistry.registerAllHandlers();
  scheduleUpdateChecks();

  // 6. Create Window & Render Initial State
  createWindow();
  if (mainWindow && engine) {
    trayManager = new TrayManager(mainWindow, engine);
    trayManager.initialize();
  }
  renderer.renderActiveSession(engine.getCurrentSession());

  // Connect engine ticks to display renderer and IPC window broadcast for live matrix timer updates
  engine.on('tick', session => {
    renderer?.renderActiveSession(session);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPCChannel.ON_SESSION_UPDATED, session);
    }
  });
  console.log('[Main] Initialization completed successfully.');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

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

  void (async () => {
    try {
      if (updateCheckTimer) {
        clearInterval(updateCheckTimer);
        updateCheckTimer = null;
      }
      if (contextScheduleService) {
        contextScheduleService.dispose();
      }
      if (windowsNotificationService) {
        windowsNotificationService.stopListening();
      }
      if (engine) {
        engine.dispose();
      }
      if (webhookServer) {
        await webhookServer.stop();
      }
      if (driver) {
        // Hand the bar back before letting go of it. Without this the display
        // keeps showing the last frame -- "Working on FEAT-42" hours after the
        // app closed -- and every frame_0/frame_1 PNG ever uploaded stays in
        // the device's own storage under our application name.
        await driver.clearDisplay(DEVICE_APPLICATION_NAME);
        await driver.deleteAppAssets(DEVICE_APPLICATION_NAME);
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
