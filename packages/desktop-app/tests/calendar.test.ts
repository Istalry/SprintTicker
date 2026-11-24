import { describe, it, expect } from 'vitest';
import { calendarHours, movedEntry, overlapFixes, placeDay, resizedEntry, snapMinutes } from '../src/shared/calendar';
import { overlapOf } from '../src/shared/overlap';

/** Local time on 2026-11-24 as an ISO string. */
const at = (h: number, m = 0) => new Date(2026, 10, 24, h, m).toISOString();
const entry = (id: string, h: number, m: number, minutes: number, comment = '') =>
  ({ id, startedAtUtc: at(h, m), durationSeconds: minutes * 60, comment });

/** History's calendar (LOCAL-WORK-AND-CALENDAR.md §5): what each gesture writes. */
describe('calendar', () => {
  it('SnapMinutes_ToTheNearestQuarter', () => {
    expect([snapMinutes(7), snapMinutes(8), snapMinutes(-22), snapMinutes(52)]).toEqual([0, 15, -15, 45]);
  });

  it('CalendarHours_TheWorkingHours_WidenedToEveryEntry', () => {
    expect(calendarHours([], null)).toEqual({ start: 8, end: 19 });
    expect(calendarHours([], { start: 9, end: 18 })).toEqual({ start: 9, end: 18 });
    const early = { startMs: Date.parse(at(6, 30)), endMs: Date.parse(at(7, 0)) };
    const late = { startMs: Date.parse(at(19, 0)), endMs: Date.parse(at(20, 10)) };
    expect(calendarHours([early, late], { start: 9, end: 18 })).toEqual({ start: 6, end: 21 });
  });

  it('PlaceDay_OverlappingEntriesShareTheWidth_TheRestTakeItAll', () => {
    const a = entry('a', 9, 0, 60);
    const b = entry('b', 9, 30, 60);
    const c = entry('c', 10, 0, 30);
    const d = entry('d', 14, 0, 30);

    const placed = Object.fromEntries(placeDay([d, c, b, a]).map(p => [p.entry.id, [p.column, p.columns]]));

    expect(placed).toEqual({ a: [0, 2], b: [1, 2], c: [0, 2], d: [0, 1] });
  });

  it('MovedEntry_SnapsTheShift_KeepsLengthAndNote_AcrossDays', () => {
    const moved = movedEntry(entry('a', 9, 0, 50, 'Hammer'), 67, 1);

    expect(moved).toEqual({ startedAtUtc: new Date(2026, 10, 25, 10, 0).toISOString(), durationSeconds: 3000, comment: 'Hammer' });
  });

  it('ResizedEntry_TheTopMovesTheStart_TheBottomTheEnd_NeverUnderAQuarter', () => {
    const a = entry('a', 9, 0, 60);

    expect(resizedEntry(a, 'start', -30)).toMatchObject({ startedAtUtc: at(8, 30), durationSeconds: 90 * 60 });
    expect(resizedEntry(a, 'end', 20)).toMatchObject({ startedAtUtc: at(9, 0), durationSeconds: 75 * 60 });
    expect(resizedEntry(a, 'start', 120)).toMatchObject({ startedAtUtc: at(9, 45), durationSeconds: 15 * 60 });
    expect(resizedEntry(a, 'end', -120)).toMatchObject({ durationSeconds: 15 * 60 });
  });

  it('OverlapFixes_EndTheFirst_OrStartTheSecond_KeepingItsEnd', () => {
    const first = entry('a', 9, 0, 60, 'one');
    const second = entry('b', 9, 45, 45, 'two');

    expect(overlapFixes(overlapOf(first, second)!)).toEqual({
      endFirst: { startedAtUtc: at(9, 0), durationSeconds: 45 * 60, comment: 'one' },
      startSecond: { startedAtUtc: at(10, 0), durationSeconds: 30 * 60, comment: 'two' }
    });
  });

  it('OverlapFixes_ASecondInsideTheFirst_CannotStartAfterIt', () => {
    const fixes = overlapFixes(overlapOf(entry('a', 9, 0, 120), entry('b', 9, 30, 30))!);

    expect(fixes.endFirst?.durationSeconds).toBe(30 * 60);
    expect(fixes.startSecond).toBeNull();
  });
});
