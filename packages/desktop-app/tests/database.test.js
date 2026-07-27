import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseService } from '../src/main/store/database';
import { DatabaseConnection } from '../src/main/db/database-connection';
describe('DatabaseService Unit Tests', () => {
    let dbService;
    beforeEach(() => {
        // Arrange: Create fresh in-memory database instance
        dbService = new DatabaseService(':memory:');
    });
    afterEach(() => {
        dbService.close();
    });
    it('GetActiveSession_EmptyDatabase_ReturnsNull', () => {
        // Act
        const session = dbService.getActiveSession();
        // Assert
        expect(session).toBeNull();
    });
    it('CreateSession_ValidData_InsertsAndRetrievesActiveSession', () => {
        // Arrange
        const startTime = new Date().toISOString();
        const newSession = {
            sessionId: 'sess_1',
            projectId: 'PROJ-1',
            taskId: 'PROJ-101',
            taskKey: 'PROJ-101',
            taskTitle: 'Unit Test Task',
            isAdHoc: false,
            status: 'TRACKING',
            startTimeUtc: startTime,
            totalPausedSeconds: 0
        };
        // Act
        dbService.createSession(newSession);
        const active = dbService.getActiveSession();
        // Assert
        expect(active).not.toBeNull();
        expect(active?.sessionId).toBe('sess_1');
        expect(active?.taskTitle).toBe('Unit Test Task');
        expect(active?.status).toBe('TRACKING');
        expect(active?.elapsedSeconds).toBeGreaterThanOrEqual(0);
    });
    it('CreateSession_MissingRequiredFields_ThrowsException', () => {
        // Arrange
        const invalidSession = {
            sessionId: '',
            projectId: '',
            taskId: '',
            taskKey: 'PROJ-101',
            taskTitle: 'Invalid Task',
            isAdHoc: false,
            status: 'TRACKING',
            startTimeUtc: new Date().toISOString(),
            totalPausedSeconds: 0
        };
        // Act & Assert
        expect(() => dbService.createSession(invalidSession)).toThrow();
    });
    it('UpdateSessionStatus_PauseSession_UpdatesStatusAndPausedTime', () => {
        // Arrange
        const newSession = {
            sessionId: 'sess_pause_test',
            projectId: 'PROJ-1',
            taskId: 'PROJ-102',
            taskKey: 'PROJ-102',
            taskTitle: 'Pause Test Task',
            isAdHoc: false,
            status: 'TRACKING',
            startTimeUtc: new Date().toISOString(),
            totalPausedSeconds: 0
        };
        dbService.createSession(newSession);
        const pauseStart = new Date().toISOString();
        // Act
        dbService.updateSessionStatus('sess_pause_test', 'PAUSED', 60, pauseStart);
        const active = dbService.getActiveSession();
        // Assert
        expect(active?.status).toBe('PAUSED');
        expect(active?.totalPausedSeconds).toBe(60);
        expect(active?.lastPauseStartUtc).toBe(pauseStart);
    });
    it('EnqueueWorklog_PendingPayload_StoresInSyncQueue', () => {
        // Arrange
        const payload = {
            id: 'log_1',
            providerId: 'jira',
            taskId: 'PROJ-101',
            durationSeconds: 3600,
            startedAtUtc: new Date().toISOString(),
            comment: 'Completed sprint ticket'
        };
        // Act
        dbService.enqueueWorklog(payload);
        const pending = dbService.getPendingWorklogs();
        // Assert
        expect(pending).toHaveLength(1);
        expect(pending[0].id).toBe('log_1');
        expect(pending[0].provider_id).toBe('jira');
        expect(pending[0].duration_seconds).toBe(3600);
        expect(pending[0].status).toBe('PENDING');
    });
    it('DatabaseConnection_SingletonInstance_ManagesConnectionLifecycle', () => {
        const conn1 = DatabaseConnection.getInstance(':memory:');
        expect(conn1.getDb()).toBeDefined();
        DatabaseConnection.resetInstance();
    });
});
//# sourceMappingURL=database.test.js.map