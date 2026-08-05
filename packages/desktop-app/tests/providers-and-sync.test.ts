import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { JiraProvider } from '../src/main/providers/jira-provider';
import { AdHocProvider } from '../src/main/providers/adhoc-provider';
import { NotionProvider } from '../src/main/providers/notion-provider';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';
import { TaskProvider } from '../src/main/sync/task-provider';

describe('Task Providers & OfflineSyncWorker Unit Tests', () => {
  let dbConn: DatabaseConnection;
  let worklogRepo: WorklogRepository;
  let jiraProvider: JiraProvider;
  let adhocProvider: AdHocProvider;
  let notionProvider: NotionProvider;

  beforeEach(() => {
    dbConn = new DatabaseConnection(':memory:');
    worklogRepo = new WorklogRepository(dbConn);

    jiraProvider = new JiraProvider();
    adhocProvider = new AdHocProvider();
    notionProvider = new NotionProvider();
  });

  afterEach(() => {
    dbConn.close();
  });

  it('JiraProvider_GetProjectsAndTasks_ReturnsConfiguredProjectsAndIssues', async () => {
    await jiraProvider.initialize({ domain: 'https://test.atlassian.net', apiToken: 'token', email: 'user@test.com' });
    const projects = await jiraProvider.getProjects();
    const tasks = await jiraProvider.getTasks('PROJ');
    const reconciliation = await jiraProvider.reconcileRemoteState();

    expect(projects).toHaveLength(3);
    expect(tasks).toHaveLength(3);
    expect(tasks[0].key).toBe('PROJ-142');
    expect(reconciliation.remoteLoggedTimeToday).toBe(8100);
  });

    it('JiraProvider_LogTime_ValidPayload_ReturnsRemoteWorklogId', async () => {
      const provider = new JiraProvider();
      const res = await provider.logTime({
        taskId: 'PROJ-142',
        durationSeconds: 3600,
        comment: 'UnitTest',
        startedAtUtc: new Date().toISOString()
      });
      expect(res.success).toBe(true);
      expect(res.remoteWorklogId).toMatch(/^jira_wl_/);
    });

    it('JiraProvider_LogTime_WithCredentials_SubmitsViaFetch', async () => {
      // Create provider with credentials to hit the fetch path
      const providerWithCreds = new JiraProvider();
      await providerWithCreds.initialize({
        email: 'test@example.com',
        apiToken: 'secret',
        domain: 'https://test.atlassian.net'
      });
      
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'remote_123' })
      } as unknown as Response);

      const res = await providerWithCreds.logTime({
        taskId: 'PROJ-142',
        durationSeconds: 3600,
        comment: 'UnitTest'
      });

      expect(res.success).toBe(true);
      expect(res.remoteWorklogId).toBe('remote_123');
      expect(global.fetch).toHaveBeenCalled();

      global.fetch = originalFetch;
    });

    it('JiraProvider_GetCredentials_ReturnsConfiguredValues', async () => {
      const provider = new JiraProvider();
      await provider.initialize({ email: 'a', apiToken: 'b', domain: 'c' });
      const creds = provider.getCredentials();
      expect(creds.email).toBe('a');
      expect(creds.apiToken).toBe('b');
      expect(creds.domain).toBe('c');
    });

    it('JiraProvider_GetTasks_WithCredentials_FetchesFromApi', async () => {
      const provider = new JiraProvider();
      await provider.initialize({ email: 'a', apiToken: 'b', domain: 'https://c.net' });
      
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          issues: [
            { id: '1', key: 'TEST-1', fields: { summary: 'Task 1', status: { name: 'To Do' } } }
          ]
        })
      } as unknown as Response);

      const tasks = await provider.getTasks('TEST');
      expect(tasks.length).toBe(1);
      expect(tasks[0].id).toBe('TEST-1');
      expect(global.fetch).toHaveBeenCalled();

      global.fetch = originalFetch;
    });

  it('JiraProvider_InvalidPayload_ThrowsError', async () => {
    await expect(jiraProvider.logTime({
      taskId: '',
      durationSeconds: -1,
      startedAtUtc: new Date().toISOString(),
      comment: '',
      isAdHoc: false
    })).rejects.toThrow();
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

  it('NotionProvider_GetProjectsAndTasks_ReturnsDatabaseRecords', async () => {
    await notionProvider.initialize({});
    const projects = await notionProvider.getProjects();
    const tasks = await notionProvider.getTasks('NOTION-1');
    const reconciliation = await notionProvider.reconcileRemoteState();
    const result = await notionProvider.logTime({
      taskId: 'NOTION-101',
      durationSeconds: 1200,
      startedAtUtc: new Date().toISOString(),
      comment: 'Notion log',
      isAdHoc: false
    });

    expect(projects[0].key).toBe('NOTION');
    expect(tasks[0].key).toBe('NOTION-101');
    expect(reconciliation.remoteLoggedTimeToday).toBe(0);
    expect(result.success).toBe(true);
  });

  it('OfflineSyncWorker_PendingQueue_ProcessesAndDrainsSyncQueue', async () => {
    // Arrange: Enqueue worklog items into SQLite
    worklogRepo.enqueueSyncItem({
      id: 'sync_101',
      providerId: 'jira',
      taskId: 'PROJ-142',
      durationSeconds: 5400,
      startedAtUtc: new Date().toISOString(),
      comment: 'Offline Log 1'
    });
    worklogRepo.enqueueSyncItem({
      id: 'sync_102',
      providerId: 'jira',
      taskId: 'PROJ-145',
      durationSeconds: 1800,
      startedAtUtc: new Date().toISOString(),
      comment: 'Offline Log 2'
    });

    expect(worklogRepo.getPendingQueueItems()).toHaveLength(2);

    // Act
    const worker = new OfflineSyncWorker(jiraProvider, worklogRepo, 60000);
    worker.setProvider(jiraProvider);

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
    // Arrange
    const worker = new OfflineSyncWorker(jiraProvider, worklogRepo, 9999999);

    // Act & Assert — calling start() twice should not throw or duplicate the interval
    expect(() => {
      worker.start();
      worker.start(); // second call is a no-op due to timerId guard
    }).not.toThrow();

    worker.stop();
  });

  it('OfflineSyncWorker_Stop_ClearsTimer_AllowsRestartAfter', () => {
    // Arrange
    const worker = new OfflineSyncWorker(jiraProvider, worklogRepo, 9999999);
    worker.start();

    // Act
    worker.stop();

    // Can be started again after stop without issue
    expect(() => worker.start()).not.toThrow();
    worker.stop();
  });

  it('OfflineSyncWorker_ProcessPendingQueue_ProviderReturnsFailure_IncrementsFailedCount', async () => {
    // Arrange: enqueue one item
    worklogRepo.enqueueSyncItem({
      id: 'sync_fail_01',
      providerId: 'jira',
      taskId: 'PROJ-999',
      durationSeconds: 3600,
      startedAtUtc: new Date().toISOString(),
      comment: 'Failure test'
    });

    // Mock provider returning { success: false }
    const failingProvider = {
      providerId: 'jira',
      providerName: 'Jira (Failing)',
      initialize: async () => true,
      getProjects: async () => [],
      getTasks: async () => [],
      reconcileRemoteState: async () => ({ remoteLoggedTimeToday: 0 }),
      logTime: async () => ({ success: false })
    };

    const worker = new OfflineSyncWorker(failingProvider as unknown as TaskProvider, worklogRepo);
    const result = await worker.processPendingQueue();

    // Assert
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
  });

  it('OfflineSyncWorker_ProcessPendingQueue_ProviderThrows_IncrementsFailedCount', async () => {
    // Arrange: enqueue one item
    worklogRepo.enqueueSyncItem({
      id: 'sync_throw_01',
      providerId: 'jira',
      taskId: 'PROJ-998',
      durationSeconds: 1800,
      startedAtUtc: new Date().toISOString(),
      comment: 'Throw test'
    });

    const throwingProvider = {
      providerId: 'jira',
      providerName: 'Jira (Throwing)',
      initialize: async () => true,
      getProjects: async () => [],
      getTasks: async () => [],
      reconcileRemoteState: async () => ({ remoteLoggedTimeToday: 0 }),
      logTime: async () => { throw new Error('Network timeout'); }
    };

    const worker = new OfflineSyncWorker(throwingProvider as unknown as TaskProvider, worklogRepo);
    const result = await worker.processPendingQueue();

    // Assert
    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
  });
});
