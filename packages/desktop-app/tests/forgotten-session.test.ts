import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserWindow } from 'electron';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { PresenceMonitor } from '../src/main/services/presence-monitor';
import { ForgottenSessionService } from '../src/main/services/forgotten-session-service';
import { IPCChannel } from '../src/shared/ipc-channels';
import { FORGOTTEN_REVIEW_KEY, LAST_PRESENCE_KEY, PRESENCE_SAMPLE_MS } from '../src/shared/session-review';

/**
 * A session left running across a change of day.
 *
 * Time is wall clock minus pauses, so a session forgotten on Friday read 62
 * hours on Monday and stopping it sent them all. Now it is paused at the last
 * activity and the user is asked when the work stopped -- while working past
 * midnight is never interrupted.
 *
 * Real engine and settings on a database in memory; the clock and the
 * system's idle time are faked. 16 October 2026 is a Friday.
 */
describe('A session left running', () => {
  let dbConn: DatabaseConnection;
  let settings: SettingsRepository;
  let worklogs: WorklogRepository;
  let engine: TimeTrackingEngine;
  let presence: PresenceMonitor;
  let service: ForgottenSessionService;
  let send: ReturnType<typeof vi.fn>;
  /** When the keyboard or mouse was last touched. */
  let lastInput: number;

  const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes, 0).getTime();
  /** The clock moves on with nobody at the machine. */
  const away = (until: number) => vi.setSystemTime(until);
  /** The clock moves on and the user touches the mouse. */
  const back = (when: number) => {
    vi.setSystemTime(when);
    lastInput = when;
  };
  const iso = (time: number) => new Date(time).toISOString();
  const createService = () =>
    new ForgottenSessionService(
      engine,
      settings,
      presence,
      () => ({ isDestroyed: () => false, show: vi.fn(), focus: vi.fn(), webContents: { send } }) as unknown as BrowserWindow
    );
  const loggedOn = (day: number) =>
    worklogs.getWorklogsByDate(`2026-10-${day}`).reduce((sum, log) => sum + log.durationSeconds, 0);
  /** Friday: started at 10:00, last activity at 18:04, the machine left on. */
  const leftRunningOnFriday = () => {
    back(at(16, 10));
    engine.startTask('T-1', false, 'Rework the pause menu', 'P', 'MG-12');
    back(at(16, 18, 4));
    service.check();
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    // Each stop wakes the queue, and no provider is configured here.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    lastInput = at(16, 9);
    vi.setSystemTime(lastInput);
    dbConn = new DatabaseConnection(':memory:');
    settings = new SettingsRepository(dbConn);
    settings.setSetting('schedule_settings', { eodWrapUpTime: '17:30' });
    worklogs = new WorklogRepository(dbConn);
    engine = new TimeTrackingEngine(
      new SessionRepository(dbConn), worklogs, new TaskRepository(dbConn), undefined, new ProjectRepository(dbConn)
    );
    presence = new PresenceMonitor(settings, () => (Date.now() - lastInput) / 1000);
    send = vi.fn();
    service = createService();
  });

  afterEach(() => {
    service.dispose();
    engine.dispose();
    dbConn.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('found', () => {
    it('Check_BackOnMonday_PausesAtFridaysLastActivityAndAsks', () => {
      leftRunningOnFriday();

      back(at(19, 9));
      service.check();

      const session = engine.getCurrentSession();
      expect(session?.status).toBe('PAUSED');
      expect(session?.elapsedSeconds).toBe(8 * 3600 + 4 * 60);
      expect(service.getReview()).toMatchObject({
        taskKey: 'MG-12',
        lastPresenceUtc: iso(at(16, 18, 4)),
        endOfDayUtc: iso(at(16, 17, 30))
      });
      expect(send).toHaveBeenCalledWith(IPCChannel.ON_FORGOTTEN_SESSION_REVIEW, expect.objectContaining({ taskKey: 'MG-12' }));
    });

    it('Check_MachineLeftOnAllWeekend_TheMinuteSamplesFindItOnMonday', () => {
      // Never locked, never asleep: only the samples see the user come back.
      leftRunningOnFriday();
      service.start();
      // A few samples on Saturday, with nobody there: nothing moves.
      away(at(17, 12));
      vi.advanceTimersByTime(3 * PRESENCE_SAMPLE_MS);
      away(at(19, 8, 59));
      vi.advanceTimersByTime(PRESENCE_SAMPLE_MS);
      expect(engine.getCurrentSession()?.status).toBe('TRACKING');

      lastInput = Date.now();
      vi.advanceTimersByTime(PRESENCE_SAMPLE_MS);

      expect(engine.getCurrentSession()?.status).toBe('PAUSED');
      expect(engine.getCurrentSession()?.elapsedSeconds).toBe(8 * 3600 + 4 * 60);
    });

    it('Check_OvernightThenBackInTheMorning_Asks', () => {
      leftRunningOnFriday();

      back(at(17, 8, 30));
      service.check();

      expect(service.getReview()).not.toBeNull();
    });

    it('Check_FirstPressOnTheBar_FindsItWithoutAnyInputOnWindows', () => {
      // Windows still counts the user idle; the press is the presence.
      leftRunningOnFriday();
      away(at(19, 9));

      service.check({ barInput: true });

      expect(engine.getCurrentSession()?.status).toBe('PAUSED');
    });

    it('Check_StillAway_WaitsForTheUser', () => {
      leftRunningOnFriday();
      away(at(19, 9));

      service.check();

      expect(engine.getCurrentSession()?.status).toBe('TRACKING');
      expect(service.getReview()).toBeNull();
    });
  });

  describe('not forgotten', () => {
    it('Check_OvertimePastMidnight_NeverInterrupts', () => {
      // At the keyboard until 01:30: the presence moves on every minute.
      back(at(16, 17));
      engine.startTask('T-1', false, 'Ship it', 'P', 'MG-12');
      service.start();

      for (let t = at(16, 17); t <= at(17, 1, 30); t += PRESENCE_SAMPLE_MS) {
        lastInput = t;
        vi.setSystemTime(t);
        vi.advanceTimersByTime(0);
        service.check();
      }

      expect(engine.getCurrentSession()?.status).toBe('TRACKING');
      expect(service.getReview()).toBeNull();
    });

    it('Check_LongAbsenceTheSameDay_IsNotForgotten', () => {
      // A three-hour meeting away from the desk: the same day, still work.
      back(at(16, 9));
      engine.startTask('T-1', false, 'Ship it', 'P', 'MG-12');
      service.check();

      back(at(16, 15));
      service.check();

      expect(engine.getCurrentSession()?.status).toBe('TRACKING');
    });

    it('Check_ShortGapAcrossMidnight_IsNotForgotten', () => {
      // Off the keyboard from 23:30 to 00:45: a long call, not a weekend.
      back(at(16, 22));
      engine.startTask('T-1', false, 'Ship it', 'P', 'MG-12');
      back(at(16, 23, 30));
      service.check();

      back(at(17, 0, 45));
      service.check();

      expect(engine.getCurrentSession()?.status).toBe('TRACKING');
    });

    it('Check_SessionStartedAfterTheUserLeft_IsNotForgotten', () => {
      // Started on Monday morning, from the bar, before anything else.
      back(at(16, 18));
      service.check();
      away(at(19, 8, 55));
      engine.startTask('T-1', false, 'Ship it', 'P', 'MG-12');

      back(at(19, 9));
      service.check();

      expect(engine.getCurrentSession()?.status).toBe('TRACKING');
    });

    it('Check_SessionAlreadyPaused_IsLeftAlone', () => {
      leftRunningOnFriday();
      engine.pauseSession();

      back(at(19, 9));
      service.check();

      expect(service.getReview()).toBeNull();
    });

    it('Check_SettingTurnedOff_DoesNotAsk', () => {
      settings.setSetting('schedule_settings', { askAboutForgottenSessions: false });
      leftRunningOnFriday();

      back(at(19, 9));
      service.check();

      expect(engine.getCurrentSession()?.status).toBe('TRACKING');
    });

    it('Check_NoPresenceEverRecorded_DoesNotGuess', () => {
      // The first start after an upgrade: no evidence of when the user left.
      back(at(16, 10));
      engine.startTask('T-1', false, 'Ship it', 'P', 'MG-12');

      back(at(19, 9));
      service.check();

      expect(engine.getCurrentSession()?.status).toBe('TRACKING');
      expect(settings.getSetting(LAST_PRESENCE_KEY, null)).toBe(iso(at(19, 9)));
    });
  });

  describe('while it is asked', () => {
    beforeEach(() => {
      leftRunningOnFriday();
      back(at(19, 9));
      service.check();
    });

    it('Restart_TheQuestionIsStillThere', () => {
      service.dispose();
      service = createService();

      expect(service.getReview()?.lastPresenceUtc).toBe(iso(at(16, 18, 4)));
    });

    it('StopFromTheBar_LogsUpToTheLastActivityAndCloses', () => {
      engine.stopSession('Stopped via BUSY Bar');

      expect(loggedOn(16)).toBe(8 * 3600 + 4 * 60);
      expect(service.getReview()).toBeNull();
      expect(send).toHaveBeenLastCalledWith(IPCChannel.ON_FORGOTTEN_SESSION_REVIEW, null);
    });

    it('ResumeFromTheBar_DoesNotCountTheGap', () => {
      engine.resumeSession();
      back(at(19, 10));

      expect(service.getReview()).toBeNull();
      expect(engine.getCurrentSession()?.elapsedSeconds).toBe(8 * 3600 + 4 * 60 + 3600);
    });

    it('Check_Again_AsksOnlyOnce', () => {
      send.mockClear();
      back(at(19, 9, 5));
      service.check();

      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('the answer', () => {
    beforeEach(() => {
      leftRunningOnFriday();
      back(at(19, 9));
      service.check();
    });

    it('Resolve_StopAtLastActivity_LogsFridayUpTo1804', () => {
      expect(service.resolve({ action: 'stop', endUtc: iso(at(16, 18, 4)) })).toBe(true);

      expect(engine.getCurrentSession()).toBeNull();
      expect(loggedOn(16)).toBe(8 * 3600 + 4 * 60);
      expect(loggedOn(19)).toBe(0);
    });

    it('Resolve_StopAtTheEndOfThatDay_LogsUpTo1730', () => {
      service.resolve({ action: 'stop', endUtc: service.getReview()!.endOfDayUtc! });

      expect(loggedOn(16)).toBe(7 * 3600 + 30 * 60);
    });

    it('Resolve_StopAtACustomTimeAfterTheLastActivity_CountsUpToIt', () => {
      // Worked on without touching the machine -- a meeting -- until 19:00.
      service.resolve({ action: 'stop', endUtc: iso(at(16, 19)) });

      expect(loggedOn(16)).toBe(9 * 3600);
    });

    it('Resolve_Restart_LogsFridayAndStartsTheTaskAgainNow', () => {
      service.resolve({ action: 'restart', endUtc: iso(at(16, 18, 4)) });

      expect(loggedOn(16)).toBe(8 * 3600 + 4 * 60);
      expect(engine.getCurrentSession()).toMatchObject({ taskId: 'T-1', taskKey: 'MG-12', status: 'TRACKING', elapsedSeconds: 0 });
    });

    it('Resolve_Discard_KeepsNothing', () => {
      service.resolve({ action: 'discard' });

      expect(engine.getCurrentSession()).toBeNull();
      expect(loggedOn(16)).toBe(0);
    });

    it('Resolve_Keep_CountsTheWholeAbsenceAndRunsOn', () => {
      service.resolve({ action: 'keep' });

      expect(engine.getCurrentSession()).toMatchObject({ status: 'TRACKING', elapsedSeconds: (at(19, 9) - at(16, 10)) / 1000 });
      expect(service.getReview()).toBeNull();
    });

    it('Resolve_EndBeforeTheStart_IsRefusedAndStillAsks', () => {
      expect(() => service.resolve({ action: 'stop', endUtc: iso(at(16, 9)) })).toThrow(/between its start and now/);
      expect(service.getReview()).not.toBeNull();
    });

    it('Resolve_StopWithoutAnEnd_IsRefused', () => {
      expect(() => service.resolve({ action: 'stop' })).toThrow(/time it ended/);
    });

    it('Resolve_UnknownAction_IsRefused', () => {
      expect(() => service.resolve({ action: 'log-everything' as never })).toThrow(/Unknown answer/);
    });

    it('Resolve_AlreadyAnswered_AnswersFalse', () => {
      service.resolve({ action: 'discard' });

      expect(service.resolve({ action: 'keep' })).toBe(false);
    });
  });

  it('GetReview_EndOfDayBeforeTheStart_IsNotOffered', () => {
    // Started at 19:00 on Friday: 17:30 that day would log nothing.
    back(at(16, 19));
    engine.startTask('T-1', false, 'Late fix', 'P', 'MG-12');
    back(at(16, 21));
    service.check();
    back(at(17, 9));
    service.check();

    expect(service.getReview()?.endOfDayUtc).toBeNull();
  });

  it('GetReview_SessionEndedBehindItsBack_DropsTheStoredQuestion', () => {
    settings.setSetting(FORGOTTEN_REVIEW_KEY, { sessionId: 'gone', lastPresenceUtc: iso(at(16, 18)) });

    expect(service.getReview()).toBeNull();
    expect(settings.getSetting(FORGOTTEN_REVIEW_KEY, 'unset')).toBeNull();
  });
});
