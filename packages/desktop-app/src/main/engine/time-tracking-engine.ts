import { EventEmitter } from 'events';
import { SessionRepository } from '../db/repositories/session-repository';
import { WorklogRepository } from '../db/repositories/worklog-repository';
import { TaskRepository, retireTasks } from '../db/repositories/task-repository';
import { ProjectRepository } from '../db/repositories/project-repository';
import { createId, IdPrefix, isAdHocTaskId } from '../db/id-generator';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { ActiveSessionDTO, TaskDTO, ProjectDTO, PauseIntervalDTO, ArgumentException, ArgumentNullException } from '../../shared/dtos';
import { workedSecondsUntil } from '../../shared/session-review';
import { addLocalDays, localDateKey } from '../../shared/local-date';
import { DEFAULT_SPLIT_PAUSE_MINUTES, mergeShortPieces, splitWork, workedSecondsByLocalDay, DayShare } from '../../shared/work-split';

import { ProviderManager } from '../providers/provider-manager';
import { PROVIDER_SETTING_DEFAULTS, ProviderSettingKey } from '../../shared/provider-settings';
import { OfflineSyncWorker } from '../sync/offline-sync-worker';
import { OWN_PROJECT_PROVIDER_ID, UNKNOWN_PROJECT_PROVIDER_ID } from '../../shared/local-provider';
import { WORKLOG_COMMENTS } from '../../shared/worklog-comments';
import { TaskOwnership, TaskOwnershipValue } from '../../shared/task-ownership';
import { TaskClaim, TaskClaimReport } from '../../shared/task-claim';
import { hasTaskPage } from '../../shared/task-page';
import { checkAdHocTitle, interruptionTitle } from '../../shared/interruption';
import { PREVIOUS_TASK_LOOKBACK, previousTaskId } from '../../shared/previous-task';
import { DEFAULT_START_SIDE_EFFECTS, StartSideEffectsSetting } from '../../shared/flow-settings';
import { SideEffectScheduler } from './side-effect-scheduler';

export type EngineState = 'Idle' | 'Tracking' | 'Paused';

export type SessionStateCallback = (session: ActiveSessionDTO | null) => void;

/** How a stop treats what it would send at once. */
export interface StopOptions {
  /**
   * Takes the Done transition instead of sending it, for a stop that can be
   * undone: it runs when the undo window ends, never after an undo.
   */
  holdRemote?: (send: () => void) => void;
}

/**
 * Core Time Tracking Engine managing finite state machine (Idle, Tracking, Paused),
 * absolute UTC timestamp delta calculations, crash/reboot resilience, and offline worklog buffering.
 */
export class TimeTrackingEngine extends EventEmitter {
  private _sessionRepo: SessionRepository;
  private _worklogRepo: WorklogRepository;
  private _taskRepo: TaskRepository;
  private _projectRepo: ProjectRepository;
  private _providerManager: ProviderManager;
  private _listeners: Set<SessionStateCallback> = new Set();
  private _currentSession: ActiveSessionDTO | null = null;
  /** Whose the tracked task was at the last sync, for the session it was read for. */
  private _trackedOwnership: { sessionId: string; owner: TaskOwnershipValue } | null = null;
  private _claimListeners: Set<(report: TaskClaimReport) => void> = new Set();
  private _tickTimer: NodeJS.Timeout | null = null;
  private _syncWorker: OfflineSyncWorker;
  private _initialized = false;
  private _splitPauseSeconds: () => number;
  private _sideEffects: SideEffectScheduler;
  private _startSideEffects: () => StartSideEffectsSetting;

  /**
   * Wires dependencies only. Deliberately free of side effects: call
   * `initialize()` to start the background sync worker and recover a session
   * left behind by a crash, and `dispose()` to shut both down.
   *
   * Constructing was previously enough to start a 5-minute timer and touch the
   * database, which made the engine impossible to build in a test without also
   * spawning a live worker.
   */
  constructor(
    sessionRepo?: SessionRepository,
    worklogRepo?: WorklogRepository,
    taskRepo?: TaskRepository,
    providerManager?: ProviderManager,
    projectRepo?: ProjectRepository,
    /** The pause, in seconds, that ends a worklog: the user's setting, read at each stop. */
    splitPauseSeconds: () => number = () => DEFAULT_SPLIT_PAUSE_MINUTES * 60,
    /** When starting a task moves and assigns it (`start_side_effects`), read at each start. */
    startSideEffects: () => StartSideEffectsSetting = () => DEFAULT_START_SIDE_EFFECTS
  ) {
    super();
    this._splitPauseSeconds = splitPauseSeconds;
    this._sideEffects = new SideEffectScheduler(startSideEffects);
    this._startSideEffects = startSideEffects;
    this._sessionRepo = sessionRepo || new SessionRepository();
    this._worklogRepo = worklogRepo || new WorklogRepository();
    this._taskRepo = taskRepo || new TaskRepository();
    // Must be injectable. A bare `new ProjectRepository()` resolves the
    // DatabaseConnection singleton regardless of the connection the other
    // repositories were given, so a test using an in-memory database still
    // opened -- and wrote -- a real on-disk sprintticker.db beside the
    // repo, and that second connection deadlocked schema migrations.
    this._projectRepo = projectRepo || new ProjectRepository();
    this._providerManager =
      providerManager ||
      new ProviderManager(new SettingsRepository(this._worklogRepo.getConnection()));

    this._syncWorker = new OfflineSyncWorker(
      this._providerManager,
      this._worklogRepo,
      this._projectRepo,
      this._taskRepo
    );
    // The tracked task outlives the provider's list until the session ends,
    // and the session says when it has left it.
    this._syncWorker.protectTasks(() => {
      const open = this._sessionRepo.getActiveSession();
      return open ? [open.taskId] : [];
    });
    this._syncWorker.onUnlistedChanged(() => {
      if (this._currentSession) this.notifyListeners();
    });
    this._syncWorker.onSynced(() => this.followTaskRename());
  }

