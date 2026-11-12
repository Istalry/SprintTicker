import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';
import { ProviderRequestError } from '../src/main/providers/provider-errors';
import { NoticeService, LAST_SEEN_VERSION_KEY } from '../src/main/services/notice-service';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import type { ProjectDTO, TaskDTO } from '../src/shared/dtos';
import type { SyncHealthDTO } from '../src/shared/sync-health';

const PROJECTS: ProjectDTO[] = [
  { id: 'P1', key: 'MG', name: 'Moonlight Garden', providerId: 'jira' },
  { id: 'P2', key: 'PF', name: 'Pixel Forge', providerId: 'jira' }
];
const TASKS = (projectId: string): TaskDTO[] => [{ id: `${projectId}-T`, projectId, key: `${projectId}-1`, title: 'One', status: 'todo' }];

/** How the sync is going, for S31's cards (P11b). */
describe('Sync health', () => {
  let db: DatabaseConnection;
  let projectRepo: ProjectRepository;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:42:00Z'));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    db = new DatabaseConnection(':memory:');
    projectRepo = new ProjectRepository(db);
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const worker = (overrides: Partial<ProviderManager>) => {
    const manager = {
      getProjects: async () => PROJECTS,
      getTasks: async (id: string) => TASKS(id),
      getActiveProvider: () => ({ providerId: 'jira' }),
      ...overrides
    } as unknown as ProviderManager;
    const w = new OfflineSyncWorker(manager, new WorklogRepository(db), projectRepo, new TaskRepository(db));
    const seen: SyncHealthDTO[] = [];
    w.onHealthChanged(h => seen.push(h));
    return { w, seen };
  };

  it('FirstSync_SaysHowFarItGot_ThenOk', async () => {
    const { w, seen } = worker({});

    await w.syncTasksAndProjects();

    expect(seen.map(h => [h.state, h.progress])).toEqual([
      ['first-sync', null],
      ['first-sync', { done: 0, total: 2 }],
      ['first-sync', { done: 1, total: 2 }],
      ['first-sync', { done: 2, total: 2 }],
      ['ok', null]
    ]);
    expect(w.getHealth()).toMatchObject({ state: 'ok', providerId: 'jira', lastSyncedAtUtc: '2026-11-12T10:42:00.000Z' });
  });

  it('LaterSync_IsNotAFirstSync', async () => {
    projectRepo.saveProject(PROJECTS[0]);
    const { w, seen } = worker({});

    await w.syncTasksAndProjects();

    expect(seen.map(h => h.state)).toEqual(['ok']);
  });

  it('NotAnswering_KeepsWhenItBegan_UntilItAnswers', async () => {
    let fail = true;
    const { w } = worker({
      getProjects: async () => {
        if (fail) throw new ProviderRequestError('jira', 'transport', 'fetch failed');
        return PROJECTS;
      }
    });

    await w.syncTasksAndProjects();
    vi.setSystemTime(new Date('2026-11-12T10:47:00Z'));
    await w.syncTasksAndProjects();

    expect(w.getHealth()).toMatchObject({ state: 'unreachable', sinceUtc: '2026-11-12T10:42:00.000Z' });
    fail = false;
    await w.syncTasksAndProjects();
    expect(w.getHealth()).toMatchObject({ state: 'ok', sinceUtc: null });
  });

  it('TokenRefused_IsRefused', async () => {
    const { w } = worker({ getProjects: async () => { throw new ProviderRequestError('jira', 'auth', 'Unauthorized', { status: 401 }); } });

    await w.syncTasksAndProjects();

    expect(w.getHealth()).toMatchObject({ state: 'refused', providerId: 'jira' });
  });

  it('NoAccount_IsNotConfigured', async () => {
    const { w } = worker({ getProjects: async () => { throw ProviderRequestError.notConfigured('openproject'); } });

    await w.syncTasksAndProjects();

    expect(w.getHealth().state).toBe('not-configured');
  });
});

/** Today's one-time notices (S31, P11b). */
describe('NoticeService', () => {
  let db: DatabaseConnection;
  let settings: SettingsRepository;

  beforeEach(() => {
    db = new DatabaseConnection(':memory:');
    settings = new SettingsRepository(db);
  });

  afterEach(() => db.close());

  it('FreshInstall_AnnouncesNothing', () => {
    expect(new NoticeService(settings, '1.5.0').getNotices().updatedTo).toBeNull();
  });

  it('Updated_AnnouncesTheVersion_UntilDismissed', () => {
    settings.setSetting(LAST_SEEN_VERSION_KEY, '1.4.0');
    const notices = new NoticeService(settings, '1.5.0');

    expect(notices.getNotices().updatedTo).toBe('1.5.0');
    expect(notices.dismiss('updated').updatedTo).toBeNull();
    expect(new NoticeService(settings, '1.5.0').getNotices().updatedTo).toBeNull();
  });

  it('NoAccount_DismissedForGood', () => {
    const notices = new NoticeService(settings, '1.5.0');

    expect(notices.getNotices().noAccountDismissed).toBe(false);
    notices.dismiss('no-account');

    expect(new NoticeService(settings, '1.5.0').getNotices().noAccountDismissed).toBe(true);
  });

  it('UnknownNotice_Throws', () => {
    expect(() => new NoticeService(settings, '1.5.0').dismiss('other' as never)).toThrow();
  });
});
