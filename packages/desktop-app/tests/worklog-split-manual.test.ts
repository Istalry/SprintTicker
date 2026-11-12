import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { ProviderManager } from '../src/main/providers/provider-manager';
import { ITaskProvider } from '../src/main/providers/task-provider-interface';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';
import { SendDestination, WorklogCorrectionService, WorklogMoveTargets } from '../src/main/services/worklog-correction-service';
import { ManualWorklogDTO } from '../src/shared/worklog-correction';
import { WORKLOG_COMMENTS } from '../src/shared/worklog-comments';
import { fakeRemote } from './support/fake-worklog-remote';

const MINUTE = 60;
const ADHOC = 'adhoc_1_call';
/** A morning in the past, local time, so "ends on the day it starts" reads the user's day. */
const at = (hour: number, minute = 0) => new Date(2026, 9, 13, hour, minute).toISOString();

/**
 * Time added by hand (S16b, P9a): a worklog here and a first send through
 * the queue, like a stop's -- the real queue and worker, a Jira-like fake.
 */
describe('Adding time by hand', () => {
  let dbConn: DatabaseConnection;
  let worklogs: WorklogRepository;
  let tasks: TaskRepository;
  let jira: ReturnType<typeof fakeRemote>;
  let worker: OfflineSyncWorker;
  let dispatch: ReturnType<typeof vi.fn>;
  let service: WorklogCorrectionService;

  const DESTINATIONS: Record<string, SendDestination | null> = {
    'T-1': { providerId: 'jira', minimumSeconds: 60 },
    'OWN-1': null
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    dbConn = new DatabaseConnection(':memory:');
    worklogs = new WorklogRepository(dbConn, { holdMs: 0 });
    tasks = new TaskRepository(dbConn);
    tasks.ensureTaskExists({ id: 'T-1', key: 'PF-31', title: 'Anvil sound pass', projectId: 'P' });
    tasks.ensureTaskExists({ id: 'OWN-1', key: 'HOME-1', title: 'Tidy up', projectId: 'HOME' });
    tasks.ensureTaskExists({ id: ADHOC, key: 'ADHOC', title: 'Call with Marc', projectId: 'ADHOC' });
    jira = fakeRemote('jira', 'Jira', 60);
    const manager = new ProviderManager(new SettingsRepository(dbConn));
    manager.registerProvider(jira.provider as unknown as ITaskProvider);
    worker = new OfflineSyncWorker(manager, worklogs);
    dispatch = vi.fn();
    const targets: WorklogMoveTargets = {
      getTask: taskId => tasks.getTaskById(taskId),
      destinationOf: taskId => DESTINATIONS[taskId] ?? null,
      retireAdHocIfUnused: () => undefined
    };
    service = new WorklogCorrectionService(worklogs, manager, dispatch, Date.now, targets);
  });

  afterEach(() => {
    dbConn.close();
    vi.restoreAllMocks();
  });

  const entry = (over: Partial<ManualWorklogDTO> = {}): ManualWorklogDTO => ({
    taskId: 'T-1', durationSeconds: 30 * MINUTE, startedAtUtc: at(8, 30), comment: 'Review', ...over
  });
  const rows = () =>
    dbConn.getDb().prepare<[], { operation: string; status: string; task_id: string }>(
      'SELECT operation, status, task_id FROM worklog_sync_queue ORDER BY rowid'
    ).all();

  it('Add_OnAProviderTask_WrittenHereAndSentThroughTheQueue', async () => {
    const added = service.add(entry());

    expect(added).toMatchObject({ taskId: 'T-1', taskKey: 'PF-31', durationSeconds: 30 * MINUTE, comment: 'Review', syncState: 'pending' });
    expect(added.sessionId).toMatch(/^manual_/);
    expect(rows()).toEqual([{ operation: 'CREATE', status: 'PENDING', task_id: 'T-1' }]);
    expect(dispatch).toHaveBeenCalledTimes(1);

    await worker.processPendingQueue();
    expect([...jira.entries.values()]).toEqual([
      expect.objectContaining({ taskId: 'T-1', durationSeconds: 30 * MINUTE, comment: expect.stringContaining('Review') })
    ]);
    expect(worklogs.getWorklogById(added.id)?.syncState).toBe('sent');
  });

  it('Add_NoNote_SaysWhereItCameFrom', () => {
    expect(service.add(entry({ comment: '   ' })).comment).toBe(WORKLOG_COMMENTS.ADDED);
  });

  it('Add_OnAProjectMadeHere_KeptHere', () => {
    expect(service.add(entry({ taskId: 'OWN-1' })).syncState).toBe('local');
    expect(rows()).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ['ad-hoc work', entry({ taskId: ADHOC }), /not to ad-hoc/],
    ['an unknown task', entry({ taskId: 'nope' }), /No task/],
    ['no task', entry({ taskId: '' }), /Choose the task/],
    ['too short for the provider', entry({ durationSeconds: 30 }), /at least 1 minute/],
    ['ending in the future', entry({ startedAtUtc: new Date(Date.now() - 10 * 60_000).toISOString() }), /future/],
    ['across midnight', entry({ startedAtUtc: at(23, 30), durationSeconds: 60 * MINUTE }), /ends on the day it starts/]
  ])('Add_%s_RefusedAndNothingWritten', (_name, refused, message) => {
    expect(() => service.add(refused)).toThrow(message);
    expect(dbConn.getDb().prepare('SELECT COUNT(*) AS n FROM worklogs').get()).toEqual({ n: 0 });
    expect(rows()).toEqual([]);
  });

  it('Add_UpToMidnight_Accepted', () => {
    expect(service.add(entry({ startedAtUtc: at(23, 30), durationSeconds: 30 * MINUTE })).durationSeconds).toBe(30 * MINUTE);
  });

  it('ProviderSeconds_WhatTheProviderHolds_TheOldValueUntilACorrectionArrives', async () => {
    const added = service.add(entry());
    expect(worklogs.getWorklogById(added.id)?.providerSeconds).toBeUndefined();
    await worker.processPendingQueue();
    expect(worklogs.getWorklogById(added.id)?.providerSeconds).toBe(30 * MINUTE);

    service.correct(added.id, { durationSeconds: 45 * MINUTE, startedAtUtc: added.startedAtUtc, comment: 'Review' });
    expect(worklogs.getWorklogById(added.id)).toMatchObject({ durationSeconds: 45 * MINUTE, providerSeconds: 30 * MINUTE });
    await worker.processPendingQueue();
    await worker.processPendingQueue();
    expect(worklogs.getWorklogById(added.id)?.providerSeconds).toBe(45 * MINUTE);

    service.remove(added.id);
    expect(worklogs.getWorklogById(added.id)).toBeNull();
  });

  it('QueuedChanges_SinceAMoment_ForTheDays_EachWithItsState', async () => {
    // Only the clock is faked: a row and the moment must not share a millisecond.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 16, 17) });
    const before = service.add(entry());
    await worker.processPendingQueue();
    vi.setSystemTime(new Date(2026, 9, 16, 17, 30));
    const since = new Date().toISOString();
    vi.setSystemTime(new Date(2026, 9, 19, 9));
    service.add(entry({ startedAtUtc: at(10), durationSeconds: 15 * MINUTE }));
    service.correct(before.id, { durationSeconds: 45 * MINUTE, startedAtUtc: before.startedAtUtc, comment: 'Review' });
    // Another week's change is not this one's.
    service.add(entry({ startedAtUtc: new Date(2026, 9, 20, 10).toISOString() }));

    const changes = worklogs.getQueuedChangesBetween('2026-10-12', '2026-10-18', since);

    expect(changes.map(c => [c.operation, c.taskKey, c.durationSeconds / MINUTE, c.state])).toEqual([
      ['CREATE', 'PF-31', 15, 'waiting'],
      ['UPDATE', 'PF-31', 45, 'waiting']
    ]);
    await worker.processPendingQueue();
    await worker.processPendingQueue();
    expect(worklogs.getQueuedChangesBetween('2026-10-12', '2026-10-18', since).map(c => c.state)).toEqual(['sent', 'sent']);
    expect(worklogs.getQueuedChangesBetween('2026-10-12', '2026-10-18', new Date(Date.now() + 60_000).toISOString())).toEqual([]);
    vi.useRealTimers();
  });

  it('Between_BothDaysIncluded_InTheOrderWorked', () => {
    service.add(entry({ startedAtUtc: new Date(2026, 9, 14, 10).toISOString() }));
    service.add(entry({ startedAtUtc: at(8, 30) }));
    service.add(entry({ startedAtUtc: new Date(2026, 9, 15, 10).toISOString() }));
    service.add(entry({ startedAtUtc: new Date(2026, 9, 12, 23, 0).toISOString() }));

    const found = worklogs.getWorklogsBetween('2026-10-13', '2026-10-14').map(w => w.startedAtUtc);

    expect(found).toEqual([at(8, 30), new Date(2026, 9, 14, 10).toISOString()]);
  });

  it('Add_OverlappingAnEntry_SavedAndHeldUntilFixed', async () => {
    const first = service.add(entry({ startedAtUtc: at(8, 45), durationSeconds: 60 * MINUTE, comment: 'Earlier' }));
    await worker.processPendingQueue();

    // S16b warns before saving, and never refuses: the queue holds the later one.
    const second = service.add(entry({ startedAtUtc: at(9, 15), durationSeconds: 30 * MINUTE }));
    await worker.processPendingQueue();

    expect(worklogs.getWorklogById(first.id)?.syncState).toBe('sent');
    expect(worklogs.getWorklogById(second.id)).toMatchObject({ syncState: 'held-overlap', overlapsTaskKey: 'PF-31' });
    expect(jira.entries.size).toBe(1);
  });
});
