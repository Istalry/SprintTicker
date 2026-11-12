import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { ProviderManager } from '../src/main/providers/provider-manager';
import { ITaskProvider } from '../src/main/providers/task-provider-interface';
import { ProviderRequestError } from '../src/main/providers/provider-errors';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';
import { WorklogCorrectionService, WorklogMoveTargets } from '../src/main/services/worklog-correction-service';
import { refusalReason } from '../src/shared/refused-entry';
import { ArgumentException } from '../src/shared/dtos';
import { fakeRemote } from './support/fake-worklog-remote';

const HOUR = 3600;
const START = '2026-10-13T09:00:00.000Z';
const TRACKING_OFF = () => ProviderRequestError.fromStatus('jira', 400, 'Logging time on MG-12', 'Time tracking is off on this issue.');

/**
 * One entry refused (redesign P11c): a 4xx on a worklog's own send is
 * refused, never retried, and ended by Move or Keep off. The real queue and
 * worker, against a fake Jira.
 */
describe('An entry the provider refuses', () => {
  let dbConn: DatabaseConnection;
  let worklogs: WorklogRepository;
  let jira: ReturnType<typeof fakeRemote>;
  let worker: OfflineSyncWorker;
  let service: WorklogCorrectionService;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    dbConn = new DatabaseConnection(':memory:');
    worklogs = new WorklogRepository(dbConn, { holdMs: 0 });
    const tasks = new TaskRepository(dbConn);
    tasks.ensureTaskExists({ id: 'T-1', key: 'MG-12', title: 'Ship it', projectId: 'P' });
    tasks.ensureTaskExists({ id: 'T-2', key: 'MG-13', title: 'Fix it', projectId: 'P' });
    jira = fakeRemote('jira', 'Jira', 60);
    const manager = new ProviderManager(new SettingsRepository(dbConn));
    manager.registerProvider(jira.provider as unknown as ITaskProvider);
    worker = new OfflineSyncWorker(manager, worklogs);
    const targets: WorklogMoveTargets = {
      getTask: taskId => tasks.getTaskById(taskId),
      destinationOf: () => ({ providerId: 'jira', minimumSeconds: 60 }),
      retireAdHocIfUnused: () => undefined
    };
    service = new WorklogCorrectionService(worklogs, manager, vi.fn(), Date.now, targets);
  });

  afterEach(() => {
    dbConn.close();
    vi.restoreAllMocks();
  });

  const logged = (id = 'w1'): string => {
    worklogs.saveWorklog({ id, sessionId: 's1', taskId: 'T-1', durationSeconds: HOUR / 2, startedAtUtc: START, comment: 'Pairing', createdAtUtc: START });
    worklogs.enqueueSyncItem({ id: `sync_${id}`, providerId: 'jira', taskId: 'T-1', durationSeconds: HOUR / 2, startedAtUtc: START, comment: 'Pairing', worklogId: id });
    return `sync_${id}`;
  };
  const refused = async (id = 'w1'): Promise<string> => {
    const send = logged(id);
    jira.provider.logTime.mockRejectedValueOnce(TRACKING_OFF());
    await worker.processPendingQueue();
    return send;
  };
  const operations = () =>
    dbConn.getDb().prepare<[], { operation: string; task_id: string; status: string }>(
      'SELECT operation, task_id, status FROM worklog_sync_queue ORDER BY rowid'
    ).all();

  describe('the worker', () => {
    it('ProcessPendingQueue_IssueRefusesTheTime_IsRefusedWithTheProvidersWords', async () => {
      const send = await refused();

      expect(worklogs.getSyncItem(send)).toMatchObject({ status: 'FAILED', retryCount: 0 });
      expect(worklogs.getSyncItem(send)?.refusedAtUtc).not.toBeNull();
      const [entry] = worklogs.getRefusedWorklogs();
      expect(entry).toMatchObject({ id: 'w1', syncState: 'refused' });
      expect(refusalReason(entry.refusal)).toBe('Time tracking is off on this issue');
    });

    it('RequeueFailedWorklogs_Refused_IsNeverSentAgain', async () => {
      await refused();

      expect(worker.requeueFailedWorklogs()).toBe(0);
      await worker.processPendingQueue();

      expect(jira.provider.logTime).toHaveBeenCalledTimes(1);
    });

    it('ProcessPendingQueue_Refused_TellsTheWindows', async () => {
      const told = vi.fn();
      worker.onEntryRefused(told);

      await refused();

      expect(told).toHaveBeenCalledWith('w1');
    });

    it('ProcessPendingQueue_TokenRefused_IsParkedNotRefused', async () => {
      const send = logged();
      jira.provider.logTime.mockRejectedValueOnce(ProviderRequestError.fromStatus('jira', 401, 'Logging time', 'Unauthorized'));

      await worker.processPendingQueue();

      expect(worklogs.getSyncItem(send)).toMatchObject({ status: 'FAILED', refusedAtUtc: null });
      expect(worklogs.getWorklogById('w1')?.syncState).toBe('failed');
      expect(worker.requeueFailedWorklogs()).toBe(1);
    });

    it('ProcessPendingQueue_SearchBeforeAResendRefused_IsParkedNotRefused', async () => {
      // A refused search says nothing of what an earlier attempt made, so
      // the row is not one whose send "made no entry".
      const send = logged();
      worklogs.claimSyncItem(send);
      worklogs.reclaimStaleSyncItems(0, Date.now() + 1);
      jira.provider.findWorklog.mockRejectedValueOnce(ProviderRequestError.fromStatus('jira', 404, 'Searching MG-12'));

      await worker.processPendingQueue();

      expect(worklogs.getSyncItem(send)).toMatchObject({ status: 'FAILED', refusedAtUtc: null });
      expect(jira.provider.logTime).not.toHaveBeenCalled();
    });

    it('ProcessPendingQueue_ServerError_IsRetriedNotRefused', async () => {
      const send = logged();
      jira.provider.logTime.mockRejectedValueOnce(ProviderRequestError.fromStatus('jira', 503, 'Logging time'));

      await worker.processPendingQueue();

      expect(worklogs.getSyncItem(send)).toMatchObject({ status: 'PENDING', retryCount: 1, refusedAtUtc: null });
    });
  });

  describe('Move…', () => {
    it('Reassign_Refused_PointsTheSendAtTheNewTask_AndDeletesNothing', async () => {
      const send = await refused();

      const moved = service.reassign('w1', 'T-2');
      await worker.processPendingQueue();

      expect(operations()).toEqual([{ operation: 'CREATE', task_id: 'T-2', status: 'SYNCED' }]);
      expect(jira.provider.deleteWorklog).not.toHaveBeenCalled();
      expect(moved.syncState).toBe('pending');
      expect(worklogs.getSyncItem(send)?.refusedAtUtc).toBeNull();
      expect(worklogs.getRefusedWorklogs()).toEqual([]);
    });
  });

  describe('Keep off', () => {
    it('KeepOff_Refused_DropsTheSend_AndKeepsTheTimeHere', async () => {
      await refused();

      const kept = service.keepOff('w1');

      expect(kept).toMatchObject({ id: 'w1', taskId: 'T-1', durationSeconds: HOUR / 2, syncState: 'local' });
      expect(operations()).toEqual([]);
      expect(worklogs.getRefusedWorklogs()).toEqual([]);
    });

    it('KeepOff_NotRefused_Throws', () => {
      logged();

      expect(() => service.keepOff('w1')).toThrow(ArgumentException);
      expect(operations()).toHaveLength(1);
    });

    it('KeepOff_UnknownWorklog_Throws', () => {
      expect(() => service.keepOff('nope')).toThrow(ArgumentException);
    });
  });

  describe('Correct and Delete', () => {
    it('Correct_Refused_GivesItAnotherGo', async () => {
      const send = await refused();

      service.correct('w1', { durationSeconds: HOUR, startedAtUtc: START, comment: 'Pairing' });

      expect(worklogs.getSyncItem(send)).toMatchObject({ status: 'PENDING', refusedAtUtc: null });
      expect(worklogs.getWorklogById('w1')?.syncState).toBe('pending');
    });

    it('Remove_Refused_QueuesNoDeletion', async () => {
      await refused();

      service.remove('w1');

      expect(operations()).toEqual([]);
    });
  });
});

describe('refusalReason', () => {
  it('RefusalReason_WithTheProvidersWords_IsThemWithoutTheFullStop', () => {
    expect(refusalReason('Logging time failed: HTTP 400 - Time tracking is off.')).toBe('Time tracking is off');
  });

  it('RefusalReason_A404WithNoWords_SaysTheTaskIsGone', () => {
    expect(refusalReason('Logging time failed: HTTP 404')).toBe('the task is not there any more');
  });

  it('RefusalReason_OtherStatusWithNoWords_NamesIt', () => {
    expect(refusalReason('Logging time failed: HTTP 422')).toBe('it answered 422');
  });

  it('RefusalReason_NoStatus_IsTheMessage', () => {
    expect(refusalReason('Jira cannot log on an epic.')).toBe('Jira cannot log on an epic');
  });

  it('RefusalReason_Nothing_SaysSo', () => {
    expect(refusalReason(null)).toBe('no reason was given');
  });
});
