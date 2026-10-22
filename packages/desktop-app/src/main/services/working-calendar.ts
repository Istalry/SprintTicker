import { ArgumentNullException, ScheduleSettingsDTO } from '../../shared/dtos';
import { addLocalDays, localDateKey } from '../../shared/local-date';
import { normalizeScheduleSettings } from '../../shared/schedule-defaults';
import { isWorkingDay, lastWorkingDayOfWeek, weekStartKey } from '../../shared/working-days';
import { isProviderRequestError } from '../providers/provider-errors';

export interface CalendarSettingsStore {
  getSetting<T>(key: string, defaultValue: T): T;
  setSetting<T>(key: string, value: T): void;
}

/**
 * The days off the provider knows of between two date keys, inclusive -- an
 * instance's holidays. Null when no provider can say, which is not a failure.
 */
export type NonWorkingDaysReader = (fromKey: string, toKey: string) => Promise<string[] | null>;

/** The holidays as last read, and the day they were read. */
interface DaysOffCache {
  readOn: string;
  days: string[];
}

/** The last week before this one to the third after it: enough for any week the schedule closes or catches up. */
const CACHE_WEEKS_BEFORE = 1;
const CACHE_WEEKS_AFTER = 3;

/**
 * Which days are worked: the weekdays in the schedule, less the holidays the
 * provider knows of.
 *
 * The holidays are read once a day and kept, because the schedule asks every
 * 30 seconds and must answer at once: a ceremony waiting on a network round
 * trip would fire late or not at all. A read that fails keeps what was read
 * before -- or nothing, the first time -- and the weekdays alone decide: a
 * holiday the app did not hear of prompts as a working day, which the user
 * dismisses, where an outage that silenced every ceremony would go unnoticed.
 */
export class WorkingCalendar {
  public static readonly CACHE_KEY = 'non_working_days';

  private reading = false;

  constructor(
    private readonly settings: CalendarSettingsStore,
    private readonly readDaysOff: NonWorkingDaysReader | null = null,
    private readonly now: () => Date = () => new Date()
  ) {
    if (!settings) throw new ArgumentNullException('settings');
  }

  public isWorkingDay(dateKey: string): boolean {
    return isWorkingDay(dateKey, this.workingDays(), this.daysOff());
  }

  /** The last working day of the week holding `dateKey`, or null for a week off. */
  public lastWorkingDayOfWeek(dateKey: string): string | null {
    return lastWorkingDayOfWeek(dateKey, this.workingDays(), this.daysOff());
  }

  /**
   * Reads the holidays when they were not read today. Never throws: the
   * caller is the schedule check, and a calendar it cannot refresh is one it
   * still answers from.
   */
  public async refresh(): Promise<void> {
    if (!this.readDaysOff || this.reading) return;
    const today = localDateKey(this.now());
    if (this.readCache()?.readOn === today) return;

    this.reading = true;
    try {
      const monday = weekStartKey(today);
      const days = await this.readDaysOff(addLocalDays(monday, -7 * CACHE_WEEKS_BEFORE), addLocalDays(monday, 7 * CACHE_WEEKS_AFTER + 6));
      // Null: nothing can say. Stamped all the same, so the next check does
      // not ask again within the day.
      const cache: DaysOffCache = { readOn: today, days: days ?? [] };
      this.settings.setSetting(WorkingCalendar.CACHE_KEY, cache);
    } catch (err) {
      if (isProviderRequestError(err) && err.kind === 'not_configured') {
        // No OpenProject set up: the weekdays decide, as they always did.
        this.settings.setSetting<DaysOffCache>(WorkingCalendar.CACHE_KEY, { readOn: today, days: this.readCache()?.days ?? [] });
        return;
      }
      console.warn('[WorkingCalendar] Could not read the days off; keeping the last ones read:', err);
    } finally {
      this.reading = false;
    }
  }

  private workingDays(): readonly number[] {
    return normalizeScheduleSettings(this.settings.getSetting<ScheduleSettingsDTO>('schedule_settings', {})).workingDays!;
  }

  private daysOff(): ReadonlySet<string> {
    return new Set(this.readCache()?.days ?? []);
  }

  private readCache(): DaysOffCache | null {
    const stored = this.settings.getSetting<unknown>(WorkingCalendar.CACHE_KEY, null) as Partial<DaysOffCache> | null;
    if (!stored || typeof stored.readOn !== 'string' || !Array.isArray(stored.days)) return null;
    return { readOn: stored.readOn, days: stored.days.filter((day): day is string => typeof day === 'string') };
  }
}
