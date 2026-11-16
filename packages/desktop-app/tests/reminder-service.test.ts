import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { ReminderService, inWorkingHours } from '../src/main/services/reminder-service';
import { IPCChannel } from '../src/shared/ipc-channels';
import { DAILY_STANDUP_TITLE } from '../src/shared/schedule-defaults';
import type { ReminderDTO, ResumePromptDTO, UserMode } from '../src/shared/dtos';

/**
 * The "still...?" reminders (redesign P8d, 13.4): each asked once per
 * occurrence, in working hours only -- the stand-up to the wrap-up, on a
 * working day, in WORK -- and gone when answered or when the state it is
 * about ends.
 *
 * A real engine on a database in memory; the clock is faked, and the
 * outlet records what reached the windows and the toasts.
 */
describe('ReminderService', () => {
  let dbConn: DatabaseConnection;
  let settings: SettingsRepository;
  let engine: TimeTrackingEngine;
  let service: ReminderService;
  let outlet: { send: ReturnType<typeof vi.fn>; announce: ReturnType<typeof vi.fn> };
  let mode: UserMode;
  let workingDay: boolean;
  let resumePrompt: ResumePromptDTO | null;
  /** What the bar's listener was told (P14e). */
  let told: Array<ReminderDTO | null>;

  /** Wednesday 14 October 2026, local time. Working hours are 09:30 to 17:30. */
  const at = (hours: number, minutes: number) => vi.setSystemTime(new Date(2026, 9, 14, hours, minutes, 0));
  const tick = (hours: number, minutes: number) => {
    at(hours, minutes);
    service.evaluate();
  };
  const sent = (): Array<ReminderDTO | null> =>
    outlet.send.mock.calls.filter(([channel]) => channel === IPCChannel.ON_REMINDER).map(([, r]) => r as ReminderDTO | null);
  const asked = () => sent().filter((r): r is ReminderDTO => r !== null);
  const startA = () => engine.startTask('', true, 'Writing the spec');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    at(9, 0);
    dbConn = new DatabaseConnection(':memory:');
    settings = new SettingsRepository(dbConn);
    settings.setSetting('schedule_settings', { standupTime: '09:30', eodWrapUpTime: '17:30' });
    engine = new TimeTrackingEngine(
      new SessionRepository(dbConn), new WorklogRepository(dbConn), new TaskRepository(dbConn), undefined, new ProjectRepository(dbConn)
    );
    outlet = { send: vi.fn(), announce: vi.fn() };
    mode = 'WORK';
    workingDay = true;
    resumePrompt = null;
    told = [];
    service = new ReminderService({
      getSession: () => engine.getCurrentSession(),
      subscribe: listener => engine.subscribe(listener),
      getSetting: (key, fallback) => settings.getSetting(key, fallback),
      getUserMode: () => mode,
      isWorkingDay: () => workingDay,
      isStandupSession: s => s.isAdHoc && s.taskTitle === DAILY_STANDUP_TITLE,
      getResumePrompt: () => resumePrompt,
      outlet: () => outlet,
      onReminder: reminder => told.push(reminder)
    });
  });

  afterEach(() => {
    service.dispose();
    engine.dispose();
    dbConn.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('working hours', () => {
    const schedule = { standupTime: '09:30', eodWrapUpTime: '17:30' };

    it.each([
      [9, 29, false], [9, 30, true], [17, 29, true], [17, 30, false]
    ])('InWorkingHours_%i:%i_%s', (h, m, expected) => {
      expect(inWorkingHours(new Date(2026, 9, 14, h, m), schedule, () => true)).toBe(expected);
    });

    it('InWorkingHours_ADayOff_Never', () => {
      expect(inWorkingHours(new Date(2026, 9, 14, 11, 0), schedule, () => false)).toBe(false);
    });
  });

  describe('nothing timing', () => {
    it('Evaluate_NothingTimingTenMinutesIntoTheDay_AsksOnceWithAToast', () => {
      tick(9, 39);
      expect(asked()).toEqual([]);

      tick(9, 40);
      tick(9, 41);

      expect(asked()).toEqual([expect.objectContaining({ kind: 'nothing-timing', minutes: 10 })]);
      expect(outlet.announce).toHaveBeenCalledWith({ title: 'Nothing timing for 10 min', body: 'Click to start a task, or leave it.' });
      expect(service.getReminder()?.kind).toBe('nothing-timing');
    });

    it('Evaluate_BeforeTheDayStarts_NothingAsked', () => {
      tick(9, 25);
      expect(asked()).toEqual([]);
    });

    it('Evaluate_CountsFromTheStop_NotFromTheMorning', () => {
      at(9, 30);
      startA();
      at(11, 0);
      engine.stopSession('Done for now');

      tick(11, 9);
      expect(asked()).toEqual([]);
      tick(11, 10);
      expect(asked()).toHaveLength(1);
    });

    it('StartingATask_TheReminderGoesAtOnce', () => {
      tick(9, 40);

      startA();

      expect(sent().at(-1)).toBeNull();
      expect(service.getReminder()).toBeNull();
    });

    it('Dismissed_IsFinalForThisOccurrence_TheNextOneAsksAgain', () => {
      tick(9, 40);
      const first = service.getReminder()!;

      expect(service.dismiss(first.id)).toBe(true);
      tick(9, 50);
      expect(asked()).toHaveLength(1);

      at(10, 0);
      startA();
      at(10, 30);
      engine.stopSession('Stop');
      tick(10, 40);

      expect(asked()).toHaveLength(2);
      expect(service.dismiss('not-this-one')).toBe(false);
    });

    it('BackToTheTaskBeingAsked_NoNothingTimingReminder_ButAToastOnceMore', () => {
      resumePrompt = {
        taskKey: 'MG-12', taskTitle: 'Fix the lantern glow', after: 'interruption',
        interruptionEndedAtUtc: new Date(2026, 9, 14, 10, 0).toISOString()
      };
      tick(10, 9);
      expect(outlet.announce).not.toHaveBeenCalled();

      tick(10, 10);
      tick(10, 30);

      expect(asked()).toEqual([]);
      expect(outlet.announce).toHaveBeenCalledTimes(1);
      expect(outlet.announce).toHaveBeenCalledWith({ title: 'Nothing is running. Back to MG-12?', body: 'Click to go back to it, or leave it.' });
    });
  });

  describe('the listener on the bar', () => {
    // Main draws NOTHING TIMING from here, and lets go of it when told null.
    it('OnReminder_AskedThenATaskStarted_ToldEachTime', () => {
      tick(9, 40);
      expect(told).toEqual([expect.objectContaining({ kind: 'nothing-timing' })]);

      startA();

      expect(told.at(-1)).toBeNull();
    });

    it('OnReminder_Dismissed_ToldItWent', () => {
      tick(9, 40);

      service.dismiss(service.getReminder()!.id);

      expect(told).toEqual([expect.objectContaining({ kind: 'nothing-timing' }), null]);
    });

    it('OnReminder_LeavingWork_ToldItWent', () => {
      tick(9, 40);
      mode = 'LUNCH';

      tick(12, 30);

      expect(told.at(-1)).toBeNull();
    });

    it('OnReminder_NothingAsked_NeverTold', () => {
      tick(9, 35);

      expect(told).toEqual([]);
    });
  });

  describe('still paused, still on it, still in it', () => {
    it('LongPause_AfterThirtyMinutes_AsksStillPaused_ResumingClearsIt', () => {
      at(9, 30);
      startA();
      at(10, 0);
      engine.pauseSession();

      tick(10, 29);
      expect(asked()).toEqual([]);
      tick(10, 30);
      expect(asked()).toEqual([expect.objectContaining({ kind: 'long-pause', minutes: 30 })]);

      engine.resumeSession();

      expect(service.getReminder()).toBeNull();
      expect(sent().at(-1)).toBeNull();
    });

    it('Interruption_AfterTwentyMinutes_AsksStillOnIt_NamingWhatItHolds', () => {
      at(9, 30);
      engine.startTask('', true, 'Writing the spec');
      at(10, 0);
      engine.startInterruption(new Date());

      tick(10, 20);

      expect(service.getReminder()).toMatchObject({ kind: 'interruption-running', minutes: 20, heldTaskKey: expect.any(String) });
    });

    it('Interruption_Paused_AskedAsAPause_NotStillOnIt', () => {
      // An interruption pauses as a task does (2026-11-16); paused, it is
      // not still being worked on.
      at(9, 30);
      engine.startTask('', true, 'Writing the spec');
      at(10, 0);
      engine.startInterruption(new Date());
      engine.pauseSession();

      tick(10, 20);
      expect(service.getReminder()).toBeNull();
      tick(10, 30);

      expect(service.getReminder()).toMatchObject({ kind: 'long-pause', minutes: 30 });
    });

    it('Standup_AfterTwentyFiveMinutes_AsksStillInIt', () => {
      at(9, 30);
      engine.startNamedAdHocTask(DAILY_STANDUP_TITLE);

      tick(9, 54);
      expect(asked()).toEqual([]);
      tick(9, 55);

      expect(service.getReminder()).toMatchObject({ kind: 'standup-running', minutes: 25 });
    });

    it('Delays_TheUsersOwn_AreRead', () => {
      settings.setSetting('prompt_delays', { longPause: 5 });
      at(9, 30);
      startA();
      at(10, 0);
      engine.pauseSession();

      tick(10, 5);

      expect(service.getReminder()?.kind).toBe('long-pause');
    });
  });

  describe('outside working hours', () => {
    it.each([['LUNCH'], ['AWAY']] as const)('Mode%s_NothingAsked_AndAnOpenReminderGoes', (other) => {
      tick(9, 40);
      expect(service.getReminder()).not.toBeNull();

      mode = other;
      tick(9, 41);

      expect(service.getReminder()).toBeNull();
      expect(sent().at(-1)).toBeNull();
    });

    it('ADayOff_NothingAsked', () => {
      workingDay = false;
      tick(11, 0);
      expect(asked()).toEqual([]);
    });

    it('AfterTheWrapUpHour_NothingAsked', () => {
      at(17, 0);
      startA();
      engine.pauseSession();
      tick(18, 0);
      expect(asked()).toEqual([]);
    });
  });
});
