import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import { ActiveSessionDTO, ProjectDTO, TaskDTO } from '../src/shared/dtos';

/**
 * A tracked task renamed on the provider, or moved to another Jira project --
 * which gives it a new key and keeps its id.
 *
 * The session copies the key and title when it starts, and nothing wrote
 * them again: the task's own row followed the sync, while the bar and the
 * window showed the old names until the session ended.
 */
describe('A tracked task the provider renames', () => {
  let dbConn: DatabaseConnection;
  let taskRepo: TaskRepository;
  let engine: TimeTrackingEngine;
  let remoteProjects: ProjectDTO[];
  let remoteTasks: Record<string, TaskDTO[]>;
  let updates: Array<ActiveSessionDTO | null>;
  let providerDown: boolean;

  const MINE: TaskDTO = { id: '10001', projectId: '10000', key: 'SCRUM-2', title: 'Tache 2', status: 'todo' };

  const sync = () => engine.getSyncWorker().syncTasksAndProjects();
  const renameRemotely = (change: Partial<TaskDTO>) => {
    remoteTasks['10000'] = [{ ...MINE, ...change }];
  };

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    dbConn = new DatabaseConnection(':memory:');
    taskRepo = new TaskRepository(dbConn);
    remoteProjects = [{ id: '10000', key: 'SCRUM', name: 'My Software Team' }];
    remoteTasks = { '10000': [MINE] };
    providerDown = false;
    const manager = {
      getActiveProvider: () => ({ providerId: 'jira', minimumLoggableSeconds: 60 }),
      getProjects: async () => {
        if (providerDown) throw new Error('network down');
        return remoteProjects;
      },
      getTasks: async (projectId: string) => remoteTasks[projectId] ?? [],
      updateTaskStatus: async () => true,
      logTimeForProvider: () => new Promise(() => undefined)
    } as unknown as ProviderManager;
    engine = new TimeTrackingEngine(
      new SessionRepository(dbConn), new WorklogRepository(dbConn), taskRepo, manager, new ProjectRepository(dbConn)
    );
    await sync();
    updates = [];
    engine.subscribe(session => updates.push(session));
  });

  afterEach(() => {
    engine.dispose();
    dbConn.close();
    vi.restoreAllMocks();
  });

  it('Sync_TrackedTaskRenamed_TheSessionTakesTheNewTitle', async () => {
    engine.startTask(MINE.id);
    updates = [];
    renameRemotely({ title: 'Tache 2, reworded' });

    await sync();

    expect(engine.getCurrentSession()?.taskTitle).toBe('Tache 2, reworded');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.taskTitle).toBe('Tache 2, reworded');
  });

  it('Sync_TrackedTaskMovedToAnotherKey_TheSessionTakesTheNewKey', async () => {
    engine.startTask(MINE.id);
    renameRemotely({ key: 'OPS-14' });

    await sync();

    expect(engine.getCurrentSession()?.taskKey).toBe('OPS-14');
  });

  it('Sync_PausedTaskRenamed_TheSessionTakesTheNewTitle', async () => {
    engine.startTask(MINE.id);
    engine.pauseSession();
    renameRemotely({ title: 'Renamed while paused' });

    await sync();

    expect(engine.getCurrentSession()?.taskTitle).toBe('Renamed while paused');
    expect(engine.getCurrentSession()?.status).toBe('PAUSED');
  });

  it('Sync_NameUnchanged_TellsNoOne', async () => {
    // Every redraw of the bar is two HTTP requests; a sync every five
    // minutes that changed nothing must not cost one.
    engine.startTask(MINE.id);
    updates = [];

    await sync();

    expect(updates).toEqual([]);
  });

  it('Sync_NoSession_TellsNoOne', async () => {
    renameRemotely({ title: 'Renamed with nothing tracked' });

    await sync();

    expect(updates).toEqual([]);
    expect(engine.getCurrentSession()).toBeNull();
  });

  it('Sync_AdHocSession_KeepsTheNameTheUserGaveIt', async () => {
    // The sync owns no ad-hoc row: whatever that row says, the session's
    // name is the one the user typed, and it is the worklog's comment.
    const session = engine.startTask('', true, 'Refactor the build script');
    const row = taskRepo.getTaskById(session.taskId)!;
    taskRepo.updateTask({ ...row, title: 'Something else' });

    await sync();

    expect(engine.getCurrentSession()?.taskTitle).toBe('Refactor the build script');
  });

  it('Sync_ProviderFails_LeavesTheSessionAlone', async () => {
    engine.startTask(MINE.id);
    updates = [];
    // The row was renamed by something else; a failed sync is not the moment
    // to read it, since it committed nothing.
    taskRepo.saveTask({ ...MINE, title: 'Written locally' });
    providerDown = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await sync();

    expect(engine.getCurrentSession()?.taskTitle).toBe(MINE.title);
    expect(updates).toEqual([]);
  });

  it('Sync_ASyncedListenerThrows_TheSyncStillSucceeds', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    engine.getSyncWorker().onSynced(() => { throw new Error('reader broke'); });
    engine.startTask(MINE.id);
    renameRemotely({ title: 'Still renamed' });

    const result = await sync();

    expect(result.status).toBe('synced');
    expect(engine.getCurrentSession()?.taskTitle).toBe('Still renamed');
    expect(error).toHaveBeenCalledWith('[OfflineSyncWorker] Synced listener failed:', expect.any(Error));
  });
});
