import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import { OWN_PROJECT_PROVIDER_ID, UNKNOWN_PROJECT_PROVIDER_ID } from '../src/shared/local-provider';

/**
 * A session's time goes back to the provider its task came from.
 *
 * It used to go to whichever provider was active when the session ended, so
 * switching from Jira to OpenProject mid-session sent a Jira issue's numeric
 * id to OpenProject -- where it can name a real, different work package.
 */
describe('the provider a session belongs to', () => {
  let dbConn: DatabaseConnection;
  let sessionRepo: SessionRepository;
  let worklogRepo: WorklogRepository;
  let taskRepo: TaskRepository;
  let projectRepo: ProjectRepository;
  let engine: TimeTrackingEngine;
  let activeId: string;
  let moves: Array<[string, string, string]>;

  const PROVIDERS: Record<string, { providerId: string; minimumLoggableSeconds: number }> = {
    jira: { providerId: 'jira', minimumLoggableSeconds: 60 },
    openproject: { providerId: 'openproject', minimumLoggableSeconds: 1 }
  };

  function project(id: string, providerId: string): void {
    projectRepo.saveProject({ id, key: id, name: id, providerId });
    taskRepo.saveTask({ id: `${id}-1`, projectId: id, key: `${id}-1`, title: 'Task', status: 'todo' });
  }

  const queued = () => worklogRepo.getSyncQueueSnapshot().items.map(i => ({ providerId: i.providerId, taskId: i.taskId }));

  const workFor = (seconds: number) => vi.setSystemTime(Date.now() + seconds * 1000);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T09:00:00.000Z'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    dbConn = new DatabaseConnection(':memory:');
    sessionRepo = new SessionRepository(dbConn);
    worklogRepo = new WorklogRepository(dbConn);
    taskRepo = new TaskRepository(dbConn);
    projectRepo = new ProjectRepository(dbConn);
    activeId = 'jira';
    moves = [];
    const manager = {
      getActiveProvider: () => PROVIDERS[activeId],
      getProvider: (id: string) => PROVIDERS[id],
      updateTaskStatus: async (taskId: string, status: string) => {
        moves.push([`active:${activeId}`, taskId, status]);
        return true;
      },
      updateTaskStatusFor: async (providerId: string, taskId: string, status: string) => {
        moves.push([providerId, taskId, status]);
        return true;
      },
      logTimeForProvider: () => new Promise(() => undefined)
    } as unknown as ProviderManager;
    engine = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo, manager, projectRepo);
    project('JIRA', 'jira');
    project('OP', 'openproject');
  });

  afterEach(() => {
    engine.dispose();
    dbConn.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('StopSession_ProviderSwitchedMidSession_QueuesForTheProviderTheTaskCameFrom', () => {
    engine.startTask('JIRA-1');
    activeId = 'openproject';
    workFor(600);

    engine.stopSession('Work');

    expect(queued()).toEqual([{ providerId: 'jira', taskId: 'JIRA-1' }]);
  });

  it('StopSession_ProviderSwitchedMidSession_HoldsToItsOwnProvidersMinimum', () => {
    // 30 seconds is enough for OpenProject; Jira, still active, cannot record it.
    engine.startTask('OP-1');
    workFor(30);

    engine.stopSession('Work');

    expect(queued()).toEqual([{ providerId: 'openproject', taskId: 'OP-1' }]);
  });

  it('StartAndFinish_ProviderSwitchedMidSession_MovesTheTaskOnItsOwnProvider', () => {
    engine.startTask('JIRA-1');
    activeId = 'openproject';
    workFor(600);

    engine.stopSession('Work', true);

    expect(moves).toEqual([
      ['jira', 'JIRA-1', 'in_progress'],
      ['jira', 'JIRA-1', 'done']
    ]);
  });

  it('StopSession_ProjectMadeInSprintTicker_IsKeptLocallyAndMovesNothing', () => {
    project('MINE', OWN_PROJECT_PROVIDER_ID);
    engine.startTask('MINE-1');
    workFor(600);

    engine.stopSession('Work', true);

    expect(queued()).toEqual([]);
    expect(moves).toEqual([]);
    expect(worklogRepo.getWorklogsByDate('2026-10-15').map(w => w.durationSeconds)).toEqual([600]);
  });

  it('StopSession_ProjectProviderNotKnown_KeepsTheOldRuleOfTheActiveProvider', () => {
    // The column's old default: an OpenProject project synced before the
    // adapter named itself, which must not be mistaken for one made here.
    project('OLD', UNKNOWN_PROJECT_PROVIDER_ID);
    activeId = 'openproject';
    engine.startTask('OLD-1');
    workFor(600);

    engine.stopSession('Work');

    expect(engine.getCurrentSession()).toBeNull();
    expect(queued()).toEqual([{ providerId: 'openproject', taskId: 'OLD-1' }]);
    expect(moves[0]).toEqual(['active:openproject', 'OLD-1', 'in_progress']);
  });

  it('Restart_MidSession_TheProviderIsReadBackWithIt', () => {
    engine.startTask('JIRA-1');

    expect(new SessionRepository(dbConn).getActiveSession()?.providerId).toBe('jira');
  });

  it('StartTask_AdHoc_RecordsNoProvider', () => {
    engine.startTask('', true, 'Whiteboard');

    expect(engine.getCurrentSession()?.providerId).toBeUndefined();
  });
});
