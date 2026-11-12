import type { NoticeService } from '../services/notice-service';
import type { NoticeKind, NoticesDTO, SyncHealthDTO } from '../../shared/sync-health';
import { INITIAL_SYNC_HEALTH } from '../../shared/sync-health';
import type { FirstRunService } from '../services/first-run-service';
import type { ConnectionTestDTO, ConnectionTestRequestDTO, DeskDetectionDTO } from '../../shared/first-run';
import { WorklogCorrectionService } from '../services/worklog-correction-service';
import { ManualWorklogDTO, WorklogCorrectionDTO } from '../../shared/worklog-correction';
import { worklogsToCsv } from '../../shared/worklog-csv';
import type { DayShare } from '../../shared/work-split';
import { app, ipcMain, BrowserWindow, dialog, shell } from 'electron';
import * as fs from 'fs';
import { isFlowSettingKey, readFlowSetting } from '../../shared/flow-settings';
import type { ReminderService } from '../services/reminder-service';
import type { MorningService } from '../services/morning-service';
import { END_THE_INTERRUPTION_FIRST, isInterruptionSource } from '../../shared/interruption';
import { InterruptionService } from '../services/interruption-service';
import { IPCChannel } from '../../shared/ipc-channels';
import { MAX_SYNC_ATTEMPTS } from '../sync/sync-constants';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { TaskRepository } from '../db/repositories/task-repository';
import { ProjectRepository } from '../db/repositories/project-repository';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { SecretStore } from '../db/secret-store';
import { BusyBarDriver } from '../hardware/busybar-driver';
import { InputDecoder } from '../hardware/input-decoder';
import { DisplayRenderer } from '../hardware/display-renderer';
import { WorklogRepository } from '../db/repositories/worklog-repository';
import { ProviderEventService } from '../services/provider-event-service';
import { ProviderEventSettingsDTO } from '../../shared/provider-events';
import { WindowsNotificationListenerService } from '../services/windows-notification-listener-service';
import { PriorityPreemptionEngine } from '../services/priority-preemption-engine';
import { ContextScheduleService } from '../services/context-schedule-service';
import { ForgottenSessionService } from '../services/forgotten-session-service';
import { DiagnosticExporter } from '../diagnostics/diagnostic-exporter';
import { SystemAutomationService, ISystemAutomationService } from '../services/system-automation-service';
import { StandupTaskDTO, SyncQueueSnapshotDTO, ActiveSessionDTO, DeviceStatusDTO, WindowsNotificationSettingsDTO, BitmapIconId, DeviceConfigDTO, ColorThemeId, UpdateStatusDTO, ProviderSyncResult, PreviewScreenId, ArgumentException, DiscardSessionResultDTO, ForgottenSessionReviewDTO, ForgottenSessionResolutionDTO, LaunchAtLoginStatusDTO, ShortcutsStatusDTO, ProviderCapabilitiesDTO, TaskDTO, UndoStateDTO, WeekChangeDTO, StandupRunningDTO } from '../../shared/dtos';
import { RECENT_TASKS_LIMIT } from '../../shared/previous-task';
import { PickerDataDTO, pickerUsageSince } from '../../shared/task-picker';
import { checkAdHocTitle } from '../../shared/interruption';
import { MiniWindowController } from '../windows/mini-window-manager';
import { openTaskPickerInMainWindow, openWindowOn } from '../windows/main-window-actions';
import type { PickerWindowController } from '../windows/picker-window-manager';
import { DEVICE_CONFIG_SETTING_KEY, DEFAULT_DEVICE_CONFIG, isValidDeviceHost } from '../../shared/device-constants';
import { OfflineSyncWorker } from '../sync/offline-sync-worker';
import { UpdateChecker } from '../updater/update-checker';
import { LaunchAtLoginService } from '../services/launch-at-login';
import { COLOR_THEME_KEY, DEFAULT_COLOR_THEME, isColorThemeId } from '../../shared/color-theme';
import { ShortcutService } from '../services/shortcut-service';
import { DEFAULT_SHORTCUTS, ShortcutAction, ShortcutChord } from '../../shared/flow-settings';
import { OpenProjectProvider } from '../providers/openproject-provider';
import { ProviderManager } from '../providers/provider-manager';
import { PROVIDER_SETTING_DEFAULTS, ProviderSettingKey, ProviderSettingKeyValue } from '../../shared/provider-settings';
import { parseTaskScope } from '../../shared/task-scope';
import { normalizeScheduleSettings, checkScheduleSettings } from '../../shared/schedule-defaults';
import { addLocalDays, localDateKey } from '../../shared/local-date';
import { weekStartKey } from '../../shared/working-days';
import { ONLY_PROJECTS_WITH_TASKS_KEY, ONLY_PROJECTS_WITH_TASKS_DEFAULT } from '../../shared/project-filter';
import { TASK_VISIBILITY_KEY, TaskVisibility, isTaskVisibility, readTaskVisibility } from '../../shared/task-visibility';
import { EOD_COMPLETE_DISPLAY_SECONDS } from '../../shared/render-constants';
import { OWN_PROJECT_PROVIDER_ID } from '../../shared/local-provider';
import { selectableProviders } from '../../shared/provider-names';
import { plainSessionEnding, SessionEnding } from '../services/session-commands';
import { UndoService } from '../services/undo-service';
import { addUndoably, correctUndoably, deleteUndoably, endDayUndoably, moveUndoably,
  keepOffUndoably, splitUndoably, WorklogEditDeps } from '../services/undoable-commands';
import { EndDayShutdown } from '../services/end-day-shutdown';
import { UNDO_WINDOW_MS } from '../sync/sync-constants';

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
/** What the switch reads with no service behind it: a registry built without one, in tests. */
const LAUNCH_AT_LOGIN_UNAVAILABLE: LaunchAtLoginStatusDTO = { enabled: false, available: false, reason: null };
/** Without the service (a test, a build without it): every chord as its default, holding nothing. */
const SHORTCUTS_UNAVAILABLE: ShortcutsStatusDTO = {
  interrupt: { ...DEFAULT_SHORTCUTS.interrupt, registered: false, problem: null },
  switch: { ...DEFAULT_SHORTCUTS.switch, registered: false, problem: null },
  previous: { ...DEFAULT_SHORTCUTS.previous, registered: false, problem: null },
  back: { ...DEFAULT_SHORTCUTS.back, registered: false, problem: null }
};

export interface IPCHandlerRegistryDeps {
  engine: TimeTrackingEngine;
  taskRepo: TaskRepository;
  settingsRepo: SettingsRepository;
  driver: BusyBarDriver;
  inputDecoder: InputDecoder;
  renderer: DisplayRenderer;
  getWindow: () => BrowserWindow | null;
  /**
   * Every window a broadcast reaches -- the dashboard and the mini timer.
   * Defaults to the dashboard alone; without it the mini timer would never
   * hear a session change.
   */
  getWindows?: () => BrowserWindow[];
  miniWindow?: MiniWindowController;
  /**
   * The picker as its own window (P7b), for the mini timer's ⇄ and ↳.
   * Without it, the main window's picker opens.
   */
  pickerWindow?: PickerWindowController;
  worklogRepo?: WorklogRepository;
  providerEvents?: ProviderEventService;
  priorityEngine?: PriorityPreemptionEngine;
  contextScheduleService?: ContextScheduleService;
  /** Asks about a session left running overnight; without it, nothing is ever asked. */
  forgottenSessionService?: ForgottenSessionService;
  /** The first run (P11a); without it, it never opens on its own and nothing can be tested. */
  firstRun?: Pick<FirstRunService, 'shouldShow' | 'finish' | 'testConnection' | 'detectDesk' | 'installDeckPlugin' | 'openTokenPage'>;
  /** Today's one-time notices (P11b); without it, none is shown. */
  notices?: Pick<NoticeService, 'getNotices' | 'dismiss'>;
  /** The "still...?" reminders (P8d); without it, none is ever asked. */
  reminders?: Pick<ReminderService, 'getReminder' | 'dismiss'>;
  /** The morning card (P8e2); without it, Today never shows one. */
  morning?: Pick<MorningService, 'getMorning' | 'markSeen'>;
  /**
   * In working hours now -- WORK, a working day, stand-up to wrap-up -- for
   * the mini timer's loud "Nothing timing" (P12d). Without it, never.
   */
  isWorkingNow?: () => boolean;
  /** Corrects and deletes worklogs; without it, both channels refuse. */
  worklogCorrections?: WorklogCorrectionService;
  windowsNotificationService?: WindowsNotificationListenerService;
  systemAutomationService?: ISystemAutomationService;
  providerManager?: ProviderManager;
  syncWorker?: OfflineSyncWorker;
  updateChecker?: UpdateChecker;
  /** Starting with Windows; without it, the switch reads unavailable. */
  launchAtLogin?: LaunchAtLoginService;
  shortcuts?: ShortcutService;
  /** Supplied so the diagnostics bundle can report the listener's real state rather than assert one. */
  webhookServer?: { getStatus(): { listening: boolean; port: number } };
  /**
   * Holds the last action for Undo (P5). Without it, as in most tests,
   * nothing is undoable: sessions end and worklogs change at once.
   */
  undo?: UndoService;
  /** How Stop, Done and Discard end a session; the undoable one in main. */
  sessionEnding?: SessionEnding;
}

