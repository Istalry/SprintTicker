import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { AdHocProvider } from '../src/main/providers/adhoc-provider';
import { OpenProjectProvider } from '../src/main/providers/openproject-provider';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';
import { ProviderManager } from '../src/main/providers/provider-manager';
import { vi } from 'vitest';

describe('Task Providers & OfflineSyncWorker Unit Tests', () => {
  let dbConn: DatabaseConnection;
  let worklogRepo: WorklogRepository;
  let adhocProvider: AdHocProvider;
  let openProjectProvider: OpenProjectProvider;

  beforeEach(() => {
    dbConn = new DatabaseConnection(':memory:');
    worklogRepo = new WorklogRepository(dbConn);

    adhocProvider = new AdHocProvider();
    openProjectProvider = new OpenProjectProvider();
  });

  afterEach(() => {
    dbConn.close();
  });

  it('OpenProjectProvider_GetProjects_WithCredentials_FetchesFromApi', async () => {
    await openProjectProvider.initialize({ domain: 'https://op.test', apiToken: 'token' });
    
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        _embedded: {
          elements: [
            { id: 1, name: 'OP Project', identifier: 'op-proj' }
          ]
        }
      })
    } as unknown as Response);

    const projects = await openProjectProvider.getProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('OP Project');
    expect(projects[0].key).toBe('op-proj');

    global.fetch = originalFetch;
  });

  it('OpenProjectProvider_GetTasks_WithCredentials_FetchesFromApi', async () => {
    await openProjectProvider.initialize({ domain: 'https://op.test', apiToken: 'token' });
    
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        _embedded: {
          elements: [
            { id: 101, subject: 'OP Task', _links: { status: { href: '/api/v3/statuses/1' } } }
          ]
        }
      })
    } as unknown as Response);

    const tasks = await openProjectProvider.getTasks('1');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('OP Task');
    expect(tasks[0].key).toBe('OP-101');
    expect(tasks[0].status).toBe('todo');

    global.fetch = originalFetch;
  });

  it('OpenProjectProvider_LogTime_FormatsIso8601DurationAndPostsToApi', async () => {
    await openProjectProvider.initialize({ domain: 'https://op.test', apiToken: 'token' });

    const originalFetch = global.fetch;
    let postedUrl = '';
    let postedBody = '';

    global.fetch = vi.fn().mockImplementation(async (url: string, options: RequestInit = {}) => {
      postedUrl = url;
      postedBody = options.body as string;
      return {
        ok: true,
        json: async () => ({ id: 42 })
      };
    });

    const result = await openProjectProvider.logTime({
      taskId: 'OP-101',
      durationSeconds: 5400, // 1h 30m -> PT1H30M
      startedAtUtc: '2026-08-07T10:00:00Z',
      comment: 'Implemented player physics'
    });

    expect(result.success).toBe(true);
    expect(result.remoteWorklogId).toBe('42');
    expect(postedUrl).toContain('/api/v3/time_entries');
    expect(postedBody).toContain('"hours":"PT1H30M"');
    expect(postedBody).toContain('"href":"/api/v3/work_packages/101"');
    expect(postedBody).toContain('"spentOn":"2026-08-07"');

    global.fetch = originalFetch;
  });

  it('OpenProjectProvider_UpdateTaskStatus_ValidStatus_SendsPatchRequest', async () => {
    await openProjectProvider.initialize({ 
      domain: 'https://op.test', 
      apiToken: 'token',
      opStatusInProgress: '2',
      opStatusToTest: '3'
    });
    
    const originalFetch = global.fetch;
    let patchUrl = '';
    let patchBody = '';
    
    global.fetch = vi.fn().mockImplementation(async (url: string, options: RequestInit = {}) => {
      const method = options.method || 'GET';
      if (method === 'GET') {
        return {
          ok: true,
          json: async () => ({ lockVersion: 5 })
        };
      } else if (options.method === 'PATCH') {
        patchUrl = url;
        patchBody = options.body as string;
        return { ok: true };
      }
    });

    const result = await openProjectProvider.updateTaskStatus('OP-101', 'in_progress');
    expect(result).toBe(true);
    expect(patchUrl).toContain('/api/v3/work_packages/101');
    expect(patchBody).toContain('"lockVersion":5');
    expect(patchBody).toContain('"/api/v3/statuses/2"');

    global.fetch = originalFetch;
  });

  it('AdHocProvider_LogTime_CustomTask_LogsUnderFallbackTicket', async () => {
    await adhocProvider.initialize({ fallbackKey: 'ADMIN-1' });
    const projects = await adhocProvider.getProjects();
    const tasks = await adhocProvider.getTasks('ADHOC');
    const reconciliation = await adhocProvider.reconcileRemoteState();

    const result = await adhocProvider.logTime({
      taskId: 'adhoc_1',
      durationSeconds: 1800,
      startedAtUtc: new Date().toISOString(),
      comment: 'Sprint Planning',
      isAdHoc: true
    });

    expect(projects).toHaveLength(1);
    expect(tasks).toHaveLength(1);
    expect(reconciliation.remoteLoggedTimeToday).toBe(0);
    expect(result.success).toBe(true);
    expect(result.remoteWorklogId).toContain('adhoc_wl_');
  });

  it('AdHocProvider_UpdateTaskStatus_ReturnsFalse', async () => {
    const result = await adhocProvider.updateTaskStatus('ADHOC-1', 'done');
    expect(result).toBe(false);
  });

  it('OfflineSyncWorker_PendingQueue_ProcessesAndDrainsSyncQueue', async () => {
    // Arrange: Enqueue worklog items into SQLite
    worklogRepo.enqueueSyncItem({
      id: 'sync_101',
      providerId: 'openproject',
      taskId: 'OP-101',
      durationSeconds: 5400,
      startedAtUtc: new Date().toISOString(),
      comment: 'Offline Log 1'
    });
    worklogRepo.enqueueSyncItem({
      id: 'sync_102',
      providerId: 'openproject',
      taskId: 'OP-102',
      durationSeconds: 1800,
      startedAtUtc: new Date().toISOString(),
      comment: 'Offline Log 2'
    });

    expect(worklogRepo.getPendingQueueItems()).toHaveLength(2);

    // Mock providerManager
    const providerManager = {
      logTime: async () => ({ success: true }),
      getProjects: async () => [],
      getTasks: async () => []
    } as unknown as ProviderManager;

    // Act
    const worker = new OfflineSyncWorker(providerManager, worklogRepo, undefined, undefined, 60000);

    // Test offline state short circuit
    worker.setOnlineStatus(false);
    const offlineSummary = await worker.processPendingQueue();
    expect(offlineSummary.processed).toBe(0);

    // Test online state processing
    worker.setOnlineStatus(true);
    const summary = await worker.processPendingQueue();

    // Assert
    expect(summary.processed).toBe(2);
    expect(summary.succeeded).toBe(2);
    expect(worklogRepo.getPendingQueueItems()).toHaveLength(0);
  });

  it('OfflineSyncWorker_Start_IdempotentDoubleStart_DoesNotThrow', () => {
    const providerManager = { getProjects: async () => [], getTasks: async () => [] } as unknown as ProviderManager;
    const worker = new OfflineSyncWorker(providerManager, worklogRepo, undefined, undefined, 9999999);

    expect(() => {
      worker.start();
      worker.start();
    }).not.toThrow();

    worker.stop();
  });

  it('OfflineSyncWorker_Stop_ClearsTimer_AllowsRestartAfter', () => {
    const providerManager = { getProjects: async () => [], getTasks: async () => [] } as unknown as ProviderManager;
    const worker = new OfflineSyncWorker(providerManager, worklogRepo, undefined, undefined, 9999999);
    worker.start();
    worker.stop();

    expect(() => worker.start()).not.toThrow();
    worker.stop();
  });

  it('OfflineSyncWorker_ProcessPendingQueue_ProviderReturnsFailure_IncrementsFailedCount', async () => {
    worklogRepo.enqueueSyncItem({
      id: 'sync_fail_01',
      providerId: 'openproject',
      taskId: 'OP-999',
      durationSeconds: 3600,
      startedAtUtc: new Date().toISOString(),
      comment: 'Failure test'
    });

    const failingManager = {
      logTime: async () => ({ success: false }),
      getProjects: async () => [],
      getTasks: async () => []
    } as unknown as ProviderManager;

    const worker = new OfflineSyncWorker(failingManager, worklogRepo);
    const result = await worker.processPendingQueue();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('OfflineSyncWorker_ProcessPendingQueue_ProviderThrows_IncrementsFailedCount', async () => {
    worklogRepo.enqueueSyncItem({
      id: 'sync_throw_01',
      providerId: 'openproject',
      taskId: 'OP-998',
      durationSeconds: 1800,
      startedAtUtc: new Date().toISOString(),
      comment: 'Throw test'
    });

    const throwingManager = {
      logTime: async () => { throw new Error('Network timeout'); },
      getProjects: async () => [],
      getTasks: async () => []
    } as unknown as ProviderManager;

    const worker = new OfflineSyncWorker(throwingManager, worklogRepo);
    const result = await worker.processPendingQueue();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
  });
});

