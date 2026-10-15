import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { ProviderManager } from '../src/main/providers/provider-manager';
import { ITaskProvider, WorklogPayload } from '../src/main/providers/task-provider-interface';
import { ProviderRequestError } from '../src/main/providers/provider-errors';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';
import { syncMarker } from '../src/main/sync/sync-constants';
import { WorklogCorrectionService } from '../src/main/services/worklog-correction-service';
import { ArgumentException, ArgumentNullException } from '../src/shared/dtos';
import { WORKLOG_COMMENT_MAX_CHARS } from '../src/shared/worklog-correction';

const HOUR = 3600;
const START = '2026-10-13T09:00:00.000Z';

/**
 * A provider that keeps its entries the way Jira does: an id per entry, the
 * comment as sent, a marker search, a 404 for an entry it no longer has.
 */
function fakeRemote(providerId = 'jira') {
  const entries = new Map<string, WorklogPayload>();
  let nextId = 100;
  const provider = {
    providerId,
    providerName: 'Jira',
    minimumLoggableSeconds: 60,
    initialize: async () => true,
    getProjects: async () => [],
    getTasks: async () => [],
    reconcileRemoteState: async () => ({ remoteLoggedTimeToday: null }),
    updateTaskStatus: async () => true,
    logTime: vi.fn(async (payload: WorklogPayload) => {
      const id = String(nextId++);
      entries.set(id, payload);
      return { success: true, remoteWorklogId: id };
    }),
    findWorklog: vi.fn(async (_taskId: string, _start: string, marker: string) => {
      for (const [id, entry] of entries) if (entry.comment.includes(marker)) return id;
      return null;
    }),
    updateWorklog: vi.fn(async (_taskId: string, id: string, payload: WorklogPayload) => {
      if (!entries.has(id)) throw new ProviderRequestError(providerId, 'protocol', 'Gone', { status: 404 });
      entries.set(id, payload);
    }),
    deleteWorklog: vi.fn(async (_taskId: string, id: string) => {
      entries.delete(id);
    })
  };
  return { provider, entries };
}

