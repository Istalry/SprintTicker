import { describe, it, expect } from 'vitest';
import { checkWeek, describeWeekCheck, WeekCheckInput } from '../src/shared/week-issues';
import type { ScheduleSettingsDTO, WeekChangeDTO, WorklogDTO } from '../src/shared/dtos';

// Monday 2 November 2026 to Sunday 8.
const DAYS = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
const NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayName = (key: string) => NAMES[DAYS.indexOf(key)] ?? key;
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m);
const iso = (day: number, h: number, m = 0) => at(day, h, m).toISOString();
const entry = (id: string, key: string, day: number, h: number, m: number, minutes: number, extra: Partial<WorklogDTO> = {}): WorklogDTO => ({
  id, sessionId: `s-${id}`, taskId: `t-${key}`, taskKey: key, taskTitle: key,
  durationSeconds: minutes * 60, startedAtUtc: iso(day, h, m), comment: '', createdAtUtc: iso(day, h, m),
  syncState: 'sent', providerSeconds: minutes * 60, ...extra
});
// 09:00 to 17:00, lunch 12:00 to 13:00: seven hours a day.
const SCHEDULE: ScheduleSettingsDTO = {
  standupTime: '09:00', eodWrapUpTime: '17:00', lunchStartTime: '12:00', lunchEndTime: '13:00', workingDays: [1, 2, 3, 4, 5]
} as ScheduleSettingsDTO;
/** A full day on one task: no gap. */
const fullDay = (day: number, key = 'PF-31') => [entry(`${day}a`, key, day, 9, 0, 180), entry(`${day}b`, key, day, 13, 0, 240)];
const FULL_WEEK = [2, 3, 4, 5, 6].flatMap(day => fullDay(day));

const input = (over: Partial<WeekCheckInput> = {}): WeekCheckInput => ({
  dayKeys: DAYS, entries: FULL_WEEK, toPlace: [], schedule: SCHEDULE, running: null, changes: null,
  nowMs: at(9, 9).getTime(), providerName: 'Jira', dayName, clock, ...over
});

