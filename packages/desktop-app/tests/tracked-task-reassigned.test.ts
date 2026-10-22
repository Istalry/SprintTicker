import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import { ProjectDTO, TaskDTO } from '../src/shared/dtos';
import type { TaskClaim, TaskClaimReport } from '../src/shared/task-claim';

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

    it('Sync_ReassignedThenClosedThere_TheSessionSaysClosed', async () => {
      // Asked once and kept, "reassigned" outlived the close: FINISH asked
      // NOT YOURS, and a yes sent the completion transition to a closed
      // work package. Found on the real bar on 2026-10-15.
      engine.startTask(MINE.id);
      remoteTasks['10000'] = [OTHER];
      await sync();
      const heard: Array<string | undefined> = [];
      engine.subscribe(session => heard.push(session?.taskLeftBecause));
      getTaskStanding.mockResolvedValue('closed');

      await sync();

      expect(engine.getCurrentSession()?.taskLeftBecause).toBe('closed');
      expect(heard).toEqual(['closed']);
    });

    it('Sync_ReasonUnchanged_TellsNobody', async () => {
      // Every redraw is two requests to the bar.
      engine.startTask(MINE.id);
      remoteTasks['10000'] = [OTHER];
      await sync();
      const heard: unknown[] = [];
      engine.subscribe(session => heard.push(session));

      await sync();

      expect(getTaskStanding).toHaveBeenCalledTimes(2);
      expect(heard).toEqual([]);
    });

    it('Sync_ReasonKnown_AFailedReadKeepsIt', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      engine.startTask(MINE.id);
      remoteTasks['10000'] = [OTHER];
      getTaskStanding.mockResolvedValue('closed');
      await sync();
      getTaskStanding.mockRejectedValue(new Error('ECONNRESET'));

      await sync();

      expect(engine.getCurrentSession()?.taskLeftBecause).toBe('closed');
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

  describe('restarted once it has left', () => {
    // Restarting is the user's answer to "resume it anyway?", after lunch or
    // a forgotten night. It tracks the task; it does not take it back.
    const archive = (id: string) =>
      dbConn.getDb().prepare('UPDATE tasks SET archived_at_utc = ? WHERE id = ?').run(new Date().toISOString(), id);

    it('StartTask_TaskArchivedSince_StaysArchivedAndIsNotMoved', () => {
      archive(MINE.id);

      engine.startTask(MINE.id);

      expect(listed(MINE.id)).toBe(false);
      expect(statusPushes).toEqual([]);
    });

    it('StartTask_TaskArchivedSince_SaysItLeftWithoutWaitingForASync', () => {
      // Until the next sync, finishing it as done would have asked nothing.
      archive(MINE.id);

      engine.startTask(MINE.id);

      expect(engine.getCurrentSession()?.taskUnlisted).toBe(true);
    });

    it('StartTask_TaskTheSyncFoundUnlisted_IsNotMovedToInProgress', async () => {
      // The forgotten-night path: the session kept the task's row, so it is
      // not archived, but the sync has already seen it leave.
      engine.startTask(MINE.id);
      remoteTasks['10000'] = [OTHER];
      await sync();
      engine.stopSession('Logged the night before');
      statusPushes = [];

      engine.startTask(MINE.id);

      expect(statusPushes).toEqual([]);
      expect(engine.getCurrentSession()?.taskUnlisted).toBe(true);
    });

    it('StartTask_TaskStillListed_MovesItToInProgress', () => {
      engine.startTask(MINE.id);

      expect(statusPushes).toEqual([[MINE.id, 'in_progress']]);
      expect(taskRepo.getTaskById(MINE.id)?.status).toBe('in_progress');
    });
  });

  it('Sync_AdHocSession_IsNeverCalledUnlisted', async () => {
    // The provider never lists ad-hoc work; that is not news.
    engine.startTask('', true, 'Code review');

    await sync();

    expect(engine.getCurrentSession()?.taskUnlisted).toBeUndefined();
  });
});

