import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';
import { ProviderRequestError } from '../src/main/providers/provider-errors';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import type { ProjectDTO, TaskDTO } from '../src/shared/dtos';

/**
 * Coverage for the reporting and single-flight behaviour of the project sync.
 *
 * Found by running the app rather than by reading it: the Projects view shows
 * `projectRepo.getAllProjects()`, which only the sync worker fills, and saving
 * provider credentials did not start a sync. The list therefore stayed empty
 * for up to a full five-minute interval, indistinguishable from a provider
 * that genuinely has no projects.
 */
describe('Project sync reporting and single-flight', () => {
  let dbConn: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let worklogRepo: WorklogRepository;

  beforeEach(() => {
    dbConn = new DatabaseConnection(':memory:');
    projectRepo = new ProjectRepository(dbConn);
    taskRepo = new TaskRepository(dbConn);
    worklogRepo = new WorklogRepository(dbConn);
  });

  afterEach(() => {
    dbConn.close();
    vi.restoreAllMocks();
  });

  /** A ProviderManager stub whose fetches behave however the test needs. */
  function managerStub(overrides: Partial<ProviderManager>): ProviderManager {
    return {
      getProjects: async (): Promise<ProjectDTO[]> => [],
      getTasks: async (): Promise<TaskDTO[]> => [],
      ...overrides
    } as unknown as ProviderManager;
  }

  function buildWorker(manager: ProviderManager): OfflineSyncWorker {
    return new OfflineSyncWorker(manager, worklogRepo, projectRepo, taskRepo);
  }

  it('SyncTasksAndProjects_Succeeds_ReportsWhatItActuallyWrote', async () => {
    const worker = buildWorker(
      managerStub({
        getProjects: async () => [{ id: 'P1', key: 'ALPHA', name: 'Alpha' }],
        getTasks: async () => [
          { id: 'T1', projectId: 'P1', key: 'ALPHA-1', title: 'One', status: 'todo' },
          { id: 'T2', projectId: 'P1', key: 'ALPHA-2', title: 'Two', status: 'todo' }
        ]
      })
    );

    const result = await worker.syncTasksAndProjects();

    expect(result).toEqual({ status: 'synced', projects: 1, tasks: 2 });
  });

  it('SyncTasksAndProjects_NotConfigured_IsReportedDistinctlyFromAnEmptyRemote', async () => {
    // The whole point: "you have not set this up" and "you have no projects"
    // must not look the same to the caller.
    const worker = buildWorker(
      managerStub({
        getProjects: async () => {
          throw ProviderRequestError.notConfigured('openproject');
        }
      })
    );

    const result = await worker.syncTasksAndProjects();

    expect(result.status).toBe('not_configured');
    expect(result.reason).toContain('not configured');
  });

  it('SyncTasksAndProjects_EmptyRemote_ReportsSyncedWithZero', async () => {
    const worker = buildWorker(managerStub({ getProjects: async () => [] }));

    const result = await worker.syncTasksAndProjects();

    expect(result).toEqual({ status: 'synced', projects: 0, tasks: 0 });
  });

  it('SyncTasksAndProjects_TransportFailure_ReportsFailedAndLeavesTheCache', async () => {
    projectRepo.saveProject({ id: 'local-1', key: 'LOCAL', name: 'Local' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const worker = buildWorker(
      managerStub({
        getProjects: async () => {
          throw ProviderRequestError.fromTransport('openproject', 'Fetching projects', new Error('ECONNREFUSED'));
        }
      })
    );

    const result = await worker.syncTasksAndProjects();

    expect(result.status).toBe('failed');
    expect(projectRepo.getAllProjects()).toHaveLength(1);
  });

  it('SyncTasksAndProjects_SecondCallWhileTheFirstIsInFlight_IsRefusedRatherThanOverlapped', async () => {
    // Two passes each prune against their own snapshot, so the slower one can
    // delete what the faster one just wrote. There are two callers now -- the
    // timer and the settings save -- so this is reachable.
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const worker = buildWorker(
      managerStub({
        getProjects: async () => {
          await gate;
          return [{ id: 'P1', key: 'ALPHA', name: 'Alpha' }];
        }
      })
    );

    const first = worker.syncTasksAndProjects();
    const second = await worker.syncTasksAndProjects();

    expect(second.status).toBe('skipped');
    expect(second.reason).toContain('already running');

    release();
    expect((await first).status).toBe('synced');
  });

  it('SyncTasksAndProjects_AfterAnInFlightPassCompletes_RunsAgainNormally', async () => {
    // The guard must clear even though the body returns from several places.
    const worker = buildWorker(
      managerStub({ getProjects: async () => [{ id: 'P1', key: 'ALPHA', name: 'Alpha' }] })
    );

    await worker.syncTasksAndProjects();
    const second = await worker.syncTasksAndProjects();

    expect(second.status).toBe('synced');
  });

  it('SyncTasksAndProjects_Offline_IsReportedAsSkippedNotSynced', async () => {
    const worker = buildWorker(managerStub({}));
    worker.setOnlineStatus(false);

    const result = await worker.syncTasksAndProjects();

    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('Offline');
  });
});
