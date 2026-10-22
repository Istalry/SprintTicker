import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import type { ActiveSessionDTO } from '../src/shared/dtos';

/**
 * A session ends as one worklog per stretch of work: a new one at each local
 * midnight and after each pause of the user's threshold. Before, it was one
 * worklog filed under the day it began, so 23:00 to 01:00 put two hours on
 * Friday and none on Saturday.
 *
 * Paris time; October 2026, the clocks going back on Sunday 25.
 */
describe('Splitting a session into worklogs', () => {
  const originalTz = process.env.TZ;
  let dbConn: DatabaseConnection;
  let worklogRepo: WorklogRepository;
  let taskRepo: TaskRepository;
  let projectRepo: ProjectRepository;
  let engine: TimeTrackingEngine;
  let splitPauseMinutes: number;
  let minimumSeconds: number;

  const H = 3600;
  const at = (day: number, hours: number, minutes = 0, seconds = 0) => new Date(2026, 9, day, hours, minutes, seconds);
  const iso = (day: number, hours: number, minutes = 0) => at(day, hours, minutes).toISOString();
  const now = (day: number, hours: number, minutes = 0, seconds = 0) => vi.setSystemTime(at(day, hours, minutes, seconds));
  const logged = (dateKey: string) =>
    worklogRepo.getWorklogsByDate(dateKey).map(w => ({ startedAtUtc: w.startedAtUtc, durationSeconds: w.durationSeconds }));
  const queued = () => worklogRepo.getSyncQueueSnapshot().items;
  const start = () => engine.startTask('OP-1');

  beforeEach(() => {
    process.env.TZ = 'Europe/Paris';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    now(16, 9);
    splitPauseMinutes = 15;
    minimumSeconds = 1;
    dbConn = new DatabaseConnection(':memory:');
    worklogRepo = new WorklogRepository(dbConn);
    taskRepo = new TaskRepository(dbConn);
    projectRepo = new ProjectRepository(dbConn);
    const provider = { get providerId() { return 'openproject'; }, get minimumLoggableSeconds() { return minimumSeconds; } };
    const manager = {
      getActiveProvider: () => provider,
      getProvider: () => provider,
      updateTaskStatus: async () => true,
      updateTaskStatusFor: async () => true,
      // Never answers: the rows stay pending, where the test reads them.
      logTimeForProvider: () => new Promise(() => undefined)
    } as unknown as ProviderManager;
    engine = new TimeTrackingEngine(
      new SessionRepository(dbConn),
      worklogRepo,
      taskRepo,
      manager,
      projectRepo,
      () => splitPauseMinutes * 60
    );
    projectRepo.saveProject({ id: 'OP', key: 'OP', name: 'OP', providerId: 'openproject' });
    taskRepo.saveTask({ id: 'OP-1', projectId: 'OP', key: 'OP-1', title: 'Ship it', status: 'todo' });
  });

  afterEach(() => {
    engine.dispose();
    dbConn.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
    process.env.TZ = originalTz;
  });

  it('StopSession_From2300To0100_OneWorklogOnEachDay', () => {
    now(16, 23);
    start();
    now(17, 1);

    const result = engine.stopSession('Late fix');

    expect(result).toEqual({ success: true, loggedSeconds: 2 * H });
    expect(logged('2026-10-16')).toEqual([{ startedAtUtc: iso(16, 23), durationSeconds: H }]);
    expect(logged('2026-10-17')).toEqual([{ startedAtUtc: iso(17, 0), durationSeconds: H }]);
  });

  it('StopSession_AcrossMidnight_EachWorklogIsItsOwnRowInTheQueue', () => {
    // Each its own marker: a resend looks for that piece, and a correction
    // names the entry it corrects.
    now(16, 23);
    start();
    now(17, 1);

    engine.stopSession('Late fix');

    const rows = queued();
    expect(rows.map(r => [r.startedAtUtc, r.durationSeconds, r.comment])).toEqual(
      expect.arrayContaining([[iso(16, 23), H, 'Late fix'], [iso(17, 0), H, 'Late fix']])
    );
    expect(rows).toHaveLength(2);
    const worklogIds = [...logged('2026-10-16'), ...logged('2026-10-17')].length;
    expect(worklogIds).toBe(2);
    for (const day of ['2026-10-16', '2026-10-17']) {
      const [worklog] = worklogRepo.getWorklogsByDate(day);
      expect(worklogRepo.getSendOf(worklog.id)?.startedAtUtc).toBe(worklog.startedAtUtc);
    }
  });

  it('StopSession_PausedOverNight_TheMorningIsOnItsOwnDay', () => {
    now(16, 17);
    start();
    now(16, 18);
    engine.pauseSession();
    now(17, 9);
    engine.resumeSession();
    now(17, 10);

    engine.stopSession();

    expect(logged('2026-10-16')).toEqual([{ startedAtUtc: iso(16, 17), durationSeconds: H }]);
    expect(logged('2026-10-17')).toEqual([{ startedAtUtc: iso(17, 9), durationSeconds: H }]);
  });

  it('StopSession_ALongPause_TwoWorklogsTheSameDay', () => {
    start();
    now(16, 10);
    engine.pauseSession();
    now(16, 10, 20);
    engine.resumeSession();
    now(16, 11);

    engine.stopSession();

    // Newest first, as Work History lists them.
    expect(logged('2026-10-16')).toEqual([
      { startedAtUtc: iso(16, 10, 20), durationSeconds: 40 * 60 },
      { startedAtUtc: iso(16, 9), durationSeconds: H }
    ]);
    expect(queued()).toHaveLength(2);
  });

  it('StopSession_AShortPause_OneWorklog', () => {
    start();
    now(16, 10);
    engine.pauseSession();
    now(16, 10, 10);
    engine.resumeSession();
    now(16, 11);

    engine.stopSession();

    expect(logged('2026-10-16')).toEqual([{ startedAtUtc: iso(16, 9), durationSeconds: 110 * 60 }]);
  });

  it('StopSession_SettingIsZero_APauseNeverSplits', () => {
    splitPauseMinutes = 0;
    start();
    now(16, 10);
    engine.pauseSession();
    now(16, 13);
    engine.resumeSession();
    now(16, 14);

    engine.stopSession();

    expect(logged('2026-10-16')).toEqual([{ startedAtUtc: iso(16, 9), durationSeconds: 2 * H }]);
  });

  it('StopSession_StoppedWhilePausedLong_TheTimeAfterThePauseIsNotThere', () => {
    // Paused at 10:00 and stopped at 11:00 from the paused menu: one stretch.
    start();
    now(16, 10);
    engine.pauseSession();
    now(16, 11);

    engine.stopSession();

    expect(logged('2026-10-16')).toEqual([{ startedAtUtc: iso(16, 9), durationSeconds: H }]);
  });

  it('StopSession_ThirtySecondsPastMidnightOnJira_FoldedIntoTheEvening', () => {
    // Jira records minutes: the 30 seconds alone would be refused, and lost.
    minimumSeconds = 60;
    now(16, 23);
    start();
    now(17, 0, 0, 30);

    engine.stopSession();

    expect(logged('2026-10-16')).toEqual([{ startedAtUtc: iso(16, 23), durationSeconds: H + 30 }]);
    expect(logged('2026-10-17')).toEqual([]);
    expect(queued()).toHaveLength(1);
  });

  it('StopSession_TheWeekendTheClocksGoBack_SundayIsTwentyFiveHours', () => {
    now(24, 23);
    start();
    now(26, 1);

    const result = engine.stopSession();

    expect(result.loggedSeconds).toBe(27 * H);
    expect(logged('2026-10-25')).toEqual([{ startedAtUtc: iso(25, 0), durationSeconds: 25 * H }]);
  });

  it('StopSessionAt_AcrossMidnight_SplitsUpToTheChosenEnd', () => {
    // A session left running: the user said they stopped at 01:00.
    now(16, 22);
    start();
    now(17, 9);

    engine.stopSessionAt(iso(17, 1));

    expect(logged('2026-10-16')).toEqual([{ startedAtUtc: iso(16, 22), durationSeconds: 2 * H }]);
    expect(logged('2026-10-17')).toEqual([{ startedAtUtc: iso(17, 0), durationSeconds: H }]);
  });

  it('StopSession_AfterAPauseSetAtTheLastActivity_TheEveningOnly', () => {
    // Left running overnight, paused retroactively at 23:30 and stopped from
    // the bar: nothing after the pause is anyone's work.
    now(16, 22);
    start();
    now(17, 9);
    engine.pauseSessionAt(iso(16, 23, 30));

    engine.stopSession();

    expect(logged('2026-10-16')).toEqual([{ startedAtUtc: iso(16, 22), durationSeconds: 1.5 * H }]);
    expect(logged('2026-10-17')).toEqual([]);
  });

  it('StopSession_AdHocAcrossMidnight_SplitLocally_NothingQueued', () => {
    now(16, 23);
    engine.startTask('', true, 'Pairing');
    now(17, 1);

    engine.stopSession();

    expect(logged('2026-10-16')).toHaveLength(1);
    expect(logged('2026-10-17')).toHaveLength(1);
    expect(queued()).toEqual([]);
  });

  it('StopSession_AcrossMidnight_ListenersHearOneEnd', () => {
    // One stop, one notification: the window and the bar draw LOGGED once,
    // however many worklogs it wrote.
    now(16, 23);
    start();
    now(17, 1);
    const heard: Array<ActiveSessionDTO | null> = [];
    engine.subscribe(session => heard.push(session));

    engine.stopSession();

    expect(heard).toEqual([null]);
  });

  it('GetSessionDays_OpenAcrossMidnight_TheTimeOfEachDay', () => {
    now(16, 23);
    start();
    now(17, 0, 30);

    expect(engine.getSessionDays()).toEqual([
      { dateKey: '2026-10-16', seconds: H },
      { dateKey: '2026-10-17', seconds: 30 * 60 }
    ]);
  });

  it('GetSessionDays_NoSession_Nothing', () => {
    expect(engine.getSessionDays()).toEqual([]);
  });
});
