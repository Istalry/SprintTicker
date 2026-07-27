import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
describe('TimeTrackingEngine Unit Tests', () => {
    let dbConn;
    let sessionRepo;
    let worklogRepo;
    let taskRepo;
    let engine;
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
});
//# sourceMappingURL=time-tracking-engine.test.js.map