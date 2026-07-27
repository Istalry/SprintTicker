import { ipcMain, BrowserWindow, dialog } from 'electron';
import { IPCChannel } from '../../shared/ipc-channels';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { TaskRepository } from '../db/repositories/task-repository';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { BusyBarDriver } from '../hardware/busybar-driver';
import { InputDecoder } from '../hardware/input-decoder';
import { DisplayRenderer } from '../hardware/display-renderer';
import { UnityInjectorService } from '../services/unity-injector-service';
import { ActiveSessionDTO, HardwareBindingConfig, DeviceStatusDTO } from '../../shared/dtos';

/**
 * Centrally registers all Electron IPC channel handlers and manages bi-directional
 * state broadcasting between Main, Renderer, and Hardware display layers.
 */
export class IPCHandlerRegistry {
  private engine: TimeTrackingEngine;
  private taskRepo: TaskRepository;
  private settingsRepo: SettingsRepository;
  private driver: BusyBarDriver;
  private inputDecoder: InputDecoder;
  private renderer: DisplayRenderer;
  private unityInjectorService: UnityInjectorService;
  private getWindow: () => BrowserWindow | null;

  constructor(
    engine: TimeTrackingEngine,
    taskRepo: TaskRepository,
    settingsRepo: SettingsRepository,
    driver: BusyBarDriver,
    inputDecoder: InputDecoder,
    renderer: DisplayRenderer,
    getWindow: () => BrowserWindow | null,
    unityInjectorService?: UnityInjectorService
  ) {
    this.engine = engine;
    this.taskRepo = taskRepo;
    this.settingsRepo = settingsRepo;
    this.driver = driver;
    this.inputDecoder = inputDecoder;
    this.renderer = renderer;
    this.getWindow = getWindow;
    this.unityInjectorService = unityInjectorService || new UnityInjectorService();
  }

  public getSettingsRepo(): SettingsRepository {
    return this.settingsRepo;
  }

  /**
   * Registers all ipcMain handles and state listeners.
   */
  public registerAllHandlers(): void {
    // 1. Session Control IPC Handlers
    ipcMain.handle(IPCChannel.GET_CURRENT_SESSION, async () => {
      return this.engine.getCurrentSession();
    });

    ipcMain.handle(IPCChannel.START_TASK, async (_event, payload: { taskId: string; isAdHoc?: boolean; customTitle?: string }) => {
      return this.engine.startTask(payload.taskId, payload.isAdHoc, payload.customTitle);
    });

    ipcMain.handle(IPCChannel.PAUSE_SESSION, async () => {
      return this.engine.pauseSession();
    });

    ipcMain.handle(IPCChannel.RESUME_SESSION, async () => {
      return this.engine.resumeSession();
    });

    ipcMain.handle(IPCChannel.COMPLETE_SESSION, async (_event, payload: { comment?: string }) => {
      return this.engine.stopSession(payload.comment);
    });

    ipcMain.handle(IPCChannel.DISCARD_SESSION, async () => {
      this.engine.stopSession('Discarded session');
      return true;
    });

    // 2. Task Provider IPC Handlers
    ipcMain.handle(IPCChannel.GET_TASKS, async (_event, projectId: string) => {
      return this.taskRepo.getTasksByProjectId(projectId);
    });

    ipcMain.handle(IPCChannel.CREATE_AD_HOC_TASK, async (_event, customTitle: string) => {
      return this.taskRepo.createAdHocTask(customTitle);
    });

    // 3. Hardware Rebinding IPC Handlers
    ipcMain.handle(IPCChannel.GET_INPUT_BINDINGS, async () => {
      return this.inputDecoder.getBindings();
    });

    ipcMain.handle(IPCChannel.SAVE_INPUT_BINDINGS, async (_event, config: HardwareBindingConfig) => {
      this.inputDecoder.saveBindings(config);
      return true;
    });

    // 4. Device Status IPC Handlers
    ipcMain.handle(IPCChannel.GET_DEVICE_STATUS, async () => {
      return this.driver.getDeviceStatus();
    });

    // 5. Unity Injector & Gitignore IPC Handlers
    ipcMain.handle(IPCChannel.SETUP_GITIGNORE, async () => {
      return this.unityInjectorService.setupGlobalGitignore();
    });

    ipcMain.handle(IPCChannel.CHECK_GITIGNORE, async () => {
      return this.unityInjectorService.checkGlobalGitignoreStatus();
    });

    ipcMain.handle(IPCChannel.SCAN_AND_INJECT, async (_event, rootFolder: string) => {
      return this.unityInjectorService.scanAndInjectProjects(rootFolder);
    });

    ipcMain.handle(IPCChannel.REMOVE_INJECTION, async (_event, projectPath: string) => {
      return this.unityInjectorService.removeInjection(projectPath);
    });

    ipcMain.handle(IPCChannel.OPEN_FOLDER_PICKER, async () => {
      const win = this.getWindow();
      const options = { properties: ['openDirectory' as const] };
      const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
      if (res.canceled || res.filePaths.length === 0) {
        return null;
      }
      return res.filePaths[0];
    });

    // 6. Wire Bi-directional State Broadcasts
    this.engine.subscribe((session: ActiveSessionDTO | null) => {
      this.broadcast(IPCChannel.ON_SESSION_UPDATED, session);
      this.renderer.renderActiveSession(session);
    });

    this.driver.on('statusChanged', (status: DeviceStatusDTO) => {
      this.broadcast(IPCChannel.ON_DEVICE_STATUS_CHANGED, status);
    });

    this.inputDecoder.registerActionHandler((action: string, inputKey: string) => {
      this.broadcast(IPCChannel.ON_HARDWARE_INPUT_EVENT, { inputKey, actionAssigned: action });
    });
  }

  /**
   * Helper method to broadcast IPC messages to active Renderer window.
   */
  private broadcast(channel: string, payload: unknown): void {
    const win = this.getWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}
