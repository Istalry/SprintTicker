import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { WebhookServer } from './api/webhook-server';
import { DatabaseService } from './store/database';
import { IPCChannel } from '../shared/ipc-channels';
import { ActiveSessionDTO } from '../shared/dtos';

let mainWindow: BrowserWindow | null = null;
let webhookServer: WebhookServer | null = null;
let databaseService: DatabaseService | null = null;

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0D0F12',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const setupIPCHandlers = (): void => {
  ipcMain.handle(IPCChannel.GET_CURRENT_SESSION, async () => {
    return databaseService ? databaseService.getActiveSession() : null;
  });

  ipcMain.handle(IPCChannel.START_TASK, async (_event, payload: { taskId: string; isAdHoc?: boolean; customTitle?: string }) => {
    if (!databaseService) throw new Error('Database service not initialized');
    const newSession: Omit<ActiveSessionDTO, 'elapsedSeconds'> = {
      sessionId: `sess_${Date.now()}`,
      projectId: 'PROJ-1',
      taskId: payload.taskId,
      taskKey: payload.taskId,
      taskTitle: payload.customTitle || 'Active Development Task',
      isAdHoc: Boolean(payload.isAdHoc),
      status: 'TRACKING',
      startTimeUtc: new Date().toISOString(),
      totalPausedSeconds: 0
    };
    databaseService.createSession(newSession);
    return databaseService.getActiveSession();
  });

  ipcMain.handle(IPCChannel.PAUSE_SESSION, async () => {
    if (!databaseService) throw new Error('Database service not initialized');
    const active = databaseService.getActiveSession();
    if (active && active.status === 'TRACKING') {
      databaseService.updateSessionStatus(
        active.sessionId,
        'PAUSED',
        active.totalPausedSeconds,
        new Date().toISOString()
      );
    }
    return databaseService.getActiveSession();
  });

  ipcMain.handle(IPCChannel.RESUME_SESSION, async () => {
    if (!databaseService) throw new Error('Database service not initialized');
    const active = databaseService.getActiveSession();
    if (active && active.status === 'PAUSED' && active.lastPauseStartUtc) {
      const pauseDuration = Math.floor((Date.now() - new Date(active.lastPauseStartUtc).getTime()) / 1000);
      const totalPaused = active.totalPausedSeconds + pauseDuration;
      databaseService.updateSessionStatus(active.sessionId, 'TRACKING', totalPaused, undefined);
    }
    return databaseService.getActiveSession();
  });

  ipcMain.handle(IPCChannel.COMPLETE_SESSION, async (_event, payload: { comment?: string }) => {
    if (!databaseService) throw new Error('Database service not initialized');
    const active = databaseService.getActiveSession();
    if (active) {
      databaseService.updateSessionStatus(active.sessionId, 'COMPLETED', active.totalPausedSeconds);
      databaseService.enqueueWorklog({
        id: `log_${Date.now()}`,
        providerId: 'jira',
        taskId: active.taskId,
        durationSeconds: active.elapsedSeconds,
        startedAtUtc: active.startTimeUtc,
        comment: payload.comment || 'Logged via Antigravity BUSY Bar'
      });
      return { success: true, loggedSeconds: active.elapsedSeconds };
    }
    return { success: false, loggedSeconds: 0 };
  });

  ipcMain.handle(IPCChannel.GET_DEVICE_STATUS, async () => {
    return {
      connected: true,
      ipAddress: '10.0.4.20',
      connectionType: 'usb',
      frontBrightness: 80,
      backBrightness: 100,
      batteryPercent: 98,
      firmwareVersion: '1.4.2',
      webSocketPingMs: 4
    };
  });
};

app.whenReady().then(async () => {
  databaseService = new DatabaseService();
  webhookServer = new WebhookServer(8080);
  await webhookServer.start();

  setupIPCHandlers();
  createWindow();

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
  if (webhookServer) {
    await webhookServer.stop();
  }
  if (databaseService) {
    databaseService.close();
  }
});
