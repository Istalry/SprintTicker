import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
describe('SQLite Repositories Unit Tests', () => {
    let dbConn;
    let taskRepo;
    let worklogRepo;
    let settingsRepo;
    let sessionRepo;
    beforeEach(() => {
        dbConn = new DatabaseConnection(':memory:');
        taskRepo = new TaskRepository(dbConn);
        worklogRepo = new WorklogRepository(dbConn);
        settingsRepo = new SettingsRepository(dbConn);
        sessionRepo = new SessionRepository(dbConn);
    });
    afterEach(() => {
        dbConn.close();
    });
    it('TaskRepository_SaveAndGetTasks_StoresAndRetrievesTasks', () => {
        // Arrange
        const task = {
            id: 'TASK-1',
            projectId: 'PROJ-A',
            key: 'PROJ-A-1',
            title: 'Fix Audio Artifacts',
            status: 'todo'
        };
        // Act
        taskRepo.saveTask(task);
        const tasks = taskRepo.getTasksByProjectId('PROJ-A');
        // Assert
        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toBe('Fix Audio Artifacts');
    });
    it('TaskRepository_CreateAdHocTask_GeneratesAdHocTaskWithFallbackKey', () => {
        // Act
        const adHoc = taskRepo.createAdHocTask('Emergency Code Review', 'MISC-1');
        // Assert
        expect(adHoc.id).toContain('adhoc_');
        expect(adHoc.key).toBe('MISC-1');
        expect(adHoc.title).toBe('Emergency Code Review');
    });
    it('SettingsRepository_GetAndSetSetting_PersistsJSONAndStringValues', () => {
        // Arrange
        const config = { startButtonPress: 'CUSTOM_ACTION' };
        // Act
        settingsRepo.setSetting('custom_key', config);
        const retrieved = settingsRepo.getSetting('custom_key', { startButtonPress: '' });
        // Assert
        expect(retrieved.startButtonPress).toBe('CUSTOM_ACTION');
    });
    it('SessionRepository_SaveAndRetrieveSession_AccuratelyCalculatesElapsed', () => {
        // Arrange
        const startTime = new Date(Date.now() - 60000).toISOString(); // 60s ago
        sessionRepo.saveSession({
            sessionId: 'sess_10',
            projectId: 'PROJ',
            taskId: 'TASK-1',
            taskKey: 'TASK-1',
            taskTitle: 'Test Session',
            isAdHoc: false,
            status: 'TRACKING',
            startTimeUtc: startTime,
            totalPausedSeconds: 10
        });
        // Act
        const session = sessionRepo.getActiveSession();
        // Assert
        expect(session).not.toBeNull();
        expect(session?.elapsedSeconds).toBeGreaterThanOrEqual(49);
        expect(session?.totalPausedSeconds).toBe(10);
    });
    it('WorklogRepository_QueueAndGetPendingWorklogs_StoresAndReturnsQueue', () => {
        // Arrange & Act
        worklogRepo.enqueueSyncItem({
            id: 'wl_1',
            providerId: 'jira',
            taskId: 'PROJ-142',
            durationSeconds: 3600,
            startedAtUtc: new Date().toISOString(),
            comment: 'Offline testing'
        });
        const pending = worklogRepo.getPendingQueueItems();
        // Assert
        expect(pending).toHaveLength(1);
        expect(pending[0].comment).toBe('Offline testing');
    });
});
//# sourceMappingURL=repositories.test.js.map