/** The shape a correction must have before it reaches the service, which checks its values. */
function isWorklogCorrection(value: unknown): value is WorklogCorrectionDTO {
  const c = value as Partial<WorklogCorrectionDTO> | null;
  return (
    typeof c === 'object' && c !== null &&
    typeof c.durationSeconds === 'number' &&
    typeof c.startedAtUtc === 'string' &&
    typeof c.comment === 'string'
  );
}

/** `YYYY-MM-DD`, a local day as the window names it. */
function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isManualWorklog(value: unknown): value is ManualWorklogDTO {
  return isWorklogCorrection(value) && typeof (value as Partial<ManualWorklogDTO>).taskId === 'string';
}

export class IPCHandlerRegistry {
  private updateChecker?: UpdateChecker;
  private launchAtLogin?: LaunchAtLoginService;
  private shortcuts?: ShortcutService;
  private engine: TimeTrackingEngine;
  private taskRepo: TaskRepository;
  private projectRepo: ProjectRepository;
  private providerManager?: ProviderManager;
  private syncWorker?: OfflineSyncWorker;
  private settingsRepo: SettingsRepository;
  private secrets: SecretStore;
  private worklogRepo: WorklogRepository;
  private worklogCorrections?: WorklogCorrectionService;
  private driver: BusyBarDriver;
  private inputDecoder: InputDecoder;
  private renderer: DisplayRenderer;
  private providerEvents: ProviderEventService;
  private windowsNotificationService: WindowsNotificationListenerService;
  private priorityEngine: PriorityPreemptionEngine;
  private contextScheduleService: ContextScheduleService;
  private forgottenSessionService?: ForgottenSessionService;
  private firstRun?: IPCHandlerRegistryDeps['firstRun'];
  private notices?: IPCHandlerRegistryDeps['notices'];
  private diagnosticExporter: DiagnosticExporter;
  private systemAutomationService: ISystemAutomationService;
  private getWindow: () => BrowserWindow | null;
  private getWindows: () => BrowserWindow[];
  private miniWindow?: MiniWindowController;
  private pickerWindow?: PickerWindowController;
  private reminders?: Pick<ReminderService, 'getReminder' | 'dismiss'>;
  private morning?: Pick<MorningService, 'getMorning' | 'markSeen'>;
  private isWorkingNow?: () => boolean;
  private undo?: UndoService;
  /** End my day's optional shutdown, after Undo and the queue (S17). */
  private readonly endDayShutdown: EndDayShutdown;
  private sessionEnding: SessionEnding;

  constructor(deps: IPCHandlerRegistryDeps) {
    const {
      engine,
      taskRepo,
      settingsRepo,
      driver,
      inputDecoder,
      renderer,
      getWindow,
      getWindows,
      miniWindow,
      worklogRepo,
      providerEvents,
      priorityEngine,
      contextScheduleService,
      forgottenSessionService,
      windowsNotificationService,
      systemAutomationService,
      providerManager,
      syncWorker,
      updateChecker,
      launchAtLogin,
      shortcuts,
      webhookServer
    } = deps;

    this.engine = engine;
    this.taskRepo = taskRepo;
    this.providerManager = providerManager;
    this.syncWorker = syncWorker;
    this.updateChecker = updateChecker;
    this.launchAtLogin = launchAtLogin;
    this.shortcuts = shortcuts;
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
    this.getWindows = getWindows ?? (() => {
      const win = getWindow();
      return win ? [win] : [];
    });
    this.miniWindow = miniWindow;
    this.pickerWindow = deps.pickerWindow;
    this.reminders = deps.reminders;
    this.morning = deps.morning;
    this.isWorkingNow = deps.isWorkingNow;
    this.worklogRepo = worklogRepo || new WorklogRepository(settingsRepo.getConnection());
    this.worklogCorrections = deps.worklogCorrections;
    // The default is never started and shows nothing: it serves the settings
    // to a test, or a build that has no toasts.
    this.providerEvents = providerEvents || new ProviderEventService({
      getActiveProvider: () => this.providerManager?.getActiveProvider(),
      settings: settingsRepo,
      toasts: { show: () => false }
    });
    this.priorityEngine = priorityEngine || new PriorityPreemptionEngine(settingsRepo);
    this.priorityEngine.setRenderer(renderer);
    this.windowsNotificationService = windowsNotificationService || new WindowsNotificationListenerService(settingsRepo, this.priorityEngine, renderer);
    this.contextScheduleService = contextScheduleService || new ContextScheduleService(this.priorityEngine, settingsRepo, engine, renderer, this.getWindow);
    this.forgottenSessionService = forgottenSessionService;
    this.firstRun = deps.firstRun;
    this.notices = deps.notices;
    this.diagnosticExporter = new DiagnosticExporter(driver, settingsRepo.getConnection(), {
      webhookStatus: webhookServer ? () => webhookServer.getStatus() : undefined
    });
    this.systemAutomationService = systemAutomationService || new SystemAutomationService();
    this.undo = deps.undo;
    this.endDayShutdown = new EndDayShutdown({
      drainOnce: async () => {
        if (!this.syncWorker) return false;
        await this.syncWorker.processPendingQueue();
        // Still due within the undo window: sends held for it, not stuck ones.
        return this.worklogRepo.getPendingQueueItems(new Date(Date.now() + UNDO_WINDOW_MS).toISOString()).length > 0;
      },
      scheduleShutdown: () => this.systemAutomationService.scheduleShutdown(),
      abortShutdown: () => this.systemAutomationService.abortShutdown(),
      isShutdownPending: () => this.systemAutomationService.isShutdownPending()
    });
    this.sessionEnding = deps.sessionEnding ?? plainSessionEnding(engine, renderer);
  }

  /** Corrections, moves and deletions: with Undo when there is one, at once otherwise. */
  private _interruptionService: InterruptionService | null = null;

  /** Placing, keeping off and discarding the interruptions that ended; built once, on first use. */
  private interruptions(): InterruptionService {
    if (!this._interruptionService) {
      this._interruptionService = new InterruptionService({
        engine: this.engine,
        ...(this.worklogCorrections ? { corrections: this.worklogCorrections } : {}),
        ...(this.undo ? { undo: this.undo, db: this.worklogRepo.getConnection().getDb() } : {}),
        onRestored: () => {
          this.broadcastInterruptions();
          this.broadcast(IPCChannel.ON_WORKLOGS_UPDATED, this.worklogRepo.getTodaysWorklogs());
        },
        getTaskKey: taskId => this.taskRepo.getTaskById(taskId)?.key ?? null
      });
    }
    return this._interruptionService;
  }

  private broadcastInterruptions(): void {
    this.broadcast(IPCChannel.ON_INTERRUPTIONS_UPDATED, this.engine.getInterruptionsToPlace());
    this.broadcast(IPCChannel.ON_WORKLOGS_UPDATED, this.worklogRepo.getTodaysWorklogs());
  }

