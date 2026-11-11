import { SyncQueueRecord, WorklogRecord, WorklogRepository } from '../db/repositories/worklog-repository';
import { ProviderManager } from '../providers/provider-manager';
import { ITaskProvider } from '../providers/task-provider-interface';
import { createId, IdPrefix, isAdHocTaskId } from '../db/id-generator';
import { ArgumentException, ArgumentNullException, TaskDTO } from '../../shared/dtos';
import { checkManualWorklog, checkWorklogCorrection, ManualWorklogDTO, WorklogCorrectionDTO } from '../../shared/worklog-correction';
import { WORKLOG_COMMENTS } from '../../shared/worklog-comments';

/** Where time logged on a task is queued, and the least that provider records. */
export interface SendDestination {
  providerId: string;
  minimumSeconds: number;
}

/** What moving a worklog needs to know of the task it goes to: the engine's rules. */
export interface WorklogMoveTargets {
  getTask(taskId: string): TaskDTO | null;
  /** Null for a project made in SprintTicker, whose time stays here. */
  destinationOf(taskId: string): SendDestination | null;
  /** Retires an ad-hoc task once nothing is logged on it, as an assigned interruption's is. */
  retireAdHocIfUnused(taskId: string): void;
}

/**
 * Corrects, deletes or moves a worklog, here at once and at its provider
 * through the queue.
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
 *
 * A move to another task (`reassign`) is a DELETE of the entry where it is,
 * then a CREATE on the new task: delete before create, by that same
 * ordering, so a move stopped half-way leaves the time off both providers
 * for a while and never on both.
 */
export class WorklogCorrectionService {
  private readonly _worklogs: WorklogRepository;
  private readonly _providers: ProviderManager | null;
  private readonly _requestDispatch: () => void;
  private readonly _now: () => number;
  private readonly _targets: WorklogMoveTargets | null;

  constructor(
    worklogs: WorklogRepository,
    providers: ProviderManager | null,
    requestDispatch: () => void,
    now: () => number = Date.now,
    targets: WorklogMoveTargets | null = null
  ) {
    if (!worklogs) throw new ArgumentNullException('worklogs');
    if (!requestDispatch) throw new ArgumentNullException('requestDispatch');
    this._worklogs = worklogs;
    this._providers = providers;
    this._requestDispatch = requestDispatch;
    this._now = now;
    this._targets = targets;
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
        for (const stale of this._worklogs.getUnsentCorrectionsOf(worklogId, send.id)) this._worklogs.dropUnsentSyncItem(stale.id);
        return true;
      }
      if (!this.canCorrect(provider)) return this.keptHereOnly(worklogId, send);

      const unsentUpdate = this._worklogs.getUnsentCorrectionsOf(worklogId, send.id).find(row => row.operation === 'UPDATE');
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

      for (const stale of this._worklogs.getUnsentCorrectionsOf(worklogId, send.id)) this._worklogs.dropUnsentSyncItem(stale.id);
      // `send_attempts`, never `retry_count`: the budget is reset on purpose
      // by a correction of this very row and by "retry failed", and parking
      // leaves it alone, so a row with an attempt behind it can read 0 there.
      const neverAttempted = send.sendAttempts === 0;
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

