import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';

/**
 * The lunch split stops the active session and starts a fresh one afterwards,
 * which is intended: two worklog entries either side of the break track time
 * more accurately than one entry containing a pause. What was not intended is
 * that resuming created a *second* ad-hoc task row each time.
 *
 * The underlying defect was broader. The renderer minted its own
 * `adhoc_<timestamp>` id and passed it as the session's taskId, while the main
 * process independently created a differently-identified row -- so every
 * ad-hoc session referenced a task that had never been stored.
 */
describe('Ad-hoc task identity', () => {
  let dbConn: DatabaseConnection;
  let taskRepo: TaskRepository;
  let engine: TimeTrackingEngine;

  function countAdHocTasks(): number {
    return (
      dbConn
        .getDb()
        .prepare<[], { n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE id LIKE 'adhoc_%'")
        .get()?.n ?? 0
    );
  }

  beforeEach(() => {
    dbConn = new DatabaseConnection(':memory:');
    taskRepo = new TaskRepository(dbConn);
    engine = new TimeTrackingEngine(
      new SessionRepository(dbConn),
      new WorklogRepository(dbConn),
      taskRepo,
      undefined,
      new ProjectRepository(dbConn)
    );
  });

  afterEach(() => {
    engine.dispose();
    dbConn.close();
  });

  it('StartTask_NewAdHocTask_SessionReferencesTheRowThatWasActuallyCreated', () => {
    // The renderer now sends an empty id, but even a stale or invented one must
    // not end up on the session.
    const session = engine.startTask('', true, 'Refactor the build script');

    expect(countAdHocTasks()).toBe(1);
    const stored = taskRepo.getTaskById(session.taskId);
    expect(stored).not.toBeNull();
    expect(stored?.title).toBe('Refactor the build script');
    expect(session.taskId.startsWith('adhoc_')).toBe(true);
  });

  it('StartTask_InventedIdForUnknownAdHocTask_IsIgnoredInFavourOfTheStoredRow', () => {
    const session = engine.startTask('adhoc_1700000000000', true, 'Invented id');

    expect(session.taskId).not.toBe('adhoc_1700000000000');
    expect(taskRepo.getTaskById(session.taskId)).not.toBeNull();
    expect(countAdHocTasks()).toBe(1);
  });

  it('LunchSplit_StopThenResumeAdHocTask_ReusesTheSameRow', () => {
    // Arrange: an ad-hoc session, as before lunch.
    const before = engine.startTask('', true, 'Write the release notes');
    expect(countAdHocTasks()).toBe(1);

    // Act: the lunch split -- stop, then start again with the session's own data.
    engine.stopSession('Auto-completed for Lunch Break split');
    const after = engine.startTask(before.taskId, true, before.taskTitle);

    // Assert: same task row, no duplicate.
    expect(after.taskId).toBe(before.taskId);
    expect(countAdHocTasks()).toBe(1);
  });

  it('LunchSplit_RepeatedAcrossManyDays_DoesNotAccumulateOrphanRows', () => {
    let session = engine.startTask('', true, 'Ongoing maintenance');
    for (let day = 0; day < 5; day++) {
      engine.stopSession('Auto-completed for Lunch Break split');
      session = engine.startTask(session.taskId, true, session.taskTitle);
    }

    expect(countAdHocTasks()).toBe(1);
  });

  it('StopSession_AdHocTask_WorklogReferencesAnExistingTask', () => {
    // An orphaned taskId matters beyond tidiness: worklogs and sync queue rows
    // point at it, and the daily summary resolves it back to a task.
    const session = engine.startTask('', true, 'Investigate flaky test');
    engine.stopSession('Done for now');

    const worklog = dbConn
      .getDb()
      .prepare<[], { task_id: string }>('SELECT task_id FROM worklogs ORDER BY created_at_utc DESC LIMIT 1')
      .get();

    expect(worklog?.task_id).toBe(session.taskId);
    expect(taskRepo.getTaskById(worklog!.task_id)).not.toBeNull();
  });

  it('StartTask_ResumeWithChangedTitle_UpdatesTheRowRatherThanCreatingOne', () => {
    const first = engine.startTask('', true, 'Original title');
    engine.stopSession('stop');
    engine.startTask(first.taskId, true, 'Renamed title');

    expect(countAdHocTasks()).toBe(1);
    expect(taskRepo.getTaskById(first.taskId)?.title).toBe('Renamed title');
  });
});
