import { EventEmitter } from 'events';
import { SessionRepository } from '../db/repositories/session-repository';
import { WorklogRepository } from '../db/repositories/worklog-repository';
import { TaskRepository } from '../db/repositories/task-repository';
import { ProjectRepository } from '../db/repositories/project-repository';
import { createId, IdPrefix, isAdHocTaskId } from '../db/id-generator';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { ActiveSessionDTO, TaskDTO, ProjectDTO, PauseIntervalDTO, ArgumentException } from '../../shared/dtos';
import { workedSecondsUntil } from '../../shared/session-review';

import { ProviderManager } from '../providers/provider-manager';
import { PROVIDER_SETTING_DEFAULTS, ProviderSettingKey } from '../../shared/provider-settings';
import { OfflineSyncWorker } from '../sync/offline-sync-worker';
import { OWN_PROJECT_PROVIDER_ID, UNKNOWN_PROJECT_PROVIDER_ID } from '../../shared/local-provider';

export type EngineState = 'Idle' | 'Tracking' | 'Paused';

export type SessionStateCallback = (session: ActiveSessionDTO | null) => void;

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
  private _tickTimer: NodeJS.Timeout | null = null;
  private _syncWorker: OfflineSyncWorker;
  private _initialized = false;

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
    projectRepo?: ProjectRepository
  ) {
    super();
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

  /// <summary>
  /// Gets current active session with live calculated UTC elapsed time.
  /// </summary>
  public getCurrentSession(): ActiveSessionDTO | null {
    if (!this._currentSession) return null;
    const session = this._sessionRepo.getActiveSession();
    if (session && this._syncWorker.isUnlisted(session.taskId)) {
      const reason = this._syncWorker.unlistedReason(session.taskId);
      return { ...session, taskUnlisted: true, ...(reason ? { taskLeftBecause: reason } : {}) };
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

    // Finalize any existing active session before starting new task
    if (this._currentSession && this._currentSession.status !== 'COMPLETED') {
      this.stopSession('Auto-completed due to new task start');
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

        if (existingTask.status !== 'in_progress') {
          this._taskRepo.updateTask({ ...existingTask, status: 'in_progress' });
        }

        // An ad-hoc task exists only here; the provider would be asked to move
        // an issue it has never heard of.
        if (!adHoc) {
          this.moveTask(this.providerOfProject(finalProjectId), taskId, 'in_progress');
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

    this._sessionRepo.saveSession(newSession);
    this._currentSession = this._sessionRepo.getActiveSession();
    this.startTickLoop();
    this.notifyListeners();

    return this._currentSession!;
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
  private destinationOf(session: ActiveSessionDTO): { providerId: string; minimumSeconds: number } | null {
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
  private moveTask(providerId: string | undefined, taskId: string, status: 'in_progress' | 'done'): void {
    if (providerId === OWN_PROJECT_PROVIDER_ID) return;
    const manager = this._providerManager as Partial<ProviderManager>;
    const moved = providerId && typeof manager.updateTaskStatusFor === 'function'
      ? manager.updateTaskStatusFor(providerId, taskId, status)
      : this._providerManager.updateTaskStatus(taskId, status);
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

    const pauses = this.getClosedPauses();
    const rows = this._sessionRepo.getPauseIntervals(active.sessionId);
    const last = rows[rows.length - 1];
    if (active.status === 'PAUSED' && last !== undefined && last.resumedAtUtc === null) {
      pauses.push({ fromUtc: last.pausedAtUtc, toUtc: new Date().toISOString() });
    }
    const loggedSeconds = workedSecondsUntil(active.startTimeUtc, new Date(end).toISOString(), pauses);
    return this.finishSession(active, loggedSeconds, comment, markDone);
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
  public stopSession(comment?: string, markDone?: boolean): { success: boolean; loggedSeconds: number } {
    const active = this.getCurrentSession();
    if (!active) return { success: false, loggedSeconds: 0 };
    return this.finishSession(active, active.elapsedSeconds, comment, markDone);
  }

  /** Logs `loggedSeconds` for the session, queues them for the provider, and ends it. */
  private finishSession(
    active: ActiveSessionDTO,
    loggedSeconds: number,
    comment?: string,
    markDone?: boolean
  ): { success: boolean; loggedSeconds: number } {
    this.stopTickLoop();

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
          this.moveTask(active.providerId, active.taskId, 'done');
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

    const worklogComment = comment || 'Completed session via SprintTicker';

    // 1. Save worklog to SQLite, under a task row that is guaranteed to
    // exist: the foreign key would otherwise refuse a worklog whose task was
    // pruned mid-session, and the time just tracked would be lost.
    this._taskRepo.ensureTaskExists({
      id: active.taskId,
      key: active.taskKey,
      title: active.taskTitle,
      projectId: active.projectId
    });
    const worklogId = createId(IdPrefix.WORKLOG);
    this._worklogRepo.saveWorklog({
      id: worklogId,
      sessionId: active.sessionId,
      taskId: active.taskId,
      durationSeconds: loggedSeconds,
      startedAtUtc: active.startTimeUtc,
      comment: worklogComment,
      createdAtUtc: nowIso
    });

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
    const destination = this.destinationOf(active);

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
      this._worklogRepo.enqueueSyncItem({
        id: createId(IdPrefix.SYNC_ITEM),
        providerId: destination.providerId,
        taskId: active.taskId,
        durationSeconds: loggedSeconds,
        startedAtUtc: active.startTimeUtc,
        comment: worklogComment,
        worklogId
      });
    } else {
      console.log(
        `[TimeTrackingEngine] Session ${active.sessionId} logged ${loggedSeconds}s, below the ` +
          `${destination.minimumSeconds}s ${destination.providerId} can record. ` +
          'Kept in local history and not queued.'
      );
    }

    // Ask for delivery now rather than waiting for the timer.
    //
    // The worker still owns delivery -- this only wakes it. It used to be
    // unsafe: a flush here raced the timer over the same rows and each one
    // POSTed them, which double-billed the session. Two things fixed that and
    // both are now in place, so the reason for the wait has gone:
    // `processPendingQueue` returns immediately if a pass is already running,
    // and `claimSyncItem` is atomic, so a row another dispatcher took comes
    // back null instead of being sent twice.
    //
    // Without this the queue drained on SYNC_INTERVAL_MS alone -- five
    // minutes -- so finishing a task and then looking at Jira showed nothing,
    // which reads as the sync being broken rather than pending.
    void this._syncWorker
      .processPendingQueue()
      .catch(err => console.warn('[TimeTrackingEngine] Draining the queue after a stop failed:', err));

    this._currentSession = null;
    this.notifyListeners();

    return { success: true, loggedSeconds };
  }
}
