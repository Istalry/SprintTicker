import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import type { ProjectDTO, TaskDTO } from '../src/shared/dtos';
import { OWN_PROJECT_PROVIDER_ID, UNKNOWN_PROJECT_PROVIDER_ID } from '../src/shared/local-provider';

/**
 * What a sync does to projects it did not create, and to projects that
 * change under it.
 *
 * Two of these were lost silently: a project made in SprintTicker was
 * deleted at the next sync, and a provider project whose key another row
 * held failed to save -- the repository logs the error and goes on.
 */
describe('projects across a sync', () => {
  let dbConn: DatabaseConnection;
  let projectRepo: ProjectRepository;
  let taskRepo: TaskRepository;
  let remoteProjects: ProjectDTO[];
  let remoteTasks: Record<string, TaskDTO[]>;
  let worker: OfflineSyncWorker;

  const JIRA_WEB: ProjectDTO = { id: '10000', key: 'WEB', name: 'Website', providerId: 'jira' };
  const task = (id: string, projectId: string, key: string, title = 'Task'): TaskDTO =>
    ({ id, projectId, key, title, status: 'todo' });

  const sync = () => worker.syncTasksAndProjects();
  const projectIds = () => projectRepo.getAllProjects().map(p => p.id).sort();

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    dbConn = new DatabaseConnection(':memory:');
    projectRepo = new ProjectRepository(dbConn);
    taskRepo = new TaskRepository(dbConn);
    remoteProjects = [JIRA_WEB];
    remoteTasks = { '10000': [task('10001', '10000', 'WEB-1')] };
    const manager = {
      getProjects: async () => remoteProjects,
      getTasks: async (projectId: string) => remoteTasks[projectId] ?? []
    } as unknown as ProviderManager;
    worker = new OfflineSyncWorker(manager, new WorklogRepository(dbConn), projectRepo, taskRepo);
  });

  afterEach(() => {
    dbConn.close();
    vi.restoreAllMocks();
  });

  it('Sync_ProjectMadeHere_IsKeptWithItsTasks', async () => {
    projectRepo.saveProject({ id: 'MINE', key: 'MINE', name: 'Mine', providerId: OWN_PROJECT_PROVIDER_ID });
    taskRepo.saveTask(task('MINE_T1', 'MINE', 'T1'));

    await sync();

    expect(projectIds()).toEqual(['10000', 'MINE']);
    expect(taskRepo.getTasksByProjectId('MINE').map(t => t.id)).toEqual(['MINE_T1']);
  });

  it('Sync_ProjectWhoseProviderIsNotKnown_IsStillRetired', async () => {
    // The old default: as likely an OpenProject project gone from the
    // provider as one made here, and the provider's list is what decides.
    projectRepo.saveProject({ id: 'OLD', key: 'OLD', name: 'Old', providerId: UNKNOWN_PROJECT_PROVIDER_ID });

    await sync();

    expect(projectIds()).toEqual(['10000']);
  });

  it('Sync_ProviderProjectWithTheKeyOfOneMadeHere_BothAreListed', async () => {
    projectRepo.saveProject({ id: 'WEB', key: 'WEB', name: 'My web notes', providerId: OWN_PROJECT_PROVIDER_ID });

    const result = await sync();

    expect(result.status).toBe('synced');
    expect(projectIds()).toEqual(['10000', 'WEB']);
  });

  it('Sync_ProjectRecreatedUnderANewIdWithTheSameKey_IsListedAtOnce', async () => {
    // The old row still held the key while the new one was saved, so the new
    // one was missing until the sync after.
    await sync();
    remoteProjects = [{ ...JIRA_WEB, id: '10100' }];
    remoteTasks = { '10100': [] };

    await sync();

    expect(projectIds()).toEqual(['10100']);
  });

  it('Sync_ProjectRenamed_TakesItsNewNameAndKey', async () => {
    await sync();
    remoteProjects = [{ ...JIRA_WEB, key: 'SITE', name: 'Public site' }];

    await sync();

    expect(projectRepo.getAllProjects()).toMatchObject([{ id: '10000', key: 'SITE', name: 'Public site' }]);
  });

  it('Sync_TaskRenamedOrMovedToAnotherKey_IsTheSameRowUnderItsNewName', async () => {
    // Jira gives a moved issue a new key and keeps its id: the row follows.
    await sync();
    remoteTasks = { '10000': [task('10001', '10000', 'SITE-7', 'Renamed')] };

    await sync();

    expect(taskRepo.getTasksByProjectId('10000')).toMatchObject([{ id: '10001', key: 'SITE-7', title: 'Renamed' }]);
  });
});
