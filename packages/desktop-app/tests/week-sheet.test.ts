import { describe, it, expect } from 'vitest';
import { buildWeekSheet, dayNotes, describeWeekExceptions, WEEK_NO_PROJECT } from '../src/shared/week-sheet';
import { worklogsToCsv } from '../src/shared/worklog-csv';
import type { WorklogDTO } from '../src/shared/dtos';

const DAYS = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];
const NAMES: Record<string, string> = { '2026-11-02': 'Monday', '2026-11-03': 'Tuesday', '2026-11-04': 'Wednesday', '2026-11-05': 'Thursday', '2026-11-06': 'Friday' };
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).toISOString();
const entry = (id: string, key: string, project: string | null, day: number, minutes: number, extra: Partial<WorklogDTO> = {}): WorklogDTO => ({
  id, sessionId: `s-${id}`, taskId: `t-${key}`, taskKey: key, taskTitle: `Title of ${key}`,
  durationSeconds: minutes * 60, startedAtUtc: at(day, 9), comment: '', createdAtUtc: at(day, 9),
  syncState: 'sent', providerSeconds: minutes * 60,
  ...(project ? { projectId: `p-${project}`, projectName: project } : {}),
  ...extra
});
const H = 3600;

/** The week as a timesheet (S15, P9c). */
describe('buildWeekSheet', () => {
  it('Build_GroupedByProject_TasksAndProjectsMostFirst_EachDayAndTheTotal', () => {
    const sheet = buildWeekSheet(DAYS, [
      entry('1', 'PF-31', 'Pixel Forge', 2, 130),
      entry('2', 'PF-2', 'Pixel Forge', 2, 40),
      entry('3', 'PF-31', 'Pixel Forge', 5, 180),
      entry('4', 'MG-14', 'Moonlight Garden', 3, 60),
      entry('5', 'X', null, 6, 10, { syncState: 'local', providerSeconds: undefined })
    ]);

    expect(sheet.projects.map(p => [p.name, p.total / 60])).toEqual([['Pixel Forge', 350], ['Moonlight Garden', 60], [WEEK_NO_PROJECT, 10]]);
    expect(sheet.projects[0].tasks.map(t => [t.key, t.perDay.map(s => s / 60)])).toEqual([
      ['PF-31', [130, 0, 0, 180, 0]],
      ['PF-2', [40, 0, 0, 0, 0]]
    ]);
    expect(sheet.days.map(d => d.seconds / 60)).toEqual([170, 60, 0, 180, 10]);
    expect(sheet.total).toBe(420 * 60);
  });

  it('Build_TheProviderRow_LeavesOutWhatItDoesNotHold_KeepsTheOldValueOfACorrection', () => {
    const sheet = buildWeekSheet(DAYS, [
      entry('1', 'A-1', 'P', 3, 60),
      // Held by an overlap, sending: not there.
      entry('2', 'A-2', 'P', 3, 20, { syncState: 'held-overlap', providerSeconds: undefined }),
      entry('3', 'A-3', 'P', 4, 30, { syncState: 'pending', providerSeconds: undefined }),
      // Corrected from 1h to 1h 25m, not answered: Jira still has the hour.
      entry('4', 'A-4', 'P', 6, 85, { syncState: 'correction-failed', providerSeconds: H })
    ], [{ startedAtUtc: at(4, 14), durationSeconds: 18 * 60 }]);

    expect(sheet.days.map(d => d.providerSeconds / 60)).toEqual([0, 60, 0, 0, 60]);
    expect(sheet.providerTotal).toBe(2 * H);
    expect(sheet.days.map(d => d.toPlaceSeconds / 60)).toEqual([0, 0, 18, 0, 0]);
    expect(sheet.days.map(dayNotes)).toEqual([[], ['20m held'], ['18m to place', '30m sending'], [], ['correction waiting']]);
  });

  it('Build_EntriesOutsideTheDaysShown_Ignored', () => {
    expect(buildWeekSheet(DAYS, [entry('1', 'A-1', 'P', 8, 60)]).total).toBe(0);
  });

  it('Exceptions_EachEntryNotThere_AndTheTimeToPlace_InDayOrder', () => {
    const entries = [
      entry('1', 'OPS-4', 'P', 3, 20, { syncState: 'held-overlap' }),
      entry('2', 'MG-14', 'P', 6, 85, { syncState: 'correction-failed' }),
      entry('3', 'ADHOC', null, 6, 5, { syncState: 'local' })
    ];
    const sheet = buildWeekSheet(DAYS, entries, [{ startedAtUtc: at(4, 14), durationSeconds: 18 * 60 }]);

    expect(describeWeekExceptions(sheet, entries, key => NAMES[key], 'Jira')).toBe(
      "All sent, except OPS-4's 20m on Tuesday, held by an overlap, 18m on Wednesday still to place and MG-14's correction on Friday, which Jira did not answer."
    );
  });

  it('Exceptions_NoneOrNothing', () => {
    const entries = [entry('1', 'A-1', 'P', 2, 60)];
    expect(describeWeekExceptions(buildWeekSheet(DAYS, entries), entries, k => k, 'Jira')).toBe('All sent.');
    expect(describeWeekExceptions(buildWeekSheet(DAYS, []), [], k => k, 'Jira')).toBe('');
  });
});

describe('worklogsToCsv', () => {
  it('Csv_ARowPerEntry_LocalTimes_DecimalHours', () => {
    const csv = worklogsToCsv([{ ...entry('1', 'PF-31', 'Pixel Forge', 2, 135), startedAtUtc: at(2, 9, 5), comment: 'Anvil sound pass' }]);

    expect(csv.split('\r\n')).toEqual([
      'Date,Start,End,Duration,Hours,Project,Task,Title,Note,Sent',
      '2026-11-02,09:05,11:20,2:15,2.25,Pixel Forge,PF-31,Title of PF-31,Anvil sound pass,yes',
      ''
    ]);
  });

  it('Csv_CommasQuotesAndFormulas_Escaped', () => {
    const csv = worklogsToCsv([{ ...entry('1', 'A-1', null, 2, 30, { syncState: 'pending' }), comment: 'Said "hi", then =SUM(A1)', taskTitle: '=cmd' }]);

    expect(csv.split('\r\n')[1]).toBe(`2026-11-02,09:00,09:30,0:30,0.50,,A-1,'=cmd,"Said ""hi"", then =SUM(A1)",no`);
  });
});
