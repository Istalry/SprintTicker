import { describe, it, expect, afterEach } from 'vitest';
import { localDateKey } from '../src/shared/local-date';

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