describe('Correcting a worklog', () => {
  let dbConn: DatabaseConnection;
  let worklogs: WorklogRepository;
  let remote: ReturnType<typeof fakeRemote>;
  let worker: OfflineSyncWorker;
  let dispatch: ReturnType<typeof vi.fn>;
  let service: WorklogCorrectionService;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    dbConn = new DatabaseConnection(':memory:');
    worklogs = new WorklogRepository(dbConn);
    new TaskRepository(dbConn).ensureTaskExists({ id: 'T-1', key: 'MG-12', title: 'Ship it', projectId: 'P' });
    remote = fakeRemote();
    const manager = new ProviderManager(new SettingsRepository(dbConn));
    manager.registerProvider(remote.provider as unknown as ITaskProvider);
    worker = new OfflineSyncWorker(manager, worklogs);
    dispatch = vi.fn();
    service = new WorklogCorrectionService(worklogs, manager, dispatch);
  });

  afterEach(() => {
    dbConn.close();
    vi.restoreAllMocks();
  });

  /** A stopped session, as the engine writes it: the worklog, and its send when `providerId` is given. */
  const logged = (id: string, seconds = 2 * HOUR, providerId: string | null = 'jira'): string => {
    worklogs.saveWorklog({
      id, sessionId: 's1', taskId: 'T-1', durationSeconds: seconds, startedAtUtc: START,
      comment: 'Pairing', createdAtUtc: START
    });
    if (providerId) {
      worklogs.enqueueSyncItem({
        id: `sync_${id}`, providerId, taskId: 'T-1', durationSeconds: seconds, startedAtUtc: START,
        comment: 'Pairing', worklogId: id
      });
    }
    return `sync_${id}`;
  };
  const fix = (seconds: number, comment = 'Pairing, fixed') => ({ durationSeconds: seconds, startedAtUtc: START, comment });
  const rows = () =>
    dbConn.getDb().prepare<[], { operation: string; status: string; duration_seconds: number }>(
      'SELECT operation, status, duration_seconds FROM worklog_sync_queue ORDER BY rowid'
    ).all();
  const onlyEntry = () => [...remote.entries.values()][0];

  describe('one never queued', () => {
    it('Correct_NeverQueued_ChangesItHereOnly', () => {
      logged('w1', HOUR, null);

      const corrected = service.correct('w1', fix(90 * 60));

      expect(corrected).toMatchObject({ durationSeconds: 90 * 60, comment: 'Pairing, fixed', syncState: 'local' });
      expect(rows()).toEqual([]);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('Remove_NeverQueued_DeletesItHereOnly', () => {
      logged('w1', HOUR, null);

      service.remove('w1');

      expect(worklogs.getWorklogById('w1')).toBeNull();
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('Correct_ShortForJiraButNeverSent_IsAllowed', () => {
      // The floor is the provider's; a worklog kept here has none but a second.
      logged('w1', HOUR, null);

      expect(service.correct('w1', fix(30)).durationSeconds).toBe(30);
    });
  });

  describe('one queued but not sent', () => {
    it('Correct_SendNotClaimedYet_RewritesTheSendItself', async () => {
      logged('w1');

      service.correct('w1', fix(90 * 60));
      await worker.processPendingQueue();

      expect(rows()).toEqual([{ operation: 'CREATE', status: 'SYNCED', duration_seconds: 90 * 60 }]);
      expect(remote.provider.logTime).toHaveBeenCalledTimes(1);
      expect(onlyEntry()).toMatchObject({ durationSeconds: 90 * 60, comment: `Pairing, fixed ${syncMarker('sync_w1')}` });
      expect(remote.provider.updateWorklog).not.toHaveBeenCalled();
      expect(dispatch).toHaveBeenCalled();
    });

    it('Correct_SendParked_RewritesItAndGivesItAnotherGo', () => {
      const send = logged('w1');
      worklogs.claimSyncItem(send);
      worklogs.parkSyncItemAsFailed(send, 'HTTP 400 - worklog refused');

      service.correct('w1', fix(HOUR));

      expect(worklogs.getSyncItem(send)).toMatchObject({ status: 'PENDING', retryCount: 0, lastError: null, durationSeconds: HOUR });
      expect(worklogs.getWorklogById('w1')?.syncState).toBe('pending');
    });

    it('Remove_SendNeverAttempted_DropsItAndSendsNothing', async () => {
      logged('w1');

      service.remove('w1');
      await worker.processPendingQueue();

      expect(rows()).toEqual([]);
      expect(remote.provider.logTime).not.toHaveBeenCalled();
      expect(remote.provider.findWorklog).not.toHaveBeenCalled();
    });

    it('Remove_SendAttemptedAndLost_DeletesWhateverTheAttemptMade', async () => {
      // The POST reached Jira but its answer did not: the row is back in
      // PENDING, and the entry exists all the same.
      const send = logged('w1');
      remote.entries.set('77', { taskId: 'T-1', durationSeconds: 2 * HOUR, startedAtUtc: START, comment: `Pairing ${syncMarker(send)}`, isAdHoc: false });
      worklogs.claimSyncItem(send);
      worklogs.releaseSyncItemAfterFailure(send, 'socket hang up', 0, 8);

      service.remove('w1');
      await worker.processPendingQueue();

      expect(remote.entries.size).toBe(0);
      expect(remote.provider.logTime).not.toHaveBeenCalled();
    });
  });

  describe('one sent', () => {
    const sent = async (id = 'w1'): Promise<string> => {
      const send = logged(id);
      await worker.processPendingQueue();
      return send;
    };

    it('Correct_Sent_ReachesTheEntryAndKeepsItsMarker', async () => {
      const send = await sent();

      service.correct('w1', fix(90 * 60));
      expect(worklogs.getWorklogById('w1')?.syncState).toBe('correction-pending');
      await worker.processPendingQueue();

      expect(remote.provider.updateWorklog).toHaveBeenCalledWith('T-1', '100', expect.objectContaining({ durationSeconds: 90 * 60 }));
      // The original marker: the next search goes by it.
      expect(onlyEntry().comment).toBe(`Pairing, fixed ${syncMarker(send)}`);
      expect(remote.provider.findWorklog).not.toHaveBeenCalled();
      expect(worklogs.getWorklogById('w1')?.syncState).toBe('sent');
    });

    it('Correct_TwiceBeforeItLeaves_SendsOnlyTheLatest', async () => {
      await sent();

      service.correct('w1', fix(HOUR));
      service.correct('w1', fix(90 * 60, 'Second thoughts'));
      await worker.processPendingQueue();

      expect(remote.provider.updateWorklog).toHaveBeenCalledTimes(1);
      expect(onlyEntry()).toMatchObject({ durationSeconds: 90 * 60 });
    });

    it('Correct_WhileTheSendIsInFlight_WaitsForIt', async () => {
      const send = logged('w1');
      worklogs.claimSyncItem(send);

      service.correct('w1', fix(HOUR));

      // The UPDATE would name no entry yet.
      expect(worklogs.getPendingQueueItems()).toEqual([]);
      worklogs.markSyncItemSynced(send, '555');
      remote.entries.set('555', { taskId: 'T-1', durationSeconds: 2 * HOUR, startedAtUtc: START, comment: 'x', isAdHoc: false });
      await worker.processPendingQueue();
      expect(remote.provider.updateWorklog).toHaveBeenCalledWith('T-1', '555', expect.objectContaining({ durationSeconds: HOUR }));
    });

    it('Correct_SentBeforeIdsWereKept_FindsTheEntryByItsMarkerAndKeepsTheId', async () => {
      const send = await sent();
      dbConn.getDb().prepare('UPDATE worklog_sync_queue SET remote_worklog_id = NULL').run();

      service.correct('w1', fix(HOUR));
      await worker.processPendingQueue();

      expect(remote.provider.findWorklog).toHaveBeenCalledWith('T-1', START, syncMarker(send));
      expect(onlyEntry().durationSeconds).toBe(HOUR);
      expect(worklogs.getSyncItem(send)?.remoteWorklogId).toBe('100');
    });

    it('Correct_EntryGoneAtTheProvider_ParksWithTheReason', async () => {
      await sent();
      dbConn.getDb().prepare('UPDATE worklog_sync_queue SET remote_worklog_id = NULL').run();
      remote.entries.clear();

      service.correct('w1', fix(HOUR));
      await worker.processPendingQueue();

      const correction = rows().find(r => r.operation === 'UPDATE');
      expect(correction?.status).toBe('FAILED');
      expect(worklogs.getSyncQueueSnapshot().items[0].lastError).toMatch(/Not found in Jira/);
      expect(worklogs.getWorklogById('w1')?.syncState).toBe('correction-failed');
    });

    it('Correct_EntryDeletedWhileItsIdWasKnown_ParksOnThe404', async () => {
      await sent();
      remote.entries.clear();

      service.correct('w1', fix(HOUR));
      await worker.processPendingQueue();

      expect(rows().find(r => r.operation === 'UPDATE')?.status).toBe('FAILED');
    });

    it('Correct_TooShortForTheProvider_IsRefusedAndNothingChanges', async () => {
      await sent();

      expect(() => service.correct('w1', fix(30))).toThrow(/at least 1 minute/);
      expect(worklogs.getWorklogById('w1')?.durationSeconds).toBe(2 * HOUR);
      expect(rows()).toHaveLength(1);
    });

    it('Remove_Sent_DeletesTheEntryAndDropsAnUnsentCorrection', async () => {
      await sent();
      service.correct('w1', fix(HOUR));

      service.remove('w1');
      await worker.processPendingQueue();

      expect(remote.entries.size).toBe(0);
      expect(remote.provider.updateWorklog).not.toHaveBeenCalled();
      expect(rows().map(r => r.operation)).toEqual(['CREATE', 'DELETE']);
    });

    it('Remove_EntryAlreadyGoneAtTheProvider_IsDone', async () => {
      await sent();
      dbConn.getDb().prepare('UPDATE worklog_sync_queue SET remote_worklog_id = NULL').run();
      remote.entries.clear();

      service.remove('w1');
      await worker.processPendingQueue();

      expect(rows().find(r => r.operation === 'DELETE')?.status).toBe('SYNCED');
      expect(remote.provider.deleteWorklog).not.toHaveBeenCalled();
    });

    it('Correct_ProviderThatCannotCorrect_ChangesItHereOnly', async () => {
      // Ad-hoc rows queued by an older build: there is no remote to change.
      logged('w1', HOUR, 'adhoc');
      await worker.processPendingQueue();

      service.correct('w1', fix(90 * 60));
      service.remove('w1');

      expect(rows().map(r => r.operation)).toEqual(['CREATE']);
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe('the queue', () => {
    it('Dispatch_CorrectionForAProviderThatCannotCorrect_ParksForGood', async () => {
      worklogs.enqueueCorrection({
        id: 'sync_fix', operation: 'UPDATE', worklogId: 'w9', originSyncId: 'sync_w9', providerId: 'adhoc',
        taskId: 'T-1', durationSeconds: HOUR, startedAtUtc: START, comment: ''
      });

      await worker.processPendingQueue();

      expect(worklogs.getSyncItem('sync_fix')).toMatchObject({ status: 'FAILED', lastError: expect.stringMatching(/cannot correct/) });
    });

    it('SyncState_FollowsTheSend', async () => {
      const send = logged('w1');
      expect(worklogs.getWorklogById('w1')?.syncState).toBe('pending');
      worklogs.claimSyncItem(send);
      worklogs.parkSyncItemAsFailed(send, 'HTTP 401');
      expect(worklogs.getWorklogById('w1')?.syncState).toBe('failed');
      worklogs.requeueFailedItems();
      await worker.processPendingQueue();
      expect(worklogs.getWorklogById('w1')?.syncState).toBe('sent');
    });
  });

  describe('what is refused', () => {
    it.each([
      ['no duration', { durationSeconds: 0, startedAtUtc: START, comment: '' }, /at least a second/],
      ['a fraction of a second', { durationSeconds: 1.5, startedAtUtc: START, comment: '' }, /at least a second/],
      ['an end in the future', { durationSeconds: HOUR, startedAtUtc: new Date(Date.now() + 1000).toISOString(), comment: '' }, /future/],
      ['a start that is no time', { durationSeconds: HOUR, startedAtUtc: 'Monday', comment: '' }, /not a date/],
      ['a comment too long', { durationSeconds: HOUR, startedAtUtc: START, comment: 'x'.repeat(WORKLOG_COMMENT_MAX_CHARS + 1) }, /longer than/]
    ])('Correct_%s_IsRefused', (_label, correction, message) => {
      logged('w1', HOUR, null);

      expect(() => service.correct('w1', correction)).toThrow(message);
      expect(worklogs.getWorklogById('w1')?.durationSeconds).toBe(HOUR);
    });

    it('CorrectOrRemove_UnknownWorklog_Throws', () => {
      expect(() => service.correct('nope', fix(HOUR))).toThrow(ArgumentException);
      expect(() => service.remove('nope')).toThrow(ArgumentException);
    });

    it('Arguments_Missing_Throw', () => {
      expect(() => service.correct('', fix(HOUR))).toThrow(ArgumentNullException);
      expect(() => service.correct('w1', null as never)).toThrow(ArgumentNullException);
      expect(() => service.remove('')).toThrow(ArgumentNullException);
      expect(() => new WorklogCorrectionService(null as never, null, () => undefined)).toThrow(/worklogs/);
      expect(() => new WorklogCorrectionService(worklogs, null, null as never)).toThrow(/requestDispatch/);
    });
  });
});
