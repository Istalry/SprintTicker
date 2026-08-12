import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import * as fs from 'fs';
import { IPCChannel } from '../../shared/ipc-channels';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { TaskRepository } from '../db/repositories/task-repository';
import { ProjectRepository } from '../db/repositories/project-repository';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { DatabaseConnection } from '../db/database-connection';
import { BusyBarDriver } from '../hardware/busybar-driver';
import { InputDecoder } from '../hardware/input-decoder';
import { DisplayRenderer } from '../hardware/display-renderer';
import { UnityInjectorService } from '../services/unity-injector-service';
import { WorklogRepository } from '../db/repositories/worklog-repository';
import { UnityTelemetryService } from '../services/unity-telemetry-service';
import { MessagingIntegrationService } from '../services/messaging-service';
import { WindowsNotificationListenerService } from '../services/windows-notification-listener-service';
import { PriorityPreemptionEngine } from '../services/priority-preemption-engine';
import { ContextScheduleService } from '../services/context-schedule-service';
import { DiagnosticExporter } from '../diagnostics/diagnostic-exporter';
import { ActiveSessionDTO, HardwareBindingConfig, DeviceStatusDTO, UnitySettingsDTO, MessagingSettingsDTO, WindowsNotificationSettingsDTO, BitmapIconId } from '../../shared/dtos';
import { OpenProjectProvider } from '../providers/openproject-provider';

/**
 * Centrally registers all Electron IPC channel handlers and manages bi-directional
 * state broadcasting between Main, Renderer, and Hardware display layers.
 */
export class IPCHandlerRegistry {
  private engine: TimeTrackingEngine;
  private taskRepo: TaskRepository;
  private projectRepo: ProjectRepository;
  private settingsRepo: SettingsRepository;
  private worklogRepo: WorklogRepository;
  private driver: BusyBarDriver;
  private inputDecoder: InputDecoder;
  private renderer: DisplayRenderer;
  private unityInjectorService: UnityInjectorService;
  private unityTelemetryService: UnityTelemetryService;
  private messagingService: MessagingIntegrationService;
  private windowsNotificationService: WindowsNotificationListenerService;
  private priorityEngine: PriorityPreemptionEngine;
  private contextScheduleService: ContextScheduleService;
  private diagnosticExporter: DiagnosticExporter;
  private getWindow: () => BrowserWindow | null;

