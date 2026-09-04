import { EventEmitter } from 'events';
import { SessionRepository } from '../db/repositories/session-repository';
import { WorklogRepository } from '../db/repositories/worklog-repository';
import { TaskRepository } from '../db/repositories/task-repository';
import { ProjectRepository } from '../db/repositories/project-repository';
import { createId, IdPrefix } from '../db/id-generator';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { ActiveSessionDTO, TaskDTO, ProjectDTO } from '../../shared/dtos';

import { ProviderManager } from '../providers/provider-manager';
import { OfflineSyncWorker } from '../sync/offline-sync-worker';

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
    // opened -- and wrote -- a real on-disk antigravity-busybar.db beside the
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
        this.emit('tick', active);
        this.emit('sessionUpdated', active);
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
    return this._sessionRepo.getActiveSession();
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
  /// Starts tracking a task session.
  /// </summary>
  public startTask(
    taskId: string,
    isAdHoc: boolean = false,
    customTitle?: string,
    projectId: string = 'PROJ',
    taskKey?: string
  ): ActiveSessionDTO {
    if (!taskId) throw new Error('Task ID is required to start a session');

    // Finalize any existing active session before starting new task
    if (this._currentSession && this._currentSession.status !== 'COMPLETED') {
      this.stopSession('Auto-completed due to new task start');
    }

    let finalTitle = customTitle || 'Active Task';
    let finalKey = taskKey || taskId;

    if (isAdHoc && customTitle) {
      const adHocTask = this._taskRepo.createAdHocTask(customTitle, 'MISC-1');
      finalKey = adHocTask.key;
      finalTitle = adHocTask.title;
    } else if (taskId) {
      // Transition task from 'todo' to 'in_progress' when session starts
      const existingTask = this._taskRepo.getTaskById(taskId);
      if (existingTask) {
        if (existingTask.status !== 'in_progress') {
          this._taskRepo.updateTask({ ...existingTask, status: 'in_progress' });
        }
        
        // Always attempt to push status to remote provider asynchronously to ensure consistency
        this._providerManager.updateTaskStatus(taskId, 'in_progress').catch(err => {
          console.warn(`[TimeTrackingEngine] Failed to remote update task status:`, err);
        });
      }
    }

    const startTimeUtc = new Date().toISOString();
    const sessionId = createId(IdPrefix.SESSION);

    const newSession: Omit<ActiveSessionDTO, 'elapsedSeconds'> = {
      sessionId,
      projectId,
      taskId,
      taskKey: finalKey,
      taskTitle: finalTitle,
      isAdHoc,
      status: 'TRACKING',
      startTimeUtc,
      totalPausedSeconds: 0
    };

    this._sessionRepo.saveSession(newSession);
    this._currentSession = this._sessionRepo.getActiveSession();
    this.startTickLoop();
    this.notifyListeners();

    return this._currentSession!;
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
    
    this._currentSession = this._sessionRepo.getActiveSession();
    this.startTickLoop();
    this.notifyListeners();

    return this._currentSession!;
  }

  /// <summary>
  /// Stops and finalizes the active session, logging elapsed time and creating offline sync queue entry.
  /// </summary>
  public stopSession(comment?: string, markDone?: boolean): { success: boolean; loggedSeconds: number } {
    const active = this.getCurrentSession();
    if (!active) return { success: false, loggedSeconds: 0 };

    this.stopTickLoop();

    // If user selected to mark task as done on session stop
    if (markDone && !active.isAdHoc && active.taskId) {
      const existingTask = this._taskRepo.getTaskById(active.taskId);
      if (existingTask) {
        this._taskRepo.updateTask({ ...existingTask, status: 'done' });
        
        // Push completion status remotely
        this._providerManager.updateTaskStatus(active.taskId, 'done').catch(err => {
          console.warn(`[TimeTrackingEngine] Failed to remote update task status to done:`, err);
        });
      }
    }

    const loggedSeconds = active.elapsedSeconds;
    this._sessionRepo.updateStatus(active.sessionId, 'COMPLETED', active.totalPausedSeconds);

    const nowIso = new Date().toISOString();

    const worklogComment = comment || 'Completed session via Antigravity BUSY Bar';

    // 1. Save worklog to SQLite
    this._worklogRepo.saveWorklog({
      id: createId(IdPrefix.WORKLOG),
      sessionId: active.sessionId,
      taskId: active.taskId,
      durationSeconds: loggedSeconds,
      startedAtUtc: active.startTimeUtc,
      comment: worklogComment,
      createdAtUtc: nowIso
    });

    // 2. Buffer to offline sync queue
    const activeProvider = this._providerManager ? this._providerManager.getActiveProvider() : null;
    this._worklogRepo.enqueueSyncItem({
      id: createId(IdPrefix.SYNC_ITEM),
      providerId: activeProvider ? activeProvider.providerId : 'openproject',
      taskId: active.taskId,
      durationSeconds: loggedSeconds,
      startedAtUtc: active.startTimeUtc,
      comment: worklogComment
    });

    // The worklog is queued, and OfflineSyncWorker owns delivery. Kicking off a
    // flush here raced the worker over the same rows.

    this._currentSession = null;
    this.notifyListeners();

    return { success: true, loggedSeconds };
  }
}
