import { app, ipcMain, BrowserWindow, dialog, shell } from 'electron';
import * as fs from 'fs';
import { IPCChannel } from '../../shared/ipc-channels';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { TaskRepository } from '../db/repositories/task-repository';
import { ProjectRepository } from '../db/repositories/project-repository';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { SecretStore } from '../db/secret-store';
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
import { SystemAutomationService, ISystemAutomationService } from '../services/system-automation-service';
import { ActiveSessionDTO, HardwareBindingConfig, DeviceStatusDTO, UnitySettingsDTO, MessagingSettingsDTO, WindowsNotificationSettingsDTO, BitmapIconId, DeviceConfigDTO, RearOledMode, ColorThemeId, UpdateStatusDTO, ProviderSyncResult, PreviewScreenId, ArgumentException } from '../../shared/dtos';
import { OfflineSyncWorker } from '../sync/offline-sync-worker';
import { UpdateChecker } from '../updater/update-checker';
import { OpenProjectProvider } from '../providers/openproject-provider';
import { ProviderManager } from '../providers/provider-manager';
import { PROVIDER_SETTING_DEFAULTS, ProviderSettingKey, ProviderSettingKeyValue } from '../../shared/provider-settings';
import { normalizeScheduleSettings } from '../../shared/schedule-defaults';
import { localDateKey } from '../../shared/local-date';

/**
 * Centrally registers all Electron IPC channel handlers and manages bi-directional
 * state broadcasting between Main, Renderer, and Hardware display layers.
 */
/**
 * Everything the registry needs, by name.
 *
 * Sixteen positional parameters, nine of them optional and eight of those
 * structurally similar service objects, meant a caller could swap two and get a
 * runtime failure somewhere unrelated rather than a compile error. Naming them
 * also removes the pressure to append rather than insert -- `providerManager`
 * had been added last purely because it was the cheapest place to put it.
 */
export interface IPCHandlerRegistryDeps {
  engine: TimeTrackingEngine;
  taskRepo: TaskRepository;
  settingsRepo: SettingsRepository;
  driver: BusyBarDriver;
  inputDecoder: InputDecoder;
  renderer: DisplayRenderer;
  getWindow: () => BrowserWindow | null;
  unityInjectorService?: UnityInjectorService;
  worklogRepo?: WorklogRepository;
  unityTelemetryService?: UnityTelemetryService;
  messagingService?: MessagingIntegrationService;
  priorityEngine?: PriorityPreemptionEngine;
  contextScheduleService?: ContextScheduleService;
  windowsNotificationService?: WindowsNotificationListenerService;
  systemAutomationService?: ISystemAutomationService;
  providerManager?: ProviderManager;
  syncWorker?: OfflineSyncWorker;
  updateChecker?: UpdateChecker;
}

export class IPCHandlerRegistry {
  private updateChecker?: UpdateChecker;
  private engine: TimeTrackingEngine;
  private taskRepo: TaskRepository;
  private projectRepo: ProjectRepository;
  private providerManager?: ProviderManager;
  private syncWorker?: OfflineSyncWorker;
  private settingsRepo: SettingsRepository;
  private secrets: SecretStore;
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
  private systemAutomationService: ISystemAutomationService;
  private getWindow: () => BrowserWindow | null;

