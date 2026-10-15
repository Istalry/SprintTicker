import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import { buildNotification, createFakeOpenProject } from '../../../scripts/fake-openproject.js';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { ProviderManager } from '../src/main/providers/provider-manager';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';
import { OpenProjectProvider } from '../src/main/providers/openproject-provider';
import { WorklogCorrectionService } from '../src/main/services/worklog-correction-service';
import { isProviderRequestError } from '../src/main/providers/provider-errors';
import { ProviderSettingKey } from '../src/shared/provider-settings';
import { ProviderEventService } from '../src/main/services/provider-event-service';
import { ToastRequest } from '../src/main/services/toast-presenter';

/**
 * End-to-end coverage of the provider layer over a real socket.
 *
 * Everything else that touches this area mocks `fetch`, which proves the walker
 * follows `nextByOffset` but says nothing about whether the app agrees: whether
 * the URL the provider builds is one a server routes, whether credentials read
 * out of settings reach the provider, and -- the one that cost real data --
 * whether the prune measures itself against the whole collection or just its
 * first page.
 *
 * The server is `scripts/fake-openproject.js`, the same harness used by hand
 * for a live run, bound here to an ephemeral port. Hermetic: loopback only, no
 * fixtures on disk, in-memory database.
 */
describe('Provider layer against a live OpenProject-shaped server', () => {
  const PROJECT_COUNT = 25;
  const WORK_PACKAGES = 47;
  const PAGE_SIZE = 20;
  // Types cycle Task/Bug/Feature/Epic/Milestone; the provider drops the last
  // two, leaving 29 of 47.
  const EXPECTED_TASKS_PER_PROJECT = 29;

  let server: ReturnType<typeof createFakeOpenProject>['server'];
  let requests: ReturnType<typeof createFakeOpenProject>['requests'];
  let timeEntries: ReturnType<typeof createFakeOpenProject>['timeEntries'];
  let baseUrl: string;

  let dbConn: DatabaseConnection;
  let settingsRepo: SettingsRepository;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let worklogRepo: WorklogRepository;

  beforeAll(async () => {
    const fake = createFakeOpenProject({
      projects: PROJECT_COUNT,
      workPackages: WORK_PACKAGES,
      pageSize: PAGE_SIZE,
      quiet: true
    });
    server = fake.server;
    requests = fake.requests;
    timeEntries = fake.timeEntries;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  beforeEach(() => {
    dbConn = new DatabaseConnection(':memory:');
    settingsRepo = new SettingsRepository(dbConn);
    projectRepo = new ProjectRepository(dbConn);
    taskRepo = new TaskRepository(dbConn);
    worklogRepo = new WorklogRepository(dbConn);
    requests.length = 0;
  });

  afterEach(() => {
    dbConn.close();
    vi.restoreAllMocks();
  });

  /** Wires a real manager and worker, reading credentials the way the app does. */
  function buildWorker(domain: string): OfflineSyncWorker {
    settingsRepo.setSetting(ProviderSettingKey.OP_DOMAIN, domain);
    settingsRepo.setSetting(ProviderSettingKey.OP_API_KEY, 'any-key-works');
    const manager = new ProviderManager(settingsRepo);
    return new OfflineSyncWorker(manager, worklogRepo, projectRepo, taskRepo);
  }

  it('CorrectingAWorklog_ThroughTheWholeStack_ReachesTheServer', async () => {
    // Database, manager, worker, adapter and HTTP, all real: a worklog sent,
    // corrected, corrected again as if sent before its id was kept, and
    // deleted, against a server that keeps what it is told.
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    settingsRepo.setSetting(ProviderSettingKey.OP_DOMAIN, baseUrl);
    settingsRepo.setSetting(ProviderSettingKey.OP_API_KEY, 'any-key-works');
    const manager = new ProviderManager(settingsRepo);
    const worker = new OfflineSyncWorker(manager, worklogRepo, projectRepo, taskRepo);
    const service = new WorklogCorrectionService(worklogRepo, manager, () => undefined);
    const start = '2026-10-13T09:00:00.000Z';
    taskRepo.ensureTaskExists({ id: 'OP-7001', key: 'OP-7001', title: 'Fake', projectId: '7' });
    worklogRepo.saveWorklog({
      id: 'w-e2e', sessionId: 's', taskId: 'OP-7001', durationSeconds: 7200, startedAtUtc: start,
      comment: 'Pairing', createdAtUtc: start
    });
    worklogRepo.enqueueSyncItem({
      id: 'sync_e2e_00000001', providerId: 'openproject', taskId: 'OP-7001', durationSeconds: 7200,
      startedAtUtc: start, comment: 'Pairing', worklogId: 'w-e2e'
    });
    const entry = () => [...timeEntries.values()].find(e => String(e.comment?.raw).includes('[#00000001]'));

    await worker.processPendingQueue();
    expect(entry()).toMatchObject({ hours: 'PT2H' });

    service.correct('w-e2e', { durationSeconds: 5400, startedAtUtc: start, comment: 'Pairing, fixed' });
    await worker.processPendingQueue();
    expect(entry()).toMatchObject({ hours: 'PT1H30M', comment: { raw: 'Pairing, fixed [#00000001]' } });

    dbConn.getDb().prepare('UPDATE worklog_sync_queue SET remote_worklog_id = NULL').run();
    service.correct('w-e2e', { durationSeconds: 3600, startedAtUtc: start, comment: 'Pairing, fixed' });
    await worker.processPendingQueue();
    expect(entry()).toMatchObject({ hours: 'PT1H' });
    expect(requests.some(r => r.method === 'GET' && r.pathname === '/api/v3/time_entries')).toBe(true);

    service.remove('w-e2e');
    await worker.processPendingQueue();
    expect(entry()).toBeUndefined();
    expect(worklogRepo.getSyncQueueSnapshot().counts).toMatchObject({ pending: 0, failed: 0 });
  });

  it('SyncTasksAndProjects_MultiPageRemote_CachesEveryProjectNotJustTheFirstPage', async () => {
    const worker = buildWorker(baseUrl);

    await worker.syncTasksAndProjects();

    const cached = projectRepo.getAllProjects();
    expect(cached).toHaveLength(PROJECT_COUNT);
    // The name check is the one that would have failed before F-12: 25 rows
    // could also mean "20 fetched twice".
    expect(cached.map(p => p.name)).toContain(`Fake Project ${PROJECT_COUNT} (LAST)`);
  });

  it('SyncTasksAndProjects_MultiPageWorkPackages_CachesEveryTaskAcrossAllPages', async () => {
    const worker = buildWorker(baseUrl);

    await worker.syncTasksAndProjects();

    const tasks = taskRepo.getTasksByProjectId('7');
    expect(tasks).toHaveLength(EXPECTED_TASKS_PER_PROJECT);
    // Page three of three, so the walk did not stop early.
    expect(tasks.map(t => t.key)).toContain('OP-7047');
  });

  it('SyncTasksAndProjects_MultiPageRemote_ActuallyRequestsEveryPage', async () => {
    const worker = buildWorker(baseUrl);

    await worker.syncTasksAndProjects();

    const projectPages = requests.filter(r => r.pathname === '/api/v3/projects');
    expect(projectPages.map(r => r.offset)).toEqual([1, 2]);
    // The opening request asks for more than one page's worth; the server
    // clamps it to its maximum. Every later request carries the server's own
    // pageSize, because the walk follows `nextByOffset` verbatim rather than
    // recomputing offsets it would have to guess the semantics of.
    expect(projectPages[0].requestedPageSize).toBeGreaterThan(PAGE_SIZE);
    expect(projectPages.slice(1).every(r => r.requestedPageSize === PAGE_SIZE)).toBe(true);
    expect(projectPages.every(r => r.pageSize === PAGE_SIZE)).toBe(true);
  });

  it('SyncTasksAndProjects_LocalProjectAbsentFromRemote_IsPruned', async () => {
    // The prune must still work. A fix for over-deletion that quietly stopped
    // deleting would leave the cache growing forever.
    projectRepo.saveProject({ id: 'stale-1', key: 'GONE', name: 'Deleted Upstream' });
    const worker = buildWorker(baseUrl);

    await worker.syncTasksAndProjects();

    expect(projectRepo.getAllProjects().map(p => p.id)).not.toContain('stale-1');
  });

  it('SyncTasksAndProjects_ServerUnreachable_LeavesTheCacheIntact', async () => {
    projectRepo.saveProject({ id: 'local-1', key: 'LOCAL', name: 'Local Project' });
    taskRepo.saveTask({ id: 'local-t1', projectId: 'local-1', key: 'LOCAL-1', title: 'Local Task', status: 'todo' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Port 1 is privileged and closed: a transport failure, not a 404.
    const worker = buildWorker('http://127.0.0.1:1');

    await worker.syncTasksAndProjects();

    expect(projectRepo.getAllProjects()).toHaveLength(1);
    expect(taskRepo.getTasksByProjectId('local-1')).toHaveLength(1);
  });

  it('SyncTasksAndProjects_NoCredentials_LeavesTheCacheIntactAndIssuesNoRequest', async () => {
    // The first-launch case that used to wipe everything: unconfigured read as
    // "the remote has nothing".
    projectRepo.saveProject({ id: 'local-1', key: 'LOCAL', name: 'Local Project' });
    settingsRepo.setSetting(ProviderSettingKey.OP_DOMAIN, '');
    settingsRepo.setSetting(ProviderSettingKey.OP_API_KEY, '');
    const manager = new ProviderManager(settingsRepo);
    const worker = new OfflineSyncWorker(manager, worklogRepo, projectRepo, taskRepo);

    await worker.syncTasksAndProjects();

    expect(projectRepo.getAllProjects()).toHaveLength(1);
    expect(requests).toHaveLength(0);
  });
});

/**
 * Notifications over the same socket: the provider's request, the fake's
 * answer, and the event service's cursor, all real. What the unit tests stub
 * is exactly what this one does not.
 */
describe('Correcting a time entry on a live OpenProject-shaped server', () => {
  const START = '2026-09-09T10:15:00.000Z';
  let server: ReturnType<typeof createFakeOpenProject>['server'];
  let requests: ReturnType<typeof createFakeOpenProject>['requests'];
  let timeEntries: ReturnType<typeof createFakeOpenProject>['timeEntries'];
  let provider: OpenProjectProvider;

  beforeAll(async () => {
    const fake = createFakeOpenProject({ pageSize: 20, quiet: true });
    server = fake.server;
    requests = fake.requests;
    timeEntries = fake.timeEntries;
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    provider = new OpenProjectProvider();
    await provider.initialize({ domain: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, apiToken: 'any-key-works' });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  beforeEach(() => {
    requests.length = 0;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  /** A time entry as the queue sends it: the marker of its row at the end of the comment. */
  const sent = async (taskId: string, marker: string, startedAtUtc = START): Promise<string> =>
    (await provider.logTime({ taskId, durationSeconds: 1800, startedAtUtc, comment: `Pairing ${marker}`, isAdHoc: false }))
      .remoteWorklogId!;

  it('LogTime_AgainstTheServer_AnswersTheEntrysOwnId', async () => {
    const id = await sent('OP-101', '[#own00001]');

    expect(timeEntries.get(id)).toMatchObject({ workPackageId: '101', hours: 'PT30M' });
  });

  it('FindWorklog_MarkerInTheComment_FindsTheEntry', async () => {
    await sent('OP-102', '[#other001]');
    const id = await sent('OP-102', '[#find0001]');

    expect(await provider.findWorklog('OP-102', START, '[#find0001]')).toBe(id);
  });

  it('FindWorklog_EntryOnAnotherDay_IsNotSearched', async () => {
    // A day either side of the start, not the work package's whole history.
    await sent('OP-103', '[#farday01]', '2026-08-01T10:00:00.000Z');

    expect(await provider.findWorklog('OP-103', START, '[#farday01]')).toBeNull();
  });

  it('UpdateWorklog_SentEntry_IsRewritten', async () => {
    const id = await sent('OP-104', '[#edit0001]');

    await provider.updateWorklog('OP-104', id, {
      taskId: 'OP-104',
      durationSeconds: 5400,
      startedAtUtc: START,
      comment: 'Pairing, corrected [#edit0001]',
      isAdHoc: false
    });

    expect(requests.find(r => r.method === 'PATCH')?.pathname).toBe(`/api/v3/time_entries/${id}`);
    expect(timeEntries.get(id)).toMatchObject({ hours: 'PT1H30M', comment: { raw: 'Pairing, corrected [#edit0001]' } });
  });

  it('DeleteWorklog_SentEntry_IsGone_AndDeletingItAgainIsNotAFailure', async () => {
    const id = await sent('OP-105', '[#dele0001]');

    await provider.deleteWorklog('OP-105', id);
    await expect(provider.deleteWorklog('OP-105', id)).resolves.toBeUndefined();

    expect(timeEntries.has(id)).toBe(false);
  });

  it('UpdateWorklog_DeletedInOpenProject_IsAPermanentFailure', async () => {
    const id = await sent('OP-106', '[#gone0001]');
    await provider.deleteWorklog('OP-106', id);

    await expect(
      provider.updateWorklog('OP-106', id, { taskId: 'OP-106', durationSeconds: 600, startedAtUtc: START, comment: '', isAdHoc: false })
    ).rejects.toSatisfy((err: unknown) => isProviderRequestError(err) && err.status === 404 && err.isPermanent);
  });
});

describe('Provider events against a live OpenProject-shaped server', () => {
  let fake: ReturnType<typeof createFakeOpenProject>;
  let baseUrl: string;
  let dbConn: DatabaseConnection;

  beforeAll(async () => {
    fake = createFakeOpenProject({ quiet: true });
    await new Promise<void>(resolve => fake.server.listen(0, '127.0.0.1', () => resolve()));
    baseUrl = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => fake.server.close(() => resolve()));
  });

  beforeEach(() => {
    dbConn = new DatabaseConnection(':memory:');
    fake.notifications.length = 0;
  });

  afterEach(() => {
    dbConn.close();
    vi.restoreAllMocks();
  });

  it('PollAfterBaseline_NotificationPosted_BecomesAToastWithItsWorkPackageLink', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const settingsRepo = new SettingsRepository(dbConn);
    settingsRepo.setSetting(ProviderSettingKey.OP_DOMAIN, baseUrl);
    settingsRepo.setSetting(ProviderSettingKey.OP_API_KEY, 'any-key-works');
    settingsRepo.setSetting(ProviderSettingKey.ACTIVE_PROVIDER_ID, 'openproject');
    const manager = new ProviderManager(settingsRepo);
    const toasts: ToastRequest[] = [];
    const service = new ProviderEventService({
      getActiveProvider: () => manager.getActiveProvider(),
      settings: settingsRepo,
      toasts: { show: toast => { toasts.push(toast); return true; } },
      // Our clock a minute behind the server's, so the notification is newer.
      now: () => new Date(Date.now() - 60_000)
    });

    // Unread before the app looked: not replayed.
    fake.notifications.push(buildNotification(1, 'mentioned', 1001));
    fake.notifications[0].createdAt = new Date(Date.now() - 3_600_000).toISOString();
    expect(await service.poll()).toBe('baseline');

    fake.notifications.push(buildNotification(2, 'mentioned', 1002), buildNotification(3, 'watched', 1003));
    expect(await service.poll()).toBe('delivered');

    expect(toasts).toEqual([{
      title: 'Alice Martin mentioned you on OP-1002',
      body: 'WP 2 that needs you',
      url: `${baseUrl}/work_packages/1002`
    }]);
    expect(await service.poll()).toBe('nothing_new');
  });
});
