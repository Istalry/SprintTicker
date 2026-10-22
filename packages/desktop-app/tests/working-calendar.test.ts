import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkingCalendar } from '../src/main/services/working-calendar';
import { ProviderRequestError } from '../src/main/providers/provider-errors';

/**
 * The working days: the weekdays the schedule lists, less the holidays the
 * provider knows of, read once a day and kept.
 */
describe('WorkingCalendar', () => {
  let store: Map<string, unknown>;
  let today: Date;
  const settings = {
    getSetting: <T>(key: string, fallback: T): T => (store.has(key) ? (store.get(key) as T) : fallback),
    setSetting: <T>(key: string, value: T): void => {
      store.set(key, value);
    }
  };
  const calendar = (reader: ConstructorParameters<typeof WorkingCalendar>[1]) => new WorkingCalendar(settings, reader, () => today);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    store = new Map();
    // Wednesday 14 October 2026.
    today = new Date(2026, 9, 14, 9, 0);
  });

  it('Constructor_NoSettings_Throws', () => {
    expect(() => new WorkingCalendar(null as never)).toThrow(/settings/);
  });

  it('IsWorkingDay_NoReader_TheWeekdaysDecide', () => {
    const plain = new WorkingCalendar(settings);

    expect(plain.isWorkingDay('2026-10-16')).toBe(true);
    expect(plain.isWorkingDay('2026-10-17')).toBe(false);
  });

  it('IsWorkingDay_TheUsersOwnWeek_IsTheirs', () => {
    store.set('schedule_settings', { workingDays: [2, 3, 4, 5, 6] });

    expect(calendar(null).isWorkingDay('2026-10-12')).toBe(false);
    expect(calendar(null).isWorkingDay('2026-10-17')).toBe(true);
  });

  it('Refresh_ReadsTheHolidaysAround_AndTheyAreNotWorked', async () => {
    const reader = vi.fn(async () => ['2026-10-16']);
    const cal = calendar(reader);

    await cal.refresh();

    // From the Monday a week back to the Sunday three weeks on.
    expect(reader).toHaveBeenCalledWith('2026-10-05', '2026-11-08');
    expect(cal.isWorkingDay('2026-10-16')).toBe(false);
    expect(cal.lastWorkingDayOfWeek('2026-10-14')).toBe('2026-10-15');
  });

  it('Refresh_TwiceTheSameDay_ReadsOnce', async () => {
    const reader = vi.fn(async () => []);
    const cal = calendar(reader);

    await cal.refresh();
    await cal.refresh();

    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('Refresh_TheNextDay_ReadsAgain', async () => {
    const reader = vi.fn(async () => []);
    const cal = calendar(reader);
    await cal.refresh();

    today = new Date(2026, 9, 15, 9, 0);
    await cal.refresh();

    expect(reader).toHaveBeenCalledTimes(2);
  });

  it('Refresh_WhileAReadIsInFlight_DoesNotStartAnother', async () => {
    let finish: (days: string[]) => void = () => undefined;
    const reader = vi.fn(() => new Promise<string[]>(resolve => { finish = resolve; }));
    const cal = calendar(reader);

    const first = cal.refresh();
    await cal.refresh();
    finish([]);
    await first;

    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('Refresh_ReadFails_KeepsTheDaysReadBefore', async () => {
    // An outage must not turn yesterday's known holiday into a working day.
    await calendar(async () => ['2026-10-16']).refresh();
    today = new Date(2026, 9, 15, 9, 0);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failing = calendar(async () => {
      throw ProviderRequestError.fromTransport('openproject', 'Reading the days off', new Error('ECONNRESET'));
    });

    await failing.refresh();

    expect(failing.isWorkingDay('2026-10-16')).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not read the days off'), expect.any(Error));
  });

  it('Refresh_ReadFails_TriesAgainAtTheNextCheck', async () => {
    const reader = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(['2026-10-16']);
    const cal = calendar(reader);

    await cal.refresh();
    await cal.refresh();

    expect(cal.isWorkingDay('2026-10-16')).toBe(false);
  });

  it('Refresh_ProviderNotSetUp_IsQuietAndAsksNoMoreToday', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const reader = vi.fn(async () => {
      throw ProviderRequestError.notConfigured('openproject');
    });
    const cal = calendar(reader);

    await cal.refresh();
    await cal.refresh();

    expect(reader).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(cal.isWorkingDay('2026-10-16')).toBe(true);
  });

  it('Refresh_NoProviderCanSay_TheWeekdaysDecide', async () => {
    const cal = calendar(async () => null);

    await cal.refresh();

    expect(cal.isWorkingDay('2026-10-16')).toBe(true);
  });

  it('IsWorkingDay_CacheWrittenByAnOlderBuild_IsIgnored', () => {
    store.set(WorkingCalendar.CACHE_KEY, 'junk');

    expect(calendar(null).isWorkingDay('2026-10-16')).toBe(true);
  });
});
