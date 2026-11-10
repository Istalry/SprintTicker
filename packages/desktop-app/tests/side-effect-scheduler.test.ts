import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import { ProjectDTO, TaskDTO } from '../src/shared/dtos';
import { StartSideEffectsSetting } from '../src/shared/flow-settings';

/**
 * "A glance moves nothing" (S20): starting a task moves it to In Progress
 * and takes an unassigned one only after two minutes of timing.
 */
describe('side effects after two minutes', () => {
  let dbConn: DatabaseConnection;
  let tasks: TaskRepository;
  let engine: TimeTrackingEngine;
  let moves: string[];
  let claims: string[];
  let setting: StartSideEffectsSetting;

  const PROJECT: ProjectDTO = { id: 'P', key: 'P', name: 'Project', providerId: 'jira' } as ProjectDTO;
  const MINE: TaskDTO = { id: 'A', projectId: 'P', key: 'A-1', title: 'Mine', status: 'todo' };
  const FREE: TaskDTO = { id: 'F', projectId: 'P', key: 'F-1', title: 'Free', status: 'todo', ownership: 'unassigned' };

  const seconds = (n: number) => vi.advanceTimersByTime(n * 1000);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date(2026, 10, 10, 10, 0, 0));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    dbConn = new DatabaseConnection(':memory:');
    tasks = new TaskRepository(dbConn);
    const projects = new ProjectRepository(dbConn);
    projects.saveProject(PROJECT);
    tasks.saveTask(MINE);
    tasks.saveTask(FREE);
    moves = [];
    claims = [];
    setting = { enabled: true, afterSeconds: 120 };
    const manager = {
      getActiveProvider: () => ({ providerId: 'jira', minimumLoggableSeconds: 60 }),
      getProvider: () => ({ providerId: 'jira', minimumLoggableSeconds: 60 }),
      getProjects: async () => [PROJECT],
      getTasks: async () => [MINE, FREE],
      updateTaskStatus: async (id: string, status: string) => { moves.push(`${id}:${status}`); return true; },
      updateTaskStatusFor: async (_p: string, id: string, status: string) => { moves.push(`${id}:${status}`); return true; },
      assignToMeFor: async (_p: string, id: string) => { claims.push(id); return { outcome: 'assigned' }; },
      logTimeForProvider: () => new Promise(() => undefined)
    } as unknown as ProviderManager;
    engine = new TimeTrackingEngine(
      new SessionRepository(dbConn), new WorklogRepository(dbConn), tasks, manager, projects, undefined, () => setting
    );
  });

  afterEach(() => {
    engine.dispose();
    dbConn.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('After120sOfTracking_MovesItToInProgress', () => {
    engine.startTask(MINE.id);
    seconds(119);
    expect(moves).toEqual([]);
    expect(tasks.getTaskById(MINE.id)?.status).toBe('todo');

    seconds(1);

    expect(moves).toEqual(['A:in_progress']);
    expect(tasks.getTaskById(MINE.id)?.status).toBe('in_progress');
  });

  it('StoppedAt119s_NeverMovesIt', () => {
    engine.startTask(MINE.id);
    seconds(119);
    engine.stopSession('A glance');

    seconds(600);

    expect(moves).not.toContain('A:in_progress');
  });

  it('SwitchedAt60s_NeverMovesTheFirst', () => {
    engine.startTask(MINE.id);
    seconds(60);
    engine.startTask(FREE.id);

    seconds(120);

    expect(moves).not.toContain('A:in_progress');
    expect(claims).toEqual(['F']);
  });

  it('PausedTime_DoesNotCount', () => {
    engine.startTask(MINE.id);
    seconds(100);
    engine.pauseSession();
    seconds(600);
    engine.resumeSession();
    seconds(19);
    expect(moves).toEqual([]);

    seconds(1);

    expect(moves).toEqual(['A:in_progress']);
  });

  it('AnUnassignedTask_IsTakenOnlyAfterTheWait', async () => {
    engine.startTask(FREE.id);
    seconds(60);
    expect(claims).toEqual([]);

    seconds(60);
    await Promise.resolve();

    expect(claims).toEqual(['F']);
  });

  it('TurnedOff_NothingEverMoves', () => {
    setting = { enabled: false, afterSeconds: 120 };
    engine.startTask(FREE.id);

    seconds(3600);

    expect(moves).toEqual([]);
    expect(claims).toEqual([]);
  });

  it('NoWait_MovesAtTheStart', () => {
    setting = { enabled: true, afterSeconds: 0 };
    engine.startTask(MINE.id);

    expect(moves).toEqual(['A:in_progress']);
  });
});
