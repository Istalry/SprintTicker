import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { ProviderManager } from '../src/main/providers/provider-manager';
import { ITaskProvider } from '../src/main/providers/task-provider-interface';
import { ProviderRequestError } from '../src/main/providers/provider-errors';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';
import { syncMarker } from '../src/main/sync/sync-constants';
import { SendDestination, WorklogCorrectionService, WorklogMoveTargets } from '../src/main/services/worklog-correction-service';
import { fakeRemote } from './support/fake-worklog-remote';

const HOUR = 3600;
const START = '2026-10-13T09:00:00.000Z';
const ADHOC = 'adhoc_1_call';

/**
 * Moving a worklog to another task: DELETE where it is, then CREATE on the
 * new task, through the queue -- delete before create, so the time is never
 * on both providers. Two real providers' fakes, the real queue and worker.
 */
describe('Moving a worklog', () => {
  let dbConn: DatabaseConnection;
  let worklogs: WorklogRepository;
  let tasks: TaskRepository;
  let jira: ReturnType<typeof fakeRemote>;
  let openProject: ReturnType<typeof fakeRemote>;
  let worker: OfflineSyncWorker;
  let dispatch: ReturnType<typeof vi.fn>;
  let retired: string[];
  let service: WorklogCorrectionService;

  /** Where each task's time goes, as the engine would say: by its project's provider. */
  const DESTINATIONS: Record<string, SendDestination | null> = {
    'T-1': { providerId: 'jira', minimumSeconds: 60 },
    'T-2': { providerId: 'jira', minimumSeconds: 60 },
    'WP-9': { providerId: 'openproject', minimumSeconds: 1 },
    // A project made in SprintTicker: its time stays here.
    'OWN-1': null
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    dbConn = new DatabaseConnection(':memory:');
    worklogs = new WorklogRepository(dbConn, { holdMs: 0 });
    tasks = new TaskRepository(dbConn);
    tasks.ensureTaskExists({ id: 'T-1', key: 'MG-12', title: 'Ship it', projectId: 'P' });
    tasks.ensureTaskExists({ id: 'T-2', key: 'MG-13', title: 'Fix it', projectId: 'P' });
    tasks.ensureTaskExists({ id: 'WP-9', key: '#9', title: 'Plan it', projectId: 'OP' });
    tasks.ensureTaskExists({ id: 'OWN-1', key: 'HOME-1', title: 'Tidy up', projectId: 'HOME' });
    tasks.ensureTaskExists({ id: ADHOC, key: 'ADHOC', title: 'Call with Marc', projectId: 'ADHOC' });
    jira = fakeRemote('jira', 'Jira', 60);
    openProject = fakeRemote('openproject', 'OpenProject', 1);
    const manager = new ProviderManager(new SettingsRepository(dbConn));
    manager.registerProvider(jira.provider as unknown as ITaskProvider);
    manager.registerProvider(openProject.provider as unknown as ITaskProvider);
    worker = new OfflineSyncWorker(manager, worklogs);
    dispatch = vi.fn();
    retired = [];
    const targets: WorklogMoveTargets = {
      getTask: taskId => tasks.getTaskById(taskId),
      destinationOf: taskId => DESTINATIONS[taskId] ?? null,
      retireAdHocIfUnused: taskId => { retired.push(taskId); },
      createOwnTask: (title, taskId) => tasks.createAdHocTask(title, 'ADHOC', false, taskId)
    };
    service = new WorklogCorrectionService(worklogs, manager, dispatch, Date.now, targets);
  });

  afterEach(() => {
    dbConn.close();
    vi.restoreAllMocks();
  });

  /** A stopped session's worklog, and its send when `providerId` is given. */
  const logged = (id: string, taskId = 'T-1', seconds = 2 * HOUR, providerId: string | null = 'jira'): string => {
    worklogs.saveWorklog({
      id, sessionId: 's1', taskId, durationSeconds: seconds, startedAtUtc: START, comment: 'Pairing', createdAtUtc: START
    });
    if (providerId) {
      worklogs.enqueueSyncItem({
        id: `sync_${id}`, providerId, taskId, durationSeconds: seconds, startedAtUtc: START, comment: 'Pairing', worklogId: id
      });
    }
    return `sync_${id}`;
  };
  const sent = async (id = 'w1'): Promise<string> => {
    const send = logged(id);
    await worker.processPendingQueue();
    return send;
  };
  const rows = () =>
    dbConn.getDb().prepare<[], { operation: string; status: string; provider_id: string; task_id: string }>(
      'SELECT operation, status, provider_id, task_id FROM worklog_sync_queue ORDER BY rowid'
    ).all();
  /** Two passes: the CREATE waits for the DELETE before it, and a pass reads the due rows once. */
  const deliver = async () => {
    await worker.processPendingQueue();
    await worker.processPendingQueue();
  };

  describe('time never sent', () => {
    it('Move_AnInterruption_IsAFirstSendUnderItsName', async () => {
      logged('w1', ADHOC, 15 * 60, null);

      const moved = service.reassign('w1', 'T-1');

      // The provider shows what the time was: the interruption's name.
      expect(moved).toMatchObject({ taskId: 'T-1', comment: 'Call with Marc', syncState: 'pending' });
      expect(moved.adHoc).toBeUndefined();
      expect(rows()).toEqual([{ operation: 'CREATE', status: 'PENDING', provider_id: 'jira', task_id: 'T-1' }]);
      expect(retired).toEqual([ADHOC]);
      expect(dispatch).toHaveBeenCalledTimes(1);

      await worker.processPendingQueue();
      expect([...jira.entries.values()]).toEqual([expect.objectContaining({ taskId: 'T-1', durationSeconds: 15 * 60, comment: expect.stringContaining('Call with Marc') })]);
    });

    it('Move_ToAProjectMadeHere_KeptHereOnly', () => {
      logged('w1', ADHOC, 15 * 60, null);

      expect(service.reassign('w1', 'OWN-1')).toMatchObject({ taskId: 'OWN-1', syncState: 'local' });
      expect(rows()).toEqual([]);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('Move_TooShortForTheNewProvider_IsRefusedAndNothingChanges', () => {
      // Jira records whole minutes: thirty seconds would be refused there.
      logged('w1', ADHOC, 30, null);

      expect(() => service.reassign('w1', 'T-1')).toThrow(/at least 1 minute/);
      expect(worklogs.getWorklogById('w1')?.taskId).toBe(ADHOC);
      expect(retired).toEqual([]);
    });
  });

  describe('time queued and never attempted', () => {
    it('Move_ToAnotherProvider_TheSendIsPointedThere_TheOldNeverHears', async () => {
      const send = logged('w1');

      service.reassign('w1', 'WP-9');
      await deliver();

      expect(worklogs.getSyncItem(send)).toMatchObject({ providerId: 'openproject', taskId: 'WP-9', status: 'SYNCED' });
      expect(rows()).toHaveLength(1);
      expect(jira.provider.logTime).not.toHaveBeenCalled();
      expect(jira.provider.deleteWorklog).not.toHaveBeenCalled();
      expect(openProject.entries.size).toBe(1);
    });

    it('Move_ToAProjectMadeHere_TheSendIsDropped', async () => {
      logged('w1');

      service.reassign('w1', 'OWN-1');
      await deliver();

      expect(rows()).toEqual([]);
      expect(jira.provider.logTime).not.toHaveBeenCalled();
      expect(worklogs.getWorklogById('w1')?.syncState).toBe('local');
    });
  });

  describe('time that may be at its provider', () => {
    it('Move_Sent_DeletedThereBeforeItIsCreatedHere', async () => {
      const send = await sent();
      const order: string[] = [];
      jira.provider.deleteWorklog.mockImplementation(async (_t: string, id: string) => { order.push('delete'); jira.entries.delete(id); });
      jira.provider.logTime.mockImplementation(async payload => { order.push('create'); jira.entries.set('200', payload); return { success: true, remoteWorklogId: '200' }; });

      service.reassign('w1', 'T-2');
      expect(worklogs.getWorklogById('w1')?.syncState).toBe('correction-pending');

      await deliver();

      // The new entry waited for the old one to go.
      expect(order).toEqual(['delete', 'create']);
      const [entry] = [...jira.entries.values()];
      expect(entry).toMatchObject({ taskId: 'T-2' });
      // Its own marker, not the old send's: a resend looks for this entry.
      expect(entry.comment).not.toContain(syncMarker(send));
      expect(worklogs.getWorklogById('w1')?.syncState).toBe('sent');
    });

    it('Move_TheDeletionFails_TheTimeIsOnNeither_NeverOnBoth', async () => {
      await sent();
      jira.provider.deleteWorklog.mockRejectedValue(new ProviderRequestError('jira', 'network', 'socket hang up'));

      service.reassign('w1', 'T-2');
      await deliver();

      // Still at the old task, and not yet at the new one: no double billing.
      expect([...jira.entries.values()].map(e => e.taskId)).toEqual(['T-1']);
      expect(jira.provider.logTime).toHaveBeenCalledTimes(1);
      expect(rows().map(r => [r.operation, r.task_id])).toEqual([['CREATE', 'T-1'], ['DELETE', 'T-1'], ['CREATE', 'T-2']]);
    });

    it('Move_ToAnotherProvider_DeletedAtTheOneCreatedAtTheOther', async () => {
      await sent();

      service.reassign('w1', 'WP-9');
      await deliver();

      expect(jira.entries.size).toBe(0);
      expect([...openProject.entries.values()].map(e => e.taskId)).toEqual(['WP-9']);
    });

    it('Move_SendAttemptedAndLost_DeletesWhateverTheAttemptMade', async () => {
      // The POST reached Jira, its answer did not: never "never attempted".
      const send = logged('w1');
      jira.entries.set('77', { taskId: 'T-1', durationSeconds: 2 * HOUR, startedAtUtc: START, comment: `Pairing ${syncMarker(send)}`, isAdHoc: false });
      worklogs.claimSyncItem(send);
      worklogs.releaseSyncItemAfterFailure(send, 'socket hang up', 0, 8);

      service.reassign('w1', 'T-2');
      await deliver();

      expect([...jira.entries.values()].map(e => e.taskId)).toEqual(['T-2']);
    });

    it('Move_SentToAProjectMadeHere_OnlyTheDeletion', async () => {
      await sent();

      service.reassign('w1', 'OWN-1');
      await deliver();

      expect(jira.entries.size).toBe(0);
      // Not "Sent": the entry it had is gone, and nothing went anywhere else.
      expect(worklogs.getWorklogById('w1')?.syncState).toBe('local');
      expect(rows().map(r => r.operation)).toEqual(['CREATE', 'DELETE']);
    });

    it('Move_AtAProviderThatCannotCorrect_IsRefused', async () => {
      // Moving it would leave the time there too.
      logged('w1', 'T-1', HOUR, 'adhoc');
      worklogs.claimSyncItem('sync_w1');
      worklogs.markSyncItemSynced('sync_w1');

      expect(() => service.reassign('w1', 'T-2')).toThrow(/cannot be corrected/);
      expect(worklogs.getWorklogById('w1')?.taskId).toBe('T-1');
    });

    it('Move_TwiceBeforeAnythingLeft_OneDeletionOfTheFirstEntry', async () => {
      await sent();

      service.reassign('w1', 'T-2');
      service.reassign('w1', 'WP-9');
      await deliver();

      expect(jira.entries.size).toBe(0);
      expect([...openProject.entries.values()].map(e => e.taskId)).toEqual(['WP-9']);
      expect(jira.provider.logTime).toHaveBeenCalledTimes(1);
    });
  });

  describe('a correction or a deletion after a move', () => {
    it('Remove_AfterAMove_StillDeletesThePreviousEntry', async () => {
      // The trap: dropping "this worklog's unsent corrections" by worklog
      // alone took the move's DELETE with them, and left the entry at Jira.
      await sent();
      service.reassign('w1', 'T-2');

      service.remove('w1');
      await deliver();

      expect(jira.entries.size).toBe(0);
      expect(jira.provider.logTime).toHaveBeenCalledTimes(1);
    });

    it('Correct_AfterAMove_ReachesTheNewEntryAndKeepsTheDeletion', async () => {
      await sent();
      service.reassign('w1', 'T-2');

      service.correct('w1', { durationSeconds: HOUR, startedAtUtc: START, comment: 'Pairing, fixed' });
      await deliver();

      expect([...jira.entries.values()]).toEqual([expect.objectContaining({ taskId: 'T-2', durationSeconds: HOUR })]);
    });
  });

  describe('to work of the user\'s own', () => {
    it('Move_ASentEntryToOwnWork_DeletedThere_NoneMade_KeptHere', async () => {
      await sent();

      const moved = service.reassign('w1', ADHOC);
      await deliver();

      expect(moved).toMatchObject({ taskId: ADHOC, comment: 'Pairing' });
      expect(rows().map(r => r.operation)).toEqual(['CREATE', 'DELETE']);
      expect([...jira.entries.values()]).toEqual([]);
    });

    it('Move_ToNewOwnWork_MadeUnderTheIdGiven_NothingQueued', () => {
      logged('w1', 'OWN-1', 2 * HOUR, null);

      const moved = service.reassign('w1', { ownTitle: ' Code review ' }, 'adhoc_new');

      expect(tasks.getTaskById('adhoc_new')).toMatchObject({ title: 'Code review', projectId: 'ADHOC' });
      expect(moved.taskId).toBe('adhoc_new');
      expect(rows()).toEqual([]);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('Move_OwnWorkToOtherOwnWork_KeepsTheNote', () => {
      logged('w1', ADHOC, 2 * HOUR, null);

      expect(service.reassign('w1', { ownTitle: 'Code review' }, 'adhoc_new').comment).toBe('Pairing');
    });
  });

  describe('what is refused', () => {
    it.each([
      ['its own task', 'T-1', /already/],
      ['no such task', 'T-404', /No task/]
    ])('Move_To%s_IsRefused', async (_label, taskId, message) => {
      await sent();

      expect(() => service.reassign('w1', taskId)).toThrow(message);
      expect(rows()).toHaveLength(1);
    });

    it('Move_UnknownWorklogOrMissingArguments_Throw', () => {
      expect(() => service.reassign('nope', 'T-2')).toThrow(/No worklog/);
      expect(() => service.reassign('', 'T-2')).toThrow(/worklogId/);
      expect(() => service.reassign('w1', '')).toThrow(/taskId/);
    });

    it('Move_WithoutTargets_IsUnavailable', () => {
      logged('w1');
      const bare = new WorklogCorrectionService(worklogs, null, dispatch);

      expect(() => bare.reassign('w1', 'T-2')).toThrow(/unavailable/);
    });
  });
});
