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
describe('Adding time by hand, and splitting an entry', () => {
  let dbConn: DatabaseConnection;
  let worklogs: WorklogRepository;
  let tasks: TaskRepository;
  let jira: ReturnType<typeof fakeRemote>;
  let worker: OfflineSyncWorker;
  let dispatch: ReturnType<typeof vi.fn>;
  let service: WorklogCorrectionService;

  const DESTINATIONS: Record<string, SendDestination | null> = {
    'T-1': { providerId: 'jira', minimumSeconds: 60 },
    'T-2': { providerId: 'jira', minimumSeconds: 60 },
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
    tasks.ensureTaskExists({ id: 'T-2', key: 'MG-12', title: 'Fix the lantern glow at dusk', projectId: 'P' });
    tasks.ensureTaskExists({ id: ADHOC, key: 'ADHOC', title: 'Call with Marc', projectId: 'ADHOC' });
    jira = fakeRemote('jira', 'Jira', 60);
    const manager = new ProviderManager(new SettingsRepository(dbConn));
    manager.registerProvider(jira.provider as unknown as ITaskProvider);
    worker = new OfflineSyncWorker(manager, worklogs);
    dispatch = vi.fn();
    const targets: WorklogMoveTargets = {
      getTask: taskId => tasks.getTaskById(taskId),
      destinationOf: taskId => DESTINATIONS[taskId] ?? null,
      retireAdHocIfUnused: () => undefined,
      createOwnTask: (title, taskId) => tasks.createAdHocTask(title, 'ADHOC', false, taskId)
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

  it('Add_OnWorkOfTheUsersOwn_KeptHere', () => {
    expect(service.add(entry({ taskId: ADHOC })).syncState).toBe('local');
    expect(rows()).toEqual([]);
  });

  it('Add_OnNewWorkOfTheUsersOwn_MadeUnderTheIdGiven_KeptHere', () => {
    const added = service.add(entry({ taskId: '', ownTitle: 'Code review' }), 'wl_added', 'adhoc_new');

    expect(tasks.getTaskById('adhoc_new')).toMatchObject({ title: 'Code review', projectId: 'ADHOC' });
    expect(added).toMatchObject({ taskId: 'adhoc_new', syncState: 'local' });
    expect(rows()).toEqual([]);
  });

  it('Add_NewOwnWorkButRefused_NoTaskMade', () => {
    expect(() => service.add(entry({ taskId: '', ownTitle: 'Code review', startedAtUtc: at(23, 30), durationSeconds: 60 * MINUTE }), 'wl_added', 'adhoc_new'))
      .toThrow(/ends on the day/);

    expect(tasks.getTaskById('adhoc_new')).toBeNull();
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

  /** Split in two (S16c, P9e). */
  const twoHours = () => service.add(entry({ startedAtUtc: at(10), durationSeconds: 120 * MINUTE, comment: 'Lantern' }));
  const queue = () =>
    dbConn.getDb().prepare<[], { id: string; operation: string; status: string; task_id: string; worklog_id: string; origin_sync_id: string | null; duration_seconds: number }>(
      'SELECT id, operation, status, task_id, worklog_id, origin_sync_id, duration_seconds FROM worklog_sync_queue ORDER BY rowid'
    ).all();

  it('Split_ASentEntry_ShortenedFirst_TheRestWaitsForIt', async () => {
    const original = twoHours();
    await worker.processPendingQueue();

    const { first, second } = service.split(original.id, { atUtc: at(11, 20), taskId: 'T-2' });

    expect(first).toMatchObject({ durationSeconds: 80 * MINUTE, startedAtUtc: at(10), comment: 'Lantern' });
    expect(second).toMatchObject({ taskId: 'T-2', durationSeconds: 40 * MINUTE, startedAtUtc: at(11, 20), comment: 'Lantern', sessionId: original.sessionId });
    const [send, update, create] = queue();
    expect([send.operation, send.status, update.operation, update.status, create.operation, create.status])
      .toEqual(['CREATE', 'SYNCED', 'UPDATE', 'PENDING', 'CREATE', 'PENDING']);
    expect(create).toMatchObject({ worklog_id: second.id, task_id: 'T-2', origin_sync_id: update.id });
    // Only the shortening is due: the rest waits for it.
    expect(worklogs.getPendingQueueItems().map(r => r.operation)).toEqual(['UPDATE']);

    await worker.processPendingQueue();
    await worker.processPendingQueue();

    expect([...jira.entries.values()].map(e => [e.taskId, e.durationSeconds / MINUTE]).sort()).toEqual([['T-1', 80], ['T-2', 40]]);
    expect(queue().every(r => r.status === 'SYNCED')).toBe(true);
  });

  it('Split_AShorteningRefused_TheRestNeverSent', async () => {
    const original = twoHours();
    await worker.processPendingQueue();
    service.split(original.id, { atUtc: at(11, 20), taskId: 'T-2' });
    const update = queue()[1];
    worklogs.parkSyncItemAsFailed(update.id, 'Jira said no');

    await worker.processPendingQueue();

    // The provider still has the two hours, and not the 40 minutes too.
    expect([...jira.entries.values()].map(e => e.durationSeconds / MINUTE)).toEqual([120]);
    expect(worklogs.getPendingQueueItems()).toEqual([]);
  });

  it('Split_AnEntryNotSentYet_ItsSendRewritten_TheRestSentAlongside', async () => {
    const original = twoHours();

    const { second } = service.split(original.id, { atUtc: at(11), taskId: 'T-2' });

    expect(queue().map(r => [r.operation, r.duration_seconds / MINUTE, r.origin_sync_id])).toEqual([['CREATE', 60, null], ['CREATE', 60, null]]);
    await worker.processPendingQueue();
    expect([...jira.entries.values()].map(e => e.taskId).sort()).toEqual(['T-1', 'T-2']);
    expect(worklogs.getWorklogById(second.id)?.syncState).toBe('sent');
  });

  it('Split_OnAProjectMadeHere_TheRestKeptHere', () => {
    const original = twoHours();

    service.split(original.id, { atUtc: at(11), taskId: 'OWN-1' });

    expect(queue().map(r => r.task_id)).toEqual(['T-1']);
  });

  it('Split_OnWorkOfTheUsersOwn_TheRestKeptHere', () => {
    const original = twoHours();

    const { second } = service.split(original.id, { atUtc: at(11), taskId: ADHOC });

    expect(second).toMatchObject({ taskId: ADHOC, durationSeconds: 60 * MINUTE, syncState: 'local' });
    expect(queue().map(r => r.task_id)).toEqual(['T-1']);
  });

  it('Split_OnNewWorkOfTheUsersOwn_MadeUnderTheIdGiven_TheRestKeptHere', () => {
    const original = twoHours();

    const { second } = service.split(original.id, { atUtc: at(11), ownTitle: ' Code review ' }, 'wl_second', 'adhoc_new');

    expect(tasks.getTaskById('adhoc_new')).toMatchObject({ title: 'Code review', projectId: 'ADHOC' });
    expect(second).toMatchObject({ taskId: 'adhoc_new', durationSeconds: 60 * MINUTE, syncState: 'local' });
    expect(queue().map(r => r.task_id)).toEqual(['T-1']);
  });

  it('Split_NewOwnWorkButTheMomentRefused_NoTaskMade', () => {
    const original = twoHours();

    expect(() => service.split(original.id, { atUtc: at(10), ownTitle: 'Code review' }, 'wl_second', 'adhoc_new')).toThrow(/between its start/);

    expect(tasks.getTaskById('adhoc_new')).toBeNull();
  });

  it('Split_NeitherATaskNorAName_Refused', () => {
    const original = twoHours();

    expect(() => service.split(original.id, { atUtc: at(11), ownTitle: '   ' })).toThrow(/taskId/);
  });

  it.each([
    ['at its start', at(10), 'T-2', /between its start and its end/],
    ['after its end', at(12, 30), 'T-2', /between its start and its end/],
    ['no moment', 'soon', 'T-2', /Choose when/],
    ['on an unknown task', at(11), 'NOPE', /No task NOPE/],
    ['leaving the rest under the floor of the provider', new Date(Date.parse(at(12)) - 30_000).toISOString(), 'T-2', /at least|minute/]
  ])('Split_%s_RefusedAndNothingChanged', (_name, atUtc, taskId, why) => {
    const original = twoHours();

    expect(() => service.split(original.id, { atUtc, taskId })).toThrow(why);

    expect(worklogs.getWorklogById(original.id)?.durationSeconds).toBe(120 * MINUTE);
    expect(queue()).toHaveLength(1);
  });
});