  /**
   * Moves a worklog to another task: here at once, so History shows it on
   * the new task, and at the providers through the queue, by how far its
   * send got.
   *
   * - never queued (ad-hoc, a project made here, too short): a first send,
   *   a CREATE for the new task's provider;
   * - queued and never attempted: that row is pointed at the new task and
   *   provider, and the old provider never hears of it;
   * - attempted, claimed or delivered: a DELETE of the entry where it is,
   *   then a CREATE on the new task, which waits for the DELETE to arrive.
   *
   * An ad-hoc worklog takes the ad-hoc task's name as its comment, so the
   * provider shows what the time was; its emptied task is retired. Neither
   * task's status moves.
   *
   * @throws ArgumentException when the task is ad-hoc, unknown or already
   *   the worklog's; when the worklog is shorter than the new provider
   *   records; or when its entry may exist at a provider this app cannot
   *   correct, which would leave the time on both.
   */
  public reassign(worklogId: string, taskId: string): WorklogRecord {
    if (!worklogId) throw new ArgumentNullException('worklogId');
    if (!taskId) throw new ArgumentNullException('taskId');
    if (!this._targets) throw new Error('Moving a worklog is unavailable.');
    const worklog = this._worklogs.getWorklogById(worklogId);
    if (!worklog) throw new ArgumentException(`No worklog ${worklogId}.`, 'worklogId');
    if (worklog.taskId === taskId) throw new ArgumentException('The worklog is on that task already.', 'taskId');
    if (isAdHocTaskId(taskId)) throw new ArgumentException('Move it to a task, not to other ad-hoc work.', 'taskId');
    if (!this._targets.getTask(taskId)) throw new ArgumentException(`No task ${taskId}.`, 'taskId');

    const destination = this._targets.destinationOf(taskId);
    if (destination && worklog.durationSeconds < destination.minimumSeconds) {
      throw new ArgumentException(
        `The provider records at least ${Math.ceil(destination.minimumSeconds / 60)} minute(s); a shorter worklog cannot be moved there.`,
        'worklogId'
      );
    }
    const send = this._worklogs.getSendOf(worklogId);
    const mayExist = send !== null && !WorklogCorrectionService.neverAttempted(send);
    if (send && mayExist && !this.canCorrect(this.providerOf(send))) {
      throw new ArgumentException(
        `It is at ${send.providerId}, which cannot be corrected from here: moving it would leave the time there too.`,
        'worklogId'
      );
    }
    const comment = worklog.adHoc && worklog.taskTitle ? worklog.taskTitle : worklog.comment;

    const queued = this.transaction(() => {
      this._worklogs.retargetWorklog(worklogId, taskId, comment);
      if (send) {
        for (const stale of this._worklogs.getUnsentCorrectionsOf(worklogId, send.id)) this._worklogs.dropUnsentSyncItem(stale.id);
        if (!mayExist) {
          if (destination && this._worklogs.retargetUnsentSyncItem(send.id, destination.providerId, taskId, comment)) return true;
          if (!destination && this._worklogs.dropUnsentSyncItem(send.id)) return false;
          // Claimed since it was read: the entry may exist now.
        }
        // Parked after an attempt: the DELETE stands for it, and would wait
        // behind it for good.
        this._worklogs.dropUnsentSyncItem(send.id);
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
      }
      if (destination) {
        this._worklogs.enqueueSyncItem({
          id: createId(IdPrefix.SYNC_ITEM),
          providerId: destination.providerId,
          taskId,
          durationSeconds: worklog.durationSeconds,
          startedAtUtc: worklog.startedAtUtc,
          comment,
          worklogId
        });
      }
      return Boolean(send) || Boolean(destination);
    });

    if (worklog.adHoc) this._targets.retireAdHocIfUnused(worklog.taskId);
    if (queued) this._requestDispatch();
    return this._worklogs.getWorklogById(worklogId)!;
  }

  /**
   * Adds time nobody timed (S16b): a worklog here, and a first send to the
   * task's provider through the queue, held for the undo window like a
   * stop's. A project made here keeps it here. An empty note is
   * `WORKLOG_COMMENTS.ADDED`, so the provider's entry says where it came
   * from.
   *
   * An overlap or a closed week is warned about in the window and never
   * refused: an overlapping entry is held by the queue's own rule.
   *
   * @throws ArgumentException when the task is ad-hoc or unknown, or the
   *   entry fails `checkManualWorklog` against the provider's floor.
   */
  public add(entry: ManualWorklogDTO, worklogId: string = createId(IdPrefix.WORKLOG)): WorklogRecord {
    if (!entry) throw new ArgumentNullException('entry');
    if (!worklogId) throw new ArgumentNullException('worklogId');
    if (!this._targets) throw new Error('Adding time is unavailable.');
    if (isAdHocTaskId(entry.taskId)) throw new ArgumentException('Add time to a task, not to ad-hoc work.', 'taskId');
    if (entry.taskId && !this._targets.getTask(entry.taskId)) throw new ArgumentException(`No task ${entry.taskId}.`, 'taskId');
    const destination = entry.taskId ? this._targets.destinationOf(entry.taskId) : null;
    const refusal = checkManualWorklog(entry, this._now(), destination?.minimumSeconds ?? 1);
    if (refusal) throw new ArgumentException(refusal);

    const comment = entry.comment.trim() || WORKLOG_COMMENTS.ADDED;
    this.transaction(() => {
      this._worklogs.saveWorklog({
        id: worklogId,
        sessionId: createId(IdPrefix.MANUAL_SESSION),
        taskId: entry.taskId,
        durationSeconds: entry.durationSeconds,
        startedAtUtc: entry.startedAtUtc,
        comment,
        createdAtUtc: new Date(this._now()).toISOString()
      });
      if (destination) {
        this._worklogs.enqueueSyncItem({
          id: createId(IdPrefix.SYNC_ITEM),
          providerId: destination.providerId,
          taskId: entry.taskId,
          durationSeconds: entry.durationSeconds,
          startedAtUtc: entry.startedAtUtc,
          comment,
          worklogId
        });
      }
    });

    if (destination) this._requestDispatch();
    return this._worklogs.getWorklogById(worklogId)!;
  }

  /** Unclaimed and never claimed: the entry cannot exist. `send_attempts`, never the retry budget. */
  private static neverAttempted(send: SyncQueueRecord): boolean {
    return send.sendAttempts === 0 && (send.status === 'PENDING' || send.status === 'FAILED');
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
