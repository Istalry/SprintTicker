import { describe, it, expect } from 'vitest';
import { CountedEntry, describeSends, summarizeDay } from '../src/shared/day-summary';
import { WorklogSyncState } from '../src/shared/worklog-correction';

const entry = (taskKey: string, minutes: number, syncState: WorklogSyncState = 'sent'): CountedEntry => ({
  taskId: `t-${taskKey}`, taskKey, taskTitle: `Title of ${taskKey}`, durationSeconds: minutes * 60, syncState
});

/** A day counted once, for History's day, its week and Check my week (P9). */
describe('summarizeDay', () => {
  it('Summarize_EntriesOfSeveralTasks_TotalsAndEachTaskOnceMostFirst', () => {
    const day = summarizeDay([entry('MG-14', 60), entry('PF-31', 90), entry('MG-14', 25), entry('OPS-4', 25)]);

    expect(day.totalSeconds).toBe(200 * 60);
    expect(day.entries).toBe(4);
    expect(day.tasks.map(t => [t.key, t.seconds / 60])).toEqual([['PF-31', 90], ['MG-14', 85], ['OPS-4', 25]]);
  });

  it('Summarize_NoKey_NamedByItsId', () => {
    expect(summarizeDay([{ taskId: 'adhoc_1', durationSeconds: 60 }]).tasks[0]).toMatchObject({ key: 'adhoc_1', title: 'adhoc_1' });
  });

  it('Summarize_Nothing_Zero', () => {
    expect(summarizeDay([])).toEqual({ totalSeconds: 0, entries: 0, tasks: [] });
  });
});

describe('describeSends', () => {
  it.each<[string, CountedEntry[], string]>([
    ['every one sent', [entry('A', 1), entry('B', 1)], 'all sent'],
    ['one correction on its way', [entry('A', 1), entry('B', 1, 'correction-pending')], 'all sent but 1 correction'],
    ['several kinds', [entry('A', 1), entry('B', 1, 'pending'), entry('C', 1, 'correction-failed'), entry('D', 1, 'correction-pending'), entry('E', 1, 'held-overlap'), entry('F', 1, 'failed')],
      'all sent but 1 waiting, 2 corrections, 1 failed, 1 held for an overlap'],
    ['nothing sent yet', [entry('A', 1, 'pending')], '1 waiting'],
    ['kept here only', [entry('A', 1, 'local')], 'kept in SprintTicker'],
    ['local beside sent', [entry('A', 1, 'local'), entry('B', 1)], 'all sent'],
    ['no entries', [], '']
  ])('Describe_%s', (_name, entries, words) => {
    expect(describeSends(entries)).toBe(words);
  });
});