  /**
   * Takes the tracked task's key and title from its row after a sync: a task
   * renamed, or moved to another Jira project -- which gives it a new key and
   * keeps its id -- kept its old names on the bar and in the window until the
   * session ended. Ad-hoc work is named by the user, not the provider.
   */
  private followTaskRename(): void {
    const open = this._currentSession ? this._sessionRepo.getActiveSession() : null;
    if (!open || open.isAdHoc || isAdHocTaskId(open.taskId)) return;
    const task = this._taskRepo.getTaskById(open.taskId);
    if (!task) return;
    // Whose it is moves without a rename, and the screens say so: a task
    // reassigned while it stays in progress is still listed, so the sync's
    // unlisted set -- which notifies on its own -- never changes for it.
    // The first sync of a session has nothing to compare with, and says so
    // only when the task is not the user's.
    const owner = task.ownership ?? TaskOwnership.MINE;
    const before = this._trackedOwnership?.sessionId === open.sessionId ? this._trackedOwnership.owner : TaskOwnership.MINE;
    const ownerChanged = owner !== before;
    this._trackedOwnership = { sessionId: open.sessionId, owner };
    const renamed = task.key !== open.taskKey || task.title !== open.taskTitle;
    if (renamed) {
      this._sessionRepo.renameSessionTask(open.sessionId, task.key, task.title);
      this._currentSession = this._sessionRepo.getActiveSession();
    }
    if (renamed || ownerChanged) this.notifyListeners();
  }

  /**
   * The sync worker this engine owns.
   *
   * Exposed so the IPC layer can start a sync when the user saves provider
   * credentials. Constructing a second worker there instead would give the
   * queue two dispatchers, which is the defect F-02 and F-03 were about.
   */
  public getSyncWorker(): OfflineSyncWorker {
    return this._syncWorker;
  }

  /**
   * Starts background work and restores any session interrupted by a crash.
   *
   * Separate from the constructor so ownership of the sync timer is explicit:
   * whoever calls `initialize()` is responsible for calling `dispose()`.
   * Idempotent.
   */
  public initialize(): ActiveSessionDTO | null {
    if (this._initialized) return this.getCurrentSession();
    this._initialized = true;

    this._syncWorker.start();
    return this.reconcileStartupState();
  }

  private startTickLoop(): void {
    if (this._tickTimer) return;
    this._tickTimer = setInterval(() => {
      try {
        const active = this.getCurrentSession();
        if (!active || active.status !== 'TRACKING') {
          this.stopTickLoop();
          return;
        }
        // One event per tick. `sessionUpdated` was emitted here and nowhere
        // else, with the same payload, and its only listener did exactly what
        // the `tick` listener did -- so every second produced two identical
        // renders, two asset uploads, two draws, and two IPC messages to the
        // renderer. Genuine state changes (start, pause, stop) render directly
        // from the IPC handlers and the input decoder, not from this loop.
        this.emit('tick', active);
        this.notifyListeners();
        this._sideEffects.onTick(active);
      } catch {
        this.stopTickLoop();
      }
    }, 1000);
  }

  private stopTickLoop(): void {
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
  }

  /// <summary>
  /// Disposes background interval timers and sync worker.
  /// </summary>
  public dispose(): void {
    this._initialized = false;
    this.stopTickLoop();
    if (this._syncWorker) {
      this._syncWorker.stop();
    }
  }

  /// <summary>
  /// Reconciles unfinalized sessions on application startup to ensure reboot & crash resilience.
  /// </summary>
  public reconcileStartupState(): ActiveSessionDTO | null {
    const active = this._sessionRepo.getActiveSession();
    if (!active) {
      this.stopTickLoop();
      this._currentSession = null;
      return null;
    }

    // If session was in TRACKING state during app crash/reboot, calculate accurate elapsed time
    this._currentSession = active;
    if (active.status === 'TRACKING') {
      this.startTickLoop();
    } else {
      this.stopTickLoop();
    }
    this.notifyListeners();
    return this._currentSession;
  }