  constructor(
    engine: TimeTrackingEngine,
    taskRepo: TaskRepository,
    settingsRepo: SettingsRepository,
    driver: BusyBarDriver,
    inputDecoder: InputDecoder,
    renderer: DisplayRenderer,
    getWindow: () => BrowserWindow | null,
    unityInjectorService?: UnityInjectorService,
    worklogRepo?: WorklogRepository,
    unityTelemetryService?: UnityTelemetryService,
    messagingService?: MessagingIntegrationService,
    priorityEngine?: PriorityPreemptionEngine,
    contextScheduleService?: ContextScheduleService,
    windowsNotificationService?: WindowsNotificationListenerService
  ) {
    this.engine = engine;
    this.taskRepo = taskRepo;
    this.projectRepo = new ProjectRepository();
    this.settingsRepo = settingsRepo;
    this.driver = driver;
    this.inputDecoder = inputDecoder;
    this.renderer = renderer;
    this.getWindow = getWindow;
    this.unityInjectorService = unityInjectorService || new UnityInjectorService();
    this.worklogRepo = worklogRepo || new WorklogRepository();
    this.unityTelemetryService = unityTelemetryService || new UnityTelemetryService(settingsRepo);
    this.messagingService = messagingService || new MessagingIntegrationService(settingsRepo, renderer);
    this.priorityEngine = priorityEngine || new PriorityPreemptionEngine(settingsRepo);
    this.priorityEngine.setRenderer(renderer);
    this.windowsNotificationService = windowsNotificationService || new WindowsNotificationListenerService(settingsRepo, this.priorityEngine, renderer);
    this.contextScheduleService = contextScheduleService || new ContextScheduleService(this.priorityEngine, settingsRepo, engine, renderer);
    this.diagnosticExporter = new DiagnosticExporter(driver);
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

    ipcMain.handle(IPCChannel.COMPLETE_SESSION, async (_event, payload: { comment?: string; markDone?: boolean }) => {
      const res = this.engine.stopSession(payload.comment, payload.markDone);
      if (payload.markDone) {
        this.renderer.renderTaskCompletionConfetti(4);
      }
      return res;
    });

    ipcMain.handle(IPCChannel.DISCARD_SESSION, async () => {
      this.engine.stopSession('Discarded session');
      return true;
    });

    // 2. Project & Task Management IPC Handlers
    ipcMain.handle(IPCChannel.GET_PROJECTS, async () => {
      return this.projectRepo.getAllProjects();
    });

    ipcMain.handle(IPCChannel.CREATE_PROJECT, async (_event, payload: { id: string; key: string; name: string; providerId?: string }) => {
      this.projectRepo.saveProject(payload);
      return true;
    });

    ipcMain.handle(IPCChannel.RENAME_PROJECT, async (_event, payload: { id: string; name: string; key: string }) => {
      this.projectRepo.renameProject(payload.id, payload.name, payload.key);
      return true;
    });

    ipcMain.handle(IPCChannel.DELETE_PROJECT, async (_event, payload: string | Record<string, string> | unknown) => {
      const p = payload as Record<string, string> | string;
      const projId = typeof p === 'string' ? p : (p?.id || p?.projectId);
      if (projId) {
        this.projectRepo.deleteProject(projId);
      }
      return true;
    });

    ipcMain.handle(IPCChannel.GET_TASKS, async (_event, payload: string | Record<string, string> | unknown) => {
      const p = payload as Record<string, string> | string;
      const projId = typeof p === 'string' ? p : (p?.projectId || p?.id);
      return projId ? this.taskRepo.getTasksByProjectId(projId) : [];
    });

    ipcMain.handle(IPCChannel.CREATE_AD_HOC_TASK, async (_event, payload: string | Record<string, string> | unknown) => {
      const p = payload as Record<string, string> | string;
      const title = typeof p === 'string' ? p : (p?.customTitle || p?.title);
      return title ? this.taskRepo.createAdHocTask(title) : null;
    });

    ipcMain.handle(IPCChannel.DELETE_TASK, async (_event, payload: string | Record<string, string> | unknown) => {
      const p = payload as Record<string, string> | string;
      const taskId = typeof p === 'string' ? p : (p?.taskId || p?.id);
      if (taskId) {
        this.taskRepo.deleteTask(taskId);
      }
      return true;
    });

    ipcMain.handle(IPCChannel.UPDATE_TASK, async (_event, task) => {
      if (task) {
        this.taskRepo.updateTask(task);
      }
      return true;
    });

    ipcMain.handle(IPCChannel.IMPORT_TASKS, async (_event, payload: { projectId: string; tasks: Array<{ key: string; title: string; status?: 'todo' | 'in_progress' | 'done' }> }) => {
      return this.taskRepo.importTasks(payload.projectId, payload.tasks);
    });

    ipcMain.handle(IPCChannel.GET_WORKLOGS_BY_DATE, async (_event, payload: string | Record<string, string> | unknown) => {
      const p = payload as Record<string, string> | string;
      const dateStr = typeof p === 'string' ? p : (p?.dateString || p?.date || new Date().toISOString().split('T')[0]);
      return this.worklogRepo.getWorklogsByDate(dateStr);
    });

    ipcMain.handle(IPCChannel.GET_DAILY_WORKLOG_SUMMARY, async (_event, payload: string | Record<string, string> | unknown) => {
      const p = payload as Record<string, string> | string;
      const dateStr = typeof p === 'string' ? p : (p?.dateString || p?.date || new Date().toISOString().split('T')[0]);
      return this.worklogRepo.getDailySummary(dateStr);
    });

    ipcMain.handle(IPCChannel.WIPE_ALL_DATA, async () => {
      DatabaseConnection.getInstance().wipeAllData();
      return true;
    });

    // 3. Hardware Rebinding IPC Handlers
    ipcMain.handle(IPCChannel.GET_INPUT_BINDINGS, async () => {
      return this.inputDecoder.getBindings();
    });

    ipcMain.handle(IPCChannel.SAVE_INPUT_BINDINGS, async (_event, config: HardwareBindingConfig) => {
      this.inputDecoder.saveBindings(config);
      return true;
    });

    ipcMain.handle(IPCChannel.INJECT_REMOTE_KEY, async (_event, payload: string | { key: string }) => {
      const key = typeof payload === 'string' ? payload : payload?.key;
      if (key) {
        return this.driver.injectRemoteKey(key);
      }
      return false;
    });

    this.inputDecoder.registerActionHandler((action, inputKey) => {
      const window = this.getWindow();
      if (window && !window.isDestroyed()) {
        window.webContents.send(IPCChannel.ON_HARDWARE_INPUT_EVENT, { inputKey, actionAssigned: action });
      }
    });

    // 4. Device Status & Config IPC Handlers
    ipcMain.handle(IPCChannel.GET_DEVICE_STATUS, async () => {
      return this.driver.getDeviceStatus();
    });

    // 5. Ceremonies & Schedule IPC Handlers
    ipcMain.handle(IPCChannel.GET_SCHEDULE_SETTINGS, async () => {
      return this.settingsRepo.getSetting('schedule_settings', {
        standupTime: '10:05',
        lunchStart: '12:18',
        lunchEnd: '13:00',
        eodTime: '17:30',
        autoDismissSeconds: 0
      });
    });

    ipcMain.handle(IPCChannel.SAVE_SCHEDULE_SETTINGS, async (_event, settings) => {
      this.settingsRepo.setSetting('schedule_settings', settings);
      this.contextScheduleService.evaluateSchedule();
      return true;
    });

    ipcMain.handle(IPCChannel.TRIGGER_STANDUP_PROMPT, async () => {
      this.contextScheduleService.triggerStandupPrompt();
      return { success: true };
    });

    ipcMain.handle(IPCChannel.TRIGGER_EOD_WRAP_UP, async (_event, options) => {
      const activeSession = this.engine.getCurrentSession();
      if (activeSession) {
        this.engine.stopSession('Finalized during End-of-Day Wrap-Up');
      }

      // Instruct VS Code to save open dirty files
      let savedVSCode = false;
      try {
        const { exec } = await import('child_process');
        exec('code --command workbench.action.files.saveAll', (err) => {
          if (!err) savedVSCode = true;
        });
      } catch {
        console.log('[EOD] VS Code CLI not in system PATH, skipping VS Code save command.');
      }

      if (options?.shouldShutdown) {
        try {
          const { exec } = await import('child_process');
          exec('shutdown /s /t 30', (err) => {
            if (err) console.error('[EOD] Shutdown command error:', err);
          });
        } catch (e) {
          console.error('[EOD] Failed to execute shutdown command:', e);
        }
      }

      return { success: true, savedUnityScenes: true, savedVSCode };
    });

    ipcMain.handle(IPCChannel.CANCEL_EOD_WRAP_UP, async () => {
      this.priorityEngine.releaseActiveLock('standupPromptPriority');
      const activeSession = this.engine.getCurrentSession();
      this.renderer.renderActiveSession(activeSession);
      return true;
    });

    ipcMain.handle(IPCChannel.CANCEL_STANDUP_PROMPT, async () => {
      this.priorityEngine.releaseActiveLock('standupPromptPriority');
      const activeSession = this.engine.getCurrentSession();
      this.renderer.renderActiveSession(activeSession);
      return true;
    });

    ipcMain.handle(IPCChannel.SNOOZE_CEREMONY, async (_event, payload: { type: 'STANDUP' | 'EOD'; minutes: number }) => {
      this.contextScheduleService.snoozeCeremony(payload.type, payload.minutes);
      const activeSession = this.engine.getCurrentSession();
      this.renderer.renderActiveSession(activeSession);
      return true;
    });

    // 6. Priority Rules IPC Handlers
    ipcMain.handle(IPCChannel.GET_PRIORITY_RULES, async () => {
      return this.priorityEngine.getRules();
    });

    ipcMain.handle(IPCChannel.SAVE_PRIORITY_RULES, async (_event, config) => {
      if (Array.isArray(config)) {
        this.priorityEngine.saveRules(config);
      } else if (config && typeof config === 'object' && Array.isArray(config.rules)) {
        this.priorityEngine.saveRules(config.rules);
      } else {
        this.settingsRepo.setSetting('priority_rules', config);
      }
      return true;
    });

    ipcMain.handle(IPCChannel.SET_USER_MODE, async (_event, mode) => {
      if (mode === 'LUNCH') {
        this.contextScheduleService.enterLunchMode();
      } else if (mode === 'AWAY') {
        this.contextScheduleService.enterAwayMode();
      } else {
        this.contextScheduleService.exitLunchMode();
      }
      return true;
    });

    ipcMain.handle(IPCChannel.GET_USER_MODE, async () => {
      return this.priorityEngine.getUserMode();
    });

    // 7. Task Provider Config IPC Handlers
    ipcMain.handle(IPCChannel.GET_PROVIDERS, async () => {
      const activeId = this.settingsRepo.getSetting('active_provider_id', 'openproject');
      const fallbackKey = this.settingsRepo.getSetting('fallback_ticket_key', 'MISC-1');
      const opDomain = this.settingsRepo.getSetting('op_domain', 'http://192.168.0.139:8090/');
      const opApiKey = this.settingsRepo.getSetting('op_api_key', '');
      const opStatusInProgress = this.settingsRepo.getSetting('op_status_in_progress', 'In progress');
      const opStatusToTest = this.settingsRepo.getSetting('op_status_to_test', 'In testing');
      const opStatusToReview = this.settingsRepo.getSetting('op_status_to_review', 'Developed');
      const opCompletionAction = this.settingsRepo.getSetting('op_completion_action', 'to_review');

      return {
        activeProviderId: activeId,
        fallbackTicketKey: fallbackKey,
        opDomain,
        opApiKey,
        opStatusInProgress,
        opStatusToTest,
        opStatusToReview,
        opCompletionAction,
        providers: [
          { id: 'openproject', name: 'OpenProject' },
          { id: 'adhoc', name: 'Ad-Hoc / Custom Local Fallback' }
        ]
      };
    });

    ipcMain.handle(IPCChannel.SET_ACTIVE_PROVIDER, async (_event, payload: { 
      providerId: string; 
      fallbackTicketKey?: string;
      opDomain?: string;
      opApiKey?: string;
      opStatusInProgress?: string;
      opStatusToTest?: string;
      opStatusToReview?: string;
      opCompletionAction?: string;
    }) => {
      if (payload.providerId) this.settingsRepo.setSetting('active_provider_id', payload.providerId);
      if (payload.fallbackTicketKey) this.settingsRepo.setSetting('fallback_ticket_key', payload.fallbackTicketKey);
      if (payload.opDomain !== undefined) this.settingsRepo.setSetting('op_domain', payload.opDomain);
      if (payload.opApiKey !== undefined) this.settingsRepo.setSetting('op_api_key', payload.opApiKey);
      if (payload.opStatusInProgress !== undefined) this.settingsRepo.setSetting('op_status_in_progress', payload.opStatusInProgress);
      if (payload.opStatusToTest !== undefined) this.settingsRepo.setSetting('op_status_to_test', payload.opStatusToTest);
      if (payload.opStatusToReview !== undefined) this.settingsRepo.setSetting('op_status_to_review', payload.opStatusToReview);
      if (payload.opCompletionAction !== undefined) this.settingsRepo.setSetting('op_completion_action', payload.opCompletionAction);

      if (this.providerManager) {
        this.providerManager.reinitializeProviders();
        if (payload.providerId) {
          this.providerManager.setActiveProviderId(payload.providerId);
        }
      }
      return true;
    });

    ipcMain.handle(IPCChannel.FETCH_OP_STATUSES, async (_event, payload: { domain: string, apiKey: string }) => {
      return OpenProjectProvider.fetchStatuses(payload.domain, payload.apiKey);
    });

    // 8. Unity Injector & Gitignore IPC Handlers
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

    // 9. Worklogs IPC Handlers
    ipcMain.handle(IPCChannel.GET_TODAYS_WORKLOGS, async () => {
      return this.worklogRepo.getTodaysWorklogs();
    });

    // 10. Unity Telemetry & Audio Settings IPC Handlers
    ipcMain.handle(IPCChannel.GET_UNITY_SETTINGS, async () => {
      return this.unityTelemetryService.getSettings();
    });

    ipcMain.handle(IPCChannel.SAVE_UNITY_SETTINGS, async (_event, settings: UnitySettingsDTO) => {
      this.unityTelemetryService.saveSettings(settings);
      return true;
    });

    ipcMain.handle(IPCChannel.GET_UNITY_TELEMETRY, async () => {
      return this.unityTelemetryService.getTelemetry();
    });

    // 11. Third-Party Messaging & Windows Notification Listener IPC Handlers
    ipcMain.handle(IPCChannel.GET_MESSAGING_SETTINGS, async () => {
      return this.messagingService.getSettings();
    });

    ipcMain.handle(IPCChannel.SAVE_MESSAGING_SETTINGS, async (_event, settings: MessagingSettingsDTO) => {
      this.messagingService.saveSettings(settings);
      return true;
    });

    ipcMain.handle(IPCChannel.TEST_MESSAGING_INTEGRATION, async (_event, channelName: string) => {
      return this.messagingService.testIntegration(channelName);
    });

    ipcMain.handle(IPCChannel.GET_NOTIFICATION_SETTINGS, async () => {
      return this.windowsNotificationService.getSettings();
    });

    ipcMain.handle(IPCChannel.SAVE_NOTIFICATION_SETTINGS, async (_event, settings: WindowsNotificationSettingsDTO) => {
      this.windowsNotificationService.saveSettings(settings);
      return true;
    });

    ipcMain.handle(IPCChannel.SIMULATE_NOTIFICATION, async (_event, payload: { appId: string; appName: string; title: string; body: string; iconId?: BitmapIconId; iconPath?: string }) => {
      return this.windowsNotificationService.simulateNotification(
        payload.appId,
        payload.appName,
        payload.title,
        payload.body,
        payload.iconId,
        payload.iconPath
      );
    });

    ipcMain.handle(IPCChannel.GET_NOTIFICATION_LISTENER_STATUS, async () => {
      return {
        status: this.windowsNotificationService.getListenerStatus(),
        logs: this.windowsNotificationService.getLogEntries()
      };
    });

    ipcMain.handle(IPCChannel.OPEN_NOTIFICATION_SETTINGS, async () => {
      if (process.platform === 'win32') {
        try {
          await shell.openExternal('ms-settings:privacy-notifications');
          return true;
        } catch {
          await shell.openExternal('ms-settings:notifications');
          return true;
        }
      }
      return false;
    });

    this.windowsNotificationService.onLog((entry) => {
      this.broadcast(IPCChannel.ON_NOTIFICATION_LOG, entry);
    });

    // 12. Hardware Display Animation & Screen Emulator IPC Handlers
    ipcMain.handle(IPCChannel.GET_DISPLAY_STATE, async () => {
      return this.renderer.getDisplayState();
    });

    ipcMain.handle(IPCChannel.SET_REAR_OLED_MODE, async (_event, mode: RearOledMode) => {
      this.renderer.setRearOledMode(mode);
      return true;
    });

    ipcMain.handle(IPCChannel.SET_COLOR_THEME, async (_event, theme: ColorThemeId) => {
      this.renderer.setColorTheme(theme);
      return true;
    });

    ipcMain.handle(IPCChannel.TRIGGER_CONFETTI_BURST, async () => {
      this.renderer.renderTaskCompletionConfetti();
      return true;
    });

    // 10. Diagnostics Handlers
    ipcMain.handle(IPCChannel.EXPORT_DIAGNOSTIC_LOGS, async () => {
      try {
        const bundle = await this.diagnosticExporter.generateDiagnosticBundle();
        const jsonStr = JSON.stringify(bundle, null, 2);
        const win = this.getWindow();
        if (!win) return false;

        const { canceled, filePath } = await dialog.showSaveDialog(win, {
          title: 'Export Diagnostic Logs',
          defaultPath: `busybar-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
          filters: [{ name: 'JSON', extensions: ['json'] }]
        });

        if (canceled || !filePath) {
          return false;
        }

        fs.writeFileSync(filePath, jsonStr, 'utf-8');
        return true;
      } catch (err) {
        console.error('Failed to export diagnostic logs:', err);
        return false;
      }
    });

    // 13. Wire Bi-directional State Broadcasts
    this.engine.subscribe((session: ActiveSessionDTO | null) => {
      this.broadcast(IPCChannel.ON_SESSION_UPDATED, session);
      this.broadcast(IPCChannel.ON_WORKLOGS_UPDATED, this.worklogRepo.getTodaysWorklogs());
      this.renderer.renderActiveSession(session);
    });

    this.renderer.onStateChanged((state) => {
      this.broadcast(IPCChannel.ON_DISPLAY_STATE_UPDATED, state);
    });

    this.priorityEngine.onUserModeChanged((mode) => {
      this.broadcast(IPCChannel.ON_USER_MODE_UPDATED, mode);
    });

    this.unityTelemetryService.onTelemetryUpdated(telemetry => {
      this.broadcast(IPCChannel.ON_UNITY_TELEMETRY_UPDATED, telemetry);
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
