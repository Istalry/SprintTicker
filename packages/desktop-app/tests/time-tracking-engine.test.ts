import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';

describe('TimeTrackingEngine Unit Tests', () => {
  let dbConn: DatabaseConnection;
  let sessionRepo: SessionRepository;
  let worklogRepo: WorklogRepository;
  let taskRepo: TaskRepository;
  let projectRepo: ProjectRepository;
  let engine: TimeTrackingEngine;

  beforeEach(() => {
    // Arrange: In-memory database instance
    dbConn = new DatabaseConnection(':memory:');
    sessionRepo = new SessionRepository(dbConn);
    worklogRepo = new WorklogRepository(dbConn);
    taskRepo = new TaskRepository(dbConn);
    projectRepo = new ProjectRepository(dbConn);

    engine = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo, undefined, projectRepo);
  });

  afterEach(() => {
    engine.dispose();
    dbConn.close();
  });

  it('StartTask_ValidTask_TransitionsToTrackingState', () => {
    // Act
    const session = engine.startTask('PROJ-101', false, 'Test Task Title', 'PROJ', 'PROJ-101');

    // Assert
    expect(session).not.toBeNull();
    expect(session.status).toBe('TRACKING');
    expect(session.taskId).toBe('PROJ-101');
    expect(session.taskTitle).toBe('Test Task Title');
    expect(session.elapsedSeconds).toBeGreaterThanOrEqual(0);
  });

  describe('the session is named from the stored task row', () => {
    // Reported from a photograph of the bar: it read "10001: Active Task"
    // while the app's own list, one pane away, held "SCRUM-2" and "Tache 2".
    // 10001 is Jira's internal issue id and appears nowhere in Jira's UI.
    //
    // The cause was defaults, not a lookup failure. `taskKey` and `customTitle`
    // were optional arguments falling back to the id and the literal
    // 'Active Task', and only some of the five call sites passed them -- the
    // app's IPC handler passes neither.

    beforeEach(() => {
      projectRepo.saveProject({ id: '10000', key: 'SCRUM', name: 'My Software Team' });
      taskRepo.saveTask({
        id: '10001',
        projectId: '10000',
        key: 'SCRUM-2',
        title: 'Tache 2',
        status: 'todo'
      });
    });

    it('StartTask_NoKeyOrTitleSupplied_TakesThemFromTheTaskRow', () => {
      // Exactly how the app's own Switch button reaches the engine.
      const session = engine.startTask('10001');

      expect(session.taskKey).toBe('SCRUM-2');
      expect(session.taskTitle).toBe('Tache 2');
    });

    it('StartTask_NoProjectSupplied_TakesItFromTheTaskRowRatherThanThePlaceholder', () => {
      // The default was the literal string 'PROJ'.
      const session = engine.startTask('10001');

      expect(session.projectId).toBe('10000');
    });

    it('StartTask_CallerSuppliesAKeyAndTitle_TheyStillWin', () => {
      // The lookup is a fallback, not an override: the lunch-split resume
      // passes both deliberately.
      const session = engine.startTask('10001', false, 'Explicit Title', '10000', 'EXPLICIT-9');

      expect(session.taskKey).toBe('EXPLICIT-9');
      expect(session.taskTitle).toBe('Explicit Title');
    });

    it('StartTask_UnknownTaskId_StillFallsBackToTheIdRatherThanThrowing', () => {
      const session = engine.startTask('not-in-the-cache');

      expect(session.taskKey).toBe('not-in-the-cache');
    });
  });

  describe('a finished session is delivered without waiting for the timer', () => {
    /**
     * Reported from real use: the status change showed up on the Jira board at
     * once but the logged time took a while to appear.
     *
     * The worklog is queued and the worker drains the queue on
     * SYNC_INTERVAL_MS, which is five minutes -- so finishing a task and
     * looking at Jira showed nothing, which reads as a broken sync rather than
     * a pending one.
     *
     * Kicking the worker from here genuinely was unsafe once: the flush raced
     * the timer over the same rows and both POSTed them, double-billing the
     * session. It is safe now because `processPendingQueue` refuses to start a
     * second concurrent pass and `claimSyncItem` is atomic, and the second of
     * those tests is what makes this one more than an optimisation.
     */
    let delivered: Array<{ taskId: string; durationSeconds: number }>;
    let stopEngine: TimeTrackingEngine;

    beforeEach(() => {
      delivered = [];
      const manager = {
        getProjects: async () => [],
        getTasks: async () => [],
        getActiveProvider: () => ({ providerId: 'jira' }),
        updateTaskStatus: async () => true,
        logTimeForProvider: async (
          _providerId: string,
          payload: { taskId: string; durationSeconds: number }
        ) => {
          delivered.push({ taskId: payload.taskId, durationSeconds: payload.durationSeconds });
          return { success: true };
        }
      } as unknown as ProviderManager;

      stopEngine = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo, manager, projectRepo);
      taskRepo.saveTask({
        id: '10001',
        projectId: '10000',
        key: 'SCRUM-2',
        title: 'Tache 2',
        status: 'todo'
      });
    });

    afterEach(() => {
      stopEngine.dispose();
    });

    /**
     * Starts a session that has already been running, so it logs whole seconds.
     *
     * Starting and stopping in the same test tick logs zero, and a zero-second
     * session is deliberately not queued -- see the test below. Backdating the
     * stored start time is how the end-to-end simulation does this too.
     */
    function startBackdatedSession(minutesAgo: number): void {
      stopEngine.startTask('10001');
      const active = sessionRepo.getActiveSession();
      if (!active) throw new Error('Expected an active session to backdate.');
      sessionRepo.saveSession({
        ...active,
        startTimeUtc: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
        totalPausedSeconds: 0,
        lastPauseStartUtc: undefined
      });
    }

    it('StopSession_WorklogQueued_ReachesTheProviderWithoutTheIntervalElapsing', async () => {
      startBackdatedSession(5);

      stopEngine.stopSession('Finished');

      await vi.waitFor(() => expect(delivered).toHaveLength(1));
      expect(delivered[0].taskId).toBe('10001');
    });

    it('StopSession_SessionShorterThanOneSecond_IsNotQueuedForAProviderThatWillRefuseIt', async () => {
      // A mis-click: start and stop inside the same second. elapsedSeconds is
      // floored and clamped, so it is 0 -- and every provider's logTime throws
      // ArgumentException on a non-positive duration, by design.
      //
      // ArgumentException is not a ProviderRequestError, so the queue cannot
      // see that it is hopeless: it takes the ordinary backoff and spends all
      // MAX_SYNC_ATTEMPTS retries over several hours before parking a row that
      // could never have been delivered. Queueing something we already know
      // violates the contract is the bug; the retries are the symptom.
      stopEngine.startTask('10001');

      const result = stopEngine.stopSession('Mis-click');

      expect(result.loggedSeconds).toBe(0);
      await stopEngine.getSyncWorker().processPendingQueue();
      expect(delivered).toHaveLength(0);
    });

    it('StopSession_TwoSessionsInARow_DeliversEachWorklogExactlyOnce', async () => {
      // The failure the five-minute wait was protecting against. A second stop
      // arrives while the first flush may still be in flight, and the row must
      // not be sent twice -- an over-reported day is harder to notice than a
      // missing entry the queue would resend anyway.
      startBackdatedSession(5);
      stopEngine.stopSession('First');
      startBackdatedSession(3);
      stopEngine.stopSession('Second');

      await vi.waitFor(() => expect(delivered).toHaveLength(2));
      // Settle any further pass before asserting nothing extra went out.
      await stopEngine.getSyncWorker().processPendingQueue();

      expect(delivered).toHaveLength(2);
    });
  });

  it('StartTask_MissingTaskId_ThrowsException', () => {
    // Act & Assert
    expect(() => engine.startTask('', false)).toThrow('Task ID is required');
  });

  it('PauseSession_TrackingSession_TransitionsToPausedState', () => {
    // Arrange
    engine.startTask('PROJ-101', false, 'Test Task Title');

    // Act
    const paused = engine.pauseSession();

    // Assert
    expect(paused.status).toBe('PAUSED');
    expect(paused.lastPauseStartUtc).toBeDefined();
  });

  it('PauseSession_NoActiveSession_ThrowsException', () => {
    // Act & Assert
    expect(() => engine.pauseSession()).toThrow('No active tracking session available to pause');
  });

  it('ResumeSession_PausedSession_TransitionsBackToTrackingState', () => {
    // Arrange
    engine.startTask('PROJ-101', false, 'Test Task Title');
    engine.pauseSession();

    // Act
    const resumed = engine.resumeSession();

    // Assert
    expect(resumed.status).toBe('TRACKING');
    expect(resumed.lastPauseStartUtc).toBeUndefined();
  });

  it('StopSession_ActiveSession_FinalizesAndQueuesWorklog', () => {
    // Arrange
    engine.startTask('PROJ-101', false, 'Test Task Title');

    // Act
    const result = engine.stopSession('Completed successfully');
    const current = engine.getCurrentSession();
    // The recorded worklog, not the queue row. Stopping now asks the worker to
    // dispatch at once instead of waiting out the five-minute interval, so the
    // row does not sit in PENDING long enough to be observed here -- with no
    // provider configured it is parked immediately, which it used to be five
    // minutes later. What has to survive either way is the worklog itself.
    const logged = worklogRepo.getTodaysWorklogs();

    // Assert
    expect(result.success).toBe(true);
    expect(current).toBeNull();
    expect(logged).toHaveLength(1);
    expect(logged[0].taskId).toBe('PROJ-101');
    expect(logged[0].comment).toBe('Completed successfully');
  });

  it('ReconcileStartupState_InterruptedSession_RestoresStateFromUTC', () => {
    // Arrange: Create session directly in DB as if app crashed while tracking
    sessionRepo.saveSession({
      sessionId: 'sess_crash',
      projectId: 'PROJ',
      taskId: 'PROJ-999',
      taskKey: 'PROJ-999',
      taskTitle: 'Crashed Session',
      isAdHoc: false,
      status: 'TRACKING',
      startTimeUtc: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
      totalPausedSeconds: 0
    });

    // Act
    const newEngine = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo, undefined, projectRepo);
    newEngine.initialize();
    const restored = newEngine.getCurrentSession();
    newEngine.dispose();

    // Assert
    expect(restored).not.toBeNull();
    expect(restored?.sessionId).toBe('sess_crash');
    expect(restored?.status).toBe('TRACKING');
    expect(restored?.elapsedSeconds).toBeGreaterThanOrEqual(3599);
  });
  it('StopSession_WhenIdle_ReturnsFailure', () => {
    // No active session — stop should return gracefully with success: false
    const result = engine.stopSession('No active session');

    expect(result.success).toBe(false);
    expect(result.loggedSeconds).toBe(0);
  });

  it('StartTask_WhenAlreadyTracking_AutoStopsCurrentSession_AndQueuesWorklog', () => {
    // Arrange: start first task, verify nothing logged yet
    engine.startTask('PROJ-100', false, 'First Task');
    expect(worklogRepo.getTodaysWorklogs()).toHaveLength(0);

    // Act: start a second task — engine should auto-stop the first and log its time
    engine.startTask('PROJ-200', false, 'Second Task');

    // Assert: the auto-stop recorded a worklog for PROJ-100. Read from the
    // worklog table rather than the queue, for the reason given above: the
    // queue row is dispatched immediately now rather than on the interval.
    const logged = worklogRepo.getTodaysWorklogs();
    expect(logged).toHaveLength(1);
    expect(logged[0].taskId).toBe('PROJ-100');
  });

  it('PauseSession_WhenIdle_ThrowsError', () => {
    // No session started — pause should throw
    expect(() => engine.pauseSession()).toThrow('No active tracking session available to pause');
  });

  it('ResumeSession_WhenAlreadyTracking_ThrowsError', () => {
    // Start a task (status = TRACKING, not PAUSED) — resume should throw
    engine.startTask('PROJ-303', false, 'Already Tracking');
    expect(() => engine.resumeSession()).toThrow('No paused session available to resume');
  });

  it('Subscribe_ListenerFires_OnSessionStateChange', () => {
    // Arrange
    let notified = false;
    engine.subscribe(() => { notified = true; });

    // Act
    engine.startTask('PROJ-404', false, 'Subscriber Test');

    // Assert
    expect(notified).toBe(true);
  });

  it('Subscribe_ReturnsUnsubscribeCallback_RemovesListener', () => {
    // Arrange
    let count = 0;
    const unsubscribe = engine.subscribe(() => { count++; });

    engine.startTask('PROJ-505', false, 'Before Unsub');
    expect(count).toBeGreaterThan(0);

    const countBefore = count;
    unsubscribe();

    // Further state changes should NOT increment count
    engine.pauseSession();
    expect(count).toBe(countBefore);
  });

  it('StartTask_TodoTask_TransitionsToInProgressState', () => {
    // Arrange: Create project and task with 'todo' status
    taskRepo.saveTask({ id: 'TASK_TODO', projectId: 'PROJ', key: 'PROJ-TODO', title: 'To-Do Task', status: 'todo' });

    // Act
    engine.startTask('TASK_TODO', false, 'To-Do Task', 'PROJ', 'PROJ-TODO');

    // Assert
    const updatedTask = taskRepo.getTaskById('TASK_TODO');
    expect(updatedTask?.status).toBe('in_progress');
  });

  it('StopSession_WithIsMarkDone_TransitionsTaskToDoneState', () => {
    // Arrange: Task in progress
    taskRepo.saveTask({ id: 'TASK_INPROG', projectId: 'PROJ', key: 'PROJ-INP', title: 'In-Progress Task', status: 'in_progress' });
    engine.startTask('TASK_INPROG', false, 'In-Progress Task', 'PROJ', 'PROJ-INP');

    // Act: Stop session with isMarkDone = true
    engine.stopSession('Completed work', true);

    // Assert
    const updatedTask = taskRepo.getTaskById('TASK_INPROG');
    expect(updatedTask?.status).toBe('done');
  });

  it('StartTask_AdHocTask_CreatesAdHocTaskAndStartsSession', () => {
    // Act: start an ad-hoc task (isAdHoc = true)
    const session = engine.startTask('adhoc-1', true, 'My Ad Hoc Work');

    // Assert: session is running and ad-hoc task was created
    expect(session.status).toBe('TRACKING');
    expect(session.taskTitle).toMatch(/My Ad Hoc Work/i);
  });

  it('ReconcileStartupState_PausedSession_ReturnsSessionWithoutStartingTick', () => {
    // Arrange: create a paused session manually in the DB
    engine.startTask('PROJ-RECON', false, 'Reconcile Task');
    engine.pauseSession();

    // Re-create engine instance to simulate app restart (uses same DB)
    const engine2 = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo, undefined, projectRepo);

    // Act
    const reconciled = engine2.reconcileStartupState();

    // Assert: session is returned in PAUSED state, tick loop is not running
    expect(reconciled).not.toBeNull();
    expect(reconciled!.status).toBe('PAUSED');
  });

  it('ReconcileStartupState_NoActiveSession_ReturnsNull', () => {
    // Arrange: no active session
    const engine2 = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo, undefined, projectRepo);

    // Act
    const result = engine2.reconcileStartupState();

    // Assert
    expect(result).toBeNull();
  });

  it('Subscribe_ListenerThrows_DoesNotCrashEngine', () => {
    // Arrange: register a listener that throws
    engine.subscribe(() => { throw new Error('listener error'); });

    // Act & Assert: startTask should not throw even when listener throws
    expect(() => engine.startTask('PROJ-ERR', false, 'Error Task')).not.toThrow();
  });

  it('StartTickLoop_EmitsTick_AfterIntervalFires', async () => {
    // Arrange: use fake timers so we can advance time without leaving live intervals after DB close
    const { vi } = await import('vitest');
    vi.useFakeTimers();

    const tickedSessions: unknown[] = [];
    engine.on('tick', (s) => tickedSessions.push(s));

    // Act: start a task then advance the clock past one tick interval
    engine.startTask('PROJ-TICK', false, 'Tick Task');
    await vi.advanceTimersByTimeAsync(1100);

    // Restore real timers and stop the tick loop cleanly
    vi.useRealTimers();
    engine.stopSession('Tick test complete');

    // Assert
    expect(tickedSessions.length).toBeGreaterThan(0);
  });
});