  constructor(deps: IPCHandlerRegistryDeps) {
    const {
      engine,
      taskRepo,
      settingsRepo,
      driver,
      inputDecoder,
      renderer,
      getWindow,
      unityInjectorService,
      worklogRepo,
      unityTelemetryService,
      messagingService,
      priorityEngine,
      contextScheduleService,
      windowsNotificationService,
      systemAutomationService,
      providerManager,
      syncWorker,
      updateChecker
    } = deps;

    this.engine = engine;
    this.taskRepo = taskRepo;
    this.providerManager = providerManager;
    this.syncWorker = syncWorker;
    this.updateChecker = updateChecker;
    // Bound to the settings repository's connection rather than the
    // DatabaseConnection singleton, which would open a second, on-disk database
    // even when the caller supplied an in-memory one.
    this.projectRepo = new ProjectRepository(settingsRepo.getConnection());
    this.settingsRepo = settingsRepo;
    this.secrets = new SecretStore(settingsRepo);
    this.driver = driver;
    this.inputDecoder = inputDecoder;
    this.renderer = renderer;
    this.getWindow = getWindow;
    this.unityInjectorService = unityInjectorService || new UnityInjectorService();
    this.worklogRepo = worklogRepo || new WorklogRepository(settingsRepo.getConnection());
    this.unityTelemetryService = unityTelemetryService || new UnityTelemetryService(settingsRepo);
    this.messagingService = messagingService || new MessagingIntegrationService(settingsRepo, renderer);
    this.priorityEngine = priorityEngine || new PriorityPreemptionEngine(settingsRepo);
    this.priorityEngine.setRenderer(renderer);
    this.windowsNotificationService = windowsNotificationService || new WindowsNotificationListenerService(settingsRepo, this.priorityEngine, renderer);
    this.contextScheduleService = contextScheduleService || new ContextScheduleService(this.priorityEngine, settingsRepo, engine, renderer, this.getWindow);
    this.diagnosticExporter = new DiagnosticExporter(driver, settingsRepo.getConnection());
    this.systemAutomationService = systemAutomationService || new SystemAutomationService();
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
    ipcMain.handle(IPCChannel.SYNC_PROVIDER_NOW, async (): Promise<ProviderSyncResult> => {
      if (!this.syncWorker) {
        return { status: 'failed', reason: 'Sync worker unavailable.', projects: 0, tasks: 0 };
      }
      const result = await this.syncWorker.syncTasksAndProjects();
      this.broadcast(IPCChannel.ON_PROJECTS_UPDATED, {
        result,
        projects: this.projectRepo.getAllProjects()
      });
      return result;
    });

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
      const dateStr = typeof p === 'string' ? p : (p?.dateString || p?.date || localDateKey());
      return this.worklogRepo.getWorklogsByDate(dateStr);
    });

    ipcMain.handle(IPCChannel.GET_DAILY_WORKLOG_SUMMARY, async (_event, payload: string | Record<string, string> | unknown) => {
      const p = payload as Record<string, string> | string;
      const dateStr = typeof p === 'string' ? p : (p?.dateString || p?.date || localDateKey());
      return this.worklogRepo.getDailySummary(dateStr);
    });

    ipcMain.handle(IPCChannel.WIPE_ALL_DATA, async () => {
      // Wipe the connection this registry was built on, not the singleton.
      // getInstance() ignores the injected connection entirely, so the handler
      // would open (and clear) a different database than the one the rest of
      // the app is using.
      this.settingsRepo.getConnection().wipeAllData();
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

    ipcMain.handle(IPCChannel.GET_DEVICE_CONFIG, async () => {
      return this.settingsRepo.getSetting<DeviceConfigDTO>('device_config', {
        showIdleClockFallback: true
      });
    });

    ipcMain.handle(IPCChannel.SET_DEVICE_CONFIG, async (_event, config: DeviceConfigDTO) => {
      this.settingsRepo.setSetting('device_config', config);
      this.renderer.setShowIdleClockFallback(config.showIdleClockFallback);
      // Re-evaluate display state if needed
      const activeSession = this.engine.getCurrentSession();
      this.renderer.renderActiveSession(activeSession);
      return true;
    });

    // 5. Ceremonies & Schedule IPC Handlers
    ipcMain.handle(IPCChannel.GET_SCHEDULE_SETTINGS, async () => {
      // Same normaliser as the scheduler. These two used to carry separate
      // default objects that did not even agree on key names, so a fresh
      // install's schedule depended on which of them read the row first.
      return normalizeScheduleSettings(
        this.settingsRepo.getSetting('schedule_settings', {})
      );
    });

    ipcMain.handle(IPCChannel.SAVE_SCHEDULE_SETTINGS, async (_event, settings) => {
      // Normalised on the way in as well. The Ceremonies view populates both
      // spellings by hand today; doing it here means a future caller that
      // forgets one cannot leave the two readers disagreeing.
      this.settingsRepo.setSetting('schedule_settings', normalizeScheduleSettings(settings));
      this.contextScheduleService.evaluateSchedule();
      return true;
    });

    ipcMain.handle(IPCChannel.TRIGGER_STANDUP_PROMPT, async () => {
      this.contextScheduleService.triggerStandupPrompt();
      return { success: true };
    });

    ipcMain.handle(IPCChannel.TRIGGER_EOD_PROMPT, async () => {
      this.contextScheduleService.triggerEodPrompt();
      return { success: true };
    });

    ipcMain.handle(IPCChannel.UPDATE_CEREMONY_PROMPT, async (_event, payload: { type: 'STANDUP' | 'LUNCH' | 'EOD', title: string }) => {
      this.contextScheduleService.updateCeremonyPrompt(payload.type, payload.title);
      return { success: true };
    });

    ipcMain.handle(IPCChannel.TRIGGER_EOD_WRAP_UP, async (_event, options) => {
      const activeSession = this.engine.getCurrentSession();
      if (activeSession) {
        this.engine.stopSession('Finalized during End-of-Day Wrap-Up');
      }

      // 1. Issue RPC save scenes request to Unity Editors
      let savedUnityScenes = false;
      try {
        const ports = [8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088, 8089];
        const fetchPromises = ports.map(async (port) => {
          try {
            const response = await fetch(`http://localhost:${port}/sprintticker/save-scenes/`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(1500)
            });
            if (response.ok) savedUnityScenes = true;
          } catch {
            // Ignore inactive ports
          }
        });
        await Promise.all(fetchPromises);
      } catch (err) {
        console.log('[EOD] Unity scene save error:', err);
      }

      // 2. Instruct open code editors (VS Code, Cursor) to save open dirty files
      let savedVSCode = false;
      try {
        const editorSaveResult = await this.systemAutomationService.saveOpenEditors();
        savedVSCode = editorSaveResult.isSaved;
      } catch (err) {
        console.warn('[EOD] Editor save error:', err);
      }

      // 3. Render EOD completion screen on hardware display
      this.renderer.renderEodCompleted('Day Complete!');

      // 4. Release display lock after 5 seconds to return to background active/idle display
      if (process.env.NODE_ENV !== 'test') {
        setTimeout(() => {
          try {
            this.priorityEngine.releaseActiveLock('eodWrapUpPriority');
            const current = this.engine.getCurrentSession();
            this.renderer.renderActiveSession(current);
          } catch {
            // Ignore if app closed
          }
        }, 5000);
      } else {
        this.priorityEngine.releaseActiveLock('eodWrapUpPriority');
      }

      // 5. Trigger Shutdown if requested
      if (options?.shouldShutdown) {
        try {
          await this.systemAutomationService.scheduleShutdown(30, 'BUSY Bar End-of-Day Wrap-Up');
        } catch (e) {
          console.error('[EOD] Failed to execute shutdown command:', e);
        }
      }

      return { success: true, savedUnityScenes, savedVSCode };
    });

    ipcMain.handle(IPCChannel.CANCEL_EOD_WRAP_UP, async () => {
      this.priorityEngine.releaseActiveLock('standupPromptPriority');
      this.priorityEngine.releaseActiveLock('eodWrapUpPriority');
      if (this.systemAutomationService.isShutdownPending()) {
        await this.systemAutomationService.abortShutdown();
      }
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
      const read = (key: ProviderSettingKeyValue): string =>
        this.settingsRepo.getSetting(key, PROVIDER_SETTING_DEFAULTS[key]);

      const activeId = read(ProviderSettingKey.ACTIVE_PROVIDER_ID);
      const fallbackKey = read(ProviderSettingKey.FALLBACK_TICKET_KEY);
      const opDomain = read(ProviderSettingKey.OP_DOMAIN);
      // Decrypted, because the settings form shows the saved key so the user
      // can check it. That the renderer sees the plaintext is a smaller
      // exposure than the plaintext sitting on disk for a backup tool to pick
      // up, but it is the reason this is not a complete fix for F-11.
      const opApiKey = this.secrets.getSecret(ProviderSettingKey.OP_API_KEY);
      const opStatusInProgress = read(ProviderSettingKey.OP_STATUS_IN_PROGRESS);
      const opStatusToTest = read(ProviderSettingKey.OP_STATUS_TO_TEST);
      const opStatusToReview = read(ProviderSettingKey.OP_STATUS_TO_REVIEW);
      const opCompletionAction = read(ProviderSettingKey.OP_COMPLETION_ACTION);

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
      if (payload.opApiKey !== undefined) this.secrets.setSecret(ProviderSettingKey.OP_API_KEY, payload.opApiKey);
      if (payload.opStatusInProgress !== undefined) this.settingsRepo.setSetting('op_status_in_progress', payload.opStatusInProgress);
      if (payload.opStatusToTest !== undefined) this.settingsRepo.setSetting('op_status_to_test', payload.opStatusToTest);
      if (payload.opStatusToReview !== undefined) this.settingsRepo.setSetting('op_status_to_review', payload.opStatusToReview);
      if (payload.opCompletionAction !== undefined) this.settingsRepo.setSetting('op_completion_action', payload.opCompletionAction);

      if (this.providerManager) {
        this.providerManager.reinitializeProviders();
        if (payload.providerId) {
          this.providerManager.setActiveProviderId(payload.providerId);
        }
        // Credentials that were just entered are useless until something
        // fetches with them, and the Projects view reads the cache the worker
        // fills. Without this the user configured a provider, saw an empty
        // list, and had no way to tell that from "the remote has nothing" for
        // up to a full sync interval.
        //
        // Deliberately not awaited: there are no fetch timeouts in the
        // provider layer yet, so a hung instance would hold the Save button
        // open indefinitely. The renderer learns the outcome from
        // ON_PROJECTS_UPDATED instead.
        this.startProviderSync();
      } else {
        // Previously `providerManager` was neither a field nor a parameter, so
        // this branch was always taken and silently did nothing: credentials
        // were persisted but the live provider kept the old ones until restart.
        console.warn(
          '[IPCHandlerRegistry] No ProviderManager wired; saved provider settings ' +
            'will not take effect until the app restarts.'
        );
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

    // Previews go through the real renderer, so the debug panel cannot show a
    // layout the device would not produce. Two consequences worth knowing: a
    // preview costs one asset upload plus one draw when a device is attached,
    // and the priority engine may legitimately suppress it -- during Lunch, for
    // instance -- which the hand-built previews used to hide.
    ipcMain.handle(IPCChannel.PREVIEW_DISPLAY_SCREEN, async (_event, screen: PreviewScreenId) => {
      const project = 'MyFantasyGame';
      switch (screen) {
        case 'CEREMONY_STANDUP':
          this.renderer.renderCeremonyPrompt('STANDUP', 'Daily Stand-Up');
          return true;
        case 'CEREMONY_EOD':
          this.renderer.renderCeremonyPrompt('EOD', 'End-of-Day Wrap-Up');
          return true;
        case 'EOD_COMPLETE':
          this.renderer.renderEodCompleted();
          return true;
        case 'UNITY_PLAY_MODE':
          this.renderer.renderPlayMode(project);
          return true;
        case 'UNITY_COMPILING':
          this.renderer.renderCompilation(project);
          return true;
        case 'UNITY_BUILDING':
          this.renderer.renderBuilding(project, 80);
          return true;
        case 'UNITY_BAKING':
          this.renderer.renderBaking(project, 45);
          return true;
        case 'UNITY_EXCEPTION':
          this.renderer.renderException(project, 'NullReferenceException');
          return true;
        case 'TASK_SELECTION':
          this.renderer.renderTaskSelection('TASK', 'PROJ-142', 'Implement dash');
          return true;
        default:
          throw new ArgumentException(`Unknown preview screen: ${String(screen)}`);
      }
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

    // 11. Update Handlers. A notification only: nothing is downloaded or
    // installed, because unsigned builds re-trigger SmartScreen on every
    // update and some are blocked outright. See ROADMAP.md §2.
    ipcMain.handle(IPCChannel.CHECK_FOR_UPDATE, async (): Promise<UpdateStatusDTO> => {
      const currentVersion = app.getVersion();
      if (!this.updateChecker) {
        return { status: 'disabled', currentVersion };
      }

      try {
        return await this.updateChecker.checkForUpdate();
      } catch (err) {
        // Translated here rather than swallowed. The checker throws when it
        // could not find out, and reporting that as "up to date" is precisely
        // the lie that got the previous updater deleted (audit F-18).
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[Main] Update check failed: ${reason}`);
        return { status: 'failed', currentVersion, reason };
      }
    });

    ipcMain.handle(IPCChannel.GET_UPDATE_CHECK_ENABLED, async () => {
      return this.updateChecker ? this.updateChecker.isEnabled() : false;
    });

    ipcMain.handle(IPCChannel.SET_UPDATE_CHECK_ENABLED, async (_event, enabled: boolean) => {
      this.updateChecker?.setEnabled(enabled);
      return this.updateChecker ? this.updateChecker.isEnabled() : false;
    });

    // Only ever opens a release page on this project's own repository. The URL
    // arrives from the renderer, so it is checked rather than trusted: a
    // shell.openExternal that accepts whatever it is handed is a way to launch
    // arbitrary protocol handlers.
    ipcMain.handle(IPCChannel.OPEN_RELEASE_PAGE, async (_event, url: string) => {
      if (typeof url !== 'string' || !url.startsWith('https://github.com/Istalry/SprintTicker/')) {
        console.warn(`[Main] Refused to open a non-release URL: ${String(url)}`);
        return false;
      }
      await shell.openExternal(url);
      return true;
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
  /**
   * Runs a provider sync in the background and tells the renderer what happened.
   *
   * Safe to call repeatedly: the worker refuses overlapping passes, because two
   * of them would each prune against their own snapshot.
   */
  private startProviderSync(): void {
    if (!this.syncWorker) {
      // Not a failure worth surfacing: every production path wires the worker,
      // and tests that omit it are not exercising sync.
      console.warn('[IPCHandlerRegistry] No OfflineSyncWorker wired; skipping the post-save sync.');
      return;
    }

    void this.syncWorker
      .syncTasksAndProjects()
      .then(result => {
        this.broadcast(IPCChannel.ON_PROJECTS_UPDATED, {
          result,
          projects: this.projectRepo.getAllProjects()
        });
      })
      .catch(err => {
        // syncTasksAndProjects reports failure in its result rather than by
        // throwing, so reaching here means a defect rather than an outage.
        console.error('[IPCHandlerRegistry] Provider sync threw unexpectedly:', err);
      });
  }

  /**
   * Sends an update result to the renderer.
   *
   * Exposed narrowly rather than making `broadcast` public: the update check
   * runs on a timer owned by main, so it needs a way in, but nothing outside
   * this class should be choosing arbitrary channels.
   */
  public broadcastUpdateStatus(status: UpdateStatusDTO): void {
    this.broadcast(IPCChannel.ON_UPDATE_STATUS, status);
  }

  /**
   * The webContents check is not redundant with the window check: they are
   * separate objects with separate lifetimes.
   *
   * Neither covers a *disposed render frame*, though. After the renderer
   * process dies, both still report false and the send is attempted anyway --
   * at which point Electron logs "Render frame was disposed before WebFrameMain
   * could be accessed" itself. It does not throw, so there is nothing here to
   * catch; a try/catch around the send was tried and never fired. Silencing it
   * would mean tracking renderer liveness through `render-process-gone`, and
   * it only appears once the renderer is already gone, so it is noise at
   * teardown rather than a fault.
   */
  private broadcast(channel: string, payload: unknown): void {
    const win = this.getWindow();
    if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
      return;
    }

    win.webContents.send(channel, payload);
  }
}
