import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { PresenceMonitor } from '../src/main/services/presence-monitor';
import { LAST_PRESENCE_KEY, workedSecondsUntil } from '../src/shared/session-review';
import { atLocalTime } from '../src/shared/local-date';

const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes, 0).getTime();
const iso = (time: number) => new Date(time).toISOString();

/**
 * Stopping a session at a time in the past, which needs to know where its
 * pauses fell -- and the resume that ended each was never written.
 */
describe('Ending a session at a chosen time', () => {
  let dbConn: DatabaseConnection;
  let sessions: SessionRepository;
  let worklogs: WorklogRepository;
  let engine: TimeTrackingEngine;

  const logged = () => worklogs.getWorklogsByDate('2026-10-16').reduce((sum, log) => sum + log.durationSeconds, 0);
  const sessionId = () => engine.getCurrentSession()!.sessionId;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.setSystemTime(at(16, 9));
    dbConn = new DatabaseConnection(':memory:');
    sessions = new SessionRepository(dbConn);
    worklogs = new WorklogRepository(dbConn);
    engine = new TimeTrackingEngine(sessions, worklogs, new TaskRepository(dbConn), undefined, new ProjectRepository(dbConn));
    engine.startTask('T-1', false, 'Ship it', 'P', 'MG-12');
  });

  afterEach(() => {
    engine.dispose();
    dbConn.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** Paused from 12:00 to 13:00. */
  const lunchPause = () => {
    vi.setSystemTime(at(16, 12));
    engine.pauseSession();
    vi.setSystemTime(at(16, 13));
    engine.resumeSession();
  };

  it('ResumeSession_RecordsWhenThePauseEnded', () => {
    lunchPause();

    expect(sessions.getPauseIntervals(sessionId())).toEqual([{ pausedAtUtc: iso(at(16, 12)), resumedAtUtc: iso(at(16, 13)) }]);
  });

  it('StopSessionAt_AfterAPause_SubtractsIt', () => {
    lunchPause();
    vi.setSystemTime(at(16, 20));

    engine.stopSessionAt(iso(at(16, 17)));

    expect(logged()).toBe(7 * 3600);
  });

  describe('the clock set back during a pause', () => {
    // 09:00-10:00 worked, paused, the clock corrected back half an hour, and
    // 09:30-10:30 worked on the new clock: two hours. The session's total
    // has the pause at -30 min, which is what keeps it right; the pause rows
    // have it ending before it began.
    const pauseThenSetTheClockBack = () => {
      vi.setSystemTime(at(16, 10));
      engine.pauseSession();
      vi.setSystemTime(at(16, 9, 30));
      engine.resumeSession();
      vi.setSystemTime(at(16, 10, 30));
    };

    it('StopSessionAt_Now_LogsWhatStoppingNowLogs', () => {
      // Stopped from the forgotten-session question rather than STOP: the
      // same session logged 90 min one way and 120 the other.
      pauseThenSetTheClockBack();
      expect(engine.getCurrentSession()!.elapsedSeconds).toBe(2 * 3600);

      engine.stopSessionAt(iso(at(16, 10, 30)));

      expect(logged()).toBe(2 * 3600);
    });

    it('StopSessionAt_BeforeTheResumeOnTheNewClock_LogsTheWorkBeforeThePause', () => {
      pauseThenSetTheClockBack();

      engine.stopSessionAt(iso(at(16, 9, 15)));

      expect(logged()).toBe(3600);
    });

    it('StopSessionAt_StillPausedAfterTheJump_LogsTheWorkBeforeThePause', () => {
      // The pause in progress is read up to now, which is before it began.
      vi.setSystemTime(at(16, 10));
      engine.pauseSession();
      vi.setSystemTime(at(16, 9, 45));

      engine.stopSessionAt(iso(at(16, 9, 45)));

      expect(logged()).toBe(3600);
    });
  });

  it('StopSessionAt_BeforeAPause_IgnoresIt', () => {
    lunchPause();
    vi.setSystemTime(at(16, 20));

    engine.stopSessionAt(iso(at(16, 11)));

    expect(logged()).toBe(2 * 3600);
  });

  it('StopSessionAt_InsideAPause_CountsUpToItsStart', () => {
    lunchPause();
    vi.setSystemTime(at(16, 20));

    engine.stopSessionAt(iso(at(16, 12, 30)));

    expect(logged()).toBe(3 * 3600);
  });

  it('StopSessionAt_WhilePausedFromTheApp_CountsThePauseInProgress', () => {
    vi.setSystemTime(at(16, 12));
    engine.pauseSession();
    vi.setSystemTime(at(16, 20));

    engine.stopSessionAt(iso(at(16, 14)));

    expect(logged()).toBe(3 * 3600);
  });

  it.each([
    ['before the start', at(16, 8)],
    ['in the future', at(16, 21)]
  ])('StopSessionAt_EndIs%s_IsRefusedAndTheSessionRunsOn', (_label, end) => {
    vi.setSystemTime(at(16, 20));

    expect(() => engine.stopSessionAt(iso(end))).toThrow(/between its start and now/);
    expect(engine.getCurrentSession()?.status).toBe('TRACKING');
  });

  it('StopSessionAt_NoSession_ReportsNothingDone', () => {
    engine.discardSession();

    expect(engine.stopSessionAt(iso(at(16, 9)))).toEqual({ success: false, loggedSeconds: 0 });
  });

  it('PauseSessionAt_ShowsAndLogsTheTimeUpToIt', () => {
    vi.setSystemTime(at(19, 9));

    engine.pauseSessionAt(iso(at(16, 18)));

    expect(engine.getCurrentSession()).toMatchObject({ status: 'PAUSED', elapsedSeconds: 9 * 3600 });
    engine.stopSession();
    expect(logged()).toBe(9 * 3600);
  });

  it('PauseSessionAt_OutsideTheSession_IsRefused', () => {
    vi.setSystemTime(at(16, 20));

    expect(() => engine.pauseSessionAt(iso(at(16, 8)))).toThrow(/between its start and now/);
  });

  it('PauseSessionAt_ThenResumed_TheGapGetsItsRow', () => {
    // So a second forgotten night on the same session knows of the first.
    vi.setSystemTime(at(19, 9));
    engine.pauseSessionAt(iso(at(16, 18)));

    engine.resumeSession();

    expect(engine.getClosedPauses()).toEqual([{ fromUtc: iso(at(16, 18)), toUtc: iso(at(19, 9)) }]);
  });

  it('WithdrawPause_CountsTheWholePauseAsWork', () => {
    vi.setSystemTime(at(19, 9));
    engine.pauseSessionAt(iso(at(16, 18)));

    engine.withdrawPause();

    expect(engine.getCurrentSession()).toMatchObject({ status: 'TRACKING', elapsedSeconds: (at(19, 9) - at(16, 9)) / 1000 });
  });

  it('GetClosedPauses_PausesFromBeforeResumesWereRecorded_FallBackOnTheTotal', () => {
    // Their rows have no end: only the stored total says how long they were.
    const id = sessionId();
    sessions.recordPauseInterval(id, iso(at(16, 10)));
    sessions.updateStatus(id, 'TRACKING', 1800);

    expect(engine.getClosedPauses()).toEqual([{ fromUtc: iso(at(16, 9)), toUtc: iso(at(16, 9, 30)) }]);
  });
});

