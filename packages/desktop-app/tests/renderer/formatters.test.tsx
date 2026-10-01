import { describe, it, expect, afterEach } from 'vitest';
import { formatClockTime, setRegionalLocale } from '../../src/renderer/utils/formatters';

/**
 * Times follow Windows' regional format, not the app's locale. Only en-US's
 * UI translation ships, so the app's locale is en-US everywhere, and left to
 * itself a French Windows would read `2:05:33 PM`.
 */
describe('formatClockTime', () => {
  const fivePastTwo = new Date(2026, 0, 1, 14, 5, 33);

  afterEach(() => setRegionalLocale(undefined));

  it('FormatClockTime_EuropeanRegion_IsA24HourClock', () => {
    setRegionalLocale('fr-FR');

    expect(formatClockTime(fivePastTwo)).toBe('14:05:33');
  });

  it('FormatClockTime_EnglishOutsideTheUs_FollowsTheRegionNotTheLanguage', () => {
    // The user's own machine: English Windows, Belgian regional format.
    setRegionalLocale('en-BE');

    expect(formatClockTime(fivePastTwo)).toBe('14:05:33');
  });

  it('FormatClockTime_UsRegion_KeepsItsTwelveHourClock', () => {
    setRegionalLocale('en-US');

    expect(formatClockTime(fivePastTwo)).toMatch(/^2:05:33\sPM$/);
  });

  it.each(['not a locale!', '', null])('SetRegionalLocale_%j_FallsBackRatherThanThrowing', locale => {
    // toLocaleTimeString throws a RangeError on a malformed tag, which would
    // take down every list that shows a time.
    setRegionalLocale(locale);

    expect(() => formatClockTime(fivePastTwo)).not.toThrow();
    expect(formatClockTime(fivePastTwo)).toBe(fivePastTwo.toLocaleTimeString());
  });
});
