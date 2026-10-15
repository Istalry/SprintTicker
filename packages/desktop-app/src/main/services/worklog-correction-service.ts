import { SyncQueueRecord, WorklogRecord, WorklogRepository } from '../db/repositories/worklog-repository';
import { ProviderManager } from '../providers/provider-manager';
import { ITaskProvider } from '../providers/task-provider-interface';
import { createId, IdPrefix } from '../db/id-generator';
import { ArgumentException, ArgumentNullException } from '../../shared/dtos';
import { checkWorklogCorrection, WorklogCorrectionDTO } from '../../shared/worklog-correction';

/**
 * Corrects or deletes a worklog, here at once and at its provider through the
 * queue.
 *
 * A stop sends at once, so a wrong duration used to be fixed by hand in Jira
 * or OpenProject. Corrections travel the same queue as the worklogs, for the
 * same reasons: they survive a lost network and a restart, and the sync panel
 * shows them. What is queued depends on how far the send got:
 *
 * - never queued (ad-hoc, too short, recovered): corrected here only;
 * - queued but not claimed: the queued row is rewritten, or dropped, and
 *   the provider never sees the old values;
 * - claimed or delivered: an UPDATE or DELETE row goes behind it, and
 *   `getPendingQueueItems` holds it until everything before it on that
 *   worklog has arrived. One unsent UPDATE per worklog: the latest wins.
 */
export class WorklogCorrectionService {
  private readonly _worklogs: WorklogRepository;
  private readonly _providers: ProviderManager | null;
  private readonly _requestDispatch: () => void;
  private readonly _now: () => number;

  constructor(
    worklogs: WorklogRepository,
    providers: ProviderManager | null,
    requestDispatch: () => void,
    now: () => number = Date.now
  ) {
    if (!worklogs) throw new ArgumentNullException('worklogs');
    if (!requestDispatch) throw new ArgumentNullException('requestDispatch');
    this._worklogs = worklogs;
    this._providers = providers;
    this._requestDispatch = requestDispatch;
    this._now = now;
  }

  /** Rewrites a worklog's duration, start and comment, and queues the change for its provider. */
  public correct(worklogId: string, correction: WorklogCorrectionDTO): WorklogRecord {
    if (!worklogId) throw new ArgumentNullException('worklogId');
    if (!correction) throw new ArgumentNullException('correction');
    const worklog = this._worklogs.getWorklogById(worklogId);
    if (!worklog) throw new ArgumentException(`No worklog ${worklogId}.`);

    const send = this._worklogs.getSendOf(worklogId);
    const provider = send ? this.providerOf(send) : null;
    const refusal = checkWorklogCorrection(correction, this._now(), provider?.minimumLoggableSeconds ?? 1);
    if (refusal) throw new ArgumentException(refusal);

    const queued = this.transaction(() => {
      this._worklogs.rewriteWorklog(worklogId, correction);
      if (!send) return false;

      // Not claimed yet: the provider will only ever see the new values.
      if (this._worklogs.rewriteUnsentSyncItem(send.id, correction)) {
        for (const stale of this._worklogs.getUnsentCorrectionsOf(worklogId)) this._worklogs.dropUnsentSyncItem(stale.id);
        return true;
      }
      if (!this.canCorrect(provider)) return this.keptHereOnly(worklogId, send);

      const unsentUpdate = this._worklogs.getUnsentCorrectionsOf(worklogId).find(row => row.operation === 'UPDATE');
      if (unsentUpdate && this._worklogs.rewriteUnsentSyncItem(unsentUpdate.id, correction)) return true;

      this._worklogs.enqueueCorrection({
        id: createId(IdPrefix.SYNC_ITEM),
        operation: 'UPDATE',
        worklogId,
        originSyncId: send.id,
        providerId: send.providerId,
        taskId: send.taskId,
        ...correction
      });
      return true;
    });

    if (queued) this._requestDispatch();
    return this._worklogs.getWorklogById(worklogId)!;
  }

  /** Deletes a worklog here at once, and at its provider through the queue. */
  public remove(worklogId: string): void {
    if (!worklogId) throw new ArgumentNullException('worklogId');
    const worklog = this._worklogs.getWorklogById(worklogId);
    if (!worklog) throw new ArgumentException(`No worklog ${worklogId}.`);

    const send = this._worklogs.getSendOf(worklogId);
    const provider = send ? this.providerOf(send) : null;

    const queued = this.transaction(() => {
      this._worklogs.deleteWorklog(worklogId);
      if (!send) return false;

      for (const stale of this._worklogs.getUnsentCorrectionsOf(worklogId)) this._worklogs.dropUnsentSyncItem(stale.id);
      const neverAttempted = send.retryCount === 0;
      if (this._worklogs.dropUnsentSyncItem(send.id) && neverAttempted) return false;
      // Dropped after an attempt, or claimed or delivered: the entry may
      // exist. An attempt whose answer was lost can have made it, so the
      // deletion goes out all the same and finds it by its marker -- or
      // finds nothing, which is a deletion done.
      if (!this.canCorrect(provider)) return this.keptHereOnly(worklogId, send);

      this._worklogs.enqueueCorrection({
        id: createId(IdPrefix.SYNC_ITEM),
        operation: 'DELETE',
        worklogId,
        originSyncId: send.id,
        providerId: send.providerId,
        taskId: send.taskId,
        durationSeconds: worklog.durationSeconds,
        startedAtUtc: worklog.startedAtUtc,
        comment: worklog.comment
      });
      return true;
    });

    if (queued) this._requestDispatch();
  }

  private providerOf(send: SyncQueueRecord): ITaskProvider | null {
    return this._providers?.getProvider(send.providerId) ?? null;
  }

  private canCorrect(provider: ITaskProvider | null): boolean {
    return Boolean(provider?.findWorklog && provider.updateWorklog && provider.deleteWorklog);
  }

  /** A provider with no remote to correct -- ad-hoc rows queued by an older build. */
  private keptHereOnly(worklogId: string, send: SyncQueueRecord): false {
    console.log(
      `[WorklogCorrectionService] ${send.providerId} cannot correct worklog ${worklogId}; changed here only.`
    );
    return false;
  }

  private transaction<T>(work: () => T): T {
    return this._worklogs.getConnection().getDb().transaction(work)();
  }
}