/** Check my week (S15b, P9d). */
describe('checkWeek', () => {
  it('Check_AWeekWithNothingWrong_ListsNothing', () => {
    const check = checkWeek(input());

    expect(check.issues).toEqual([]);
    expect(describeWeekCheck(35 * 3600, check)).toBe('35h 00m logged. Nothing to look at.');
  });

  it('Check_AFragmentToPlace_PlacedThere_OthersWeeksLeftOut', () => {
    const check = checkWeek(input({
      entries: FULL_WEEK.filter(e => !(e.id === '4b')).concat(entry('4c', 'PF-31', 4, 13, 0, 200), entry('4d', 'PF-31', 4, 16, 38, 22)),
      toPlace: [
        { id: 'f1', title: 'Interruption at 16:20', startedAtUtc: iso(4, 16, 20), endedAtUtc: iso(4, 16, 38), durationSeconds: 18 * 60, interruptedTaskKey: 'SR-8' },
        { id: 'f2', title: 'Last week', startedAtUtc: iso(29, 10), endedAtUtc: iso(29, 11), durationSeconds: 3600, interruptedTaskKey: null }
      ]
    }));

    expect(check.issues).toEqual([{
      kind: 'to-place', title: '18m to place', details: ['Wednesday · Interruption at 16:20, during SR-8'], fix: { kind: 'place' }
    }]);
  });

  it('Check_CorrectionsNotSent_SaysTheChange_SendNowOnlyWhenRefused', () => {
    const corrected = FULL_WEEK.map(e => e.id === '6a'
      ? { ...e, durationSeconds: e.durationSeconds + 25 * 60, syncState: 'correction-failed' as const }
      : e);

    expect(checkWeek(input({ entries: corrected })).issues).toEqual([{
      kind: 'correction', title: '1 correction not sent', details: ['PF-31 · Friday · +25m · Jira did not answer'], fix: { kind: 'send-now' }
    }]);
    const waiting = corrected.map(e => e.id === '6a' ? { ...e, syncState: 'correction-pending' as const } : e);
    expect(checkWeek(input({ entries: waiting })).issues[0]).toMatchObject({ details: ['PF-31 · Friday · +25m · on its way'], fix: { kind: 'none' } });
  });

  it('Check_AnEntryRefused_SendNow', () => {
    const entries = FULL_WEEK.map(e => e.id === '3a' ? { ...e, syncState: 'failed' as const, providerSeconds: undefined } : e);

    expect(checkWeek(input({ entries })).issues).toEqual([{
      kind: 'not-sent', title: '1 entry not sent', details: ['PF-31 · Tuesday · 3h 00m · Jira did not take it'], fix: { kind: 'send-now' }
    }]);
  });

  it('Check_AnEntryTheProviderRefusedForGood_SaysWhy_AndOpensItsDay', () => {
    // Sending again would not help (P11c): the day's ⋯ moves it or keeps it off.
    const entries = FULL_WEEK.map(e => e.id === '3a'
      ? { ...e, syncState: 'refused' as const, providerSeconds: undefined, refusal: 'Logging time failed: HTTP 400 - Time tracking is off on this issue.' }
      : e);

    expect(checkWeek(input({ entries })).issues).toEqual([{
      kind: 'refused',
      title: 'Jira refused 1 entry',
      details: ['PF-31 · Tuesday · 3h 00m · Time tracking is off on this issue'],
      fix: { kind: 'open-day', dateKey: '2026-11-03', label: 'Open Tuesday' }
    }]);
  });

  it('Check_UntrackedTimeInWorkingHours_EachDay_OpensIt', () => {
    const entries = FULL_WEEK.filter(e => e.id !== '4b').concat(entry('4c', 'PF-31', 4, 13, 0, 180), entry('4d', 'PF-31', 4, 16, 20, 40));

    expect(checkWeek(input({ entries })).issues).toEqual([{
      kind: 'gaps', title: 'Wednesday has 20m not timed', details: ['1 gap · 16:00–16:20'], fix: { kind: 'open-day', dateKey: '2026-11-04', label: 'Open Wednesday' }
    }]);
  });

  it('Check_ADayWithNothing_SaysSo_ADayNotBegunOrNotWorked_Skipped', () => {
    const entries = FULL_WEEK.filter(e => !e.id.startsWith('2'));
    // Thursday 10:00: Thursday has an hour so far, Friday has not begun.
    const check = checkWeek(input({ entries: entries.filter(e => !e.id.startsWith('5') && !e.id.startsWith('6')), nowMs: at(5, 10).getTime() }));

    expect(check.issues.map(i => i.title)).toEqual(['Nothing logged on Monday', 'Nothing logged on Thursday']);
    expect(check.issues[0].details).toEqual(['7h 00m of working hours']);
    expect(check.issues[1].details).toEqual(['1h 00m of working hours']);
  });

  it('Check_TheRunningSessionAndFragments_AreNotGaps', () => {
    const entries = FULL_WEEK.filter(e => e.id !== '5b');
    const check = checkWeek(input({
      entries,
      nowMs: at(5, 17).getTime(),
      running: { startMs: at(5, 13).getTime(), endMs: at(5, 16, 30).getTime() },
      toPlace: [{ id: 'f', title: 'Call', startedAtUtc: iso(5, 16, 30), endedAtUtc: iso(5, 17), durationSeconds: 1800, interruptedTaskKey: null }]
    }));

    expect(check.issues.map(i => i.kind)).toEqual(['to-place']);
  });

  it('Check_NoSchedule_NoGaps', () => {
    expect(checkWeek(input({ entries: [], schedule: null })).issues).toEqual([]);
  });

  it('Check_AnOverlap_TheLaterWaits_FixOpensTheDay', () => {
    const entries = [...FULL_WEEK, entry('x', 'OPS-4', 3, 14, 0, 20, { syncState: 'held-overlap', providerSeconds: undefined })];

    expect(checkWeek(input({ entries })).issues).toEqual([{
      kind: 'overlap',
      title: "2 entries overlap · OPS-4's 20m waits",
      details: ['Tuesday 14:00–14:20, with PF-31. The later entry is not sent until the overlap is fixed, so Jira never gets the same minutes twice.'],
      fix: { kind: 'open-day', dateKey: '2026-11-03', label: 'Fix…' }
    }]);
  });

  it('Check_AnOverlapBothSent_SaysCountedTwice', () => {
    const entries = [...FULL_WEEK, entry('x', 'OPS-4', 3, 14, 0, 20)];

    expect(checkWeek(input({ entries })).issues[0].details[0]).toBe('Tuesday 14:00–14:20, with PF-31. Both are at Jira: those minutes are counted twice.');
  });

  it('Check_AClosedWeek_ListsItsChanges_OrNone', () => {
    const changes: WeekChangeDTO[] = [
      { id: 'q2', operation: 'DELETE', taskKey: 'OPS-4', startedAtUtc: iso(3, 14), durationSeconds: 1200, queuedAtUtc: iso(10, 9), state: 'waiting' },
      { id: 'q1', operation: 'UPDATE', taskKey: 'MG-14', startedAtUtc: iso(6, 9), durationSeconds: 5100, queuedAtUtc: iso(9, 9), state: 'sent' }
    ];

    const check = checkWeek(input({ changes }));
    expect(check.closed).toBe(true);
    expect(check.issues).toEqual([{
      kind: 'closed-change',
      title: '2 changes to a closed week',
      details: ['MG-14 · Friday · 1h 25m corrected · Jira has it', 'OPS-4 · Tuesday · 20m deleted · on its way'],
      fix: { kind: 'none' }
    }]);
    expect(checkWeek(input({ changes: [] }))).toEqual({ issues: [], closed: true });
    expect(checkWeek(input()).closed).toBe(false);
  });

  it('Describe_CountsTheThings', () => {
    const check = checkWeek(input({ entries: FULL_WEEK.map(e => e.id === '3a' ? { ...e, syncState: 'failed' as const } : e), changes: [] }));

    expect(describeWeekCheck(37 * 3600 + 20 * 60, check)).toBe('37h 20m logged. 1 thing to look at.');
  });
});
