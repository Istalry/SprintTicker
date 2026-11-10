import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import { ArgumentException, ProjectDTO, TaskDTO } from '../src/shared/dtos';
import { previousTaskId } from '../src/shared/previous-task';
import { starIdentity } from '../src/shared/task-stars';

/**
 * The stores the redesigned picker, Previous task and the deck read (P4):
 * stars kept by provider and key, Recent from the sessions, and the task a
 * session replaced. Real repositories and engine on a database in memory.
 */
describe('stars, recent and previous task', () => {
  let dbConn: DatabaseConnection;
  let tasks: TaskRepository;
  let projects: ProjectRepository;
  let engine: TimeTrackingEngine;

  const PROJECT: ProjectDTO = { id: '10000', key: 'SCRUM', name: 'Team', providerId: 'jira' } as ProjectDTO;
  const A: TaskDTO = { id: '10001', projectId: '10000', key: 'SCRUM-2', title: 'Two', status: 'todo' };
  const B: TaskDTO = { id: '10002', projectId: '10000', key: 'SCRUM-3', title: 'Three', status: 'todo' };
  const C: TaskDTO = { id: '10003', projectId: '10000', key: 'SCRUM-4', title: 'Four', status: 'todo' };

  let minute = 0;
  /** Each start a minute after the last, so "newest first" is never a tie. */
  const start = (task: TaskDTO) => {
    vi.setSystemTime(new Date(2026, 10, 10, 9, minute++, 0));
    return engine.startTask(task.id, false, task.title, task.projectId, task.key);
  };
  const stop = () => {
    vi.setSystemTime(new Date(2026, 10, 10, 9, minute++, 0));
    engine.stopSession('done');
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    minute = 0;
    dbConn = new DatabaseConnection(':memory:');
    tasks = new TaskRepository(dbConn);
    projects = new ProjectRepository(dbConn);
    projects.saveProject(PROJECT);
    for (const task of [A, B, C]) tasks.saveTask(task);
    const manager = {
      getActiveProvider: () => ({ providerId: 'jira', minimumLoggableSeconds: 60 }),
      getProjects: async () => [PROJECT],
      getTasks: async () => [A, B, C],
      updateTaskStatus: async () => true,
      logTimeForProvider: () => new Promise(() => undefined)
    } as unknown as ProviderManager;
    engine = new TimeTrackingEngine(new SessionRepository(dbConn), new WorklogRepository(dbConn), tasks, manager, projects);
  });

  afterEach(() => {
    engine.dispose();
    dbConn.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('stars', () => {
    it('Star_ThenGetStarred_ListsIt', () => {
      tasks.star(A.id);
      expect(tasks.getStarred().map(t => t.key)).toEqual(['SCRUM-2']);
    });

    it('Star_Twice_KeepsOneStar', () => {
      tasks.star(A.id);
      tasks.star(A.id);
      expect(tasks.getStarred()).toHaveLength(1);
    });

    it('Unstar_TakesItOff', () => {
      tasks.star(A.id);
      tasks.unstar(A.id);
      expect(tasks.getStarred()).toEqual([]);
    });

    it('Star_RetiredThenFetchedUnderANewId_ComesBack', () => {
      // The sync retires a task that leaves the scope and may fetch it again
      // later; a star tied to the row would be gone with it.
      tasks.star(A.id);
      tasks.deleteTasksNotIn(PROJECT.id, [B.id, C.id]);
      expect(tasks.getStarred()).toEqual([]);

      tasks.saveTask({ ...A, id: '20001' });

      expect(tasks.getStarred().map(t => [t.id, t.key])).toEqual([['20001', 'SCRUM-2']]);
    });

    it('Star_SameKeyOnAnotherProvider_IsNotStarred', () => {
      projects.saveProject({ id: 'op1', key: 'OP', name: 'Other', providerId: 'openproject' } as ProjectDTO);
      tasks.saveTask({ id: 'op-77', projectId: 'op1', key: 'SCRUM-2', title: 'Namesake', status: 'todo' });

      tasks.star(A.id);

      expect(tasks.getStarred().map(t => t.id)).toEqual([A.id]);
    });

    it('Star_AdHocTask_StarsThatOneNotEveryAdHocTask', () => {
      // Every ad-hoc task shows the same key; a star by key would star them all.
      const call = tasks.createAdHocTask('Call');
      tasks.createAdHocTask('Admin');

      tasks.star(call.id);

      expect(tasks.getStarred().map(t => t.title)).toEqual(['Call']);
    });

    it('Starred_NewestStarFirst', () => {
      vi.setSystemTime(new Date(2026, 10, 10, 9, 0));
      tasks.star(A.id);
      vi.setSystemTime(new Date(2026, 10, 10, 9, 1));
      tasks.star(B.id);
      expect(tasks.getStarred().map(t => t.id)).toEqual([B.id, A.id]);
    });

    it('Star_UnknownTask_Throws', () => {
      expect(() => tasks.star('nope')).toThrow(ArgumentException);
    });

    it('StarIdentity_ProjectWithNoRow_IsTheUnknownProvider', () => {
      expect(starIdentity({ id: 'x', key: 'K-1' }, undefined, false)).toEqual({ providerId: 'local', taskKey: 'K-1' });
    });
  });

  describe('recent', () => {
    it('Recent_NewestFirst_EachTaskOnce', () => {
      start(A); start(B); start(A); stop();

      expect(tasks.getRecent(6).map(t => t.id)).toEqual([A.id, B.id]);
    });

    it('Recent_KeepsToTheLimit', () => {
      start(A); start(B); start(C); stop();

      expect(tasks.getRecent(2).map(t => t.id)).toEqual([C.id, B.id]);
    });

    it('Recent_LeavesOutUnnamedInterruptionsAndRetiredTasks', () => {
      start(A);
      engine.startInterruption();
      stop();
      start(B); stop();
      tasks.deleteTasksNotIn(PROJECT.id, [A.id, C.id]);

      expect(tasks.getRecent(6).map(t => t.id)).toEqual([A.id]);
    });

    it('Recent_BadLimit_Throws', () => {
      expect(() => tasks.getRecent(0)).toThrow(ArgumentException);
    });
  });

  describe('previous task', () => {
    it('Switch_RecordsTheTaskReplaced', () => {
      const first = start(A);
      const second = start(B);

      const sessions = new SessionRepository(dbConn);
      expect(sessions.getPreviousTaskId(second.sessionId)).toBe(A.id);
      expect(sessions.getPreviousTaskId(first.sessionId)).toBeNull();
      expect(engine.getPreviousTask()?.id).toBe(A.id);
    });

    it('StartingTheSameTaskAgain_RecordsNothing', () => {
      start(A);
      const again = start(A);

      expect(new SessionRepository(dbConn).getPreviousTaskId(again.sessionId)).toBeNull();
    });

    it('NothingRunning_IsTheLastEndedTask', () => {
      start(A); stop(); start(B); stop();

      expect(engine.getPreviousTask()?.id).toBe(B.id);
    });

    it('RunningTheLastTaskAgain_SkipsIt', () => {
      start(A); stop(); start(B); stop(); start(B);

      expect(engine.getPreviousTask()?.id).toBe(A.id);
    });

    it('StoredTaskRetired_FallsBackToTheSessions', () => {
      start(C); stop(); start(A); start(B);
      tasks.deleteTasksNotIn(PROJECT.id, [B.id, C.id]);

      expect(engine.getPreviousTask()?.id).toBe(C.id);
    });

    it('NothingEver_IsNull', () => {
      expect(engine.getPreviousTask()).toBeNull();
    });

    it('PreviousTaskId_StoredFirst_ThenTheSessions', () => {
      const offered = () => true;
      expect(previousTaskId({ currentTaskId: 'b', storedPreviousTaskId: 'a', recentEndedTaskIds: ['c'], isOffered: offered })).toBe('a');
      expect(previousTaskId({ currentTaskId: 'b', storedPreviousTaskId: null, recentEndedTaskIds: ['b', 'c'], isOffered: offered })).toBe('c');
      expect(previousTaskId({ currentTaskId: null, storedPreviousTaskId: null, recentEndedTaskIds: ['x'], isOffered: id => id !== 'x' })).toBeNull();
    });
  });
});
