import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';

describe('TimeTrackingEngine Unit Tests', () => {
  let dbConn: DatabaseConnection;
  let sessionRepo: SessionRepository;
  let worklogRepo: WorklogRepository;
  let taskRepo: TaskRepository;
  let engine: TimeTrackingEngine;

  beforeEach(() => {
    // Arrange: In-memory database instance
    dbConn = new DatabaseConnection(':memory:');
    sessionRepo = new SessionRepository(dbConn);
    worklogRepo = new WorklogRepository(dbConn);
    taskRepo = new TaskRepository(dbConn);

    engine = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo);
  });

  afterEach(() => {
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
    const pendingWorklogs = worklogRepo.getPendingQueueItems();

    // Assert
    expect(result.success).toBe(true);
    expect(current).toBeNull();
    expect(pendingWorklogs).toHaveLength(1);
    expect(pendingWorklogs[0].taskId).toBe('PROJ-101');
    expect(pendingWorklogs[0].comment).toBe('Completed successfully');
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
    const newEngine = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo);
    const restored = newEngine.getCurrentSession();

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
    // Arrange: start first task, verify nothing queued yet
    engine.startTask('PROJ-100', false, 'First Task');
    expect(worklogRepo.getPendingQueueItems()).toHaveLength(0);

    // Act: start a second task — engine should auto-stop the first and queue a worklog
    engine.startTask('PROJ-200', false, 'Second Task');

    // Assert: the auto-stop created a worklog for PROJ-100
    const queueItems = worklogRepo.getPendingQueueItems();
    expect(queueItems).toHaveLength(1);
    expect(queueItems[0].taskId).toBe('PROJ-100');
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
});
