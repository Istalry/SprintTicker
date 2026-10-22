import { describe, it, expect } from 'vitest';
import {
  DEFAULT_WORKING_DAYS,
  checkWorkingDays,
  isWorkingDay,
  lastWorkingDayOfWeek,
  weekStartKey,
  weekdayOf
} from '../src/shared/working-days';

const NONE = new Set<string>();

/** October 2026: Monday 12 to Sunday 18. */
describe('working days', () => {
  it('WeekdayOf_AKnownDay_IsItsWeekday', () => {
    expect(weekdayOf('2026-10-12')).toBe(1);
    expect(weekdayOf('2026-10-18')).toBe(0);
  });

  it.each([
    ['2026-10-12', '2026-10-12'],
    ['2026-10-16', '2026-10-12'],
    ['2026-10-18', '2026-10-12'],
    // Across a month and a year.
    ['2026-11-01', '2026-10-26'],
    ['2027-01-01', '2026-12-28']
  ])('WeekStartKey_%s_IsTheMonday%s', (day, monday) => {
    expect(weekStartKey(day)).toBe(monday);
  });

  it('WeekStartKey_TheWeekTheClocksGoBack_StillItsMonday', () => {
    // 25 October 2026 is the end of summer time in Europe: a 25-hour Sunday.
    expect(weekStartKey('2026-10-25')).toBe('2026-10-19');
    expect(weekStartKey('2026-10-26')).toBe('2026-10-26');
  });

  it('IsWorkingDay_DefaultWeek_MondayToFriday', () => {
    expect(isWorkingDay('2026-10-16', DEFAULT_WORKING_DAYS, NONE)).toBe(true);
    expect(isWorkingDay('2026-10-17', DEFAULT_WORKING_DAYS, NONE)).toBe(false);
  });

  it('IsWorkingDay_AHoliday_IsNot', () => {
    expect(isWorkingDay('2026-10-14', DEFAULT_WORKING_DAYS, new Set(['2026-10-14']))).toBe(false);
  });

  it('LastWorkingDayOfWeek_DefaultWeek_IsFriday', () => {
    expect(lastWorkingDayOfWeek('2026-10-13', DEFAULT_WORKING_DAYS, NONE)).toBe('2026-10-16');
  });

  it('LastWorkingDayOfWeek_FridayOff_IsThursday', () => {
    expect(lastWorkingDayOfWeek('2026-10-13', DEFAULT_WORKING_DAYS, new Set(['2026-10-16']))).toBe('2026-10-15');
  });

  it('LastWorkingDayOfWeek_FourDayWeek_IsThursday', () => {
    expect(lastWorkingDayOfWeek('2026-10-13', [1, 2, 3, 4], NONE)).toBe('2026-10-15');
  });

  it('LastWorkingDayOfWeek_SaturdayWorked_IsSaturday', () => {
    expect(lastWorkingDayOfWeek('2026-10-13', [2, 3, 4, 5, 6], NONE)).toBe('2026-10-17');
  });

  it('LastWorkingDayOfWeek_EveryDayOff_IsNull', () => {
    const off = new Set(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);

    expect(lastWorkingDayOfWeek('2026-10-13', DEFAULT_WORKING_DAYS, off)).toBeNull();
  });

  it.each([
    [[1, 2, 3, 4, 5], null],
    [[0, 6], null],
    [[], /at least one/],
    ['Mon', /at least one/],
    [[1, 7], /days of the week/],
    [[1.5], /days of the week/],
    [[1, 1], /twice/]
  ])('CheckWorkingDays_%j_%s', (days, expected) => {
    const refusal = checkWorkingDays(days);
    if (expected === null) expect(refusal).toBeNull();
    else expect(refusal).toMatch(expected);
  });
});