/**
 * The sync keeps a teammate's task in progress and every task nobody owns,
 * so "listed" no longer means "the user's". Whose a task is now says it.
 */
describe('Tasks that are not the user\'s', () => {
  let dbConn: DatabaseConnection;
  let taskRepo: TaskRepository;
  let engine: TimeTrackingEngine;
  let remoteTasks: TaskDTO[];
  let statusPushes: Array<[string, string]>;
  let getTaskStanding: ReturnType<typeof vi.fn>;

  const MINE: TaskDTO = { id: '20001', projectId: '20000', key: 'TEAM-1', title: 'Mine', status: 'todo' };
  const FREE: TaskDTO = { id: '20002', projectId: '20000', key: 'TEAM-2', title: 'Nobody\'s', status: 'todo', ownership: 'unassigned' };
  const ALICES: TaskDTO = {
    id: '20003', projectId: '20000', key: 'TEAM-3', title: 'Alice\'s', status: 'in_progress',
    ownership: 'other', assigneeName: 'Alice Martin'
  };

  const sync = () => engine.getSyncWorker().syncTasksAndProjects();

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    dbConn = new DatabaseConnection(':memory:');
    taskRepo = new TaskRepository(dbConn);
    remoteTasks = [MINE, FREE, ALICES];
    statusPushes = [];
    getTaskStanding = vi.fn(async () => 'open');
    const manager = {
      getActiveProvider: () => ({ providerId: 'jira', minimumLoggableSeconds: 60, getTaskStanding }),
      getProjects: async () => [{ id: '20000', key: 'TEAM', name: 'Team', providerId: 'jira' }],
      getTasks: async () => remoteTasks,
      updateTaskStatus: async (taskId: string, status: string) => {
        statusPushes.push([taskId, status]);
        return true;
      },
      updateTaskStatusFor: async (_provider: string, taskId: string, status: string) => {
        statusPushes.push([taskId, status]);
        return true;
      },
      logTimeForProvider: () => new Promise(() => undefined)
    } as unknown as ProviderManager;
    engine = new TimeTrackingEngine(new SessionRepository(dbConn), new WorklogRepository(dbConn), taskRepo, manager, new ProjectRepository(dbConn));
    await sync();
  });

  afterEach(() => {
    engine.dispose();
    dbConn.close();
    vi.restoreAllMocks();
  });

  it('Sync_EveryOwner_IsStoredWithItsTask', () => {
    expect([MINE, FREE, ALICES].map(t => taskRepo.getTaskById(t.id))).toMatchObject([
      { id: MINE.id },
      { id: FREE.id, ownership: 'unassigned' },
      { id: ALICES.id, ownership: 'other', assigneeName: 'Alice Martin' }
    ]);
    expect(taskRepo.getTaskById(MINE.id)?.ownership).toBeUndefined();
  });

  it('GetTasksByProjectId_EveryOwner_ListsThemAllWithTheirMarks', () => {
    // Each list applies the user's visibility; the store hands it everything.
    const listed = taskRepo.getTasksByProjectId('20000').map(t => [t.id, t.ownership ?? 'mine']);
    expect(listed).toEqual(expect.arrayContaining([[MINE.id, 'mine'], [FREE.id, 'unassigned'], [ALICES.id, 'other']]));
    expect(listed).toHaveLength(3);
  });

  it('GetAllProjects_OpenTaskCounts_CountsEachOwnerApart', () => {
    // "Only projects with tasks" counts what the visibility shows, so each
    // owner's open work is counted on its own.
    const [project] = new ProjectRepository(dbConn).getAllProjects();
    expect([project.openTaskCount, project.openUnassignedCount, project.openOthersCount]).toEqual([1, 1, 1]);
  });

  it('IsTaskListed_TeammatesTask_IsNotTheUsersToRestartWithoutAsking', () => {
    expect(engine.isTaskListed(MINE.id)).toBe(true);
    expect(engine.isTaskListed(FREE.id)).toBe(true);
    expect(engine.isTaskListed(ALICES.id)).toBe(false);
  });

  it('Sync_TrackedTaskNowATeammatesInProgress_SaysReassignedWithoutAsking', async () => {
    // Still listed -- as Alice's -- so the provider need not be asked why.
    engine.startTask(MINE.id);
    remoteTasks = [{ ...MINE, status: 'in_progress', ownership: 'other', assigneeName: 'Alice Martin' }, FREE];

    await sync();

    expect(engine.getCurrentSession()).toMatchObject({ taskUnlisted: true, taskLeftBecause: 'reassigned' });
    expect(getTaskStanding).not.toHaveBeenCalled();
  });

  it('Sync_TrackedTaskChangesHands_TheScreensAreToldOnce', async () => {
    engine.startTask(MINE.id);
    const told = vi.fn();
    engine.subscribe(told);
    remoteTasks = [{ ...MINE, status: 'in_progress', ownership: 'other', assigneeName: 'Alice Martin' }, FREE];

    await sync();
    await sync();

    expect(told.mock.calls.filter(([s]) => s?.taskUnlisted)).toHaveLength(1);
  });

  it('StartTask_TeammatesTaskInProgress_IsTrackedWithoutMovingIt', () => {
    const session = engine.startTask(ALICES.id);

    expect(statusPushes).toEqual([]);
    expect(engine.getCurrentSession()).toMatchObject({ taskId: session.taskId, taskUnlisted: true, taskLeftBecause: 'reassigned' });
  });

  it('StartTask_TaskNobodyHas_IsNotMovedBeforeItIsTaken', () => {
    engine.startTask(FREE.id);

    expect(statusPushes).toEqual([]);
  });

  it('StartTask_UsersOwnTask_StillMovesToInProgress', () => {
    engine.startTask(MINE.id);

    expect(statusPushes).toEqual([[MINE.id, 'in_progress']]);
  });

  describe('taking a task nobody owns', () => {
    let assignToMeFor: ReturnType<typeof vi.fn>;
    let reports: TaskClaimReport[];

    beforeEach(() => {
      assignToMeFor = vi.fn(async (): Promise<TaskClaim | null> => ({ outcome: 'assigned' }));
      (engine as unknown as { _providerManager: Record<string, unknown> })._providerManager.assignToMeFor = assignToMeFor;
      reports = [];
      engine.onTaskClaim(report => reports.push(report));
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('StartTask_TaskNobodyHas_AssignsItAndThenMovesIt', async () => {
      engine.startTask(FREE.id);

      await vi.waitFor(() => expect(reports).toHaveLength(1));
      expect(assignToMeFor).toHaveBeenCalledWith('jira', FREE.id);
      expect(statusPushes).toEqual([[FREE.id, 'in_progress']]);
      expect(taskRepo.getTaskById(FREE.id)).toMatchObject({ status: 'in_progress' });
      expect(taskRepo.getTaskById(FREE.id)?.ownership).toBeUndefined();
      expect(engine.getCurrentSession()?.taskUnlisted).toBeUndefined();
      expect(reports[0]).toMatchObject({ taskKey: FREE.key, providerId: 'jira', claim: { outcome: 'assigned' } });
    });

    it('StartTask_AssignedToTheUserSinceTheSync_MovesIt', async () => {
      assignToMeFor.mockResolvedValue({ outcome: 'already_mine' });

      engine.startTask(FREE.id);

      await vi.waitFor(() => expect(statusPushes).toEqual([[FREE.id, 'in_progress']]));
      expect(taskRepo.getTaskById(FREE.id)?.ownership).toBeUndefined();
    });

    it('StartTask_TakenMeanwhile_RunsLeavesItWithThemAndSaysWho', async () => {
      assignToMeFor.mockResolvedValue({ outcome: 'taken', assigneeName: 'Bob Stone' });
      const told = vi.fn();
      engine.subscribe(told);

      const session = engine.startTask(FREE.id);

      await vi.waitFor(() => expect(reports).toHaveLength(1));
      expect(statusPushes).toEqual([]);
      expect(taskRepo.getTaskById(FREE.id)).toMatchObject({ ownership: 'other', assigneeName: 'Bob Stone' });
      expect(engine.getCurrentSession()).toMatchObject({
        sessionId: session.sessionId, status: 'TRACKING', taskUnlisted: true, taskLeftBecause: 'reassigned', taskOwnerName: 'Bob Stone'
      });
      // The screens hear it at once, not at the next sync.
      expect(told.mock.calls.some(([s]) => s?.taskOwnerName === 'Bob Stone')).toBe(true);
      expect(reports[0].claim).toEqual({ outcome: 'taken', assigneeName: 'Bob Stone' });
    });

    it('Sync_AfterATakenClaim_DoesNotTellTheSameChangeAgain', async () => {
      assignToMeFor.mockResolvedValue({ outcome: 'taken', assigneeName: 'Bob Stone' });
      engine.startTask(FREE.id);
      await vi.waitFor(() => expect(reports).toHaveLength(1));
      const told = vi.fn();
      engine.subscribe(told);
      remoteTasks = [MINE, { ...FREE, ownership: 'other', assigneeName: 'Bob Stone' }, ALICES];

      await sync();

      expect(told).not.toHaveBeenCalled();
    });

    it('StartTask_AssignmentFails_ToldOnceNeitherRetriedNorMoved', async () => {
      assignToMeFor.mockRejectedValue(new Error('HTTP 403 Forbidden'));

      engine.startTask(FREE.id);

      await vi.waitFor(() => expect(reports).toHaveLength(1));
      expect(reports[0]).toMatchObject({ taskKey: FREE.key, error: 'HTTP 403 Forbidden' });
      expect(reports[0].claim).toBeUndefined();
      expect(assignToMeFor).toHaveBeenCalledTimes(1);
      expect(statusPushes).toEqual([]);
      expect(taskRepo.getTaskById(FREE.id)?.ownership).toBe('unassigned');
      expect(engine.getCurrentSession()?.status).toBe('TRACKING');
    });

    it('StartTask_ProviderCannotAssign_ChangesNothingAndSaysNothing', async () => {
      assignToMeFor.mockResolvedValue(null);

      engine.startTask(FREE.id);
      await Promise.resolve();
      await Promise.resolve();

      expect(reports).toEqual([]);
      expect(taskRepo.getTaskById(FREE.id)?.ownership).toBe('unassigned');
    });

    it('StartTask_ProjectMadeInTheApp_AsksNoProvider', async () => {
      // `sprintticker` is not a provider: asking it failed and toasted an error.
      new ProjectRepository(dbConn).saveProject({ id: 'OWN', key: 'OWN', name: 'Own', providerId: 'sprintticker' });
      taskRepo.saveTask({ id: 'OWN_1', projectId: 'OWN', key: 'OWN-1', title: 'Free here', status: 'todo', ownership: 'unassigned' });

      engine.startTask('OWN_1');
      await Promise.resolve();

      expect(assignToMeFor).not.toHaveBeenCalled();
      expect(reports).toEqual([]);
    });

    it('StartTask_UsersOwnOrATeammatesTask_AssignsNothing', async () => {
      engine.startTask(MINE.id);
      engine.startTask(ALICES.id);
      await Promise.resolve();

      expect(assignToMeFor).not.toHaveBeenCalled();
    });

    it('StartTask_SessionEndedBeforeTheAnswer_StillRecordsWhoseItIs', async () => {
      let answer: (claim: TaskClaim) => void = () => undefined;
      assignToMeFor.mockReturnValue(new Promise<TaskClaim>(resolve => { answer = resolve; }));
      engine.startTask(FREE.id);
      engine.startTask(MINE.id);

      answer({ outcome: 'taken', assigneeName: 'Bob Stone' });

      await vi.waitFor(() => expect(reports).toHaveLength(1));
      expect(taskRepo.getTaskById(FREE.id)).toMatchObject({ ownership: 'other', assigneeName: 'Bob Stone' });
      expect(engine.getCurrentSession()).toMatchObject({ taskId: MINE.id });
      expect(engine.getCurrentSession()?.taskUnlisted).toBeUndefined();
    });
  });
});
