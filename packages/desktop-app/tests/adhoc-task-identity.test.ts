import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import type { ProviderManager } from '../src/main/providers/provider-manager';

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

/**
 * Ad-hoc work exists only on this machine. It used to be treated as a task of
 * the active provider whenever a list started it again -- every list passes
 * `isAdHoc = false` -- and its time was always queued for that provider, so
 * Jira was asked to move and to log time on an issue called `adhoc_...`. And
 * finishing it as done was skipped outright, so it stayed in progress for good.
 */
describe('Ad-hoc work stays local', () => {
  let dbConn: DatabaseConnection;
  let taskRepo: TaskRepository;
  let sessionRepo: SessionRepository;
  let engine: TimeTrackingEngine;
  let statusPushes: Array<[string, string]>;

  function queuedTaskIds(): string[] {
    return dbConn
      .getDb()
      .prepare<[], { task_id: string }>('SELECT task_id FROM worklog_sync_queue')
      .all()
      .map(row => row.task_id);
  }

  /** Moves the running session's start back, so it logs whole minutes. */
  function backdate(minutes: number): void {
    const active = sessionRepo.getActiveSession()!;
    sessionRepo.saveSession({ ...active, startTimeUtc: new Date(Date.now() - minutes * 60_000).toISOString(), totalPausedSeconds: 0 });
  }

  beforeEach(() => {
    dbConn = new DatabaseConnection(':memory:');
    taskRepo = new TaskRepository(dbConn);
    sessionRepo = new SessionRepository(dbConn);
    statusPushes = [];
    const manager = {
      getActiveProvider: () => ({ providerId: 'jira', minimumLoggableSeconds: 60 }),
      getAdHocTaskKey: () => 'ADMIN-1',
      updateTaskStatus: vi.fn(async (taskId: string, status: string) => {
        statusPushes.push([taskId, status]);
        return true;
      }),
      // Never answers, so a queued row stays visible to the assertions.
      logTimeForProvider: () => new Promise(() => undefined)
    } as unknown as ProviderManager;
    engine = new TimeTrackingEngine(sessionRepo, new WorklogRepository(dbConn), taskRepo, manager, new ProjectRepository(dbConn));
    taskRepo.saveTask({ id: '10001', projectId: '10000', key: 'SCRUM-2', title: 'Tache 2', status: 'todo' });
  });

  afterEach(() => {
    engine.dispose();
    dbConn.close();
  });

  it('StartTask_NewAdHocTask_ShowsTheConfiguredKey', () => {
    const session = engine.startTask('', true, 'Code review');

    expect(session.taskKey).toBe('ADMIN-1');
    expect(taskRepo.getTaskById(session.taskId)?.key).toBe('ADMIN-1');
  });

  it('StopSession_AdHocMarkedDone_IsDoneLocallyAndNothingGoesToTheProvider', () => {
    const session = engine.startTask('', true, 'Code review');

    engine.stopSession('Finished', true);

    expect(taskRepo.getTaskById(session.taskId)?.status).toBe('done');
    expect(statusPushes).toEqual([]);
  });

  it('StartTask_AdHocRowStartedFromAList_IsStillAdHoc', () => {
    // The Projects tab and both pickers start a listed row with isAdHoc = false.
    const first = engine.startTask('', true, 'Code review');
    engine.stopSession('Lunch');

    const again = engine.startTask(first.taskId, false);

    expect(again.isAdHoc).toBe(true);
    expect(statusPushes).toEqual([]);
  });

  it('StopSession_AdHocWork_IsKeptLocallyAndNeverQueued', () => {
    engine.startTask('', true, 'Code review');
    backdate(30);

    engine.stopSession('Done for now');

    expect(queuedTaskIds()).toEqual([]);
    const worklogs = dbConn.getDb().prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM worklogs').get()!.n;
    expect(worklogs).toBe(1);
  });

  it('StopSession_ProviderTask_IsStillQueuedAndMoved', () => {
    // The other side of the line: a provider's task keeps both.
    engine.startTask('10001');
    backdate(30);

    engine.stopSession('Finished', true);

    expect(queuedTaskIds()).toEqual(['10001']);
    expect(statusPushes).toEqual([['10001', 'in_progress'], ['10001', 'done']]);
  });

  it('StopSession_AdHocRowStoredWithoutTheFlag_IsStillKeptLocal', () => {
    // A session started before ad-hoc was read from the id carries
    // isAdHoc = false on an ad-hoc row. Stopping it must not queue it either.
    const first = engine.startTask('', true, 'Code review');
    engine.stopSession('Lunch');
    engine.startTask('10001');
    // saveSession's upsert leaves the task alone, so the row is rewritten here.
    dbConn
      .getDb()
      .prepare("UPDATE active_sessions SET task_id = ?, is_ad_hoc = 0, start_time_utc = ? WHERE status = 'TRACKING'")
      .run(first.taskId, new Date(Date.now() - 30 * 60_000).toISOString());

    engine.stopSession('Done', true);

    expect(queuedTaskIds()).toEqual([]);
    expect(statusPushes).toEqual([['10001', 'in_progress']]);
  });
});
