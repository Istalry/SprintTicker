import { describe, it, expect } from 'vitest';
import { isInClosedWeek } from '../src/shared/closed-week';

/** Local times, as the user's weeks are: Monday 2 to Sunday 8 November 2026 was closed. */
const at = (day: number, hours = 12) => new Date(2026, 10, day, hours, 0).toISOString();
const CLOSED = '2026-11-02';

describe('isInClosedWeek', () => {
  it.each([
    ['its Monday morning', at(2, 0)],
    ['its Sunday night', at(8, 23)],
    ['a week before it', new Date(2026, 9, 27, 9, 0).toISOString()]
  ])('IsInClosedWeek_%s_True', (_label, startedAtUtc) => {
    expect(isInClosedWeek(startedAtUtc, CLOSED)).toBe(true);
  });

  it('IsInClosedWeek_TheWeekAfter_False', () => {
    expect(isInClosedWeek(at(9, 0), CLOSED)).toBe(false);
  });

  it('IsInClosedWeek_NoWeekClosedYet_False', () => {
    expect(isInClosedWeek(at(2), null)).toBe(false);
  });

  it('IsInClosedWeek_NotADate_False', () => {
    expect(isInClosedWeek('Monday', CLOSED)).toBe(false);
  });
});
