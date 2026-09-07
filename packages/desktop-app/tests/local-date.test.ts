import { describe, it, expect, afterEach } from 'vitest';
import { localDateKey, localDayBoundsUtc, addLocalDays } from '../src/shared/local-date';

/**
 * These cases pick instants where the local day and the UTC day disagree, in
 * both directions, because a single timezone only exposes one side of the fault.
 */
describe('localDateKey', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('LocalDateKey_WestOfUtcInTheEvening_ReturnsTheLocalDayNotTheUtcDay', () => {
    process.env.TZ = 'America/New_York';
    // 2026-09-08T00:30Z is 20:30 on the 7th in New York.
    const key = localDateKey(new Date('2026-09-08T00:30:00Z'));

    expect(key).toBe('2026-09-07');
  });

  it('LocalDateKey_EastOfUtcAfterMidnight_ReturnsTheLocalDayNotTheUtcDay', () => {
    process.env.TZ = 'Europe/Paris';
    // 2026-09-07T23:30Z is 01:30 on the 8th in Paris.
    const key = localDateKey(new Date('2026-09-07T23:30:00Z'));

    expect(key).toBe('2026-09-08');
  });

  it('LocalDateKey_SingleDigitMonthAndDay_IsZeroPadded', () => {
    process.env.TZ = 'UTC';

    expect(localDateKey(new Date('2026-01-05T12:00:00Z'))).toBe('2026-01-05');
  });
});

describe('localDayBoundsUtc', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('LocalDayBoundsUtc_EastOfUtc_StartsBeforeUtcMidnight', () => {
    process.env.TZ = 'Europe/Paris';

    expect(localDayBoundsUtc('2026-09-08')).toEqual({
      startUtc: '2026-09-07T22:00:00.000Z',
      endUtc: '2026-09-08T22:00:00.000Z'
    });
  });

  it('LocalDayBoundsUtc_WestOfUtc_StartsAfterUtcMidnight', () => {
    process.env.TZ = 'America/New_York';

    expect(localDayBoundsUtc('2026-09-08')).toEqual({
      startUtc: '2026-09-08T04:00:00.000Z',
      endUtc: '2026-09-09T04:00:00.000Z'
    });
  });

  it('LocalDayBoundsUtc_DaylightSavingStartsThatDay_SpansTwentyThreeHours', () => {
    process.env.TZ = 'Europe/Paris';
    // Clocks go forward on 2026-03-29, so this local day is an hour short.
    // Adding 24 hours to the start would run into the following day.
    const { startUtc, endUtc } = localDayBoundsUtc('2026-03-29');
    const hours = (Date.parse(endUtc) - Date.parse(startUtc)) / 3_600_000;

    expect(hours).toBe(23);
  });

  it('LocalDayBoundsUtc_MalformedKey_Throws', () => {
    expect(() => localDayBoundsUtc('08/09/2026')).toThrow(/YYYY-MM-DD/);
    expect(() => localDayBoundsUtc('')).toThrow(/YYYY-MM-DD/);
  });
});

describe('addLocalDays', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it('AddLocalDays_WestOfUtc_ActuallyAdvancesTheDay', () => {
    process.env.TZ = 'America/New_York';
    // The previous implementation parsed the key as UTC midnight -- already the
    // previous day in New York -- then stepped it with local getters, so this
    // returned the day it started from.
    expect(addLocalDays('2026-09-08', 1)).toBe('2026-09-09');
    expect(addLocalDays('2026-09-08', -1)).toBe('2026-09-07');
  });

  it('AddLocalDays_AcrossMonthAndYearBoundaries_Rolls', () => {
    process.env.TZ = 'Europe/Paris';

    expect(addLocalDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('AddLocalDays_AcrossADaylightSavingChange_StillMovesOneDay', () => {
    process.env.TZ = 'Europe/Paris';

    expect(addLocalDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addLocalDays('2026-03-29', 1)).toBe('2026-03-30');
  });
});
