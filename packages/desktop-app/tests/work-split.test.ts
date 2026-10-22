import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  splitWork,
  mergeShortPieces,
  workedSecondsByLocalDay,
  checkSplitPauseMinutes,
  DEFAULT_SPLIT_PAUSE_MINUTES
} from '../src/shared/work-split';
import { workedSecondsUntil } from '../src/shared/session-review';

/**
 * A session's time as worklogs: one per stretch of work, never across local
 * midnight. Paris time, where the clocks go back on Sunday 25 October 2026
 * (a 25-hour day) and forward on Sunday 29 March 2026 (23 hours).
 */
describe('splitWork', () => {
  const originalTz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'Europe/Paris';
  });
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  const iso = (month: number, day: number, hours: number, minutes = 0) => new Date(2026, month - 1, day, hours, minutes).toISOString();
  const oct = (day: number, hours: number, minutes = 0) => iso(10, day, hours, minutes);
  const pause = (fromUtc: string, toUtc: string) => ({ fromUtc, toUtc });
  const H = 3600;
  const FIFTEEN_MINUTES = DEFAULT_SPLIT_PAUSE_MINUTES * 60;
  /** As the engine calls it: the total is what the session logs either way. */
  const split = (start: string, end: string, pauses: Array<{ fromUtc: string; toUtc: string }> = [], threshold = FIFTEEN_MINUTES) =>
    splitWork(start, end, pauses, threshold, workedSecondsUntil(start, end, pauses));

  it('SplitWork_WithinADay_OnePieceAtTheStart', () => {
    expect(split(oct(16, 9), oct(16, 17))).toEqual([{ startedAtUtc: oct(16, 9), durationSeconds: 8 * H }]);
  });

  it('SplitWork_From2300To0100_OneHourOnEachDay', () => {
    expect(split(oct(16, 23), oct(17, 1))).toEqual([
      { startedAtUtc: oct(16, 23), durationSeconds: H },
      { startedAtUtc: oct(17, 0), durationSeconds: H }
    ]);
  });

  it('SplitWork_PausedOverNight_TheMorningStartsAtTheResume', () => {
    // The morning's work used to be filed under the evening before.
    expect(split(oct(16, 17), oct(17, 10), [pause(oct(16, 18), oct(17, 9))])).toEqual([
      { startedAtUtc: oct(16, 17), durationSeconds: H },
      { startedAtUtc: oct(17, 9), durationSeconds: H }
    ]);
  });

  it('SplitWork_OverThreeDays_ADayInTheMiddleIsWhole', () => {
    expect(split(oct(16, 23), oct(18, 1)).map(p => p.durationSeconds)).toEqual([H, 24 * H, H]);
  });

  it('SplitWork_TheDayTheClocksGoBack_IsTwentyFiveHours', () => {
    expect(split(oct(24, 23), oct(26, 1)).map(p => p.durationSeconds)).toEqual([H, 25 * H, H]);
  });

  it('SplitWork_TheDayTheClocksGoForward_IsTwentyThreeHours', () => {
    expect(split(iso(3, 28, 23), iso(3, 30, 1)).map(p => p.durationSeconds)).toEqual([H, 23 * H, H]);
  });

  it('SplitWork_APauseOfTheThreshold_StartsANewPiece', () => {
    expect(split(oct(16, 9), oct(16, 11), [pause(oct(16, 10), oct(16, 10, 15))])).toEqual([
      { startedAtUtc: oct(16, 9), durationSeconds: H },
      { startedAtUtc: oct(16, 10, 15), durationSeconds: 45 * 60 }
    ]);
  });

  it('SplitWork_AShorterPause_IsAGapInOnePiece', () => {
    expect(split(oct(16, 9), oct(16, 11), [pause(oct(16, 10), oct(16, 10, 14))])).toEqual([
      { startedAtUtc: oct(16, 9), durationSeconds: 2 * H - 14 * 60 }
    ]);
  });

  it('SplitWork_ThresholdZero_PausesNeverSplit_MidnightStillDoes', () => {
    const pauses = [pause(oct(16, 20), oct(16, 22))];

    expect(split(oct(16, 18), oct(17, 1), pauses, 0).map(p => p.startedAtUtc)).toEqual([oct(16, 18), oct(17, 0)]);
  });

  it('SplitWork_ClockSetBackDuringAPause_PiecesAddUpToTheTotal', () => {
    // Paused at 23:30, resumed at 23:00 on a corrected clock: the session's
    // total counts the jump back, and so must its worklogs.
    const pauses = [pause(oct(16, 23, 30), oct(16, 23))];
    const total = workedSecondsUntil(oct(16, 23), oct(17, 1), pauses);

    const pieces = split(oct(16, 23), oct(17, 1), pauses);

    expect(total).toBe(2.5 * H);
    expect(pieces.reduce((sum, p) => sum + p.durationSeconds, 0)).toBe(total);
    expect(pieces.map(p => p.startedAtUtc)).toEqual([oct(16, 23), oct(17, 0)]);
  });

  it('SplitWork_TotalBelowThePieces_ComesOffTheLongest', () => {
    // A total the timer floored, or a session paused before pauses were dated.
    expect(splitWork(oct(16, 23), oct(17, 2), [], 0, 3 * H - 5).map(p => p.durationSeconds)).toEqual([H, 2 * H - 5]);
  });

  it('SplitWork_NothingLogged_OnePieceOfZeroAtTheStart', () => {
    expect(splitWork(oct(16, 23), oct(17, 1), [], 0, 0)).toEqual([{ startedAtUtc: oct(16, 23), durationSeconds: 0 }]);
  });

  it('SplitWork_PausedFromTheStart_OnePieceFromTheResume', () => {
    // Where a session from before pauses were dated keeps its pauses.
    expect(split(oct(16, 23), oct(17, 10), [pause(oct(16, 23), oct(17, 9))])).toEqual([
      { startedAtUtc: oct(17, 9), durationSeconds: H }
    ]);
  });

  it('SplitWork_UnreadableTimes_OnePiece', () => {
    expect(splitWork('not a time', oct(17, 1), [], 0, 60)).toEqual([{ startedAtUtc: 'not a time', durationSeconds: 60 }]);
  });
});

