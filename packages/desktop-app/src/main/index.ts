import { app, BrowserWindow } from 'electron';
import path from 'path';
import { DatabaseConnection } from './db/database-connection';
import { TaskRepository } from './db/repositories/task-repository';
import { WorklogRepository } from './db/repositories/worklog-repository';
import { SettingsRepository } from './db/repositories/settings-repository';
import { SessionRepository } from './db/repositories/session-repository';
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

import { PriorityPreemptionEngine } from './services/priority-preemption-engine';
import { TrayManager } from './tray/tray-manager';

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
      contextIsolation: true
    }
  });

  mainWindow.setMenu(null);

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

app.whenReady().then(async () => {
  console.log('[Main] Starting Antigravity BUSY Bar PC Companion Application...');

  // 1. Initialize SQLite Database & Repositories
  dbConnection = DatabaseConnection.getInstance();
  const taskRepo = new TaskRepository(dbConnection);
  const worklogRepo = new WorklogRepository(dbConnection);
  const settingsRepo = new SettingsRepository(dbConnection);
  const sessionRepo = new SessionRepository(dbConnection);

  // 2. Initialize Time Tracking Engine
  engine = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo);

  // 3. Initialize Hardware Driver, Display Renderer & Input Decoder
  const forceMock = process.argv.includes('--mock-hardware') || process.env.MOCK_HARDWARE === 'true';
  driver = new BusyBarDriver('10.0.4.20', forceMock);
  await driver.connect();

  renderer = new DisplayRenderer(driver);
  inputDecoder = new InputDecoder(driver, engine, settingsRepo);

  // 4. Initialize Local Fastify Webhook Server
  webhookServer = new WebhookServer(39123);
  await webhookServer.start();
  console.log('[Main] Fastify Webhook Server listening on http://127.0.0.1:39123');

  // 5. Register IPC Handlers and Bi-directional State Broadcasts
  unityInjectorService = new UnityInjectorService();
  const priorityEngine = new PriorityPreemptionEngine(settingsRepo);
  renderer.setPriorityEngine(priorityEngine);

  const unityTelemetryService = new UnityTelemetryService(settingsRepo, webhookServer, renderer, engine, priorityEngine);
  const messagingService = new MessagingIntegrationService(settingsRepo, renderer, webhookServer);
  const windowsNotificationService = new WindowsNotificationListenerService(settingsRepo, priorityEngine, renderer);
  windowsNotificationService.startListening();

  ipcRegistry = new IPCHandlerRegistry(
    engine,
    taskRepo,
    settingsRepo,
    driver,
    inputDecoder,
    renderer,
    () => mainWindow,
    unityInjectorService,
    worklogRepo,
    unityTelemetryService,
    messagingService,
    priorityEngine,
    undefined,
    windowsNotificationService
  );
  ipcRegistry.registerAllHandlers();

  // 6. Create Window & Render Initial State
  createWindow();
  if (mainWindow && engine) {
    trayManager = new TrayManager(mainWindow, engine);
    trayManager.initialize();
  }
  renderer.renderActiveSession(engine.getCurrentSession());
  console.log('[Main] Initialization completed successfully.');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', async () => {
  if (windowsNotificationService) {
    windowsNotificationService.stopListening();
  }
  if (webhookServer) {
    await webhookServer.stop();
  }
  if (driver) {
    driver.disconnect();
  }
  if (dbConnection) {
    DatabaseConnection.resetInstance();
  }
});