  private worklogEdits(): WorklogEditDeps | null {
    if (!this.undo || !this.worklogCorrections) return null;
    return {
      db: this.worklogRepo.getConnection().getDb(),
      undo: this.undo,
      worklogs: this.worklogRepo,
      corrections: this.worklogCorrections,
      onRestored: () => this.broadcast(IPCChannel.ON_WORKLOGS_UPDATED, this.worklogRepo.getTodaysWorklogs())
    };
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
      // During an interruption, choosing a task does nothing (the user's
      // choice, 2026-11-12): it ends first, by Back, Stop or Discard.
      if (this.engine.isInterrupted()) throw new Error(END_THE_INTERRUPTION_FIRST);
      return this.engine.startTask(payload.taskId, payload.isAdHoc, payload.customTitle);
    });

    // "↳ Move my 1h 24m…" on a task that left the list (S5b): its time so
    // far goes to the task picked, which then runs. Each entry moves as
    // `worklogs:move` moves one, so its send goes to the new task.
    ipcMain.handle(IPCChannel.MOVE_SESSION, async (_event, taskId: unknown) => {
      if (typeof taskId !== 'string' || !taskId) throw new ArgumentException('A move needs a task id.', 'taskId');
      const corrections = this.worklogCorrections;
      if (!corrections) throw new Error('Moving time is unavailable.');
      try {
        return this.engine.moveSessionTo(taskId, (worklogId, target) => corrections.reassign(worklogId, target));
      } finally {
        this.broadcast(IPCChannel.ON_WORKLOGS_UPDATED, this.worklogRepo.getTodaysWorklogs());
      }
    });

    // Interruptions in a row (P6). Start goes through the schedule service,
    // the one place every surface's Interrupt meets; the rest are the
    // engine's, which holds the interrupted task, and the interruption
    // service's for the ones waiting to be placed.
    const interrupt = (options: unknown) => {
      const { source, startedAtUtc } = (options ?? {}) as { source?: unknown; startedAtUtc?: unknown };
      const at = typeof startedAtUtc === 'string' ? new Date(startedAtUtc) : undefined;
      if (at && Number.isNaN(at.getTime())) throw new ArgumentException('Not a time.', 'startedAtUtc');
      return this.contextScheduleService.interrupt(isInterruptionSource(source) ? source : 'window', at);
    };
    ipcMain.handle(IPCChannel.START_INTERRUPTION, async (_event, options: unknown) => interrupt(options));
    ipcMain.handle(IPCChannel.INTERRUPTION_START, async (_event, options: unknown) => interrupt(options));
    ipcMain.handle(IPCChannel.INTERRUPTION_ANOTHER, async () => this.engine.anotherInterruption('window'));
    ipcMain.handle(IPCChannel.INTERRUPTION_BACK, async (_event, addGapMinutes: unknown) =>
      this.engine.backFromInterruption(typeof addGapMinutes === 'number' ? addGapMinutes : 0));
    ipcMain.handle(IPCChannel.INTERRUPTION_STOP, async () => {
      // Through the session's ending, so Stop on an interruption can be undone too.
      if (this.engine.isInterrupted()) this.sessionEnding.complete();
      return this.engine.getCurrentSession();
    });
    ipcMain.handle(IPCChannel.INTERRUPTION_SWITCH, async (_event, taskId: unknown) => {
      if (typeof taskId !== 'string' || !taskId) throw new ArgumentException('Switching needs a task id.', 'taskId');
      // No surface offers it since 2026-11-12 (choosing a task during an
      // interruption does nothing); an older window's request is refused too.
      throw new Error(END_THE_INTERRUPTION_FIRST);
    });
    ipcMain.handle(IPCChannel.INTERRUPTION_DISCARD, async (_event, id: unknown) => {
      if (id === undefined || id === null) {
        return this.engine.isInterrupted() ? this.sessionEnding.discard().success : false;
      }
      if (typeof id !== 'string' || !id) throw new ArgumentException('Discarding needs an interruption id.', 'id');
      const discarded = this.interruptions().discard(id);
      this.broadcastInterruptions();
      return discarded;
    });
    ipcMain.handle(IPCChannel.INTERRUPTION_RENAME, async (_event, id: unknown, name: unknown) => {
      if (typeof id !== 'string' || !id) throw new ArgumentException('Naming needs an interruption id.', 'id');
      this.interruptions().rename(id, checkAdHocTitle(name));
      this.broadcastInterruptions();
    });
    ipcMain.handle(IPCChannel.INTERRUPTION_MOVE_START, async (_event, atUtc: unknown) => {
      const at = typeof atUtc === 'string' ? new Date(atUtc) : null;
      if (!at || Number.isNaN(at.getTime())) throw new ArgumentException('Not a time.', 'atUtc');
      return this.engine.moveInterruptionStart(at);
    });
    ipcMain.handle(IPCChannel.INTERRUPTION_CHOOSE_TASK, async (_event, taskId: unknown) => {
      if (taskId !== null && (typeof taskId !== 'string' || !taskId)) throw new ArgumentException('Choosing needs a task id, or null.', 'taskId');
      return this.engine.chooseTaskForInterruption(taskId);
    });
    ipcMain.handle(IPCChannel.INTERRUPTION_PLACE, async (_event, id: unknown, taskId: unknown) => {
      if (typeof id !== 'string' || !id || typeof taskId !== 'string' || !taskId) {
        throw new ArgumentException('Placing needs an interruption and a task.');
      }
      this.interruptions().place([id], taskId);
      this.broadcastInterruptions();
    });
    ipcMain.handle(IPCChannel.INTERRUPTION_PLACE_MANY, async (_event, ids: unknown, taskId: unknown) => {
      if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string' && id) || typeof taskId !== 'string' || !taskId) {
        throw new ArgumentException('Placing needs interruptions and a task.');
      }
      this.interruptions().place(ids as string[], taskId);
      this.broadcastInterruptions();
    });
    ipcMain.handle(IPCChannel.INTERRUPTION_KEEP_OFF, async (_event, id: unknown) => {
      if (typeof id !== 'string' || !id) throw new ArgumentException('Keeping off needs an interruption id.', 'id');
      this.interruptions().keepOff([id]);
      this.broadcastInterruptions();
    });
    ipcMain.handle(IPCChannel.INTERRUPTION_GET_TO_PLACE, async () => this.interruptions().getToPlace());
    // Ended from anywhere -- the bar, the deck, the tray, lunch -- the lists follow.
    this.engine.onInterruptionEnded(() => this.broadcastInterruptions());

    ipcMain.handle(IPCChannel.RENAME_SESSION, async (_event, title: unknown) => this.engine.renameAdHocSession(checkAdHocTitle(title)));

    ipcMain.handle(IPCChannel.ASSIGN_SESSION, async (_event, taskId: unknown) => {
      if (typeof taskId !== 'string' || !taskId) throw new ArgumentException('Assigning needs a task id.', 'taskId');
      return this.engine.assignSessionToTask(taskId);
    });

    ipcMain.handle(IPCChannel.PAUSE_SESSION, async () => {
      return this.engine.pauseSession();
    });

    ipcMain.handle(IPCChannel.RESUME_SESSION, async () => {
      return this.engine.resumeSession();
    });

    // Shared with the Stream Deck, so a key ends a session as a click does.
    ipcMain.handle(IPCChannel.COMPLETE_SESSION, async (_event, payload: { comment?: string; markDone?: boolean }) =>
      this.sessionEnding.complete(payload.comment, payload.markDone)
    );

    // Keeps nothing: no worklog, nothing sent, no scene on the bar. The
    // window asks for confirmation before calling this.
    ipcMain.handle(IPCChannel.DISCARD_SESSION, async (): Promise<DiscardSessionResultDTO> => {
      return this.sessionEnding.discard();
    });

    ipcMain.handle(IPCChannel.GET_FLOW_SETTING, async (_e, key: unknown) => {
      if (!isFlowSettingKey(key)) throw new ArgumentException(`Not a flow setting: ${String(key)}.`, 'key');
      return readFlowSetting(key, this.settingsRepo.getSetting<unknown>(key, null));
    });
    ipcMain.handle(IPCChannel.SAVE_FLOW_SETTING, async (_e, key: unknown, value: unknown) => {
      if (!isFlowSettingKey(key)) throw new ArgumentException(`Not a flow setting: ${String(key)}.`, 'key');
      // Stored as its reader answers it, so a partial or wrong value from the
      // window lands whole and valid, never as the shape it was sent in.
      const stored = readFlowSetting(key, value);
      this.settingsRepo.setSetting(key, stored);
      return stored;
    });
    ipcMain.handle(IPCChannel.GET_UNDO, async (): Promise<UndoStateDTO | null> => this.undo?.current() ?? null);
    ipcMain.handle(IPCChannel.RUN_UNDO, async (): Promise<boolean> => {
      const undone = this.undo?.run() ?? false;
      if (undone) this.broadcast(IPCChannel.ON_WORKLOGS_UPDATED, this.worklogRepo.getTodaysWorklogs());
      return undone;
    });
    this.undo?.onChanged(state => this.broadcast(IPCChannel.ON_UNDO_CHANGED, state));

    ipcMain.handle(IPCChannel.GET_PREVIOUS_TASK, async (): Promise<TaskDTO | null> => this.engine.getPreviousTask());

    ipcMain.handle(IPCChannel.GET_SESSION_DAYS, async (): Promise<DayShare[]> => this.engine.getSessionDays());

    // The first run (P11a). Test connection never throws for the remote's
    // failure -- that is its answer -- and never saves what it tested.
    ipcMain.handle(IPCChannel.GET_FIRST_RUN, async (): Promise<boolean> => this.firstRun?.shouldShow() ?? false);
    ipcMain.handle(IPCChannel.FINISH_FIRST_RUN, async (): Promise<void> => { this.firstRun?.finish(); });
    ipcMain.handle(IPCChannel.TEST_PROVIDER_CONNECTION, async (_event, request: ConnectionTestRequestDTO): Promise<ConnectionTestDTO> => {
      if (!this.firstRun) return { ok: false, reason: 'failed', host: null, detail: 'Testing is not available.' };
      return this.firstRun.testConnection(request);
    });
    ipcMain.handle(IPCChannel.DETECT_DESK, async (): Promise<DeskDetectionDTO | null> => this.firstRun?.detectDesk() ?? null);
    ipcMain.handle(IPCChannel.INSTALL_DECK_PLUGIN, async (): Promise<boolean> => this.firstRun?.installDeckPlugin() ?? false);
    // The renderer names the provider and the address typed; main builds the URL.
    ipcMain.handle(IPCChannel.OPEN_TOKEN_PAGE, async (_event, providerId: string, site: string): Promise<boolean> =>
      this.firstRun?.openTokenPage(providerId, site) ?? false
    );

    // S31's states (P11b): how the sync is going, and Today's one-time notices.
    ipcMain.handle(IPCChannel.GET_SYNC_HEALTH, async (): Promise<SyncHealthDTO> => this.syncWorker?.getHealth() ?? INITIAL_SYNC_HEALTH);
    ipcMain.handle(IPCChannel.GET_NOTICES, async (): Promise<NoticesDTO> =>
      this.notices?.getNotices() ?? { updatedTo: null, noAccountDismissed: true }
    );
    ipcMain.handle(IPCChannel.DISMISS_NOTICE, async (_event, kind: NoticeKind): Promise<NoticesDTO> =>
      this.notices?.dismiss(kind) ?? { updatedTo: null, noAccountDismissed: true }
    );

    ipcMain.handle(IPCChannel.GET_FORGOTTEN_REVIEW, async (): Promise<ForgottenSessionReviewDTO | null> =>
      this.forgottenSessionService?.getReview() ?? null
    );

    // Validated by the service: an unknown action, or an end outside the
    // session, throws rather than logging something nobody chose.
    ipcMain.handle(IPCChannel.RESOLVE_FORGOTTEN_SESSION, async (_event, resolution: ForgottenSessionResolutionDTO) =>
      this.forgottenSessionService?.resolve(resolution) ?? false
    );

    // 2. Project & Task Management IPC Handlers
    ipcMain.handle(IPCChannel.SYNC_PROVIDER_NOW, async (): Promise<ProviderSyncResult> => {
      if (!this.syncWorker) {
        return { status: 'failed', reason: 'Sync worker unavailable.', projects: 0, tasks: 0 };
      }
      const result = await this.syncWorker.syncTasksAndProjects();
      // A committed sync has told the window already, through onSynced.
      if (result.status !== 'synced') this.broadcastProjects(result);
      return result;
    });

    /**
     * The sync queue, for the panel that shows why a worklog has not arrived.
     *
     * Each row is joined to the local task cache so the panel can name the
     * task the way the user does. The queue stores the provider's own task id
     * -- Jira's `10001` rather than `SCRUM-2` -- because that is what the API
     * needs, and a number nobody recognises is no use in a diagnostic.
     */
    ipcMain.handle(IPCChannel.GET_SYNC_QUEUE, async (): Promise<SyncQueueSnapshotDTO> => {
      const snapshot = this.worklogRepo.getSyncQueueSnapshot();
      return {
        counts: snapshot.counts,
        maxAttempts: MAX_SYNC_ATTEMPTS,
        items: snapshot.items.map(item => ({
          id: item.id,
          providerId: item.providerId,
          taskId: item.taskId,
          taskKey: this.taskRepo.getTaskById(item.taskId)?.key || item.taskId,
          durationSeconds: item.durationSeconds,
          startedAtUtc: item.startedAtUtc,
          comment: item.comment,
          status: item.status,
          operation: item.operation,
          retryCount: item.retryCount,
          nextAttemptAtUtc: item.nextAttemptAtUtc,
          lastError: item.lastError,
          ...(item.refusedAtUtc ? { refused: true as const } : {})
        }))
      };
    });

    /**
     * Un-parks every FAILED row and drains the queue.
     *
     * The same call saving credentials makes, exposed on its own because the
     * reason a row parked is not always a credential: a deleted issue answers
     * 404 for good, and a payload Jira refuses answers 400 no matter how long
     * you wait. Both park permanently now, and re-creating the issue or fixing
     * the workflow is a repair no settings form can detect.
     */
    ipcMain.handle(IPCChannel.RETRY_FAILED_WORKLOGS, async (): Promise<{ requeued: number }> => {
      if (!this.syncWorker) return { requeued: 0 };
      const requeued = this.syncWorker.requeueFailedWorklogs();
      if (requeued > 0) await this.syncWorker.processPendingQueue();
      return { requeued };
    });

    ipcMain.handle(IPCChannel.GET_PROJECTS, async () => {
      return this.projectRepo.getAllProjects();
    });

    ipcMain.handle(IPCChannel.CREATE_PROJECT, async (_event, payload: { id: string; key: string; name: string; providerId?: string }) => {
      // Made here, whatever the caller says: its tasks exist nowhere else, so
      // their time must never be queued for a provider.
      this.projectRepo.saveProject({ ...payload, providerId: OWN_PROJECT_PROVIDER_ID });
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

    ipcMain.handle(IPCChannel.GET_UNSORTED_WORKLOGS, async () => this.worklogRepo.getUnsortedWorklogs());

    ipcMain.handle(IPCChannel.STAR_TASK, async (_event, taskId: unknown): Promise<TaskDTO[]> => {
      if (typeof taskId !== 'string' || !taskId) throw new ArgumentException('A task id is required.', 'taskId');
      this.taskRepo.star(taskId);
      return this.taskRepo.getStarred();
    });
    ipcMain.handle(IPCChannel.UNSTAR_TASK, async (_event, taskId: unknown): Promise<TaskDTO[]> => {
      if (typeof taskId !== 'string' || !taskId) throw new ArgumentException('A task id is required.', 'taskId');
      this.taskRepo.unstar(taskId);
      return this.taskRepo.getStarred();
    });
    ipcMain.handle(IPCChannel.GET_STARRED_TASKS, async (): Promise<TaskDTO[]> => this.taskRepo.getStarred());
    ipcMain.handle(IPCChannel.GET_PICKER_DATA, async (): Promise<PickerDataDTO> => {
      const since = pickerUsageSince(new Date());
      return {
        previous: this.engine.getPreviousTask(),
        recent: this.taskRepo.getRecent(RECENT_TASKS_LIMIT),
        starred: this.taskRepo.getStarred(),
        tasks: this.taskRepo.getAllListed(),
        projects: this.projectRepo.getAllProjects(),
        projectSeconds: this.taskRepo.getProjectSecondsSince(since)
      };
    });
    // Kept like any task the sync brings, so starting it, its worklog and its
    // send all find the row. A project the lists do not hold is refused: the
    // task would be filed under nothing, and the next sync would retire it.
    ipcMain.handle(IPCChannel.FETCH_TASK_BY_KEY, async (_event, key: unknown): Promise<TaskDTO | null> => {
      if (typeof key !== 'string' || !key.trim()) throw new ArgumentException('Fetching needs a key.', 'key');
      if (!this.providerManager) throw new Error('No provider is running.');
      const task = await this.providerManager.getTaskByKey(key.trim());
      if (!task) return null;
      if (!this.projectRepo.getAllProjects().some(p => p.id === task.projectId)) {
        throw new ArgumentException(`${task.key} is in a project SprintTicker does not list. Refresh, then try again.`, 'key');
      }
      this.taskRepo.saveTask(task);
      return this.taskRepo.getTaskById(task.id) ?? task;
    });
    ipcMain.handle(IPCChannel.GET_RECENT_TASKS, async (): Promise<TaskDTO[]> => this.taskRepo.getRecent(RECENT_TASKS_LIMIT));

    ipcMain.handle(IPCChannel.RENAME_AD_HOC_TASK, async (_event, taskId: unknown, title: unknown) => {
      if (typeof taskId !== 'string' || !taskId) throw new ArgumentException('A task id is required.', 'taskId');
      this.engine.renameAdHocTask(taskId, checkAdHocTitle(title));
    });

    ipcMain.handle(IPCChannel.GET_WORKLOGS_RANGE, async (_event, from: unknown, to: unknown) => {
      if (!isDateKey(from) || !isDateKey(to) || from > to) throw new ArgumentException('A range needs two days, YYYY-MM-DD, the first not after the second.');
      return this.worklogRepo.getWorklogsBetween(from, to);
    });

    // Check my week (P9d): what moved in a closed week after it closed; null while it is open.
    ipcMain.handle(IPCChannel.GET_WEEK_CHANGES, async (_event, day: unknown): Promise<WeekChangeDTO[] | null> => {
      if (!isDateKey(day)) throw new ArgumentException('A week is named by one of its days, YYYY-MM-DD.');
      const monday = weekStartKey(day);
      const closedAt = this.contextScheduleService.weekClosedAt(monday);
      if (!closedAt) return null;
      return this.worklogRepo.getQueuedChangesBetween(monday, addLocalDays(monday, 6), closedAt.toISOString());
    });

    // The window names the days; main writes the file, where the user says.
    ipcMain.handle(IPCChannel.EXPORT_WORKLOGS_CSV, async (_event, from: unknown, to: unknown): Promise<string | null> => {
      if (!isDateKey(from) || !isDateKey(to) || from > to) throw new ArgumentException('A range needs two days, YYYY-MM-DD, the first not after the second.');
      const csv = worklogsToCsv(this.worklogRepo.getWorklogsBetween(from, to));
      const win = this.getWindow();
      if (!win) return null;
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        title: 'Export the worklogs as CSV',
        defaultPath: `sprintticker-${from}-to-${to}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      });
      if (canceled || !filePath) return null;
      await fs.promises.writeFile(filePath, csv, 'utf-8');
      return filePath;
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

    // 3. The bar's inputs have one meaning each since P14b, so there is no
    // binding to read or save (the old `hardware_bindings` setting is unread).

    ipcMain.handle(IPCChannel.INJECT_REMOTE_KEY, async (_event, payload: string | { key: string }) => {
      const key = typeof payload === 'string' ? payload : payload?.key;
      if (!key) return false;
      // The bridge answers a boolean, and a rejection would reach the renderer
      // as an opaque IPC error. The key has already been handled locally by
      // the time the driver can fail -- only its forwarding to the device was
      // refused -- so `false` is the honest answer.
      try {
        await this.driver.injectRemoteKey(key);
        return true;
      } catch (err) {
        console.warn('[IPC] Remote key was not forwarded to the device:', err);
        return false;
      }
    });

    // 4. Device Status & Config IPC Handlers
    ipcMain.handle(IPCChannel.GET_DEVICE_STATUS, async () => {
      return this.driver.getDeviceStatus();
    });

    ipcMain.handle(IPCChannel.GET_DEVICE_CONFIG, async () => {
      const stored = this.settingsRepo.getSetting<DeviceConfigDTO>(
        DEVICE_CONFIG_SETTING_KEY,
        DEFAULT_DEVICE_CONFIG
      );
      // Spread over the defaults rather than returning `stored` directly: a row
      // written before the address and token existed has neither key, and
      // handing the renderer `undefined` puts it straight into an input.
      return { ...DEFAULT_DEVICE_CONFIG, ...stored };
    });

    ipcMain.handle(IPCChannel.SET_DEVICE_CONFIG, async (_event, config: DeviceConfigDTO) => {
      const host = (config.ipAddress ?? '').trim();
      // Validated here, not only in the renderer. A host with a slash or an `@`
      // is concatenated into `http://${host}/api/...` and silently retargets
      // every device request at another origin.
      if (!isValidDeviceHost(host)) {
        throw new ArgumentException(
          `'${config.ipAddress}' is not a valid device address. Use an IPv4 address or a hostname, with no scheme, port or path.`
        );
      }

      const previous = this.settingsRepo.getSetting<DeviceConfigDTO>(
        DEVICE_CONFIG_SETTING_KEY,
        DEFAULT_DEVICE_CONFIG
      );
      const next: DeviceConfigDTO = {
        ...DEFAULT_DEVICE_CONFIG,
        ...config,
        // A boolean whatever arrived: anything but an explicit false keeps the
        // bar, which is the safe reading of a malformed payload.
        enabled: config.enabled !== false,
        ipAddress: host,
        apiToken: config.apiToken ?? ''
      };

      this.settingsRepo.setSetting(DEVICE_CONFIG_SETTING_KEY, next);
      this.renderer.setShowIdleClockFallback(next.showIdleClockFallback);

      // Persist first, then reconnect. If the new address does not answer, the
      // user still has the value they typed to correct -- discarding it on a
      // failed connection would make a typo cost the whole entry, and an
      // address that is right but temporarily down is not a wrong address.
      const targetChanged =
        (previous.ipAddress ?? DEFAULT_DEVICE_CONFIG.ipAddress) !== next.ipAddress ||
        (previous.apiToken ?? '') !== next.apiToken;

      const enabledChanged = (previous.enabled !== false) !== next.enabled;
      const retarget = async (): Promise<void> => {
        if (!targetChanged) return;
        console.log(`[IPC] Device address changed to ${next.ipAddress}. Reconnecting.`);
        await this.driver.reconfigure({ ipAddress: next.ipAddress, apiToken: next.apiToken });
      };

      // Ordered so the driver never dials an address it is about to stop
      // using: turning the bar off happens before a retarget, turning it on
      // after one, so it comes up on the new address and nowhere else.
      if (enabledChanged && !next.enabled) await this.driver.setEnabled(false);
      await retarget();
      if (enabledChanged && next.enabled) await this.driver.setEnabled(true);

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
      const refusal = checkScheduleSettings(settings);
      if (refusal) throw new ArgumentException(refusal, 'settings');
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

    ipcMain.handle(IPCChannel.GET_RESUME_PROMPT, async () => this.contextScheduleService.getResumePrompt());

    ipcMain.handle(IPCChannel.ANSWER_RESUME_PROMPT, async (_event, resume: unknown, addGapMinutes: unknown, workedThrough: unknown) => {
      if (typeof resume !== 'boolean') {
        throw new ArgumentException(`The answer must be true or false, got ${String(resume)}.`, 'resume');
      }
      if (addGapMinutes !== undefined && (typeof addGapMinutes !== 'number' || !Number.isFinite(addGapMinutes) || addGapMinutes < 0)) {
        throw new ArgumentException(`The gap must be a number of minutes, got ${String(addGapMinutes)}.`, 'addGapMinutes');
      }
      if (workedThrough !== undefined && typeof workedThrough !== 'boolean') {
        throw new ArgumentException(`"Worked through it" must be true or false, got ${String(workedThrough)}.`, 'workedThrough');
      }
      return this.contextScheduleService.answerResumePrompt(resume, addGapMinutes ?? 0, workedThrough ?? false);
    });

    ipcMain.handle(IPCChannel.TRIGGER_EOD_WRAP_UP, async (_event, options: unknown) => {
      const shutdown = typeof options === 'object' && options !== null && (options as { shouldShutdown?: unknown }).shouldShutdown === true;
      this.contextScheduleService.closeEodPrompt();
      // A shutdown asked for earlier and not yet gone is this one's to replace.
      await this.endDayShutdown.cancel();

      // Open editors save first, before anything can shut the machine down.
      let savedVSCode = false;
      try {
        const editorSaveResult = await this.systemAutomationService.saveOpenEditors();
        savedVSCode = editorSaveResult.isSaved;
      } catch (err) {
        console.warn('[EOD] Editor save error:', err);
      }

      // Through the schedule service, which drops the restarts first: a
      // stand-up ended by the wrap-up must not bring its task back overnight.
      // The shutdown waits for Undo to pass and the queue to answer (S17).
      const startShutdown = () => {
        this.endDayShutdown.start().catch(err => console.error('[EOD] The shutdown failed:', err));
      };
      const stop = () => this.contextScheduleService.stopForWrapUp();
      if (this.undo) {
        endDayUndoably({ db: this.worklogRepo.getConnection().getDb(), undo: this.undo, engine: this.engine }, stop, {
          ...(shutdown ? { onCommit: startShutdown } : {}),
          onUndo: () => { void this.endDayShutdown.cancel(); }
        });
      } else {
        stop();
        if (shutdown) startShutdown();
      }

      // The bar's completion screen, then the display goes back once it is over.
      this.renderer.renderEodCompleted();
      //
      // The test branch releases at once instead. Audit F-35 flagged this shape
      // as test logic in production code, and it is -- kept because the
      // alternative is worse: a timer of seconds either leaves a handle open past the
      // end of the run, or makes every EOD test wait out five real seconds.
      // What differs between the branches is only *when* the lock is released,
      // never whether, so no assertion here depends on the branch it took.
      if (process.env.NODE_ENV !== 'test') {
        setTimeout(() => {
          try {
            // The release hands the display back itself; see CANCEL below.
            this.priorityEngine.releaseActiveLock('eodWrapUpPriority');
          } catch {
            // Ignore if app closed
          }
        }, EOD_COMPLETE_DISPLAY_SECONDS * 1000);
      } else {
        this.priorityEngine.releaseActiveLock('eodWrapUpPriority');
      }

      return { success: true, savedVSCode };
    });

    ipcMain.handle(IPCChannel.CANCEL_EOD_WRAP_UP, async () => {
      this.contextScheduleService.closeEodPrompt();
      this.priorityEngine.releaseActiveLock('standupPromptPriority');
      this.priorityEngine.releaseActiveLock('eodWrapUpPriority');
      await this.endDayShutdown.cancel();
      // Nothing drawn here: a release that frees the lock it names hands the
      // display back itself, and one that does not leaves it with whoever
      // holds it. Drawing the session after it drew idle twice -- two clears
      // of the device's screen (CLAUDE.md §5); seen on the real bar on
      // 2026-10-15 as a removal of a frame already gone.
      return true;
    });

    ipcMain.handle(IPCChannel.GET_WEEK_ENDED, async () => this.contextScheduleService.getWeekEnded());
    ipcMain.handle(IPCChannel.GET_LAST_WEEK_CLOSED, async () => this.contextScheduleService.getLastWeekClosed());

    ipcMain.handle(IPCChannel.DISMISS_WEEK_ENDED, async () => {
      this.contextScheduleService.dismissWeekEnded();
      return true;
    });

    // `joinedAt`: "joined 5 min ago", an ISO time; absent, now (P8c2).
    ipcMain.handle(IPCChannel.JOIN_STANDUP, async (_event, joinedAt: unknown) => {
      if (joinedAt === undefined || joinedAt === null) {
        this.contextScheduleService.joinStandup();
        return true;
      }
      const at = typeof joinedAt === 'string' ? new Date(joinedAt) : null;
      if (!at || !Number.isFinite(at.getTime())) {
        throw new ArgumentException(`When you joined must be a time, got ${String(joinedAt)}.`, 'joinedAt');
      }
      this.contextScheduleService.joinStandup(at);
      return true;
    });

    ipcMain.handle(IPCChannel.ANSWER_LUNCH_QUESTION, async (_event, start: unknown) => {
      if (typeof start !== 'boolean') {
        throw new ArgumentException(`The answer must be true or false, got ${String(start)}.`, 'start');
      }
      return this.contextScheduleService.answerLunchQuestion(start);
    });

    ipcMain.handle(IPCChannel.GET_STANDUP_TASK, async () => this.contextScheduleService.getStandupTask());
    ipcMain.handle(IPCChannel.SET_STANDUP_TASK, async (_event, task: unknown) => {
      this.contextScheduleService.setStandupTask(task as StandupTaskDTO | null);
      return true;
    });

    // Skip today. The release hands the display back itself: rendering the
    // session after it drew twice (CLAUDE.md §5).
    ipcMain.handle(IPCChannel.CANCEL_STANDUP_PROMPT, async () => {
      this.contextScheduleService.skipStandup();
      return true;
    });

    ipcMain.handle(IPCChannel.GET_CEREMONY_PROMPT, async () => this.contextScheduleService.getCeremonyPrompt());

    ipcMain.handle(IPCChannel.GET_REMINDER, async () => this.reminders?.getReminder() ?? null);
    ipcMain.handle(IPCChannel.DISMISS_REMINDER, async (_event, id: unknown) => {
      if (typeof id !== 'string' || id === '') throw new ArgumentException(`Not a reminder: ${String(id)}.`, 'id');
      return this.reminders?.dismiss(id) ?? false;
    });

    ipcMain.handle(IPCChannel.GET_MORNING, async () => this.morning?.getMorning() ?? null);
    ipcMain.handle(IPCChannel.MORNING_SEEN, async () => {
      this.morning?.markSeen();
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
      this.contextScheduleService.chooseMode(mode === 'LUNCH' || mode === 'AWAY' ? mode : 'WORK');
      return true;
    });

    ipcMain.handle(IPCChannel.GET_USER_MODE, async () => {
      return this.priorityEngine.getUserMode();
    });

    // 7. Task Provider Config IPC Handlers
    ipcMain.handle(IPCChannel.GET_PROVIDER_CAPABILITIES, async (): Promise<ProviderCapabilitiesDTO> => {
      if (this.providerManager) return this.providerManager.getActiveCapabilities();
      // No providers wired (a test, or a start that failed before them):
      // claim nothing, so the window offers nothing that would fail.
      return {
        providerId: this.settingsRepo.getSetting(
          ProviderSettingKey.ACTIVE_PROVIDER_ID,
          PROVIDER_SETTING_DEFAULTS[ProviderSettingKey.ACTIVE_PROVIDER_ID]
        ),
        canAssign: false,
        canTransition: false,
        canFindWorklog: false,
        canFetchByKey: false,
        hasHolidays: false
      };
    });

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
      const opTaskScope = read(ProviderSettingKey.OP_TASK_SCOPE);
      const opTaskQuery = read(ProviderSettingKey.OP_TASK_QUERY);
      const jiraSite = read(ProviderSettingKey.JIRA_SITE);
      const jiraEmail = read(ProviderSettingKey.JIRA_EMAIL);
      const jiraApiToken = this.secrets.getSecret(ProviderSettingKey.JIRA_API_TOKEN);
      const jiraTaskScope = read(ProviderSettingKey.JIRA_TASK_SCOPE);
      const jiraTaskQuery = read(ProviderSettingKey.JIRA_TASK_QUERY);
      const jiraTransitionInProgress = read(ProviderSettingKey.JIRA_TRANSITION_IN_PROGRESS);
      const jiraTransitionToTest = read(ProviderSettingKey.JIRA_TRANSITION_TO_TEST);
      const jiraTransitionToReview = read(ProviderSettingKey.JIRA_TRANSITION_TO_REVIEW);
      const jiraCompletionAction = read(ProviderSettingKey.JIRA_COMPLETION_ACTION);

      return {
        activeProviderId: activeId,
        fallbackTicketKey: fallbackKey,
        opDomain,
        opApiKey,
        opStatusInProgress,
        opStatusToTest,
        opStatusToReview,
        opCompletionAction,
        opTaskScope,
        opTaskQuery,
        jiraSite,
        jiraEmail,
        jiraApiToken,
        jiraTaskScope,
        jiraTaskQuery,
        jiraTransitionInProgress,
        jiraTransitionToTest,
        jiraTransitionToReview,
        jiraCompletionAction,
        providers: selectableProviders()
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
      opTaskScope?: string;
      opTaskQuery?: string;
      jiraSite?: string;
      jiraEmail?: string;
      jiraApiToken?: string;
      jiraTaskScope?: string;
      jiraTaskQuery?: string;
      jiraTransitionInProgress?: string;
      jiraTransitionToTest?: string;
      jiraTransitionToReview?: string;
      jiraCompletionAction?: string;
    }) => {
      if (payload.providerId) this.settingsRepo.setSetting('active_provider_id', payload.providerId);
      if (payload.fallbackTicketKey) this.settingsRepo.setSetting('fallback_ticket_key', payload.fallbackTicketKey);
      if (payload.opDomain !== undefined) this.settingsRepo.setSetting('op_domain', payload.opDomain);
      if (payload.opApiKey !== undefined) this.secrets.setSecret(ProviderSettingKey.OP_API_KEY, payload.opApiKey);
      if (payload.opStatusInProgress !== undefined) this.settingsRepo.setSetting('op_status_in_progress', payload.opStatusInProgress);
      if (payload.opStatusToTest !== undefined) this.settingsRepo.setSetting('op_status_to_test', payload.opStatusToTest);
      if (payload.opStatusToReview !== undefined) this.settingsRepo.setSetting('op_status_to_review', payload.opStatusToReview);
      if (payload.opCompletionAction !== undefined) this.settingsRepo.setSetting('op_completion_action', payload.opCompletionAction);
      // Stored through parseTaskScope so a value from an older renderer, or a
      // hand-edited row, cannot leave the provider with a scope it does not
      // recognise.
      if (payload.opTaskScope !== undefined) {
        this.settingsRepo.setSetting(ProviderSettingKey.OP_TASK_SCOPE, parseTaskScope(payload.opTaskScope));
      }
      if (payload.opTaskQuery !== undefined) this.settingsRepo.setSetting(ProviderSettingKey.OP_TASK_QUERY, payload.opTaskQuery);

      if (payload.jiraSite !== undefined) this.settingsRepo.setSetting(ProviderSettingKey.JIRA_SITE, payload.jiraSite);
      if (payload.jiraEmail !== undefined) this.settingsRepo.setSetting(ProviderSettingKey.JIRA_EMAIL, payload.jiraEmail);
      // Encrypted at rest, like the OpenProject key.
      if (payload.jiraApiToken !== undefined) this.secrets.setSecret(ProviderSettingKey.JIRA_API_TOKEN, payload.jiraApiToken);
      if (payload.jiraTaskScope !== undefined) {
        this.settingsRepo.setSetting(ProviderSettingKey.JIRA_TASK_SCOPE, parseTaskScope(payload.jiraTaskScope));
      }
      if (payload.jiraTaskQuery !== undefined) this.settingsRepo.setSetting(ProviderSettingKey.JIRA_TASK_QUERY, payload.jiraTaskQuery);
      if (payload.jiraTransitionInProgress !== undefined) this.settingsRepo.setSetting(ProviderSettingKey.JIRA_TRANSITION_IN_PROGRESS, payload.jiraTransitionInProgress);
      if (payload.jiraTransitionToTest !== undefined) this.settingsRepo.setSetting(ProviderSettingKey.JIRA_TRANSITION_TO_TEST, payload.jiraTransitionToTest);
      if (payload.jiraTransitionToReview !== undefined) this.settingsRepo.setSetting(ProviderSettingKey.JIRA_TRANSITION_TO_REVIEW, payload.jiraTransitionToReview);
      if (payload.jiraCompletionAction !== undefined) this.settingsRepo.setSetting(ProviderSettingKey.JIRA_COMPLETION_ACTION, payload.jiraCompletionAction);

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
        // Deliberately not awaited: a full pass on a slow instance would hold
        // the Save button open for as long as it took. The renderer learns the
        // outcome from ON_PROJECTS_UPDATED instead.
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

    // 8. Worklogs IPC Handlers
    ipcMain.handle(IPCChannel.GET_TODAYS_WORKLOGS, async () => {
      return this.worklogRepo.getTodaysWorklogs();
    });

    // A correction changes the worklog here at once and queues it for the
    // provider; both answer with what the window should show next. The
    // service validates, and its refusal reaches the window as the error.
    ipcMain.handle(IPCChannel.UPDATE_WORKLOG, async (_event, worklogId: unknown, correction: unknown) => {
      if (!this.worklogCorrections) throw new Error('Worklog corrections are unavailable.');
      if (typeof worklogId !== 'string' || !isWorklogCorrection(correction)) {
        throw new ArgumentException('A correction needs a worklog id, a duration, a start and a comment.');
      }
      const edits = this.worklogEdits();
      const corrected = edits ? correctUndoably(edits, worklogId, correction) : this.worklogCorrections.correct(worklogId, correction);
      this.broadcast(IPCChannel.ON_WORKLOGS_UPDATED, this.worklogRepo.getTodaysWorklogs());
      return corrected;
    });

    ipcMain.handle(IPCChannel.MOVE_WORKLOG, async (_event, worklogId: unknown, taskId: unknown) => {
      if (!this.worklogCorrections) throw new Error('Worklog corrections are unavailable.');
      if (typeof worklogId !== 'string' || !worklogId || typeof taskId !== 'string' || !taskId) {
        throw new ArgumentException('A move needs a worklog id and a task id.');
      }
      const edits = this.worklogEdits();
      const moved = edits ? moveUndoably(edits, worklogId, taskId) : this.worklogCorrections.reassign(worklogId, taskId);
      this.broadcast(IPCChannel.ON_WORKLOGS_UPDATED, this.worklogRepo.getTodaysWorklogs());
      return moved;
    });

    // One entry refused (P11c): Today's card lists them; Keep off ends one here.
    ipcMain.handle(IPCChannel.GET_REFUSED_WORKLOGS, async () => this.worklogRepo.getRefusedWorklogs());
    ipcMain.handle(IPCChannel.KEEP_WORKLOG_OFF, async (_event, worklogId: unknown) => {
      if (!this.worklogCorrections) throw new Error('Worklog corrections are unavailable.');
      if (typeof worklogId !== 'string' || !worklogId) throw new ArgumentException('Keeping an entry off needs its worklog id.');
      const edits = this.worklogEdits();
      const kept = edits ? keepOffUndoably(edits, worklogId) : this.worklogCorrections.keepOff(worklogId);
      this.broadcast(IPCChannel.ON_WORKLOGS_UPDATED, this.worklogRepo.getTodaysWorklogs());
      return kept;
    });

    ipcMain.handle(IPCChannel.CREATE_MANUAL_WORKLOG, async (_event, entry: unknown) => {
      if (!this.worklogCorrections) throw new Error('Worklog corrections are unavailable.');
      if (!isManualWorklog(entry)) throw new ArgumentException('Added time needs a task, a duration, a start and a note.');
      const edits = this.worklogEdits();
      const added = edits ? addUndoably(edits, entry) : this.worklogCorrections.add(entry);
      this.broadcast(IPCChannel.ON_WORKLOGS_UPDATED, this.worklogRepo.getTodaysWorklogs());
      return added;
    });

    // Split in two (S16c): the entry shortened, then the rest on the task chosen, both through the queue.
    ipcMain.handle(IPCChannel.SPLIT_WORKLOG, async (_event, worklogId: unknown, atUtc: unknown, taskId: unknown) => {
      if (!this.worklogCorrections) throw new Error('Worklog corrections are unavailable.');
      if (typeof worklogId !== 'string' || !worklogId || typeof atUtc !== 'string' || typeof taskId !== 'string' || !taskId) {
        throw new ArgumentException('A split needs a worklog id, a moment and a task id.');
      }
      const edits = this.worklogEdits();
      const pieces = edits ? splitUndoably(edits, worklogId, { atUtc, taskId }) : this.worklogCorrections.split(worklogId, { atUtc, taskId });
      this.broadcast(IPCChannel.ON_WORKLOGS_UPDATED, this.worklogRepo.getTodaysWorklogs());
      return pieces;
    });

    ipcMain.handle(IPCChannel.DELETE_WORKLOG, async (_event, worklogId: unknown) => {
      if (!this.worklogCorrections) throw new Error('Worklog corrections are unavailable.');
      if (typeof worklogId !== 'string') throw new ArgumentException('A deletion needs a worklog id.');
      const edits = this.worklogEdits();
      if (edits) deleteUndoably(edits, worklogId);
      else this.worklogCorrections.remove(worklogId);
      this.broadcast(IPCChannel.ON_WORKLOGS_UPDATED, this.worklogRepo.getTodaysWorklogs());
      return true;
    });

    // 9. Provider events & Windows Notification Listener IPC Handlers
    ipcMain.handle(IPCChannel.GET_PROVIDER_EVENT_SETTINGS, async () => this.providerEvents.getSettings());
    ipcMain.handle(IPCChannel.SAVE_PROVIDER_EVENT_SETTINGS, async (_event, settings: ProviderEventSettingsDTO) =>
      this.providerEvents.saveSettings(settings)
    );
    ipcMain.handle(IPCChannel.TEST_PROVIDER_EVENTS, async () => this.providerEvents.sendTest());

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

    // 10. Hardware Display Animation & Screen Emulator IPC Handlers
    ipcMain.handle(IPCChannel.GET_DISPLAY_STATE, async () => {
      return this.renderer.getDisplayState();
    });

    ipcMain.handle(IPCChannel.GET_SCREEN_ICON, async () => this.renderer.getScreenIcon());

    ipcMain.handle(IPCChannel.SET_COLOR_THEME, async (_event, theme: unknown) => {
      if (!isColorThemeId(theme)) throw new ArgumentException('Not a key colour.', 'theme');
      this.settingsRepo.setSetting(COLOR_THEME_KEY, theme);
      this.renderer.setColorTheme(theme);
      return true;
    });

    ipcMain.handle(IPCChannel.GET_COLOR_THEME, async (): Promise<ColorThemeId> => {
      const stored = this.settingsRepo.getSetting<unknown>(COLOR_THEME_KEY, DEFAULT_COLOR_THEME);
      return isColorThemeId(stored) ? stored : DEFAULT_COLOR_THEME;
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
        case 'TASK_SELECTION':
          this.renderer.renderTaskSelection('TASK', 'Implement dash', {
            description: 'PROJ-142 Dash that cancels into a slide',
            position: { index: 2, count: 12 },
            status: 'in_progress'
          });
          return true;
        case 'TASK_LOGGED':
          // The scene alone: stopping a real session to see it would log time.
          this.renderer.renderTaskLogged();
          return true;
        default:
          throw new ArgumentException(`Unknown preview screen: ${String(screen)}`);
      }
    });

    // 11. Diagnostics Handlers
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

    // 12. Update Handlers. A notification only: nothing is downloaded or
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

    ipcMain.handle(IPCChannel.GET_SYSTEM_LOCALE, async (): Promise<string> => app.getSystemLocale());

    // Mini timer. Without a controller (tests, or a build that has none) it is
    // simply never open.
    ipcMain.handle(IPCChannel.MINI_TOGGLE, async (): Promise<boolean> => this.miniWindow?.toggle() ?? false);
    ipcMain.handle(IPCChannel.MINI_IS_OPEN, async (): Promise<boolean> => this.miniWindow?.isOpen() ?? false);
    ipcMain.handle(IPCChannel.OPEN_TASK_PICKER, async (): Promise<boolean> =>
      this.pickerWindow ? this.pickerWindow.open('start') : openTaskPickerInMainWindow(this.getWindow()));
    ipcMain.handle(IPCChannel.OPEN_ASSIGN_PICKER, async (): Promise<boolean> =>
      this.pickerWindow ? this.pickerWindow.open('assign') : openTaskPickerInMainWindow(this.getWindow(), undefined, 'assign'));
    // The mini timer's ↳ (P12d): which task the running interruption goes
    // to. Without the picker window, Today's interruption card asks the same.
    ipcMain.handle(IPCChannel.OPEN_PLACE_PICKER, async (): Promise<boolean> =>
      this.pickerWindow ? this.pickerWindow.open('place') : openWindowOn(this.getWindow(), 'today'));
    // What the mini timer shows when it is not the session (P12d): the
    // stand-up and where it goes back to, and whether nothing timing is news.
    ipcMain.handle(IPCChannel.GET_STANDUP_RUNNING, async (): Promise<StandupRunningDTO | null> =>
      this.contextScheduleService?.standupRunning() ?? null);
    ipcMain.handle(IPCChannel.GET_WORKING_NOW, async (): Promise<boolean> => this.isWorkingNow?.() ?? false);
    this.miniWindow?.subscribe(open => this.broadcast(IPCChannel.ON_MINI_VISIBILITY, open));

    ipcMain.handle(IPCChannel.GET_ONLY_PROJECTS_WITH_TASKS, async (): Promise<boolean> =>
      this.settingsRepo.getSetting<boolean>(ONLY_PROJECTS_WITH_TASKS_KEY, ONLY_PROJECTS_WITH_TASKS_DEFAULT)
    );

    // Broadcast, because the switch appears in two views of the window and
    // the bar's picker reads it too: flipped in one, the others follow.
    ipcMain.handle(IPCChannel.SET_ONLY_PROJECTS_WITH_TASKS, async (_event, enabled: boolean): Promise<boolean> => {
      if (typeof enabled !== 'boolean') {
        throw new ArgumentException(`Expected a boolean, received: ${String(enabled)}`);
      }
      this.settingsRepo.setSetting(ONLY_PROJECTS_WITH_TASKS_KEY, enabled);
      this.broadcast(IPCChannel.ON_ONLY_PROJECTS_WITH_TASKS, enabled);
      return enabled;
    });

    ipcMain.handle(IPCChannel.GET_TASK_VISIBILITY, async (): Promise<TaskVisibility> => readTaskVisibility(this.settingsRepo));

    // Broadcast for the same reason as the switch above.
    ipcMain.handle(IPCChannel.SET_TASK_VISIBILITY, async (_event, visibility: unknown): Promise<TaskVisibility> => {
      if (!isTaskVisibility(visibility)) {
        throw new ArgumentException(`Expected { unassigned: boolean, others: boolean }, received: ${JSON.stringify(visibility)}`);
      }
      const stored: TaskVisibility = { unassigned: visibility.unassigned, others: visibility.others };
      this.settingsRepo.setSetting(TASK_VISIBILITY_KEY, stored);
      this.broadcast(IPCChannel.ON_TASK_VISIBILITY, stored);
      return stored;
    });

    ipcMain.handle(IPCChannel.GET_LAUNCH_AT_LOGIN, async () => {
      return this.launchAtLogin ? this.launchAtLogin.getStatus() : LAUNCH_AT_LOGIN_UNAVAILABLE;
    });

    ipcMain.handle(IPCChannel.SET_LAUNCH_AT_LOGIN, async (_event, enabled: unknown) => {
      if (typeof enabled !== 'boolean') throw new ArgumentException('Starting with Windows is on or off.', 'enabled');
      return this.launchAtLogin ? this.launchAtLogin.setEnabled(enabled) : LAUNCH_AT_LOGIN_UNAVAILABLE;
    });

    // The global shortcuts (P12e): four chords, one service.
    ipcMain.handle(IPCChannel.GET_SHORTCUTS, async (): Promise<ShortcutsStatusDTO> =>
      this.shortcuts ? this.shortcuts.getStatus() : SHORTCUTS_UNAVAILABLE);

    ipcMain.handle(IPCChannel.SET_SHORTCUT, async (_event, action: unknown, chord: unknown): Promise<ShortcutsStatusDTO> => {
      if (typeof action !== 'string') throw new ArgumentException('Which shortcut?', 'action');
      if (!chord || typeof chord !== 'object') throw new ArgumentException('The shortcut is a setting.', 'chord');
      // The service validates the action and the fields, and refuses a chord it cannot register.
      return this.shortcuts ? this.shortcuts.set(action as ShortcutAction, chord as ShortcutChord) : SHORTCUTS_UNAVAILABLE;
    });

    ipcMain.handle(IPCChannel.SET_SHORTCUTS_RECORDING, async (_event, recording: unknown): Promise<ShortcutsStatusDTO> => {
      if (typeof recording !== 'boolean') throw new ArgumentException('Recording is on or off.', 'recording');
      return this.shortcuts ? this.shortcuts.setRecording(recording) : SHORTCUTS_UNAVAILABLE;
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

    // Only the URL main builds from the provider's own site is opened: the
    // renderer names a task, never a URL. Checked once more here, since
    // shell.openExternal launches whatever protocol handler it is given.
    ipcMain.handle(IPCChannel.OPEN_TASK_PAGE, async (_event, taskId: unknown): Promise<boolean> => {
      if (typeof taskId !== 'string' || !taskId) {
        throw new ArgumentException(`Expected a task id, received: ${String(taskId)}`);
      }
      const url = this.engine.taskPageUrl(taskId);
      if (!url || !/^https?:\/\//i.test(url)) return false;
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

    this.renderer.onScreenIconChanged((icon) => {
      this.broadcast(IPCChannel.ON_SCREEN_ICON, icon);
    });

    // Every committed sync, the five-minute one included: the window only
    // heard of the ones it asked for, so a task added or renamed on the
    // provider appeared when the user changed views, not when it arrived.
    this.syncWorker?.onSynced(result => this.broadcastProjects(result));
    this.syncWorker?.onHealthChanged(health => this.broadcast(IPCChannel.ON_SYNC_HEALTH, health));
    this.syncWorker?.onEntryRefused(() => this.broadcast(IPCChannel.ON_WORKLOGS_UPDATED, this.worklogRepo.getTodaysWorklogs()));

    this.priorityEngine.onUserModeChanged((mode) => {
      this.broadcast(IPCChannel.ON_USER_MODE_UPDATED, mode);
    });

    this.driver.on('statusChanged', (status: DeviceStatusDTO) => {
      this.broadcast(IPCChannel.ON_DEVICE_STATUS_CHANGED, status);
    });

    // Registered once. A second registration here sent every press to the
    // renderer twice, and the wrap-up modal counts presses: its two-step
    // confirmation took one START, and ran the wrap-up -- shutdown included,
    // when ticked -- on a single press.
    this.inputDecoder.registerActionHandler((action: string, inputKey: string) => {
      this.contextScheduleService.answerFromBar(action);
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

    // A worklog parked because the key was wrong should go out on the pass the
    // corrected key triggers, not sit for another sync interval. Entering
    // credentials is the only user action that can fix a permanent failure, so
    // it is the only sensible moment to un-park.
    if (this.syncWorker.requeueFailedWorklogs() > 0) {
      void this.syncWorker
        .processPendingQueue()
        .catch(err => console.error('[IPCHandlerRegistry] Draining the requeued worklogs failed:', err));
    }

    void this.syncWorker
      .syncTasksAndProjects()
      .then(result => {
        // A committed sync has told the window already, through onSynced.
        if (result.status !== 'synced') this.broadcastProjects(result);
      })
      .catch(err => {
        // syncTasksAndProjects reports failure in its result rather than by
        // throwing, so reaching here means a defect rather than an outage.
        console.error('[IPCHandlerRegistry] Provider sync threw unexpectedly:', err);
      });
  }

  private broadcastProjects(result: ProviderSyncResult): void {
    this.broadcast(IPCChannel.ON_PROJECTS_UPDATED, {
      result,
      projects: this.projectRepo.getAllProjects()
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
  /** Sends to every open window: the dashboard and, when open, the mini timer. */
  private broadcast(channel: string, payload: unknown): void {
    for (const win of this.getWindows()) {
      if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) continue;
      win.webContents.send(channel, payload);
    }
  }
}
