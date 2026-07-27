import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { JiraProvider } from '../src/main/providers/jira-provider';
import { AdHocProvider } from '../src/main/providers/adhoc-provider';
import { NotionProvider } from '../src/main/providers/notion-provider';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';

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
    const result = await jiraProvider.logTime({
      taskId: 'PROJ-142',
      durationSeconds: 3600,
      startedAtUtc: new Date().toISOString(),
      comment: 'UnitTest',
      isAdHoc: false
    });

    expect(result.success).toBe(true);
    expect(result.remoteWorklogId).toContain('jira_wl_');
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
});
