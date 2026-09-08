import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { OpenProjectProvider } from '../src/main/providers/openproject-provider';
import { ProviderRequestError, isProviderRequestError } from '../src/main/providers/provider-errors';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import type { ProjectDTO, TaskDTO } from '../src/shared/dtos';

/**
 * Regression coverage for the cache-wipe class of bug (audit F-01).
 *
 * A provider that reported failure as an empty array was indistinguishable
 * from a provider reporting that the remote is genuinely empty. The sync
 * worker treats its fetch as authoritative and prunes anything missing from
 * it, so one failed request -- or simply launching before credentials were
 * entered -- deleted every locally cached project and task.
 */
describe('Provider contract and cache-prune safety', () => {
  let dbConn: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let worklogRepo: WorklogRepository;
  const originalFetch = global.fetch;

  /**
   * Backoff, neutered. providerFetch retries a failed GET; what it retries and
   * how long it waits belongs to `provider-http.test.ts`, not here.
   */
  const noBackoff = { sleepFn: async (): Promise<void> => undefined };

  /** Seeds the local cache with one project and one task. */
  function seedCache(): void {
    projectRepo.saveProject({ id: 'P1', key: 'PROJ', name: 'Local Project' });
    taskRepo.saveTask({
      id: 'T1',
      projectId: 'P1',
      key: 'PROJ-1',
      title: 'Local Task',
      status: 'todo'
    });
  }

  /** A ProviderManager stub whose fetches behave however the test needs. */
  function managerStub(overrides: Partial<ProviderManager>): ProviderManager {
    return {
      getProjects: async () => [],
      getTasks: async () => [],
      ...overrides
    } as unknown as ProviderManager;
  }

  beforeEach(() => {
    dbConn = new DatabaseConnection(':memory:');
    projectRepo = new ProjectRepository(dbConn);
    taskRepo = new TaskRepository(dbConn);
    worklogRepo = new WorklogRepository(dbConn);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    dbConn.close();
  });

  describe('OpenProjectProvider signals failure by throwing', () => {
    it('GetProjects_NoCredentials_ThrowsNotConfiguredInsteadOfReturningEmpty', async () => {
      const provider = new OpenProjectProvider(noBackoff);
      await provider.initialize({ domain: '', apiToken: '' });

      await expect(provider.getProjects()).rejects.toThrow(ProviderRequestError);
      await provider.getProjects().catch((e: unknown) => {
        expect(isProviderRequestError(e) && e.kind).toBe('not_configured');
        expect(isProviderRequestError(e) && e.isPermanent).toBe(true);
      });
    });

    it('GetTasks_NoCredentials_ThrowsNotConfigured', async () => {
      const provider = new OpenProjectProvider(noBackoff);
      await provider.initialize({ domain: '', apiToken: '' });

      await expect(provider.getTasks('P1')).rejects.toMatchObject({ kind: 'not_configured' });
    });

    it('GetProjects_NetworkUnreachable_ThrowsTransportError', async () => {
      const provider = new OpenProjectProvider(noBackoff);
      await provider.initialize({ domain: 'https://op.test', apiToken: 'token' });
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(provider.getProjects()).rejects.toMatchObject({ kind: 'transport' });
    });

    it('GetProjects_Unauthorized_ThrowsPermanentAuthError', async () => {
      const provider = new OpenProjectProvider(noBackoff);
      await provider.initialize({ domain: 'https://op.test', apiToken: 'bad' });
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 } as unknown as Response);

      const err = await provider.getProjects().catch((e: unknown) => e);
      expect(isProviderRequestError(err)).toBe(true);
      expect((err as ProviderRequestError).kind).toBe('auth');
      expect((err as ProviderRequestError).isPermanent).toBe(true);
    });

    it('GetProjects_MalformedBody_ThrowsProtocolErrorRatherThanReportingNoProjects', async () => {
      const provider = new OpenProjectProvider(noBackoff);
      await provider.initialize({ domain: 'https://op.test', apiToken: 'token' });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ unexpected: 'shape' })
      } as unknown as Response);

      await expect(provider.getProjects()).rejects.toMatchObject({ kind: 'protocol' });
    });

    it('LogTime_Unauthorized_ThrowsInsteadOfReportingAPlainFailure', async () => {
      // It used to log and return `{ success: false }`. That reached the sync
      // queue as the string "Provider reported failure" -- identical whether
      // the key had been revoked or the wifi had dropped -- so the queue
      // retried a revoked key to its attempt ceiling and then parked the
      // worklog with nothing to explain it.
      const provider = new OpenProjectProvider(noBackoff);
      await provider.initialize({ domain: 'https://op.test', apiToken: 'revoked' });
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'You did not provide the correct credentials.' })
      } as unknown as Response);

      const err = await provider
        .logTime({
          taskId: 'OP-1',
          durationSeconds: 3600,
          startedAtUtc: '2026-01-01T09:00:00.000Z',
          comment: 'work',
          isAdHoc: false
        })
        .catch((e: unknown) => e);

      expect(isProviderRequestError(err)).toBe(true);
      expect((err as ProviderRequestError).kind).toBe('auth');
      expect((err as ProviderRequestError).isPermanent).toBe(true);
    });

    it('LogTime_NoCredentials_ThrowsNotConfiguredRatherThanSilentlyDoingNothing', async () => {
      const provider = new OpenProjectProvider(noBackoff);
      await provider.initialize({ domain: '', apiToken: '' });

      await expect(
        provider.logTime({
          taskId: 'OP-1',
          durationSeconds: 3600,
          startedAtUtc: '2026-01-01T09:00:00.000Z',
          comment: 'work',
          isAdHoc: false
        })
      ).rejects.toMatchObject({ kind: 'not_configured' });
    });

    it('LogTime_ZeroDuration_ThrowsArgumentExceptionWithoutIssuingARequest', async () => {
      // Fail fast on the caller's mistake, and do not let it look like a
      // provider outage the queue should retry.
      const provider = new OpenProjectProvider(noBackoff);
      await provider.initialize({ domain: 'https://op.test', apiToken: 'token' });
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      await expect(
        provider.logTime({
          taskId: 'OP-1',
          durationSeconds: 0,
          startedAtUtc: '2026-01-01T09:00:00.000Z',
          comment: 'work',
          isAdHoc: false
        })
      ).rejects.toThrow(/durationSeconds/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('UpdateTaskStatus_RequestFails_ThrowsRatherThanReturningFalse', async () => {
      // `false` was indistinguishable from "this provider does not support
      // status changes", which is what AdHoc legitimately returns.
      const provider = new OpenProjectProvider(noBackoff);
      await provider.initialize({
        domain: 'https://op.test',
        apiToken: 'token',
        opStatusInProgress: '7'
      });
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: 'nope' })
      } as unknown as Response);

      await expect(provider.updateTaskStatus('OP-1', 'in_progress')).rejects.toMatchObject({
        kind: 'auth'
      });
    });

    it('SanitizeDomain_BareHost_AssumesTlsRatherThanClearText', async () => {
      // The API key travels in a Basic header on every request, so a default of
      // `http://` leaked a permanent credential to anyone on the path whenever
      // the user typed a host without a scheme -- which the settings field
      // invites, since it is labelled as a domain.
      expect(OpenProjectProvider.sanitizeDomain('op.example.com')).toBe('https://op.example.com');
    });

    it('SanitizeDomain_ExplicitHttp_IsLeftAlone', async () => {
      // A self-hosted instance on plain HTTP is still supported; it just has to
      // say so, rather than being assumed.
      expect(OpenProjectProvider.sanitizeDomain('http://op.local:8080')).toBe('http://op.local:8080');
    });

    it('GetProjects_GenuinelyEmptyRemote_ReturnsEmptyArrayWithoutThrowing', async () => {
      // The one case that must still be an empty array: a well-formed response
      // whose collection happens to be empty.
      const provider = new OpenProjectProvider(noBackoff);
      await provider.initialize({ domain: 'https://op.test', apiToken: 'token' });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ _embedded: { elements: [] } })
      } as unknown as Response);

      await expect(provider.getProjects()).resolves.toEqual([]);
    });
  });

  describe('OfflineSyncWorker never prunes against a failed or partial fetch', () => {
    it('SyncTasksAndProjects_ProviderNotConfigured_LeavesLocalCacheIntact', async () => {
      seedCache();
      const worker = new OfflineSyncWorker(
        managerStub({
          getProjects: async () => {
            throw ProviderRequestError.notConfigured('openproject');
          }
        }),
        worklogRepo,
        projectRepo,
        taskRepo
      );

      await worker.syncTasksAndProjects();

      expect(projectRepo.getAllProjects()).toHaveLength(1);
      expect(taskRepo.getTasksByProjectId('P1')).toHaveLength(1);
    });

    it('SyncTasksAndProjects_FetchFails_LeavesLocalCacheIntact', async () => {
      seedCache();
      const worker = new OfflineSyncWorker(
        managerStub({
          getProjects: async () => {
            throw ProviderRequestError.fromTransport('openproject', 'Fetching projects', new Error('offline'));
          }
        }),
        worklogRepo,
        projectRepo,
        taskRepo
      );

      await worker.syncTasksAndProjects();

      expect(projectRepo.getAllProjects()).toHaveLength(1);
      expect(taskRepo.getTasksByProjectId('P1')).toHaveLength(1);
    });

    it('SyncTasksAndProjects_TaskFetchFailsPartway_CommitsNothing', async () => {
      // Projects resolve, but the second project's tasks fail. Under the old
      // write-as-you-go loop the first project was already saved and pruned
      // against, reconciling the cache to a view that was never complete.
      seedCache();
      const remoteProjects: ProjectDTO[] = [
        { id: 'R1', key: 'R1', name: 'Remote One' },
        { id: 'R2', key: 'R2', name: 'Remote Two' }
      ];
      const worker = new OfflineSyncWorker(
        managerStub({
          getProjects: async () => remoteProjects,
          getTasks: async (projectId: string) => {
            if (projectId === 'R2') {
              throw ProviderRequestError.fromTransport('openproject', 'Fetching tasks', new Error('timeout'));
            }
            return [{ id: 'RT1', projectId, key: 'R1-1', title: 'Remote Task', status: 'todo' }] as TaskDTO[];
          }
        }),
        worklogRepo,
        projectRepo,
        taskRepo
      );

      await worker.syncTasksAndProjects();

      // Nothing committed: the original cache is untouched and no remote
      // project leaked in from the half-finished pass.
      const projects = projectRepo.getAllProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe('P1');
    });

    it('SyncTasksAndProjects_CompleteFetch_ReplacesCacheAndPrunesRemovedItems', async () => {
      // The prune must still work when the fetch genuinely succeeded.
      seedCache();
      const worker = new OfflineSyncWorker(
        managerStub({
          getProjects: async () => [{ id: 'R1', key: 'R1', name: 'Remote One' }] as ProjectDTO[],
          getTasks: async (projectId: string) =>
            [{ id: 'RT1', projectId, key: 'R1-1', title: 'Remote Task', status: 'todo' }] as TaskDTO[]
        }),
        worklogRepo,
        projectRepo,
        taskRepo
      );

      await worker.syncTasksAndProjects();

      const projects = projectRepo.getAllProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe('R1');
      expect(taskRepo.getTasksByProjectId('R1')).toHaveLength(1);
    });

    it('SyncTasksAndProjects_RemoteGenuinelyEmpty_DoesPruneEverything', async () => {
      // Distinguishing failure from emptiness only matters if emptiness still
      // prunes. A successful fetch returning no projects is authoritative.
      seedCache();
      const worker = new OfflineSyncWorker(
        managerStub({ getProjects: async () => [] }),
        worklogRepo,
        projectRepo,
        taskRepo
      );

      await worker.syncTasksAndProjects();

      expect(projectRepo.getAllProjects()).toHaveLength(0);
    });
  });
});
