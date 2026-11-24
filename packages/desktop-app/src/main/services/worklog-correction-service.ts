import { SyncQueueRecord, WorklogRecord, WorklogRepository } from '../db/repositories/worklog-repository';
import { ProviderManager } from '../providers/provider-manager';
import { ITaskProvider } from '../providers/task-provider-interface';
import { createId, IdPrefix, isAdHocTaskId } from '../db/id-generator';
import { ArgumentException, ArgumentNullException, TaskDTO } from '../../shared/dtos';
import {
  checkManualWorklog,
  checkWorklogCorrection,
  ManualWorklogDTO,
  splitPieces,
  WorklogCorrectionDTO,
  WorklogSplitDTO,
  WorklogTarget
} from '../../shared/worklog-correction';
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
  /** New work of the user's own under this id, for a move, added time or a split's rest: its time stays here. */
  createOwnTask?(title: string, taskId: string, projectName?: string): TaskDTO;
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
      const madeNoEntry = WorklogCorrectionService.madeNoEntry(send);
      if (this._worklogs.dropUnsentSyncItem(send.id) && madeNoEntry) return false;
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
   * task's status moves. Moved to work of the user's own -- an existing
   * one, or new one named `ownTitle` -- the time stays here: its entry at a
   * provider is deleted and none is made.
   *
   * @throws ArgumentException when the task is unknown or already
   *   the worklog's; when the worklog is shorter than the new provider
   *   records; or when its entry may exist at a provider this app cannot
   *   correct, which would leave the time on both.
   */
  public reassign(worklogId: string, target: WorklogTarget, ownTaskId: string = createId(IdPrefix.ADHOC_TASK)): WorklogRecord {
    if (!worklogId) throw new ArgumentNullException('worklogId');
    if (!target) throw new ArgumentNullException('taskId');
    if (!this._targets) throw new Error('Moving a worklog is unavailable.');
    const worklog = this._worklogs.getWorklogById(worklogId);
    if (!worklog) throw new ArgumentException(`No worklog ${worklogId}.`, 'worklogId');
    const { taskId, ownTitle, ownProject } = this.targetOf(typeof target === 'string' ? { taskId: target } : target, ownTaskId);
    if (worklog.taskId === taskId) throw new ArgumentException('The worklog is on that task already.', 'taskId');

    const destination = this.destinationFor(taskId, ownTitle);
    if (destination && worklog.durationSeconds < destination.minimumSeconds) {
      throw new ArgumentException(
        `The provider records at least ${Math.ceil(destination.minimumSeconds / 60)} minute(s); a shorter worklog cannot be moved there.`,
        'worklogId'
      );
    }
    const send = this._worklogs.getSendOf(worklogId);
    const mayExist = send !== null && !WorklogCorrectionService.madeNoEntry(send);
    if (send && mayExist && !this.canCorrect(this.providerOf(send))) {
      throw new ArgumentException(
        `It is at ${send.providerId}, which cannot be corrected from here: moving it would leave the time there too.`,
        'worklogId'
      );
    }
    // Own work to own work keeps the note: the name it carried was for a provider.
    const comment = worklog.adHoc && worklog.taskTitle && destination ? worklog.taskTitle : worklog.comment;

    const queued = this.transaction(() => {
      if (ownTitle) this._targets!.createOwnTask!(ownTitle, taskId, ownProject);
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
   * Keeps an entry its provider refused off it (P11c): the send is dropped,
   * and the worklog stays here on its task, as local time -- the week stops
   * listing it. Only a refused send: any other may have made the entry, or
   * still will, and keeping that off would be a deletion (Delete is).
   *
   * @throws ArgumentException when the worklog is unknown or its send was
   *   not refused.
   */
  public keepOff(worklogId: string): WorklogRecord {
    if (!worklogId) throw new ArgumentNullException('worklogId');
    const worklog = this._worklogs.getWorklogById(worklogId);
    if (!worklog) throw new ArgumentException(`No worklog ${worklogId}.`, 'worklogId');
    const send = this._worklogs.getSendOf(worklogId);
    if (!send || send.refusedAtUtc === null || send.status !== 'FAILED') {
      throw new ArgumentException('Only an entry its provider refused can be kept off it.', 'worklogId');
    }
    this.transaction(() => {
      for (const stale of this._worklogs.getUnsentCorrectionsOf(worklogId, send.id)) this._worklogs.dropUnsentSyncItem(stale.id);
      this._worklogs.dropUnsentSyncItem(send.id);
    });
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
   * Work of the user's own takes added time too -- an existing one, or new
   * one named `entry.ownTitle` -- and keeps it here.
   *
   * @throws ArgumentException when the task is unknown, or the
   *   entry fails `checkManualWorklog` against the provider's floor.
   */
  public add(
    entry: ManualWorklogDTO,
    worklogId: string = createId(IdPrefix.WORKLOG),
    ownTaskId: string = createId(IdPrefix.ADHOC_TASK)
  ): WorklogRecord {
    if (!entry) throw new ArgumentNullException('entry');
    if (!worklogId) throw new ArgumentNullException('worklogId');
    if (!this._targets) throw new Error('Adding time is unavailable.');
    const refusal = checkManualWorklog(entry, this._now(), 1);
    if (refusal) throw new ArgumentException(refusal);
    const { taskId, ownTitle, ownProject } = this.targetOf(entry, ownTaskId);
    const destination = this.destinationFor(taskId, ownTitle);
    const floorRefusal = destination ? checkManualWorklog(entry, this._now(), destination.minimumSeconds) : null;
    if (floorRefusal) throw new ArgumentException(floorRefusal);

    const comment = entry.comment.trim() || WORKLOG_COMMENTS.ADDED;
    const written = { taskId, durationSeconds: entry.durationSeconds, startedAtUtc: entry.startedAtUtc, comment };
    this.transaction(() => {
      if (ownTitle) this._targets!.createOwnTask!(ownTitle, taskId, ownProject);
      this.writeEntry(written, worklogId, createId(IdPrefix.MANUAL_SESSION), destination, null);
    });

    if (destination) this._requestDispatch();
    return this._worklogs.getWorklogById(worklogId)!;
  }

  /**
   * Splits an entry in two at `split.atUtc` (S16c): the time forgotten to be
   * switched. The entry is shortened to end there -- a correction, through
   * the queue like any -- and the rest becomes a new entry on
   * `split.taskId`, from the same session and with the same note, whose
   * first send waits for the shortening to arrive (`waitsFor`): the provider
   * gets the first entry shortened and the second as a new one, in that
   * order, and never the same minutes on both.
   *
   * The rest may go on work of the user's own -- an existing ad-hoc task,
   * or new one named `ownTitle` -- and then stays here, queued nowhere.
   *
   * @throws ArgumentException when the moment is outside the entry, the
   *   task is unknown, or a piece is shorter than its provider records.
   */
  public split(
    worklogId: string,
    split: WorklogSplitDTO,
    secondId: string = createId(IdPrefix.WORKLOG),
    ownTaskId: string = createId(IdPrefix.ADHOC_TASK)
  ): {
    first: WorklogRecord;
    second: WorklogRecord;
  } {
    if (!worklogId) throw new ArgumentNullException('worklogId');
    if (!split?.taskId && !split?.ownTitle?.trim()) throw new ArgumentNullException('taskId');
    if (!this._targets) throw new Error('Splitting an entry is unavailable.');
    const worklog = this._worklogs.getWorklogById(worklogId);
    if (!worklog) throw new ArgumentException(`No worklog ${worklogId}.`, 'worklogId');
    const pieces = splitPieces(worklog, split.atUtc);
    if (typeof pieces === 'string') throw new ArgumentException(pieces, 'atUtc');
    const { taskId: targetId, ownTitle, ownProject } = this.targetOf(split, ownTaskId);

    const comment = worklog.adHoc && worklog.taskTitle ? worklog.taskTitle : worklog.comment;
    const second: ManualWorklogDTO = {
      taskId: targetId,
      durationSeconds: pieces.secondSeconds,
      startedAtUtc: new Date(Date.parse(worklog.startedAtUtc) + pieces.firstSeconds * 1000).toISOString(),
      comment
    };
    const destination = this.destinationFor(targetId, ownTitle);
    // The note is kept as it is, even empty: it is the entry's own, not added time's.
    const refusal = checkManualWorklog({ ...second, comment: comment || WORKLOG_COMMENTS.ADDED }, this._now(), destination?.minimumSeconds ?? 1);
    if (refusal) throw new ArgumentException(refusal);

    this.transaction(() => {
      if (ownTitle) this._targets!.createOwnTask!(ownTitle, targetId, ownProject);
      this.correct(worklogId, { durationSeconds: pieces.firstSeconds, startedAtUtc: worklog.startedAtUtc, comment: worklog.comment });
      // The row the provider must have before the second piece: the
      // shortening, when the entry was sent and an UPDATE now carries it.
      const send = this._worklogs.getSendOf(worklogId);
      const shortening = send
        ? this._worklogs.getUnsentCorrectionsOf(worklogId, send.id).find(row => row.operation === 'UPDATE') ?? null
        : null;
      this.writeEntry(second, secondId, worklog.sessionId, destination, shortening?.id ?? null);
    });

    if (destination) this._requestDispatch();
    return { first: this._worklogs.getWorklogById(worklogId)!, second: this._worklogs.getWorklogById(secondId)! };
  }

  /**
   * The task a move, added time or a split's rest goes on, and the name of
   * the own work to make under `ownTaskId` first, if that is it. Work of the
   * user's own is a place for time too (the user's request, 2026-11-24);
   * new own work is made in the caller's transaction, under an id its undo
   * covers.
   */
  private targetOf(
    target: { taskId?: string; ownTitle?: string; ownProject?: string },
    ownTaskId: string
  ): { taskId: string; ownTitle: string | null; ownProject?: string } {
    const ownTitle = target.ownTitle?.trim();
    if (ownTitle) {
      if (!this._targets?.createOwnTask) throw new Error('New work of your own is unavailable here.');
      const ownProject = target.ownProject?.trim();
      return { taskId: ownTaskId, ownTitle, ...(ownProject ? { ownProject } : {}) };
    }
    if (!target.taskId || !this._targets?.getTask(target.taskId)) throw new ArgumentException(`No task ${target.taskId}.`, 'taskId');
    return { taskId: target.taskId, ownTitle: null };
  }

  /** Where time on `taskId` is sent; never anywhere for work of the user's own. */
  private destinationFor(taskId: string, ownTitle: string | null): SendDestination | null {
    // Own work names no provider: asking would answer the active one.
    return ownTitle || isAdHocTaskId(taskId) ? null : this._targets!.destinationOf(taskId);
  }

  /** A worklog here and, for a task with a provider, its first send. */
  private writeEntry(
    entry: ManualWorklogDTO,
    worklogId: string,
    sessionId: string,
    destination: SendDestination | null,
    waitsFor: string | null
  ): void {
    this._worklogs.saveWorklog({
      id: worklogId,
      sessionId,
      taskId: entry.taskId,
      durationSeconds: entry.durationSeconds,
      startedAtUtc: entry.startedAtUtc,
      comment: entry.comment,
      createdAtUtc: new Date(this._now()).toISOString()
    });
    if (destination) {
      this._worklogs.enqueueSyncItem({
        id: createId(IdPrefix.SYNC_ITEM),
        providerId: destination.providerId,
        taskId: entry.taskId,
        durationSeconds: entry.durationSeconds,
        startedAtUtc: entry.startedAtUtc,
        comment: entry.comment,
        worklogId,
        waitsFor
      });
    }
  }

  /** Unclaimed and never claimed: the entry cannot exist. `send_attempts`, never the retry budget. */
  /**
   * True when the send cannot have made an entry: never attempted, or
   * refused (P11c), whose refusal was the answer to the POST itself after a
   * search had found nothing.
   */
  private static madeNoEntry(send: SyncQueueRecord): boolean {
    return (send.sendAttempts === 0 || send.refusedAtUtc !== null) && (send.status === 'PENDING' || send.status === 'FAILED');
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
