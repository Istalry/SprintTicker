import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { InputDecoder } from '../src/main/hardware/input-decoder';
import { IPCHandlerRegistry } from '../src/main/ipc/ipc-handler-registry';
import { IPCChannel } from '../src/shared/ipc-channels';
import type { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';
import type { ProviderManager } from '../src/main/providers/provider-manager';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), emit: vi.fn() },
  BrowserWindow: vi.fn(),
  app: { isPackaged: false },
  powerMonitor: { on: vi.fn() }
}));

import { ipcMain } from 'electron';

/**
 * Regression coverage for the empty-Projects-tab bug.
 *
 * Saving provider credentials persisted them and reinitialised the provider,
 * but started no sync. The Projects view reads `projectRepo.getAllProjects()`,
 * a cache only the sync worker fills, so a freshly configured provider showed
 * an empty list for up to a full five-minute interval -- and an empty list is
 * exactly what a correctly-working provider with no projects looks like.
 *
 * Found by running the app against `scripts/fake-openproject.js` and noticing
 * the server was never asked for `/api/v3/projects` at all.
 *
 * The channel is `SET_ACTIVE_PROVIDER`, which undersells it: the handler
 * persists the domain, API key and every status mapping too.
 */
describe('Saving provider settings triggers a sync', () => {
  let dbConn: DatabaseConnection;
  let registry: IPCHandlerRegistry;
  let engine: TimeTrackingEngine;
  let sent: Array<{ channel: string; payload: unknown }>;
  let syncWorker: OfflineSyncWorker;
  let queueRepo: WorklogRepository;
  let cacheRepo: TaskRepository;
  let requeueCalls = 0;
  let drainCalls = 0;
  let syncCalls: number;

  /** Captures what the registry broadcasts to the renderer. */
  function windowStub() {
    return {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: (channel: string, payload: unknown) => sent.push({ channel, payload })
      }
    };
  }

  /** Finds a registered ipcMain handler by channel. */
  function handlerFor(channel: string): (...args: unknown[]) => unknown {
    const calls = (ipcMain.handle as unknown as { mock: { calls: Array<[string, (...a: unknown[]) => unknown]> } })
      .mock.calls;
    const found = calls.find(([name]) => name === channel);
    if (!found) throw new Error(`No handler registered for ${channel}`);
    return found[1];
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    sent = [];
    syncCalls = 0;
    requeueCalls = 0;
    drainCalls = 0;

    dbConn = new DatabaseConnection(':memory:');
    const sessionRepo = new SessionRepository(dbConn);
    const worklogRepo = new WorklogRepository(dbConn);
    const taskRepo = new TaskRepository(dbConn);
    queueRepo = worklogRepo;
    cacheRepo = taskRepo;
    const settingsRepo = new SettingsRepository(dbConn);
    const projectRepo = new ProjectRepository(dbConn);

    engine = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo, undefined, projectRepo);
    const driver = new BusyBarDriver('10.0.4.20', true);
    await driver.connect();

    // A sync that "succeeds" by writing one project, so the broadcast has
    // something real to carry.
    syncWorker = {
      syncTasksAndProjects: async () => {
        syncCalls += 1;
        projectRepo.saveProject({ id: 'P1', key: 'ALPHA', name: 'Alpha' });
        return { status: 'synced' as const, projects: 1, tasks: 0 };
      },
      // Saving credentials un-parks worklogs that failed against the old ones,
      // and drains the queue when it revived any. Counted so the test below can
      // assert it happens; nothing here has parked a row, so it returns zero.
      requeueFailedWorklogs: () => {
        requeueCalls += 1;
        return 0;
      },
      processPendingQueue: async () => {
        drainCalls += 1;
        return { processed: 0, succeeded: 0, failed: 0 };
      }
    } as unknown as OfflineSyncWorker;

    registry = new IPCHandlerRegistry({
      engine,
      taskRepo,
      settingsRepo,
      driver,
      inputDecoder: new InputDecoder(driver, engine, settingsRepo),
      renderer: new DisplayRenderer(driver),
      getWindow: () => windowStub() as never,
      providerManager: { reinitializeProviders: () => {}, setActiveProviderId: () => {} } as unknown as ProviderManager,
      syncWorker
    });
    registry.registerAllHandlers();
  });

  afterEach(() => {
    engine.dispose();
    dbConn.close();
    vi.restoreAllMocks();
  });

  it('SetActiveProvider_CredentialsEntered_StartsASyncInsteadOfWaitingForTheTimer', async () => {
    await handlerFor(IPCChannel.SET_ACTIVE_PROVIDER)({}, {
      providerId: 'openproject',
      opDomain: 'http://127.0.0.1:8099',
      opApiKey: 'any-key'
    });

    // The sync is deliberately not awaited by the handler, so let its
    // continuation run before asserting.
    await new Promise(resolve => setImmediate(resolve));

    expect(syncCalls).toBe(1);
  });

  it('SetActiveProvider_CredentialsEntered_UnparksWorklogsThatFailedAgainstTheOldOnes', async () => {
    // The sync worker parks a worklog immediately when the provider reports a
    // permanent failure -- a revoked key -- rather than spending its whole
    // retry budget on an answer that will not change. That is only safe
    // because entering credentials returns those rows to the queue, and this
    // handler is the only place that happens. Without it, correcting a typo'd
    // API key would leave the already-parked time stranded for good.
    await handlerFor(IPCChannel.SET_ACTIVE_PROVIDER)({}, {
      providerId: 'openproject',
      opDomain: 'http://127.0.0.1:8099',
      opApiKey: 'a-corrected-key'
    });

    expect(requeueCalls).toBe(1);
  });

  it('SetActiveProvider_NothingWasParked_DoesNotDrainTheQueueForNoReason', async () => {
    // The stub revives zero rows, so the extra pass has nothing to send. A
    // drain on every settings save would issue provider requests for a queue
    // that is already empty.
    await handlerFor(IPCChannel.SET_ACTIVE_PROVIDER)({}, {
      providerId: 'openproject',
      opDomain: 'http://127.0.0.1:8099',
      opApiKey: 'any-key'
    });
    await new Promise(resolve => setImmediate(resolve));

    expect(drainCalls).toBe(0);
  });

  it('SetActiveProvider_SyncCompletes_BroadcastsTheRefreshedProjectList', async () => {
    await handlerFor(IPCChannel.SET_ACTIVE_PROVIDER)({}, {
      providerId: 'openproject',
      opDomain: 'http://127.0.0.1:8099',
      opApiKey: 'any-key'
    });
    await new Promise(resolve => setImmediate(resolve));

    const broadcast = sent.find(m => m.channel === IPCChannel.ON_PROJECTS_UPDATED);
    expect(broadcast).toBeDefined();
    const payload = broadcast!.payload as {
      result: { status: string; projects: number };
      projects: Array<{ id: string }>;
    };
    expect(payload.result.status).toBe('synced');
    expect(payload.projects.map(p => p.id)).toEqual(['P1']);
  });

  it('SetActiveProvider_DoesNotBlockOnTheSync', async () => {
    // There are no fetch timeouts in the provider layer yet, so awaiting the
    // sync here would let a hung instance hold the Save button open forever.
    let releaseSync: () => void = () => {};
    const hung = new Promise<void>(resolve => {
      releaseSync = resolve;
    });
    (syncWorker as unknown as { syncTasksAndProjects: () => Promise<unknown> }).syncTasksAndProjects = async () => {
      await hung;
      return { status: 'synced', projects: 0, tasks: 0 };
    };

    const settled = await Promise.race([
      handlerFor(IPCChannel.SET_ACTIVE_PROVIDER)({}, { providerId: 'openproject', opDomain: 'http://x', opApiKey: 'k' }).then(() => 'returned'),
      new Promise(resolve => setTimeout(() => resolve('blocked'), 50))
    ]);

    expect(settled).toBe('returned');
    releaseSync();
  });

  it('SyncProviderNow_Invoked_ReturnsTheOutcomeAndBroadcastsIt', async () => {
    const result = await handlerFor(IPCChannel.SYNC_PROVIDER_NOW)({});

    expect(result).toEqual({ status: 'synced', projects: 1, tasks: 0 });
    expect(sent.some(m => m.channel === IPCChannel.ON_PROJECTS_UPDATED)).toBe(true);
  });

  describe('the sync queue is readable from the renderer', () => {
    /**
     * The panel exists because two worklogs failed against a live Jira and
     * finding out why took a terminal and three hundred lines of console. The
     * reasons were on the rows the whole time.
     */
    function park(id: string, taskId: string, message: string): void {
      queueRepo.enqueueSyncItem({
        id,
        providerId: 'jira',
        taskId,
        durationSeconds: 30,
        startedAtUtc: '2026-09-08T09:00:00.000Z',
        comment: 'Completed session via SprintTicker'
      });
      queueRepo.parkSyncItemAsFailed(id, message);
    }

    it('GetSyncQueue_ParkedWorklog_ReportsTheProvidersOwnMessage', async () => {
      park('sync_400', '10004', 'HTTP 400 - Le journal de travail est invalide');

      const snapshot = (await handlerFor(IPCChannel.GET_SYNC_QUEUE)({})) as {
        counts: { failed: number };
        items: Array<{ lastError: string | null; status: string }>;
        maxAttempts: number;
      };

      expect(snapshot.counts.failed).toBe(1);
      expect(snapshot.items[0].status).toBe('FAILED');
      expect(snapshot.items[0].lastError).toContain('HTTP 400');
      // So the panel can say "attempt 3 of 8" rather than just "3".
      expect(snapshot.maxAttempts).toBeGreaterThan(0);
    });

    it('GetSyncQueue_TaskStillCached_NamesItTheWayTheUserDoes', async () => {
      // The queue stores the provider's own id, because that is what the API
      // needs -- Jira's 10004 rather than SCRUM-6. A number that appears
      // nowhere in Jira's UI is no use in a diagnostic panel.
      cacheRepo.saveTask({ id: '10004', projectId: '10000', key: 'SCRUM-6', title: 'Test 2', status: 'todo' });
      park('sync_named', '10004', 'HTTP 400');

      const snapshot = (await handlerFor(IPCChannel.GET_SYNC_QUEUE)({})) as {
        items: Array<{ taskKey: string }>;
      };

      expect(snapshot.items[0].taskKey).toBe('SCRUM-6');
    });

    it('GetSyncQueue_TaskNoLongerCached_FallsBackToTheIdRatherThanBlank', async () => {
      // A 404 means the issue is gone, so it will not be in the local cache
      // either -- and that row is exactly the one being diagnosed.
      park('sync_404', '10001', 'HTTP 404 - introuvable');

      const snapshot = (await handlerFor(IPCChannel.GET_SYNC_QUEUE)({})) as {
        items: Array<{ taskKey: string }>;
      };

      expect(snapshot.items[0].taskKey).toBe('10001');
    });

    it('RetryFailedWorklogs_Invoked_UnparksAndDrains', async () => {
      const result = await handlerFor(IPCChannel.RETRY_FAILED_WORKLOGS)({});

      expect(requeueCalls).toBeGreaterThan(0);
      expect(result).toEqual({ requeued: 0 });
      // The stub revived nothing, so no drain should have been attempted: a
      // pass over an empty queue is work for nothing on every button press.
      expect(drainCalls).toBe(0);
    });
  });
});