describe('mergeShortPieces', () => {
  const piece = (startedAtUtc: string, durationSeconds: number) => ({ startedAtUtc, durationSeconds });

  it('MergeShortPieces_ThirtySecondsPastMidnight_JoinTheEvening', () => {
    // Jira records minutes: 30 seconds alone would be refused, and lost.
    expect(mergeShortPieces([piece('a', 3600), piece('b', 30)], 60)).toEqual([piece('a', 3630)]);
  });

  it('MergeShortPieces_BetweenTwo_JoinsTheLonger', () => {
    expect(mergeShortPieces([piece('a', 600), piece('b', 20), piece('c', 900)], 60)).toEqual([piece('a', 600), piece('c', 920)]);
  });

  it('MergeShortPieces_ShortestFirst_UntilEveryPieceIsRecordable', () => {
    expect(mergeShortPieces([piece('a', 50), piece('b', 40)], 60)).toEqual([piece('a', 90)]);
  });

  it('MergeShortPieces_ALonePiece_IsLeftForTheCallerToRefuse', () => {
    expect(mergeShortPieces([piece('a', 30)], 60)).toEqual([piece('a', 30)]);
  });

  it('MergeShortPieces_AllLongEnough_Unchanged', () => {
    const pieces = [piece('a', 60), piece('b', 61)];

    expect(mergeShortPieces(pieces, 60)).toEqual(pieces);
  });
});

describe('workedSecondsByLocalDay', () => {
  const originalTz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'Europe/Paris';
  });
  afterEach(() => {
    process.env.TZ = originalTz;
  });
  const oct = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes).toISOString();

  it('WorkedSecondsByLocalDay_ALongPauseTheSameDay_IsStillOneDay', () => {
    const pauses = [{ fromUtc: oct(17, 0, 10), toUtc: oct(17, 0, 40) }];

    expect(workedSecondsByLocalDay(oct(16, 23), oct(17, 1), pauses, 3600 + 1800)).toEqual([
      { dateKey: '2026-10-16', seconds: 3600 },
      { dateKey: '2026-10-17', seconds: 1800 }
    ]);
  });

  it('WorkedSecondsByLocalDay_WithinADay_OneDay', () => {
    expect(workedSecondsByLocalDay(oct(16, 9), oct(16, 10), [], 3600)).toEqual([{ dateKey: '2026-10-16', seconds: 3600 }]);
  });
});

describe('checkSplitPauseMinutes', () => {
  it.each([0, 15, 480])('CheckSplitPauseMinutes_%s_IsKept', minutes => {
    expect(checkSplitPauseMinutes(minutes)).toBeNull();
  });

  it.each([-1, 481, 7.5, Number.NaN, '15', undefined])('CheckSplitPauseMinutes_%s_IsRefused', minutes => {
    expect(checkSplitPauseMinutes(minutes)).toMatch(/0 \(never\) to 480/);
  });
});
