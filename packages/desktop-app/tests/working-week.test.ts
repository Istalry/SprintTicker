import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserWindow } from 'electron';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { PriorityPreemptionEngine } from '../src/main/services/priority-preemption-engine';
import { ContextScheduleService } from '../src/main/services/context-schedule-service';
import { WorkingCalendar } from '../src/main/services/working-calendar';
import type { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { IPCChannel } from '../src/shared/ipc-channels';
import { WeekEndedDTO } from '../src/shared/dtos';

/**
 * The working week: nothing is prompted on a day off -- a weekend, a holiday
 * the instance lists, a day outside the user's own week -- and the last
 * working day of a week closes it, once.
 *
 * October 2026: Monday 12 to Sunday 18, Monday 19 to Sunday 25 (the clocks
 * go back in Europe that Sunday), Monday 26 on. The schedule is the default,
 * stand-up 09:30, lunch 12:30-13:30, wrap-up 17:30.
 */
describe('The working week', () => {
  let dbConn: DatabaseConnection;
  let settings: SettingsRepository;
  let engine: TimeTrackingEngine;
  let priority: PriorityPreemptionEngine;
  let renderer: { setContextMode: ReturnType<typeof vi.fn>; renderCeremonyPrompt: ReturnType<typeof vi.fn>; renderResumePrompt: ReturnType<typeof vi.fn> };
  let send: ReturnType<typeof vi.fn>;
  let service: ContextScheduleService;
  let holidays: string[];

  const at = (day: number, hours: number, minutes = 0) => vi.setSystemTime(new Date(2026, 9, day, hours, minutes, 0));
  /** A check at that time, with the holidays read as the app reads them. */
  const check = async (day: number, hours: number, minutes = 0) => {
    at(day, hours, minutes);
    service.evaluateSchedule();
    // The calendar's read lands, and the next check answers from it.
    await Promise.resolve();
    await Promise.resolve();
  };
  const prompted = (type: string) => renderer.renderCeremonyPrompt.mock.calls.filter(([t]) => t === type).length;
  const weeksSent = () => send.mock.calls.filter(([channel, week]) => channel === IPCChannel.ON_WEEK_ENDED && week !== null).map(([, week]) => week as WeekEndedDTO);
  const createService = () =>
    new ContextScheduleService(
      priority,
      settings,
      engine,
      renderer as unknown as DisplayRenderer,
      () => ({ isDestroyed: () => false, webContents: { send } }) as unknown as BrowserWindow,
      new WorkingCalendar(settings, async () => holidays)
    );
  const restart = () => {
    service.dispose();
    priority = new PriorityPreemptionEngine(settings);
    service = createService();
    service.evaluateSchedule();
  };
  /** Two hours on a task, from 10:00, on that day. */
  const workOn = (day: number) => {
    at(day, 10);
    engine.startTask('T-1', false, 'Ship it', 'P', 'MG-12');
    at(day, 12);
    engine.stopSession('Two hours');
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    dbConn = new DatabaseConnection(':memory:');
    settings = new SettingsRepository(dbConn);
    engine = new TimeTrackingEngine(new SessionRepository(dbConn), new WorklogRepository(dbConn), new TaskRepository(dbConn), undefined, new ProjectRepository(dbConn));
    priority = new PriorityPreemptionEngine(settings);
    renderer = { setContextMode: vi.fn(), renderCeremonyPrompt: vi.fn(), renderResumePrompt: vi.fn() };
    send = vi.fn();
    holidays = [];
    // Installed on the Monday morning of the first week, before anything is
    // due: the first check of a run passes over what is already late.
    at(12, 8);
    service = createService();
    service.evaluateSchedule();
  });

  afterEach(() => {
    service.dispose();
    engine.dispose();
    dbConn.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('days off', () => {
    it('Saturday_NothingIsPrompted', async () => {
      await check(17, 8);
      await check(17, 9, 31);
      await check(17, 12, 31);
      await check(17, 17, 31);

      expect(renderer.renderCeremonyPrompt).not.toHaveBeenCalled();
      expect(priority.getUserMode()).toBe('WORK');
    });

    it('Saturday_TimeIsStillTracked', async () => {
      // A day off silences the ceremonies, not the timer.
      workOn(17);

      expect(engine.getLoggedSeconds('2026-10-17', '2026-10-17')).toBe(2 * 3600);
    });

    it('Monday_TheStandupIsPrompted', async () => {
      await check(12, 9, 31);

      expect(prompted('STANDUP')).toBe(1);
    });

    it('AHolidayTheInstanceLists_NothingIsPrompted', async () => {
      holidays = ['2026-10-14'];
      await check(14, 8);

      await check(14, 9, 31);
      await check(14, 12, 31);
      await check(14, 17, 31);

      expect(renderer.renderCeremonyPrompt).not.toHaveBeenCalled();
      expect(priority.getUserMode()).toBe('WORK');
    });

    it('ADayOutsideTheUsersWeek_NothingIsPrompted', async () => {
      settings.setSetting('schedule_settings', { workingDays: [1, 2, 3, 4] });

      await check(16, 9, 31);
      await check(16, 17, 31);

      expect(renderer.renderCeremonyPrompt).not.toHaveBeenCalled();
    });

    it('LunchRunningIntoADayOff_StillEnds', async () => {
      // Exits are not ceremonies: a LUNCH mode must never outlive its hour.
      await check(16, 12, 31);
      expect(priority.getUserMode()).toBe('LUNCH');
      holidays = ['2026-10-16'];

      await check(16, 13, 31);

      expect(priority.getUserMode()).toBe('WORK');
    });
  });

  describe('closing the week', () => {
    it('FridaysWrapUp_ClosesTheWeekWithItsHours', async () => {
      workOn(13);
      workOn(15);

      await check(16, 17, 31);

      expect(prompted('EOD')).toBe(1);
      expect(weeksSent()).toEqual([{ weekStart: '2026-10-12', weekEnd: '2026-10-16', loggedSeconds: 4 * 3600 }]);
      expect(service.getWeekEnded()).toEqual(weeksSent()[0]);
    });

    it('ThursdaysWrapUp_ClosesNothing', async () => {
      await check(15, 17, 31);

      expect(prompted('EOD')).toBe(1);
      expect(weeksSent()).toEqual([]);
    });

    it('FridayAHoliday_ThursdayClosesTheWeek', async () => {
      holidays = ['2026-10-16'];
      await check(15, 8);

      await check(15, 17, 31);

      expect(weeksSent().map(w => [w.weekStart, w.weekEnd])).toEqual([['2026-10-12', '2026-10-15']]);
    });

    it('AFourDayWeek_ThursdayClosesIt', async () => {
      settings.setSetting('schedule_settings', { workingDays: [1, 2, 3, 4] });

      await check(15, 17, 31);

      expect(weeksSent().map(w => w.weekEnd)).toEqual(['2026-10-15']);
    });

    it('FridayMissed_TheNextWorkingDayClosesIt', async () => {
      // The laptop stayed shut on Friday: Monday catches it, at the first check.
      workOn(14);

      await check(19, 8);

      expect(weeksSent()).toEqual([{ weekStart: '2026-10-12', weekEnd: '2026-10-16', loggedSeconds: 2 * 3600 }]);
    });

    it('FridayMissed_TheWeekendDoesNotCatchIt', async () => {
      // Saturday is not a working day; the notice waits for Monday.
      await check(17, 10);

      expect(weeksSent()).toEqual([]);
    });

    it('FridayMissed_MondayLocked_WaitsForTheUser', async () => {
      priority.setUserMode('AWAY');
      await check(19, 8);
      expect(weeksSent()).toEqual([]);

      priority.setUserMode('WORK');
      await check(19, 9);

      expect(weeksSent()).toHaveLength(1);
    });

    it('ClosedOnFriday_MondayClosesNothingMore', async () => {
      await check(16, 17, 31);

      await check(19, 8);
      await check(19, 17, 31);

      expect(weeksSent()).toHaveLength(1);
    });

    it('ClosedOnFriday_ARestartDoesNotCloseItAgain', async () => {
      await check(16, 17, 31);

      restart();
      await check(19, 8);

      expect(weeksSent()).toHaveLength(1);
    });

    it('FirstRunEver_ThePreviousWeekIsNotClosed', async () => {
      // Installed on a Wednesday: the week before predates the app.
      service.dispose();
      settings.setSetting('last_week_closed', null);
      at(21, 8);
      service = createService();

      await check(21, 9);

      expect(weeksSent()).toEqual([]);
    });

    it('AWeekEntirelyOff_IsClosedSilently', async () => {
      // Read on the Friday, which the week's range covers back to its Monday.
      holidays = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
      settings.setSetting(WorkingCalendar.CACHE_KEY, null);
      // The day's first check reads them; the app running overnight makes it
      // at midnight, long before anything is due.
      await check(16, 0, 1);
      await check(16, 18);

      await check(19, 8);

      expect(weeksSent()).toEqual([]);
      expect(settings.getSetting('last_week_closed', null)).toBe('2026-10-12');
    });

    it('TheWeekTheClocksGoBack_ClosesOnItsFriday', async () => {
      settings.setSetting('last_week_closed', '2026-10-12');
      await check(23, 17, 31);
      await check(26, 8);

      expect(weeksSent().map(w => [w.weekStart, w.weekEnd])).toEqual([['2026-10-19', '2026-10-23']]);
    });

    it('OnWeekEnded_HearsEachWeekOnce_AndAThrowingListenerChangesNothing', async () => {
      const heard = vi.fn();
      service.onWeekEnded(() => {
        throw new Error('the timesheet client broke');
      });
      service.onWeekEnded(heard);

      await check(16, 17, 31);
      await check(19, 8);

      expect(heard).toHaveBeenCalledTimes(1);
      expect(weeksSent()).toHaveLength(1);
    });
  });

  describe('the notice', () => {
    it('DismissWeekEnded_GoesFromEveryWindow', async () => {
      await check(16, 17, 31);

      service.dismissWeekEnded();

      expect(service.getWeekEnded()).toBeNull();
      expect(send).toHaveBeenLastCalledWith(IPCChannel.ON_WEEK_ENDED, null);
    });

    it('GetWeekEnded_AfterARestart_StillShowsIt', async () => {
      await check(16, 17, 31);

      restart();

      expect(service.getWeekEnded()).toMatchObject({ weekStart: '2026-10-12' });
    });
  });
});