  /// <summary>
  /// Subscribes a listener callback to engine state transitions.
  /// </summary>
  public subscribe(callback: SessionStateCallback): () => void {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  private notifyListeners(): void {
    const sessionCopy = this.getCurrentSession();
    for (const listener of this._listeners) {
      try {
        listener(sessionCopy);
      } catch (err) {
        console.error('[TimeTrackingEngine] Error in session state listener:', err);
      }
    }
  }

  /**
   * The task to switch back to -- see `shared/previous-task.ts`. Null when
   * nothing earlier can be offered.
   */
  public getPreviousTask(): TaskDTO | null {
    const open = this._currentSession && this._currentSession.status !== 'COMPLETED' ? this._currentSession : null;
    const taskId = previousTaskId({
      currentTaskId: open?.taskId ?? null,
      storedPreviousTaskId: open ? this._sessionRepo.getPreviousTaskId(open.sessionId) : null,
      recentEndedTaskIds: this._sessionRepo.getRecentEndedTaskIds(PREVIOUS_TASK_LOOKBACK),
      isOffered: id => this._taskRepo.isOffered(id)
    });
    return taskId ? this._taskRepo.getTaskById(taskId) : null;
  }

  /// <summary>
  /// Gets current active session with live calculated UTC elapsed time.
  /// </summary>
  public getCurrentSession(): ActiveSessionDTO | null {
    if (!this._currentSession) return null;
    const session = this._sessionRepo.getActiveSession();
    if (session && this.hasLeftTheList(session)) {
      // Listed as a teammate's is seen, not inferred: it is open, and theirs.
      const someoneElses = this.isSomeoneElses(session);
      const reason = someoneElses ? 'reassigned' : this._syncWorker.unlistedReason(session.taskId);
      const ownerName = someoneElses ? this._taskRepo.getTaskById(session.taskId)?.assigneeName : undefined;
      return {
        ...session,
        taskUnlisted: true,
        ...(reason ? { taskLeftBecause: reason } : {}),
        ...(ownerName ? { taskOwnerName: ownerName } : {})
      };
    }
    // An interruption not yet named nor assigned says so: read from its task
    // row, which naming it clears, so the session never holds a stale copy.
    if (session && (session.isAdHoc || isAdHocTaskId(session.taskId)) && this._taskRepo.getTaskById(session.taskId)?.unsorted) {
      return { ...session, unsorted: true };
    }
    return session;
  }

  /// <summary>
  /// Retrieves all cached projects from local SQLite storage.
  /// </summary>
  public getProjects(): ProjectDTO[] {
    return this._projectRepo.getAllProjects();
  }

  /// <summary>
  /// Retrieves all cached tasks for a given project from local SQLite storage.
  /// </summary>
  public getTasksForProject(projectId: string): TaskDTO[] {
    return this._taskRepo.getTasksByProjectId(projectId);
  }

  /**
   * The sync says so once it has seen the session's task missing; an archived
   * row says so at once. A task archived over lunch and restarted after it
   * would otherwise read as the user's own until the next sync, and finishing
   * it as done in between would move it without asking.
   */
  private hasLeftTheList(session: ActiveSessionDTO): boolean {
    if (this._syncWorker.isUnlisted(session.taskId)) return true;
    if (session.isAdHoc || isAdHocTaskId(session.taskId)) return false;
    return this._taskRepo.isArchived(session.taskId) || this.isSomeoneElses(session);
  }

  /**
   * The sync keeps a teammate's task in progress in the lists, so a task
   * reassigned mid-session can stay listed -- as theirs. It has left the
   * user's work all the same.
   */
  private isSomeoneElses(session: ActiveSessionDTO): boolean {
    return !session.isAdHoc && this._taskRepo.ownershipOf(session.taskId) === TaskOwnership.OTHER;
  }

  /** Seconds logged from `fromKey` to `toKey`, both local days and both included. */
  public getLoggedSeconds(fromKey: string, toKey: string): number {
    let total = 0;
    for (let day = fromKey; day <= toKey; day = addLocalDays(day, 1)) {
      for (const log of this._worklogRepo.getWorklogsByDate(day)) total += log.durationSeconds;
    }
    return total;
  }

  /**
   * Starts ad-hoc work under a name the app gives it, on the row already
   * made for that name when there is one. `startTask` reuses an ad-hoc row
   * only when handed its id, so the stand-up made a new one every morning.
   */
  public startNamedAdHocTask(title: string): ActiveSessionDTO {
    if (!title) throw new ArgumentException('An ad-hoc task needs a name.', 'title');
    return this.startTask(this._taskRepo.findAdHocTaskByTitle(title)?.id ?? '', true, title);
  }

  /**
   * Starts an interruption: a new ad-hoc task under the name the app makes up
   * for it, marked unsorted until the user names it or moves its time
   * (migration 13). Never an existing row -- two interruptions are two
   * things to sort, unlike the stand-up's one task a day.
   *
   * The session running is logged as any start logs it, under its own
   * comment. Bringing it back afterwards is the schedule service's
   * (`ContextScheduleService.interrupt`), which is the one caller.
   */
  public startInterruption(at: Date = new Date()): ActiveSessionDTO {
    if (this._currentSession && this._currentSession.status !== 'COMPLETED') {
      this.stopSession(WORKLOG_COMMENTS.INTERRUPTED);
    }
    const title = interruptionTitle(at);
    const task = this._taskRepo.createAdHocTask(title, this.adHocTaskKey(), true);
    return this.startTask(task.id, true, title);
  }

  /**
   * Names the open ad-hoc session -- an interruption, typically -- and its
   * task, so History shows the name too. The task row and the session's
   * copy change together: the open session copies its task's title, and a
   * rename of one alone would show two names. One notification, so one
   * redraw of the bar.
   *
   * @throws ArgumentException with no ad-hoc session open, or an empty name.
   */
  public renameAdHocSession(title: string): ActiveSessionDTO {
    const name = checkAdHocTitle(title);
    const open = this.getCurrentSession();
    if (!open || !(open.isAdHoc || isAdHocTaskId(open.taskId))) {
      throw new ArgumentException('Only ad-hoc work is named here; a provider task keeps its own name.', 'title');
    }
    this._taskRepo.renameAdHocTask(open.taskId, name);
    this._sessionRepo.renameSessionTask(open.sessionId, open.taskKey, name);
    this._currentSession = this._sessionRepo.getActiveSession();
    this.notifyListeners();
    return this.getCurrentSession()!;
  }

  /**
   * Names ad-hoc work after the fact, from History or the wrap-up: the task
   * row, so every worklog of it reads the new name, and clears its unsorted
   * mark. Local only: ad-hoc time was never sent. The open session's own
   * task is renamed through `renameAdHocSession`, so its copy of the title
   * follows and the bar redraws once.
   *
   * @throws ArgumentException for a provider's task, an unknown one, or an empty name.
   */
  public renameAdHocTask(taskId: string, title: string): void {
    const name = checkAdHocTitle(title);
    if (!taskId || !isAdHocTaskId(taskId)) {
      throw new ArgumentException('Only ad-hoc work is named here; a provider task keeps its own name.', 'taskId');
    }
    if (!this._taskRepo.getTaskById(taskId)) throw new ArgumentException(`No task ${taskId}.`, 'taskId');
    if (this.getCurrentSession()?.taskId === taskId) {
      this.renameAdHocSession(name);
      return;
    }
    this._taskRepo.renameAdHocTask(taskId, name);
  }

  /**
   * Assigns the open ad-hoc session to a task, in place: its start and pauses
   * stay, so all of its time goes to the task when it ends, and to the
   * task's provider.
   *
   * The session gets its provider now -- ad-hoc work had none -- and keeps it,
   * which is what "fixed at start" protects: the time never follows whichever
   * provider is active when it ends. The task is then taken up as a start
   * takes it up: In Progress for the user's own listed task, claimed when
   * nobody has it, left as it is when it is a teammate's. The ad-hoc row is
   * retired: deleted when nothing was logged on it.
   *
   * @throws ArgumentException with no ad-hoc session open, or no such task.
   */
  public assignSessionToTask(taskId: string): ActiveSessionDTO {
    if (!taskId) throw new ArgumentNullException('taskId');
    const open = this.getCurrentSession();
    if (!open || !(open.isAdHoc || isAdHocTaskId(open.taskId))) {
      throw new ArgumentException('Only ad-hoc work is assigned to a task while it runs.', 'taskId');
    }
    if (isAdHocTaskId(taskId)) throw new ArgumentException('Assign it to a task, not to other ad-hoc work.', 'taskId');
    const task = this._taskRepo.getTaskById(taskId);
    if (!task) throw new ArgumentException(`No task ${taskId}.`, 'taskId');

    const providerId = this.providerOfProject(task.projectId);
    this._sessionRepo.retargetSession(open.sessionId, {
      projectId: task.projectId,
      taskId: task.id,
      taskKey: task.key,
      taskTitle: task.title,
      ...(providerId ? { providerId } : {})
    });
    retireTasks(this._taskRepo.getConnection().getDb(), 'id = ?', [open.taskId]);
    this._currentSession = this._sessionRepo.getActiveSession();
    this.notifyListeners();
    // After two minutes of timing, counted from the interruption's start:
    // one already that long takes the task up at once.
    this.scheduleTakeUp(this.getCurrentSession()!, task.id, providerId);
    return this.getCurrentSession()!;
  }

  /// <summary>
  /// Whether a task is still in the user's lists -- see TaskRepository.isListed.
  /// </summary>
  public isTaskListed(taskId: string): boolean {
    return this._taskRepo.isListed(taskId);
  }

  /// <summary>
  /// Starts tracking a task session.
  /// </summary>
  public startTask(
    taskId: string,
    isAdHoc: boolean = false,
    customTitle?: string,
    projectId: string = 'PROJ',
    taskKey?: string
  ): ActiveSessionDTO {
    // A new ad-hoc task is the one case with no id to supply: the caller has a
    // title, and this process mints the row and its identifier below.
    const isNewAdHocTask = isAdHoc && Boolean(customTitle);
    if (!taskId && !isNewAdHocTask) {
      throw new Error('Task ID is required to start a session');
    }

    // Finalize any existing active session before starting new task. Its
    // task is the new session's previous one (migration 14).
    let replacedTaskId: string | undefined;
    if (this._currentSession && this._currentSession.status !== 'COMPLETED') {
      replacedTaskId = this._currentSession.taskId;
      this.stopSession(WORKLOG_COMMENTS.SWITCHED_TASK);
    }

    // Ad-hoc by its id as well as by the flag: a list offering an ad-hoc row
    // again starts it as an ordinary task. See isAdHocTaskId.
    const adHoc = isAdHoc || isAdHocTaskId(taskId);

    let finalTitle = customTitle || 'Active Task';
    let finalKey = taskKey || taskId;
    let finalProjectId = projectId;
    // The session must reference a task row that actually exists. The renderer
    // used to invent its own `adhoc_<timestamp>` id while the main process
    // created a different row, so every ad-hoc session pointed at a task that
    // was never stored, and every start orphaned the row it did create.
    let effectiveTaskId = taskId;
    // A provider's task is taken up -- In Progress, assigned -- only after
    // the session has been timed a while (SideEffectScheduler), not here.
    let takeUp: TaskDTO | null = null;

    if (isAdHoc && customTitle) {
      // Resuming an ad-hoc task -- after the lunch split, for instance -- must
      // reuse its existing row rather than making a second one. The lunch
      // stop/start is intended behaviour; the duplicate rows were not.
      const existing = this._taskRepo.getTaskById(taskId);
      if (existing) {
        if (existing.title !== customTitle || existing.status !== 'in_progress') {
          this._taskRepo.updateTask({ ...existing, title: customTitle, status: 'in_progress' });
        }
        finalKey = existing.key;
        finalTitle = customTitle;
      } else {
        const adHocTask = this._taskRepo.createAdHocTask(customTitle, this.adHocTaskKey());
        effectiveTaskId = adHocTask.id;
        finalKey = adHocTask.key;
        finalTitle = adHocTask.title;
      }
    } else if (taskId) {
      // Transition task from 'todo' to 'in_progress' when session starts
      const existingTask = this._taskRepo.getTaskById(taskId);
      if (existingTask) {
        // The stored row is the authority on how to name this task, and the
        // caller supplying it was always optional. Only two of the five call
        // sites passed a key and only three a title, so the defaults decided
        // what the bar showed: `finalKey` fell back to the id and `finalTitle`
        // to the literal 'Active Task'. Starting a Jira task from the app put
        // "10001: Active Task" on the display -- a number that appears nowhere
        // in Jira's own UI -- where the row next to it held "SCRUM-2" and
        // "Tache 2" all along. Reading it here fixes every caller at once,
        // rather than threading two more arguments through the IPC bridge.
        if (!taskKey) finalKey = existingTask.key;
        if (!customTitle) finalTitle = existingTask.title;
        if (existingTask.projectId) finalProjectId = existingTask.projectId;

        if (adHoc) {
          if (existingTask.status !== 'in_progress') {
            this._taskRepo.updateTask({ ...existingTask, status: 'in_progress' });
          }
        } else {
          takeUp = existingTask;
        }
      }
    }

    // Read once, now: the session's time goes back to where its task came
    // from, whatever provider is active by the time it ends.
    const providerId = adHoc ? undefined : this.providerOfProject(finalProjectId);

    const startTimeUtc = new Date().toISOString();
    const sessionId = createId(IdPrefix.SESSION);

    const newSession: Omit<ActiveSessionDTO, 'elapsedSeconds'> = {
      sessionId,
      projectId: finalProjectId,
      taskId: effectiveTaskId,
      taskKey: finalKey,
      taskTitle: finalTitle,
      isAdHoc: adHoc,
      status: 'TRACKING',
      startTimeUtc,
      totalPausedSeconds: 0,
      ...(providerId ? { providerId } : {})
    };

    this._sessionRepo.saveSession(newSession, replacedTaskId !== effectiveTaskId ? replacedTaskId : undefined);
    this._currentSession = this._sessionRepo.getActiveSession();
    this.startTickLoop();
    this.notifyListeners();

    if (takeUp) this.scheduleTakeUp(this._currentSession!, takeUp.id, providerId);

    return this._currentSession!;
  }

  /**
   * What starting work on a provider's task does to it, and nothing about the
   * session: shared by a start and by assigning an interruption to a task, so
   * the two cannot treat a task differently. True when nobody owns it, for
   * the caller to claim once its session is down (`claimTask`).
   *
   * A task the provider no longer lists for the user -- restarted after
   * lunch or a forgotten night, once they said yes -- is tracked as it is.
   * Saving the row took it out of the archive, back into the lists, and the
   * transition moved a task that is someone else's, or closed, to In
   * Progress on the provider. Someone else's task in progress is listed too,
   * and is tracked without being moved; one nobody owns is not moved before
   * it is taken.
   */
  /**
   * Waits to take the session's task up -- `takeUpTask`, then `claimTask`
   * for one nobody owns -- until it has been timed long enough
   * (`SideEffectScheduler`). Read again when it runs: the sync may have
   * reassigned or archived the task meanwhile.
   */
  private scheduleTakeUp(session: ActiveSessionDTO, taskId: string, providerId: string | undefined): void {
    this._sideEffects.schedule(session, () => {
      const task = this._taskRepo.getTaskById(taskId);
      const open = this._currentSession;
      if (!task || !open || open.sessionId !== session.sessionId || open.taskId !== taskId) return;
      const claimable = this.takeUpTask(task, providerId);
      if (claimable) this.claimTask(open, providerId);
    });
  }

  private takeUpTask(task: TaskDTO, providerId: string | undefined): boolean {
    const listed = !this._taskRepo.isArchived(task.id) && !this._syncWorker.isUnlisted(task.id);
    const stillListed = listed && task.ownership === undefined;
    if (stillListed) {
      if (task.status !== 'in_progress') this._taskRepo.updateTask({ ...task, status: 'in_progress' });
      this.moveTask(providerId, task.id, 'in_progress');
    }
    return listed && task.ownership === TaskOwnership.UNASSIGNED;
  }

  /**
   * The task's page on the provider it came from, or null: no such task, an
   * ad-hoc task or one of the app's own projects, or a provider that cannot
   * say. Read from the task's project, as its time is sent.
   */
  public taskPageUrl(taskId: string): string | null {
    if (!taskId || isAdHocTaskId(taskId)) return null;
    const task = this._taskRepo.getTaskById(taskId);
    if (!task || !hasTaskPage(task.projectId, this._projectRepo.getProviderIdOf(task.projectId))) return null;
    const manager = this._providerManager as Partial<ProviderManager>;
    if (typeof manager.taskPageUrlFor !== 'function') return null;
    return manager.taskPageUrlFor(this.providerOfProject(task.projectId), task);
  }

  /**
   * Hears how each claim of a task nobody owned ended: assigned, already the
   * user's, taken by someone meanwhile, or failed. For the toast and the bar
   * banner; the session itself already says whose the task is.
   */
  public onTaskClaim(listener: (report: TaskClaimReport) => void): () => void {
    this._claimListeners.add(listener);
    return () => this._claimListeners.delete(listener);
  }

  /**
   * Assigns the task of a session just started to the user, in the
   * background: the session runs whatever the provider answers, so the
   * start never waits on the network.
   *
   * Taken meanwhile, the task is recorded as that person's and left with
   * them; the session then reads as theirs (`reassigned`), so finishing it
   * asks first, and the toast and the bar say who has it. A failure leaves
   * the task as it was and is told, never queued: a retry minutes later
   * would assign a task the user may since have dropped.
   */
  private claimTask(session: ActiveSessionDTO, providerId: string | undefined): void {
    const manager = this._providerManager as Partial<ProviderManager>;
    // A project made here has no provider to ask -- asking would fail on an
    // unregistered id and toast an error -- and a test double without it has
    // nobody to assign.
    if (providerId === OWN_PROJECT_PROVIDER_ID || typeof manager.assignToMeFor !== 'function') return;
    const report: TaskClaimReport = {
      sessionId: session.sessionId,
      taskId: session.taskId,
      taskKey: session.taskKey,
      taskTitle: session.taskTitle,
      providerId
    };
    void (async () => {
      try {
        const claim = await manager.assignToMeFor!(providerId, session.taskId);
        if (!claim) return;
        this.applyClaim(session, claim, providerId);
        this.reportClaim({ ...report, claim });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[TimeTrackingEngine] Could not assign ${session.taskKey} to the user:`, message);
        this.reportClaim({ ...report, error: message });
      }
    })();
  }

  /** Records whose the claimed task now is, and moves it to In Progress once it is the user's. */
  private applyClaim(session: ActiveSessionDTO, claim: TaskClaim, providerId: string | undefined): void {
    const task = this._taskRepo.getTaskById(session.taskId);
    // Saving would take an archived row out of the archive (saveTask).
    if (task && !this._taskRepo.isArchived(session.taskId)) {
      if (claim.outcome === 'taken') {
        this._taskRepo.updateTask({ ...task, ownership: TaskOwnership.OTHER, assigneeName: claim.assigneeName });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { ownership, assigneeName, ...mine } = task;
        this._taskRepo.updateTask({ ...mine, status: 'in_progress' });
        this.moveTask(providerId, session.taskId, 'in_progress');
      }
    }
    // Seen here, so the next sync does not tell the same change again.
    const owner = claim.outcome === 'taken' ? TaskOwnership.OTHER : TaskOwnership.MINE;
    this._trackedOwnership = { sessionId: session.sessionId, owner };
    if (this._currentSession?.sessionId === session.sessionId) this.notifyListeners();
  }

  private reportClaim(report: TaskClaimReport): void {
    for (const listener of this._claimListeners) {
      try {
        listener(report);
      } catch (err) {
        console.error('[TimeTrackingEngine] Error in task claim listener:', err);
      }
    }
  }

  /**
   * Where a session's time is queued, and the shortest time that provider can
   * record; null for a project made in SprintTicker, whose time stays here.
   *
   * The session's own provider, not the active one: the active one used to
   * decide, so switching provider mid-session sent a Jira issue's id to
   * OpenProject. A session from before migration 9 recorded none and keeps
   * the old rule. A manager without `getProvider` is a test double.
   */
  private destinationOf(session: Pick<ActiveSessionDTO, 'providerId'>): { providerId: string; minimumSeconds: number } | null {
    if (session.providerId === OWN_PROJECT_PROVIDER_ID) return null;
    const manager = this._providerManager as Partial<ProviderManager> | undefined;
    if (session.providerId) {
      const provider = typeof manager?.getProvider === 'function' ? manager.getProvider(session.providerId) : undefined;
      return { providerId: session.providerId, minimumSeconds: provider ? provider.minimumLoggableSeconds : 1 };
    }
    const active = typeof manager?.getActiveProvider === 'function' ? manager.getActiveProvider() : null;
    return active
      ? { providerId: active.providerId, minimumSeconds: active.minimumLoggableSeconds }
      : { providerId: 'openproject', minimumSeconds: 1 };
  }

  /**
   * Where time logged on a task is queued, by the rule a session's end
   * follows: its project's provider, nothing for a project made here, the
   * active provider when the project's is not known. For moving a worklog.
   *
   * @throws ArgumentException for an unknown task.
   */
  public sendDestinationOfTask(taskId: string): { providerId: string; minimumSeconds: number } | null {
    const task = this._taskRepo.getTaskById(taskId);
    if (!task) throw new ArgumentException(`No task ${taskId}.`, 'taskId');
    return this.destinationOf({ providerId: this.providerOfProject(task.projectId) });
  }

  /**
   * Retires an ad-hoc task once no worklog names it -- deleted, as an
   * assigned interruption's row is -- unless the open session is on it.
   */
  public retireAdHocTaskIfUnused(taskId: string): void {
    if (!isAdHocTaskId(taskId) || this.getCurrentSession()?.taskId === taskId) return;
    if (this._worklogRepo.countWorklogsOf(taskId) > 0) return;
    retireTasks(this._taskRepo.getConnection().getDb(), 'id = ?', [taskId]);
  }

  /**
   * The provider a project came from, or undefined when that is not known: no
   * such project, or the column's legacy default (see
   * {@link UNKNOWN_PROJECT_PROVIDER_ID}).
   */
  private providerOfProject(projectId: string): string | undefined {
    const providerId = this._projectRepo.getProviderIdOf(projectId);
    return providerId && providerId !== UNKNOWN_PROJECT_PROVIDER_ID ? providerId : undefined;
  }

  /**
   * Moves a task on the provider it came from, in the background; nothing for
   * a project made here. Unknown -- a session from before migration 9, or a
   * test double -- falls back to the active provider.
   */
  private moveTask(providerId: string | undefined, taskId: string, status: 'in_progress' | 'done', projectId?: string): void {
    if (providerId === OWN_PROJECT_PROVIDER_ID) return;
    const manager = this._providerManager as Partial<ProviderManager>;
    // The project names its own Done state (`done_state_by_project`).
    const moved = providerId && typeof manager.updateTaskStatusFor === 'function'
      ? manager.updateTaskStatusFor(providerId, taskId, status, projectId)
      : this._providerManager.updateTaskStatus(taskId, status, projectId);
    moved.catch(err => {
      console.warn(`[TimeTrackingEngine] Failed to move ${taskId} to ${status} on its provider:`, err);
    });
  }

  /** The configured ad-hoc key; the default when the manager cannot say (a test double). */
  private adHocTaskKey(): string {
    const manager = this._providerManager as Partial<ProviderManager>;
    return typeof manager.getAdHocTaskKey === 'function'
      ? manager.getAdHocTaskKey()
      : PROVIDER_SETTING_DEFAULTS[ProviderSettingKey.FALLBACK_TICKET_KEY];
  }

  /// <summary>
  /// Pauses the current active session.
  /// </summary>
  public pauseSession(): ActiveSessionDTO {
    const active = this.getCurrentSession();
    if (!active || active.status !== 'TRACKING') {
      throw new Error('No active tracking session available to pause');
    }

    const nowIso = new Date().toISOString();
    this._sessionRepo.updateStatus(active.sessionId, 'PAUSED', active.totalPausedSeconds, nowIso);
    this._sessionRepo.recordPauseInterval(active.sessionId, nowIso);

    this._currentSession = this._sessionRepo.getActiveSession();
    this.stopTickLoop();
    this.notifyListeners();

    return this._currentSession!;
  }

  /// <summary>
  /// Resumes a paused session.
  /// </summary>
  public resumeSession(): ActiveSessionDTO {
    const active = this.getCurrentSession();
    if (!active || active.status !== 'PAUSED' || !active.lastPauseStartUtc) {
      throw new Error('No paused session available to resume');
    }

    // active.totalPausedSeconds already includes the live duration of the current pause
    // (calculated inside SessionRepository.getActiveSession), so we don't need to add it again.
    this._sessionRepo.updateStatus(active.sessionId, 'TRACKING', active.totalPausedSeconds, undefined);

    // When each pause ended, so a session can be stopped at a time in the
    // past (`stopSessionAt`). It was never written, so only the total said
    // how long the pauses were, not where they fell. A pause with no row is
    // the retroactive one (`pauseSessionAt`): it gets its row now.
    const resumedAtUtc = new Date().toISOString();
    if (!this._sessionRepo.closeLatestPause(active.sessionId, resumedAtUtc)) {
      this._sessionRepo.recordPauseInterval(active.sessionId, active.lastPauseStartUtc, resumedAtUtc);
    }

    this._currentSession = this._sessionRepo.getActiveSession();
    this.startTickLoop();
    this.notifyListeners();

    return this._currentSession!;
  }

  /**
   * Pauses the running session as of an instant in the past: the user's last
   * activity, when a session was left running overnight. From then on it
   * shows, logs and resumes as a session paused at that instant, so every way
   * of ending it -- the bar's paused menu included -- stops at that instant.
   *
   * Provisional: no pause row is written, so `withdrawPause` can take it back
   * and `stopSessionAt` can log past it when the user says they worked on.
   *
   * @throws ArgumentException for an instant before the start or in the future.
   */
  public pauseSessionAt(pausedAtUtc: string): ActiveSessionDTO {
    const active = this.getCurrentSession();
    if (!active || active.status !== 'TRACKING') {
      throw new Error('No active tracking session available to pause');
    }
    const at = Date.parse(pausedAtUtc);
    if (!Number.isFinite(at) || at < Date.parse(active.startTimeUtc) || at > Date.now()) {
      throw new ArgumentException(
        `A session can be paused only between its start and now, not at ${String(pausedAtUtc)}.`,
        'pausedAtUtc'
      );
    }

    this._sessionRepo.updateStatus(active.sessionId, 'PAUSED', active.totalPausedSeconds, new Date(at).toISOString());
    this._currentSession = this._sessionRepo.getActiveSession();
    this.stopTickLoop();
    this.notifyListeners();
    return this._currentSession!;
  }

  /**
   * Takes back the pause in progress as though it never happened: its whole
   * length counts as work. For the retroactive pause, when the user says they
   * were working all along; it has no row to remove.
   */
  public withdrawPause(): ActiveSessionDTO {
    const active = this.getCurrentSession();
    if (!active || active.status !== 'PAUSED') {
      throw new Error('No paused session available to resume');
    }
    // The stored total, without the live length of this pause.
    const pausedSeconds = this._sessionRepo.getStoredPausedSeconds(active.sessionId);
    this._sessionRepo.updateStatus(active.sessionId, 'TRACKING', pausedSeconds, undefined);
    this._currentSession = this._sessionRepo.getActiveSession();
    this.startTickLoop();
    this.notifyListeners();
    return this._currentSession!;
  }

  /**
   * The open session's finished pauses, oldest first. A session paused
   * before resumes were recorded has open rows that are not its current
   * pause: their lengths are known only as a total, which is then placed at
   * the start -- right for any end after it, which is every end that matters.
   */
  public getClosedPauses(): PauseIntervalDTO[] {
    const active = this.getCurrentSession();
    if (!active) return [];
    const rows = this._sessionRepo.getPauseIntervals(active.sessionId);
    const last = rows[rows.length - 1];
    const currentOpen = active.status === 'PAUSED' && last !== undefined && last.resumedAtUtc === null ? 1 : 0;
    if (rows.filter(row => row.resumedAtUtc === null).length > currentOpen) {
      const pausedMs = this._sessionRepo.getStoredPausedSeconds(active.sessionId) * 1000;
      return [{
        fromUtc: active.startTimeUtc,
        toUtc: new Date(Date.parse(active.startTimeUtc) + pausedMs).toISOString()
      }];
    }
    return rows
      .filter((row): row is { pausedAtUtc: string; resumedAtUtc: string } => row.resumedAtUtc !== null)
      .map(row => ({ fromUtc: row.pausedAtUtc, toUtc: row.resumedAtUtc }));
  }

  /**
   * Stops the session as of `endUtc` and logs the time worked up to then:
   * the end the user chose for a session left running. A retroactive pause in
   * progress is not subtracted -- the user has said when they stopped, which
   * may be after it began. A pause opened from the app still counts as one.
   *
   * @throws ArgumentException for an end before the start or in the future.
   */
  public stopSessionAt(endUtc: string, comment?: string, markDone?: boolean): { success: boolean; loggedSeconds: number } {
    const active = this.getCurrentSession();
    if (!active) return { success: false, loggedSeconds: 0 };
    const end = Date.parse(endUtc);
    if (!Number.isFinite(end) || end < Date.parse(active.startTimeUtc) || end > Date.now()) {
      throw new ArgumentException(
        `A session can be stopped only between its start and now, not at ${String(endUtc)}.`,
        'endUtc'
      );
    }

    const pauses = this.pausesUntilNow(active, false);
    const endIso = new Date(end).toISOString();
    const loggedSeconds = workedSecondsUntil(active.startTimeUtc, endIso, pauses);
    return this.finishSession(active, loggedSeconds, endIso, pauses, comment, markDone);
  }

  /**
   * Every pause of the session, the one in progress running to now. A pause
   * set retroactively (`pauseSessionAt`) has no row until it is resumed;
   * it counts unless `withProvisional` is false -- an end chosen by the user
   * may lie after it, and then they worked on.
   */
  private pausesUntilNow(active: ActiveSessionDTO, withProvisional = true): PauseIntervalDTO[] {
    const pauses = this.getClosedPauses();
    if (active.status !== 'PAUSED') return pauses;
    const rows = this._sessionRepo.getPauseIntervals(active.sessionId);
    const last = rows[rows.length - 1];
    const nowIso = new Date().toISOString();
    if (last !== undefined && last.resumedAtUtc === null) {
      pauses.push({ fromUtc: last.pausedAtUtc, toUtc: nowIso });
    } else if (withProvisional && active.lastPauseStartUtc) {
      pauses.push({ fromUtc: active.lastPauseStartUtc, toUtc: nowIso });
    }
    return pauses;
  }

  /**
   * The open session's time per local day, were it stopped now: what the
   * window shows before a stop across midnight files it under two days.
   */
  public getSessionDays(): DayShare[] {
    const active = this.getCurrentSession();
    if (!active) return [];
    return workedSecondsByLocalDay(active.startTimeUtc, new Date().toISOString(), this.pausesUntilNow(active), active.elapsedSeconds);
  }

  /**
   * Ends the active session and keeps nothing of it: no worklog, nothing
   * queued, the task's status untouched.
   *
   * `session:discard` used to call `stopSession`, so "discard" logged the time
   * and sent it to the provider like any stop. Every caller asks the user to
   * confirm first; hours thrown away by a stray click do not come back.
   */
  public discardSession(): { success: boolean; discardedSeconds: number } {
    const active = this.getCurrentSession();
    if (!active) return { success: false, discardedSeconds: 0 };

    this.stopTickLoop();
    // A glance moves nothing: what waited for the timing is dropped.
    this._sideEffects.cancel();
    this._sessionRepo.updateStatus(active.sessionId, 'COMPLETED', active.totalPausedSeconds);
    console.log(
      `[TimeTrackingEngine] Session ${active.sessionId} on ${active.taskKey} discarded: ` +
        `${active.elapsedSeconds}s neither logged nor sent.`
    );

    this._currentSession = null;
    this.notifyListeners();
    return { success: true, discardedSeconds: active.elapsedSeconds };
  }

  /// <summary>
  /// Stops and finalizes the active session, logging elapsed time and creating offline sync queue entry.
  /// </summary>
  public stopSession(
    comment?: string,
    markDone?: boolean,
    options: StopOptions = {}
  ): { success: boolean; loggedSeconds: number } {
    const active = this.getCurrentSession();
    if (!active) return { success: false, loggedSeconds: 0 };
    return this.finishSession(active, active.elapsedSeconds, new Date().toISOString(), this.pausesUntilNow(active), comment, markDone, options);
  }

  /**
   * Takes up a session an undo has just put back (`UndoService`): the rows
   * are the restore point's work, this only makes the engine follow them --
   * the tick, and every listener told the session runs again.
   */
  public resumeAfterUndo(): ActiveSessionDTO | null {
    this._currentSession = this._sessionRepo.getActiveSession();
    if (this._currentSession) this.startTickLoop();
    this.notifyListeners();
    // A stop inside the wait cancelled the take-up; the session runs on, so
    // it waits again. One timed past the wait was taken up already.
    const reopened = this.getCurrentSession();
    if (reopened && !reopened.isAdHoc && !isAdHocTaskId(reopened.taskId)
      && reopened.elapsedSeconds < this._startSideEffects().afterSeconds) {
      this.scheduleTakeUp(reopened, reopened.taskId, reopened.providerId);
    }
    return reopened;
  }

  /**
   * Logs `loggedSeconds` for the session, queues them for the provider, and
   * ends it. The time goes in as one worklog per stretch of work between
   * the start and `endUtc` (`splitWork`): a new one at each local midnight
   * and after each pause of the user's threshold or more.
   */
  private finishSession(
    active: ActiveSessionDTO,
    loggedSeconds: number,
    endUtc: string,
    pauses: readonly PauseIntervalDTO[],
    comment?: string,
    markDone?: boolean,
    options: StopOptions = {}
  ): { success: boolean; loggedSeconds: number } {
    this.stopTickLoop();
    // A glance moves nothing: what waited for the timing is dropped.
    this._sideEffects.cancel();

    // The id as well as the flag: a session started before ad-hoc was read
    // from the id may carry `isAdHoc = false` on an ad-hoc row.
    const adHoc = active.isAdHoc || isAdHocTaskId(active.taskId);

    if (markDone && active.taskId) {
      const existingTask = this._taskRepo.getTaskById(active.taskId);
      if (existingTask) {
        // Ad-hoc work is marked done too. It used to be skipped outright, so
        // every ad-hoc task stayed in progress for good and its project always
        // looked like it had something open.
        this._taskRepo.updateTask({ ...existingTask, status: 'done' });

        // Only the provider's own tasks have a remote status to move, and
        // one closed there has none: the completion transition moved an
        // OpenProject work package out of Closed again.
        if (!adHoc && active.taskLeftBecause !== 'closed') {
          // Held with the stop when it can be undone: a transition sent
          // cannot be taken back.
          const send = () => this.moveTask(active.providerId, active.taskId, 'done', active.projectId);
          if (options.holdRemote) options.holdRemote(send);
          else send();
        }
      } else {
        // The sync now keeps the tracked task, but a session started before
        // that, or on a task retired some other way, has no row to mark. Say
        // so: it used to do nothing, silently.
        console.warn(
          `[TimeTrackingEngine] ${active.taskKey} is no longer in the local cache; ` +
            'its time is logged but it could not be marked done.'
        );
      }
    }

    this._sessionRepo.updateStatus(active.sessionId, 'COMPLETED', active.totalPausedSeconds);

    const nowIso = new Date().toISOString();

    const worklogComment = comment || WORKLOG_COMMENTS.DEFAULT;

    // 1. Save worklog to SQLite, under a task row that is guaranteed to
    // exist: the foreign key would otherwise refuse a worklog whose task was
    // pruned mid-session, and the time just tracked would be lost.
    this._taskRepo.ensureTaskExists({
      id: active.taskId,
      key: active.taskKey,
      title: active.taskTitle,
      projectId: active.projectId
    });
    const destination = this.destinationOf(active);

    // One worklog per stretch of work, never across midnight. A piece too
    // short for the provider joins its neighbour rather than being dropped;
    // local and remote get the same pieces, one queue row per worklog, so a
    // correction always names the entry it corrects.
    const pieces = mergeShortPieces(
      splitWork(active.startTimeUtc, endUtc, pauses, this._splitPauseSeconds(), loggedSeconds),
      !adHoc && destination ? destination.minimumSeconds : 1
    );
    const worklogs = pieces.map(piece => {
      const id = createId(IdPrefix.WORKLOG);
      this._worklogRepo.saveWorklog({
        id,
        sessionId: active.sessionId,
        taskId: active.taskId,
        durationSeconds: piece.durationSeconds,
        startedAtUtc: piece.startedAtUtc,
        comment: worklogComment,
        createdAtUtc: nowIso
      });
      return { ...piece, worklogId: id };
    });
    if (worklogs.length > 1) {
      console.log(
        `[TimeTrackingEngine] Session ${active.sessionId} logged as ${worklogs.length} worklogs: ` +
          worklogs.map(w => `${w.durationSeconds}s on ${localDateKey(new Date(w.startedAtUtc))}`).join(', ') + '.'
      );
    }

    // 2. Buffer to offline sync queue, unless the provider cannot record it.
    //
    // Two ways a session ends up too short to send. It can log zero --
    // elapsedSeconds is floored to whole seconds and clamped at 0, so starting
    // and stopping inside the same second logs nothing. Or it can be shorter
    // than the provider's own granularity: Jira's time tracking is
    // minute-granular, so five seconds rounds to zero minutes and the API
    // answers `400 - Le journal de travail ne doit pas avoir pour valeur
    // Null`.
    //
    // Both were queued anyway, and neither could be delivered. Worse, neither
    // failure told the queue so: an ArgumentException is not a
    // ProviderRequestError at all, and the 400 was classified as retryable, so
    // the row spent every MAX_SYNC_ATTEMPTS retry across several hours before
    // parking. Queueing a payload already known to violate the contract is the
    // bug; the retries were only the symptom.
    //
    // The floor is the provider's rather than a constant here, because it is a
    // fact about each remote API and not a policy: OpenProject records
    // arbitrary durations and must not lose a user's time to Jira's limit.
    //
    // The local worklog above is still written either way. The session did
    // happen, and the history is the one place that should say so.

    //
    // Ad-hoc time is never queued. It was queued for the active provider, so
    // Jira was asked to log time on an issue called `adhoc_...`, answered 404,
    // and the row ended in the failed queue -- while the picker promised a
    // fallback ticket that nothing ever used. It stays in local history.
    if (adHoc) {
      console.log(
        `[TimeTrackingEngine] Session ${active.sessionId} is ad-hoc work: kept in local history and not queued.`
      );
    } else if (!destination) {
      console.log(
        `[TimeTrackingEngine] Session ${active.sessionId} is on a project made in SprintTicker: ` +
          'kept in local history and not queued.'
      );
    } else if (loggedSeconds >= destination.minimumSeconds) {
      // Each its own row, so each its own marker: a resend looks for that
      // piece, not for the session.
      for (const worklog of worklogs) {
        this._worklogRepo.enqueueSyncItem({
          id: createId(IdPrefix.SYNC_ITEM),
          providerId: destination.providerId,
          taskId: active.taskId,
          durationSeconds: worklog.durationSeconds,
          startedAtUtc: worklog.startedAtUtc,
          comment: worklogComment,
          worklogId: worklog.worklogId
        });
      }
    } else {
      console.log(
        `[TimeTrackingEngine] Session ${active.sessionId} logged ${loggedSeconds}s, below the ` +
          `${destination.minimumSeconds}s ${destination.providerId} can record. ` +
          'Kept in local history and not queued.'
      );
    }

    // Ask for delivery when the hold ends rather than at the next pass.
    //
    // The rows are held for the undo window (UNDO_WINDOW_MS), so Undo finds
    // them unsent; the worker is woken when it ends. Without a wake the
    // queue drained on SYNC_INTERVAL_MS alone -- five minutes -- so finishing
    // a task and then looking at Jira showed nothing, which reads as the
    // sync being broken rather than pending. A wake is safe: a pass already
    // running returns at once, and `claimSyncItem` is atomic.
    this._syncWorker.dispatchAfterHold();

    this._currentSession = null;
    this.notifyListeners();

    return { success: true, loggedSeconds };
  }
}
