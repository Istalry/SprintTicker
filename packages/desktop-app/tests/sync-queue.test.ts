import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { OfflineSyncWorker } from '../src/main/sync/offline-sync-worker';
import {
  MAX_SYNC_ATTEMPTS,
  SYNC_CLAIM_TIMEOUT_MS,
  SYNC_BACKOFF_MAX_MS,
  computeBackoffMs
} from '../src/main/sync/sync-constants';
import { createId, IdPrefix } from '../src/main/db/id-generator';
import type { ProviderManager } from '../src/main/providers/provider-manager';

/**
 * Regression coverage for audit F-02 (worklogs stranded permanently after one
 * network error) and F-03 (two dispatchers racing the same queue rows).
 */
describe('Worklog sync queue ownership', () => {
  let dbConn: DatabaseConnection;
  let worklogRepo: WorklogRepository;

  function enqueue(id: string, providerId = 'openproject'): void {
    worklogRepo.enqueueSyncItem({
      id,
      providerId,
      taskId: 'OP-1',
      durationSeconds: 3600,
      startedAtUtc: '2026-01-01T09:00:00.000Z',
      comment: 'Queued work'
    });
  }

  function managerStub(overrides: Record<string, unknown>): ProviderManager {
    return {
      getProjects: async () => [],
      getTasks: async () => [],
      logTimeForProvider: async () => ({ success: true }),
      ...overrides
    } as unknown as ProviderManager;
  }

  beforeEach(() => {
    dbConn = new DatabaseConnection(':memory:');
    worklogRepo = new WorklogRepository(dbConn);
  });

  afterEach(() => {
    dbConn.close();
  });

  describe('claimSyncItem is atomic', () => {
    it('ClaimSyncItem_TwoDispatchersRaceSameRow_OnlyOneWins', () => {
      // The double-billing bug: both the sync worker and ProviderManager read
      // the same PENDING set and each POSTed it.
      enqueue('sync_race');

      const first = worklogRepo.claimSyncItem('sync_race');
      const second = worklogRepo.claimSyncItem('sync_race');

      expect(first).not.toBeNull();
      expect(second).toBeNull();
      expect(first?.status).toBe('SYNCING');
    });

    it('ClaimSyncItem_RowInSyncing_IsNotReturnedAsPending', () => {
      enqueue('sync_claimed');
      worklogRepo.claimSyncItem('sync_claimed');

      expect(worklogRepo.getPendingQueueItems()).toHaveLength(0);
    });
  });

  describe('failure is retryable, not terminal', () => {
    it('ReleaseAfterFailure_BelowCeiling_ReturnsRowToPendingBehindBackoff', () => {
      enqueue('sync_retry');
      worklogRepo.claimSyncItem('sync_retry');
      const now = Date.parse('2026-01-01T12:00:00.000Z');

      worklogRepo.releaseSyncItemAfterFailure('sync_retry', 'timeout', 30_000, MAX_SYNC_ATTEMPTS, now);

      // Not due yet.
      expect(worklogRepo.getPendingQueueItems(new Date(now).toISOString())).toHaveLength(0);
      // Due once the backoff elapses.
      const later = new Date(now + 31_000).toISOString();
      const due = worklogRepo.getPendingQueueItems(later);
      expect(due).toHaveLength(1);
      expect(due[0].status).toBe('PENDING');
      expect(due[0].retryCount).toBe(1);
      expect(due[0].lastError).toBe('timeout');
    });

    it('ReleaseAfterFailure_AtCeiling_ParksAsFailed_AndRequeueRecoversIt', () => {
      enqueue('sync_exhausted');
      const now = Date.now();

      for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt++) {
        worklogRepo.claimSyncItem('sync_exhausted');
        worklogRepo.releaseSyncItemAfterFailure('sync_exhausted', 'down', 0, MAX_SYNC_ATTEMPTS, now);
      }

      expect(worklogRepo.getPendingQueueItems()).toHaveLength(0);

      // F-02's recovery: a parked row is not lost time.
      expect(worklogRepo.requeueFailedItems()).toBe(1);
      const recovered = worklogRepo.getPendingQueueItems();
      expect(recovered).toHaveLength(1);
      expect(recovered[0].retryCount).toBe(0);
    });

    it('ComputeBackoff_GrowsWithRetriesAndStaysUnderTheCap', () => {
      const first = computeBackoffMs(0);
      const later = computeBackoffMs(6);
      expect(first).toBeGreaterThan(0);
      expect(later).toBeGreaterThan(first);
      for (let n = 0; n < 30; n++) {
        expect(computeBackoffMs(n)).toBeLessThanOrEqual(SYNC_BACKOFF_MAX_MS);
      }
    });
  });

  describe('crashed claims are recovered', () => {
    it('ReclaimStaleSyncItems_ClaimOlderThanTimeout_ReturnsRowToPending', () => {
      enqueue('sync_crashed');
      const claimedAt = Date.parse('2026-01-01T09:00:00.000Z');
      worklogRepo.claimSyncItem('sync_crashed', new Date(claimedAt).toISOString());

      // Not yet stale.
      expect(worklogRepo.reclaimStaleSyncItems(SYNC_CLAIM_TIMEOUT_MS, claimedAt + 1000)).toBe(0);

      // Past the timeout, the abandoned claim is released.
      const reclaimed = worklogRepo.reclaimStaleSyncItems(
        SYNC_CLAIM_TIMEOUT_MS,
        claimedAt + SYNC_CLAIM_TIMEOUT_MS + 1000
      );
      expect(reclaimed).toBe(1);
      expect(worklogRepo.getPendingQueueItems()).toHaveLength(1);
    });
  });

  describe('the worker dispatches to the row\'s own provider', () => {
    it('ProcessPendingQueue_MixedProviders_SendsEachRowToItsRecordedProvider', async () => {
      // Switching provider mid-day used to deliver everything queued to
      // whichever provider happened to be active, posting OpenProject worklogs
      // into AdHoc.
      enqueue('sync_op', 'openproject');
      enqueue('sync_adhoc', 'adhoc');

      const seen: string[] = [];
      const worker = new OfflineSyncWorker(
        managerStub({
          logTimeForProvider: async (providerId: string) => {
            seen.push(providerId);
            return { success: true };
          }
        }),
        worklogRepo
      );

      const result = await worker.processPendingQueue();

      expect(result.succeeded).toBe(2);
      expect(seen.sort()).toEqual(['adhoc', 'openproject']);
      expect(worklogRepo.getPendingQueueItems()).toHaveLength(0);
    });

    it('ProcessPendingQueue_RunTwice_DoesNotResendAnAlreadyDeliveredWorklog', async () => {
      enqueue('sync_once');
      const send = vi.fn(async () => ({ success: true }));
      const worker = new OfflineSyncWorker(managerStub({ logTimeForProvider: send }), worklogRepo);

      await worker.processPendingQueue();
      await worker.processPendingQueue();

      expect(send).toHaveBeenCalledTimes(1);
    });

    it('ProcessPendingQueue_ProviderFails_RowSurvivesForALaterAttempt', async () => {
      enqueue('sync_flaky');
      const worker = new OfflineSyncWorker(
        managerStub({
          logTimeForProvider: async () => {
            throw new Error('ECONNRESET');
          }
        }),
        worklogRepo
      );

      const result = await worker.processPendingQueue();

      expect(result.failed).toBe(1);
      // Still in the queue, waiting out its backoff -- not discarded.
      const row = dbConn
        .getDb()
        .prepare<[], { status: string; retry_count: number; last_error: string }>(
          "SELECT status, retry_count, last_error FROM worklog_sync_queue WHERE id = 'sync_flaky'"
        )
        .get();
      expect(row?.status).toBe('PENDING');
      expect(row?.retry_count).toBe(1);
      expect(row?.last_error).toContain('ECONNRESET');
    });
  });

  describe('identifiers do not collide', () => {
    it('CreateId_ManyCallsInTheSameMillisecond_AreAllDistinct', () => {
      // `${prefix}${Date.now()}` collided whenever two rows were created inside
      // one millisecond -- which stopping a session does, writing a worklog and
      // a queue row together. The second INSERT threw and the time was lost.
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) ids.add(createId(IdPrefix.SYNC_ITEM));
      expect(ids.size).toBe(1000);
    });

    it('CreateId_AdHocPrefix_IsUnchanged', () => {
      // deleteTasksNotIn filters on `id NOT LIKE 'adhoc_%'`; changing this
      // prefix would make the sync prune delete every ad-hoc task.
      expect(createId(IdPrefix.ADHOC_TASK).startsWith('adhoc_')).toBe(true);
    });
  });
});
