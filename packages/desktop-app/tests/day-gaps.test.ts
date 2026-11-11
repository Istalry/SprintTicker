import { describe, it, expect } from 'vitest';
import { dayGaps, gapSeconds, Span, spanOf, workingWindow, WorkingWindow } from '../src/shared/day-gaps';
import { normalizeScheduleSettings } from '../src/shared/schedule-defaults';

// Monday 9 November 2026, local time.
const at = (h: number, m = 0) => new Date(2026, 10, 9, h, m).getTime();
const span = (h1: number, m1: number, h2: number, m2: number): Span => ({ startMs: at(h1, m1), endMs: at(h2, m2) });
const SCHEDULE = normalizeScheduleSettings({ standupTime: '09:00', lunchStartTime: '12:30', lunchEndTime: '13:30', eodWrapUpTime: '17:30' });
const MONDAY = new Date(2026, 10, 9);
const window = (): WorkingWindow => workingWindow(MONDAY, SCHEDULE)!;
const asClock = (gaps: Span[]) => gaps.map(g => {
  const f = (ms: number) => new Date(ms).toTimeString().slice(0, 5);
  return `${f(g.startMs)}-${f(g.endMs)}`;
});

/** A day's untracked time (S14b): working hours less lunch less the entries. */
describe('day gaps', () => {
  it('WorkingWindow_StandUpToWrapUp_WithItsLunch', () => {
    expect(window()).toEqual({ startMs: at(9), endMs: at(17, 30), lunch: span(12, 30, 13, 30) });
  });

  it('WorkingWindow_ADayNotWorked_None', () => {
    expect(workingWindow(new Date(2026, 10, 8), SCHEDULE)).toBeNull();
  });

  it('WorkingWindow_LunchOutsideTheHours_NoLunch', () => {
    expect(workingWindow(MONDAY, { ...SCHEDULE, lunchStartTime: '18:00', lunchEndTime: '19:00' })!.lunch).toBeNull();
  });

  it('Gaps_TheMockupsDay_TheTwoStretchesBeforeTheStandUpAndBeforeLunch', () => {
    const covered = [span(9, 30, 12, 20), span(13, 30, 17, 30)];

    const gaps = dayGaps(window(), covered);

    expect(asClock(gaps)).toEqual(['09:00-09:30', '12:20-12:30']);
    expect(gapSeconds(gaps)).toBe(40 * 60);
  });

  it('Gaps_EntriesOverlappingOrOutsideTheHours_CountedOnce', () => {
    const covered = [span(8, 0, 10, 0), span(9, 30, 11, 0), span(10, 45, 12, 30), span(13, 30, 18, 0)];

    expect(dayGaps(window(), covered)).toEqual([]);
  });

  it('Gaps_ShorterThanFiveMinutes_NotShown', () => {
    const covered = [span(9, 0, 11, 0), span(11, 3, 12, 30), span(13, 30, 17, 30)];

    expect(dayGaps(window(), covered)).toEqual([]);
  });

  it('Gaps_WorkedThroughLunch_LunchStillNotUntracked', () => {
    expect(asClock(dayGaps(window(), [span(9, 0, 13, 0)]))).toEqual(['13:30-17:30']);
  });

  it('Gaps_Today_TheRestOfTheDayIsNotMissingYet', () => {
    expect(asClock(dayGaps(window(), [span(9, 0, 10, 0)], at(11, 0)))).toEqual(['10:00-11:00']);
  });

  it('Gaps_BeforeTheDayStarts_None', () => {
    expect(dayGaps(window(), [], at(8, 0))).toEqual([]);
  });

  it('Gaps_NothingLogged_TheHoursLessLunch', () => {
    expect(asClock(dayGaps(window(), []))).toEqual(['09:00-12:30', '13:30-17:30']);
  });

  it('SpanOf_AnEntry_ItsStartAndEnd', () => {
    expect(spanOf({ startedAtUtc: new Date(at(9)).toISOString(), durationSeconds: 1800 })).toEqual(span(9, 0, 9, 30));
  });
});
