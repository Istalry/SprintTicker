import { describe, it, expect } from 'vitest';
import { groupEntriesByTask } from '../src/shared/entry-groups';
import type { WorklogDTO } from '../src/shared/dtos';

const log = (id: string, taskId: string, hour: number, minutes: number, extra: Partial<WorklogDTO> = {}): WorklogDTO => ({
  id, sessionId: `s-${id}`, taskId, taskKey: taskId.toUpperCase(), taskTitle: `Title ${taskId}`, durationSeconds: minutes * 60,
  startedAtUtc: `2026-11-24T${String(hour).padStart(2, '0')}:00:00.000Z`, comment: '', createdAtUtc: '2026-11-24T18:00:00.000Z', ...extra
});

/** Today by task (LOCAL-WORK-AND-CALENDAR.md §4). */
describe('groupEntriesByTask', () => {
  it('GroupEntriesByTask_AProvidersTaskById_SumsIt_NewestLineFirst', () => {
    const groups = groupEntriesByTask([log('1', 'mg-1', 9, 30), log('2', 'pf-2', 10, 15), log('3', 'mg-1', 11, 45)]);

    expect(groups.map(g => [g.taskKey, g.seconds, g.entries.map(e => e.id)])).toEqual([
      ['MG-1', 75 * 60, ['3', '1']],
      ['PF-2', 15 * 60, ['2']]
    ]);
  });

  it('GroupEntriesByTask_OwnWorkOfOneName_IsOneLine_EvenAsTwoOldRows', () => {
    const own = { adHoc: true as const, projectId: 'ADHOC' };
    const groups = groupEntriesByTask([
      log('1', 'adhoc_a', 9, 10, { ...own, taskTitle: 'Code review' }),
      log('2', 'adhoc_b', 10, 20, { ...own, taskTitle: ' code  REVIEW' })
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].seconds).toBe(30 * 60);
  });

  it('GroupEntriesByTask_InterruptionsToName_StayApart', () => {
    const fragment = { adHoc: true as const, unsorted: true as const, projectId: 'ADHOC', taskTitle: 'Interruption' };

    expect(groupEntriesByTask([log('1', 'adhoc_a', 9, 10, fragment), log('2', 'adhoc_b', 10, 10, fragment)])).toHaveLength(2);
  });
});