describe('Work History files a worklog by its start', () => {
  it('GetWorklogsByDate_SessionFrom2300To0100_IsOnTheFirstDay', () => {
    // As Jira (`started`) and OpenProject (`spentOn`) file it.
    const dbConn = new DatabaseConnection(':memory:');
    const worklogs = new WorklogRepository(dbConn);
    new TaskRepository(dbConn).ensureTaskExists({ id: 'T-1', key: 'MG-12', title: 'Ship it', projectId: 'P' });
    worklogs.saveWorklog({
      id: 'w1', sessionId: 's1', taskId: 'T-1', durationSeconds: 7200,
      startedAtUtc: iso(at(16, 23)), comment: '', createdAtUtc: iso(at(17, 1))
    });

    expect(worklogs.getWorklogsByDate('2026-10-16').map(w => w.id)).toEqual(['w1']);
    expect(worklogs.getWorklogsByDate('2026-10-17')).toEqual([]);
    dbConn.close();
  });
});

describe('PresenceMonitor', () => {
  let dbConn: DatabaseConnection;
  let settings: SettingsRepository;
  let idle: number;
  let monitor: PresenceMonitor;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at(16, 9));
    dbConn = new DatabaseConnection(':memory:');
    settings = new SettingsRepository(dbConn);
    idle = 0;
    monitor = new PresenceMonitor(settings, () => idle);
  });

  afterEach(() => {
    dbConn.close();
    vi.useRealTimers();
  });

  it('Record_StoresTheLastInputNotNow', () => {
    idle = 600;

    monitor.record();

    expect(monitor.lastPresence()).toBe(at(16, 8, 50));
  });

  it('Record_LessThanAStepLater_DoesNotWrite', () => {
    monitor.record();
    vi.setSystemTime(at(16, 9) + 30_000);

    monitor.record();

    expect(monitor.lastPresence()).toBe(at(16, 9));
  });

  it('Record_ABarPress_IsThePresence', () => {
    idle = 3600;

    monitor.record(at(16, 9));

    expect(monitor.lastPresence()).toBe(at(16, 9));
  });

  it('IsPresent_IdleReadFails_TakesTheUserAsHere', () => {
    idle = NaN;

    expect(monitor.isPresent()).toBe(true);
  });

  it('LastPresence_GarbageStored_IsUnknown', () => {
    settings.setSetting(LAST_PRESENCE_KEY, 'not a date');

    expect(monitor.lastPresence()).toBeNull();
  });

  it('Constructor_NullArguments_Throw', () => {
    expect(() => new PresenceMonitor(null as never, () => 0)).toThrow(/settings/);
    expect(() => new PresenceMonitor(settings, null as never)).toThrow(/getIdleSeconds/);
  });
});

describe('the shared arithmetic', () => {
  it('WorkedSecondsUntil_EndBeforeStart_IsZero', () => {
    expect(workedSecondsUntil(iso(at(16, 10)), iso(at(16, 9)), [])).toBe(0);
  });

  it('WorkedSecondsUntil_PauseEndingBeforeItBegan_GivesTheJumpBack', () => {
    const pauses = [{ fromUtc: iso(at(16, 10)), toUtc: iso(at(16, 9, 30)) }];

    expect(workedSecondsUntil(iso(at(16, 9)), iso(at(16, 10, 30)), pauses)).toBe(2 * 3600);
  });

  it('WorkedSecondsUntil_OverlappingPause_SubtractsOnlyTheOverlap', () => {
    const pauses = [{ fromUtc: iso(at(16, 8)), toUtc: iso(at(16, 10)) }];

    expect(workedSecondsUntil(iso(at(16, 9)), iso(at(16, 12)), pauses)).toBe(2 * 3600);
  });

  it('AtLocalTime_ThatDayAtTheHour', () => {
    expect(atLocalTime(new Date(at(16, 22, 15)), '17:30').getTime()).toBe(at(16, 17, 30));
  });

  it('AtLocalTime_NotAnHour_Throws', () => {
    expect(() => atLocalTime(new Date(), '25:00')).toThrow(/HH:MM/);
  });
});
