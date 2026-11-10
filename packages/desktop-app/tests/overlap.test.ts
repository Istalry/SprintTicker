import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { findOverlaps, heldByOverlap, overlapOf, TimedEntry } from '../src/shared/overlap';

const entry = (id: string, start: string, minutes: number, sessionId = `s-${id}`): TimedEntry => ({
  id,
  sessionId,
  startedAtUtc: `2026-11-10T${start}:00.000Z`,
  durationSeconds: minutes * 60
});

/** S15b: the later entry of an overlap waits until it is fixed. */
describe('overlap rule', () => {
  it('Overlapping_TheLaterIsHeld_ByTheSharedTime', () => {
    const a = entry('a', '09:00', 60);
    const b = entry('b', '09:45', 30);

    expect(overlapOf(a, b)).toMatchObject({ earlier: a, later: b, seconds: 15 * 60 });
    expect(heldByOverlap(b, [a, b])).toBe(a);
    expect(heldByOverlap(a, [a, b])).toBeNull();
  });

  it('Touching_IsNotOverlapping', () => {
    expect(overlapOf(entry('a', '09:00', 60), entry('b', '10:00', 30))).toBeNull();
  });

  it('PiecesOfOneSession_NeverOverlap', () => {
    // The longest piece carries the rounding and may run a second over.
    expect(overlapOf(entry('a', '09:00', 61, 's1'), entry('b', '10:00', 30, 's1'))).toBeNull();
  });

  it('SameStart_TheLowerIdIsEarlier', () => {
    expect(overlapOf(entry('b', '09:00', 10), entry('a', '09:00', 10))?.later.id).toBe('b');
  });

  it('Contained_IsHeldForItsWholeLength', () => {
    expect(overlapOf(entry('a', '09:00', 120), entry('b', '09:30', 15))?.seconds).toBe(15 * 60);
  });

  it('FindOverlaps_EachPairOnce', () => {
    const day = [entry('a', '09:00', 60), entry('b', '09:30', 60), entry('c', '12:00', 10)];
    expect(findOverlaps(day).map(o => [o.earlier.id, o.later.id])).toEqual([['a', 'b']]);
  });
});

describe('the queue holds an overlapping entry', () => {
  let dbConn: DatabaseConnection;
  let worklogs: WorklogRepository;

  const LATER = '2026-12-01T00:00:00.000Z';
  const log = (id: string, start: string, minutes: number, sessionId = `s-${id}`) => {
    worklogs.saveWorklog({
      id, sessionId, taskId: 'T', durationSeconds: minutes * 60,
      startedAtUtc: `2026-11-10T${start}:00.000Z`, comment: 'c', createdAtUtc: '2026-11-10T18:00:00.000Z'
    });
    worklogs.enqueueSyncItem({
      id: `q-${id}`, providerId: 'jira', taskId: 'T', durationSeconds: minutes * 60,
      startedAtUtc: `2026-11-10T${start}:00.000Z`, comment: 'c', worklogId: id
    });
  };
  const due = () => worklogs.getPendingQueueItems(LATER).map(r => r.worklogId);

  beforeEach(() => {
    dbConn = new DatabaseConnection(':memory:');
    worklogs = new WorklogRepository(dbConn);
    new TaskRepository(dbConn).saveTask({ id: 'T', projectId: 'P', key: 'PF-31', title: 'Thing', status: 'todo' });
  });

  afterEach(() => dbConn.close());

  it('Overlap_TheLaterIsNotDue_AndReadsHeld', () => {
    log('a', '09:00', 60);
    log('b', '09:45', 30);

    expect(due()).toEqual(['a']);
    expect(worklogs.getWorklogById('b')).toMatchObject({ syncState: 'held-overlap', overlapsTaskKey: 'PF-31' });
    expect(worklogs.getWorklogById('a')?.syncState).toBe('pending');
  });

  it('Fixed_TheLaterIsDueAgain', () => {
    log('a', '09:00', 60);
    log('b', '09:45', 30);

    worklogs.rewriteWorklog('a', { durationSeconds: 45 * 60, startedAtUtc: '2026-11-10T09:00:00.000Z', comment: 'c' });

    expect(due()).toEqual(['a', 'b']);
    expect(worklogs.getWorklogById('b')?.syncState).toBe('pending');
  });

  it('PiecesSplitAtMidnight_AreBothDue', () => {
    log('a', '23:00', 60, 's1');
    worklogs.saveWorklog({
      id: 'b', sessionId: 's1', taskId: 'T', durationSeconds: 3600,
      startedAtUtc: '2026-11-11T00:00:00.000Z', comment: 'c', createdAtUtc: '2026-11-11T01:00:00.000Z'
    });
    worklogs.enqueueSyncItem({ id: 'q-b', providerId: 'jira', taskId: 'T', durationSeconds: 3600, startedAtUtc: '2026-11-11T00:00:00.000Z', comment: 'c', worklogId: 'b' });

    expect(due()).toEqual(['a', 'b']);
  });

  it('EarlierAlreadySent_TheLaterIsStillHeld', () => {
    log('a', '09:00', 60);
    worklogs.claimSyncItem('q-a', LATER);
    worklogs.markSyncItemSynced('q-a', 'r1');
    log('b', '09:30', 60);

    expect(due()).toEqual([]);
    expect(worklogs.getWorklogById('a')?.syncState).toBe('sent');
  });
});
