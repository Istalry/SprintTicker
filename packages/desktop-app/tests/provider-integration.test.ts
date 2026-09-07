import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'net';
import { createFakeOpenProject } from '../../../scripts/fake-openproject.js';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { ProviderManager } from '../src/main/providers/provider-manager';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';
import { ProviderSettingKey } from '../src/shared/provider-settings';

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
