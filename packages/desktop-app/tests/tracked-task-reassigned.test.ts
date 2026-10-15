import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import { ProjectDTO, TaskDTO } from '../src/shared/dtos';

/**
 * A task reassigned, closed or moved on the provider while it is tracked.
 *
 * It leaves the user's scope, and the next sync used to retire it -- deleted
 * outright when no time had been logged on it yet -- in the middle of the
 * session. The session ran on, the task vanished from the lists, and
 * finishing it as done did nothing at all: there was no row left to mark.
 */
describe('A tracked task the provider stops listing', () => {
  let dbConn: DatabaseConnection;
  let taskRepo: TaskRepository;
  let projectRepo: ProjectRepository;
  let engine: TimeTrackingEngine;
  let remoteProjects: ProjectDTO[];
  let remoteTasks: Record<string, TaskDTO[]>;
  let statusPushes: Array<[string, string]>;
  /** What the provider says of the tracked task when asked on its own. */
  let getTaskStanding: ReturnType<typeof vi.fn>;

  const MINE: TaskDTO = { id: '10001', projectId: '10000', key: 'SCRUM-2', title: 'Tache 2', status: 'todo' };
  const OTHER: TaskDTO = { id: '10002', projectId: '10000', key: 'SCRUM-3', title: 'Tache 3', status: 'todo' };

  const sync = () => engine.getSyncWorker().syncTasksAndProjects();
  const listed = (id: string): boolean => taskRepo.getTasksByProjectId('10000').some(t => t.id === id);

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    dbConn = new DatabaseConnection(':memory:');
    taskRepo = new TaskRepository(dbConn);
    projectRepo = new ProjectRepository(dbConn);
    remoteProjects = [{ id: '10000', key: 'SCRUM', name: 'My Software Team' }];
    remoteTasks = { '10000': [MINE, OTHER] };
    statusPushes = [];
    getTaskStanding = vi.fn(async () => 'open');
    const manager = {
      getActiveProvider: () => ({ providerId: 'jira', minimumLoggableSeconds: 60, getTaskStanding }),
      getProjects: async () => remoteProjects,
      getTasks: async (projectId: string) => remoteTasks[projectId] ?? [],
      updateTaskStatus: async (taskId: string, status: string) => {
        statusPushes.push([taskId, status]);
        return true;
      },
      logTimeForProvider: () => new Promise(() => undefined)
    } as unknown as ProviderManager;
    engine = new TimeTrackingEngine(new SessionRepository(dbConn), new WorklogRepository(dbConn), taskRepo, manager, projectRepo);
    await sync();
  });

  afterEach(() => {
    engine.dispose();
    dbConn.close();
    vi.restoreAllMocks();
  });

  it('Sync_TrackedTaskReassigned_KeepsItAndSaysSo', async () => {
    engine.startTask(MINE.id);
    remoteTasks['10000'] = [OTHER];

    await sync();

    expect(listed(MINE.id)).toBe(true);
    expect(engine.getCurrentSession()?.taskUnlisted).toBe(true);
  });

  it('Sync_TrackedTaskStillListed_SaysNothing', async () => {
    engine.startTask(MINE.id);

    await sync();

    expect(engine.getCurrentSession()?.taskUnlisted).toBeUndefined();
  });

  it('Sync_OtherTaskReassigned_IsStillRetired', async () => {
    // Only the tracked task is spared.
    engine.startTask(MINE.id);
    remoteTasks['10000'] = [MINE];

    await sync();

    expect(listed(OTHER.id)).toBe(false);
  });

  it('Sync_TrackedTasksWholeProjectGone_KeepsTheProjectAndTheTask', async () => {
    // Removed from the project: the provider lists neither any more.
    engine.startTask(MINE.id);
    remoteProjects = [];
    remoteTasks = {};

    await sync();

    expect(projectRepo.getAllProjects().map(p => p.id)).toEqual(['10000']);
    expect(listed(MINE.id)).toBe(true);
    expect(engine.getCurrentSession()?.taskUnlisted).toBe(true);
  });

  it('Sync_AfterTheSessionEnds_RetiresTheTask', async () => {
    engine.startTask(MINE.id);
    remoteTasks['10000'] = [OTHER];
    await sync();

    engine.stopSession('Done for now');
    await sync();

    expect(listed(MINE.id)).toBe(false);
  });

  it('Sync_TrackedTaskLeavesTheList_TellsTheSessionsListeners', async () => {
    // The badge in the window comes from here: the session is re-sent.
    engine.startTask(MINE.id);
    const heard: Array<boolean | undefined> = [];
    engine.subscribe(session => heard.push(session?.taskUnlisted));
    remoteTasks['10000'] = [OTHER];

    await sync();

    expect(heard).toEqual([true]);
  });

  it('StopSession_FinishedAfterReassignment_MarksItDoneAndMovesIt', async () => {
    // The window and the bar ask first; once the user has said yes, finishing
    // works as for any task -- it used to do nothing, with no row to mark.
    engine.startTask(MINE.id);
    remoteTasks['10000'] = [OTHER];
    await sync();

    engine.stopSession('Finished', true);

    expect(taskRepo.getTaskById(MINE.id)?.status).toBe('done');
    expect(statusPushes).toContainEqual([MINE.id, 'done']);
  });

  it('StopSession_FinishedWithItsRowAlreadyGone_LogsTheTimeAndWarns', () => {
    // A session started before this protection, or on a task retired some
    // other way: the time is kept, and the log says the task was not marked.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    engine.startTask(MINE.id);
    dbConn.getDb().prepare('DELETE FROM tasks WHERE id = ?').run(MINE.id);

    engine.stopSession('Finished', true);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not be marked done'));
    expect(statusPushes).not.toContainEqual([MINE.id, 'done']);
    const worklogs = dbConn.getDb().prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM worklogs').get()!.n;
    expect(worklogs).toBe(1);
  });

  it('Sync_AListenerThrows_TheSyncStillCommitsAndTheOthersHear', async () => {
    // A listener's failure is logged; it must not cost the sync its commit.
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    engine.startTask(MINE.id);
    const worker = engine.getSyncWorker();
    const heard = vi.fn();
    worker.onUnlistedChanged(() => {
      throw new Error('listener exploded');
    });
    const unsubscribe = worker.onUnlistedChanged(heard);
    remoteTasks['10000'] = [OTHER];

    const result = await sync();

    expect(result.status).toBe('synced');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Unlisted-task listener failed'), expect.any(Error));

    // Unsubscribed, it hears nothing more.
    unsubscribe();
    remoteTasks['10000'] = [MINE, OTHER];
    await sync();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  describe('why it left', () => {
    it.each([
      ['open', 'reassigned'],
      ['closed', 'closed'],
      ['gone', 'gone']
    ])('Sync_ProviderSaysTheTaskIs%s_TheSessionSays%s', async (standing, reason) => {
      engine.startTask(MINE.id);
      remoteTasks['10000'] = [OTHER];
      getTaskStanding.mockResolvedValue(standing);

      await sync();

      expect(getTaskStanding).toHaveBeenCalledWith(MINE.id);
      expect(engine.getCurrentSession()).toMatchObject({ taskUnlisted: true, taskLeftBecause: reason });
    });

    it('Sync_ReasonKnown_IsNotAskedAgainAtTheNextSync', async () => {
      engine.startTask(MINE.id);
      remoteTasks['10000'] = [OTHER];
      await sync();

      await sync();

      expect(getTaskStanding).toHaveBeenCalledTimes(1);
    });

    it('Sync_ProviderCannotSay_StillUnlistedWithNoReason', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      engine.startTask(MINE.id);
      remoteTasks['10000'] = [OTHER];
      getTaskStanding.mockRejectedValue(new Error('ECONNRESET'));

      const result = await sync();

      expect(result.status).toBe('synced');
      expect(engine.getCurrentSession()?.taskUnlisted).toBe(true);
      expect(engine.getCurrentSession()?.taskLeftBecause).toBeUndefined();
    });

    it('Sync_ReasonLearnt_TellsTheSessionsListeners', async () => {
      engine.startTask(MINE.id);
      const heard: Array<string | undefined> = [];
      engine.subscribe(session => heard.push(session?.taskLeftBecause));
      remoteTasks['10000'] = [OTHER];
      getTaskStanding.mockResolvedValue('closed');

      await sync();

      expect(heard.at(-1)).toBe('closed');
    });

    it('StopSession_FinishedAfterItWasClosedThere_MarksItDoneHereAndMovesNothing', async () => {
      // The completion transition on a closed OpenProject work package moved
      // it out of Closed again.
      engine.startTask(MINE.id);
      remoteTasks['10000'] = [OTHER];
      getTaskStanding.mockResolvedValue('closed');
      await sync();

      engine.stopSession('Finished', true);

      expect(taskRepo.getTaskById(MINE.id)?.status).toBe('done');
      expect(statusPushes).toEqual([[MINE.id, 'in_progress']]);
    });

    it('Sync_TaskListedAgain_ForgetsTheReason', async () => {
      engine.startTask(MINE.id);
      remoteTasks['10000'] = [OTHER];
      getTaskStanding.mockResolvedValue('closed');
      await sync();

      remoteTasks['10000'] = [MINE, OTHER];
      await sync();

      expect(engine.getCurrentSession()?.taskUnlisted).toBeUndefined();
      expect(engine.getCurrentSession()?.taskLeftBecause).toBeUndefined();
    });
  });

  it('Sync_AdHocSession_IsNeverCalledUnlisted', async () => {
    // The provider never lists ad-hoc work; that is not news.
    engine.startTask('', true, 'Code review');

    await sync();

    expect(engine.getCurrentSession()?.taskUnlisted).toBeUndefined();
  });
});
