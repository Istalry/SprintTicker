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
import type { DisplayRenderer } from '../src/main/hardware/display-renderer';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import { IPCChannel } from '../src/shared/ipc-channels';
import { ProjectDTO, TaskDTO } from '../src/shared/dtos';

/**
 * Lunch and Away pause the task (redesign P8b, D1) and never undo what the
 * user does.
 *
 * Lunch pauses the running session when it starts and asks "Back at your
 * desk?" when it ends: Resume, I worked through it, or Not now. The question
 * is kept in the database, so a restart of the app asks it still; the user
 * resuming, stopping or starting a task during lunch answers it, and skips
 * lunch for the day.
 *
 * Real engine, real priority engine, real settings, on a database in memory;
 * only the renderer is a stand-in, and the clock is faked.
 */
describe('Lunch pauses the task; Away keeps it timing', () => {
  let dbConn: DatabaseConnection;
  let settings: SettingsRepository;
  let engine: TimeTrackingEngine;
  let priority: PriorityPreemptionEngine;
  let renderer: { setContextMode: ReturnType<typeof vi.fn>; renderResumePrompt: ReturnType<typeof vi.fn> };
  let send: ReturnType<typeof vi.fn>;
  let service: ContextScheduleService;
  let remoteTasks: TaskDTO[];
  let statusPushes: Array<[string, string]>;

  const PROJECT: ProjectDTO = { id: '10000', key: 'SCRUM', name: 'My Software Team' };
  const A: TaskDTO = { id: '10001', projectId: '10000', key: 'SCRUM-2', title: 'Tache 2', status: 'todo' };
  const B: TaskDTO = { id: '10002', projectId: '10000', key: 'SCRUM-3', title: 'Tache 3', status: 'todo' };

  /** 14 October 2026, local time. Lunch is 12:30 to 13:30. */
  const at = (hours: number, minutes: number, day = 14) => vi.setSystemTime(new Date(2026, 9, day, hours, minutes, 0));
  const check = (hours: number, minutes: number) => {
    at(hours, minutes);
    service.evaluateSchedule();
  };
  const sync = () => engine.getSyncWorker().syncTasksAndProjects();
  const startA = () => engine.startTask(A.id, false, A.title, A.projectId, A.key);
  const createService = () =>
    new ContextScheduleService(
      priority,
      settings,
      engine,
      renderer as unknown as DisplayRenderer,
      () => ({ isDestroyed: () => false, webContents: { send } }) as unknown as BrowserWindow
    );
  /** Closing the app and opening it again: the database survives, the rest starts afresh. */
  const restart = () => {
    service.dispose();
    priority = new PriorityPreemptionEngine(settings);
    service = createService();
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    at(9, 0);
    dbConn = new DatabaseConnection(':memory:');
    settings = new SettingsRepository(dbConn);
    settings.setSetting('schedule_settings', {
      enableStandupPrompt: false, lunchStartTime: '12:30', lunchEndTime: '13:30', eodWrapUpTime: '23:00'
    });
    remoteTasks = [A, B];
    statusPushes = [];
    const manager = {
      getActiveProvider: () => ({ providerId: 'jira', minimumLoggableSeconds: 60 }),
      getProjects: async () => [PROJECT],
      getTasks: async () => remoteTasks,
      updateTaskStatus: async (taskId: string, status: string) => {
        statusPushes.push([taskId, status]);
        return true;
      },
      logTimeForProvider: () => new Promise(() => undefined)
    } as unknown as ProviderManager;
    const taskRepo = new TaskRepository(dbConn);
    engine = new TimeTrackingEngine(
      new SessionRepository(dbConn), new WorklogRepository(dbConn), taskRepo, manager, new ProjectRepository(dbConn)
    );
    await sync();
    priority = new PriorityPreemptionEngine(settings);
    renderer = { setContextMode: vi.fn(), renderResumePrompt: vi.fn() };
    send = vi.fn();
    service = createService();
    service.evaluateSchedule(); // the first check, at 09:00
  });

  afterEach(() => {
    service.dispose();
    engine.dispose();
    dbConn.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const open = () => engine.getCurrentSession();
  const worklogs = () => new WorklogRepository(dbConn).getWorklogsByDate('2026-10-14');
  /** A paused session, waiting on "Back at your desk?" since the break ended. */
  const heldPrompt = (after: 'lunch' | 'away' = 'lunch', breakEndedAtUtc: unknown = expect.any(String)) =>
    ({ taskKey: A.key, taskTitle: A.title, after, held: true, breakEndedAtUtc });
  const iso = (hours: number, minutes: number) => new Date(2026, 9, 14, hours, minutes, 0).toISOString();

  describe('the plain day', () => {
    it('EvaluateSchedule_LunchStarts_PausesTheTask_LogsNothing', () => {
      startA();

      check(12, 45);

      expect(priority.getUserMode()).toBe('LUNCH');
      expect(open()).toMatchObject({ taskId: A.id, status: 'PAUSED' });
      expect(engine.openPauseReason()).toBe('lunch');
      expect(worklogs()).toEqual([]);
    });

    it('EvaluateSchedule_LunchEnds_AsksBackAtYourDesk_NothingResumesAlone', () => {
      startA();
      check(12, 45);

      check(13, 31);

      expect(priority.getUserMode()).toBe('WORK');
      expect(open()).toMatchObject({ taskId: A.id, status: 'PAUSED' });
      expect(service.getResumePrompt()).toEqual(heldPrompt('lunch', iso(13, 31)));
      expect(send).toHaveBeenCalledWith(IPCChannel.ON_RESUME_PROMPT, heldPrompt('lunch', iso(13, 31)));
      expect(renderer.renderResumePrompt).toHaveBeenCalledWith('lunch', A.key, true);
    });

    it('Resume_AnsweredLate_TimesFromLunchsEnd_NotFromTheAnswer', () => {
      // The user's choice (2026-11-17): back at 13:30, answering at 13:50,
      // the twenty minutes the question waited are work.
      startA();
      check(12, 30);
      check(13, 30);

      at(13, 50);
      service.answerResumePrompt(true);
      at(15, 0);
      engine.stopSession('Done for today');

      const pieces = worklogs().map(w => w.durationSeconds).sort((a, b) => b - a);
      expect(pieces).toEqual([3.5 * 3600, 1.5 * 3600]);
    });

    it('Resume_AfterARestartBeforeTheAnswer_StillTimesFromLunchsEnd', () => {
      startA();
      check(12, 30);
      check(13, 30);
      at(13, 40);
      restart();

      check(13, 41);
      expect(service.getResumePrompt()).toEqual(heldPrompt('lunch', iso(13, 30)));
      service.answerResumePrompt(true);
      at(15, 0);
      engine.stopSession('Done for today');

      const pieces = worklogs().map(w => w.durationSeconds).sort((a, b) => b - a);
      expect(pieces).toEqual([3.5 * 3600, 1.5 * 3600]);
    });

    it('ResumeSession_FromAnInstant_NeverInTheFutureNorBeforeThePause', () => {
      startA();
      check(12, 30);

      at(13, 0);
      expect(() => engine.resumeSession(iso(13, 5))).toThrow(/up to now/);
      expect(() => engine.resumeSession('not a time')).toThrow(/up to now/);
      engine.resumeSession(iso(12, 0));
      at(14, 0);
      engine.stopSession('Done');

      // Resumed "at noon" during a pause begun at 12:30: no pause at all.
      expect(worklogs().map(w => w.durationSeconds)).toEqual([5 * 3600]);
    });

    it('Resume_TheMorningAndTheAfternoon_TwoEntries_TheLunchHourNotWork', () => {
      // D1: one session, split at the stop at the lunch pause -- the
      // provider gets 09:00-12:30 and 13:31-15:00, as when lunch stopped it.
      startA();
      check(12, 30);
      check(13, 31);
      service.answerResumePrompt(true);
      expect(open()?.status).toBe('TRACKING');

      at(15, 0);
      engine.stopSession('Done for today');

      const pieces = worklogs().map(w => w.durationSeconds).sort((a, b) => b - a);
      expect(pieces).toEqual([3.5 * 3600, 89 * 60]);
    });

    it('IWorkedThroughIt_TakesThePauseBack_OneEntry', () => {
      startA();
      check(12, 30);
      check(13, 30);

      service.answerResumePrompt(true, 0, true);
      at(14, 0);
      engine.stopSession('Done');

      expect(worklogs().map(w => w.durationSeconds)).toEqual([5 * 3600]);
    });

    it('NotNow_LeavesItPaused_AndNothingAsksAgain', () => {
      startA();
      check(12, 45);
      check(13, 31);

      service.answerResumePrompt(false);
      check(13, 40);

      expect(open()).toMatchObject({ taskId: A.id, status: 'PAUSED' });
      expect(service.getResumePrompt()).toBeNull();
      expect(renderer.renderResumePrompt).toHaveBeenCalledTimes(1);
    });

    it('EvaluateSchedule_ATickBeforeTheCheck_LunchStillPauses', () => {
      // The engine tells its listeners every second while a session runs, and
      // the check runs every 30: a tick in the first seconds of lunch was
      // read as the user starting work, and lunch was skipped for the day.
      // Found on the real bar on 2026-10-15.
      startA();
      at(12, 30);
      vi.advanceTimersByTime(1000);

      service.evaluateSchedule();

      expect(priority.getUserMode()).toBe('LUNCH');
      expect(open()?.status).toBe('PAUSED');
      expect(settings.getSetting(ContextScheduleService.LUNCH_SKIPPED_KEY, null)).toBeNull();
    });

    it('PausedBeforeLunch_LunchLeavesItAndAsksNothing', () => {
      // The user's own pause is not lunch's to end.
      startA();
      engine.pauseSession();
      check(12, 45);
      check(13, 31);

      expect(engine.openPauseReason()).toBe('user');
      expect(service.getResumePrompt()).toBeNull();
    });
  });

  describe('a restart of the app', () => {
    it('Restart_DuringLunch_StillAsksAtTheEnd', () => {
      startA();
      check(12, 45);
      restart();

      check(12, 50);
      expect(priority.getUserMode()).toBe('LUNCH');
      check(13, 31);

      expect(service.getResumePrompt()).toEqual(heldPrompt());
    });

    it('Restart_AfterLunchEnded_TheFirstCheckAsks', () => {
      startA();
      check(12, 45);
      restart();

      check(14, 0);

      expect(service.getResumePrompt()).toEqual(heldPrompt());
    });

    it('Restart_NextDay_YesterdaysQuestionIsDropped_TheSessionStaysPaused', () => {
      startA();
      check(12, 45);
      restart();

      at(14, 0, 15);
      service.evaluateSchedule();

      expect(service.getResumePrompt()).toBeNull();
      expect(open()?.status).toBe('PAUSED');
      expect(settings.getSetting(ContextScheduleService.LUNCH_RESUME_KEY, 'unset')).toBeNull();
    });
  });

  describe('Away', () => {
    // The user's rule (2026-11-17): "I should be able to make me a coffee or
    // go to the toilet without the task being paused."
    const awaySpans = () => {
      const told: Array<{ sessionId: string; taskKey: string; fromUtc: string; toUtc: string }> = [];
      service.onAwayEnded(span => told.push(span));
      return told;
    };
    const utc = (hours: number, minutes: number) => new Date(2026, 9, 14, hours, minutes, 0).toISOString();

    it('EnterAwayMode_KeepsTheTaskTiming_BackTellsTheAbsence', () => {
      const told = awaySpans();
      startA();
      at(15, 0);

      service.enterAwayMode();
      expect(open()?.status).toBe('TRACKING');
      expect(priority.getUserMode()).toBe('AWAY');

      at(15, 20);
      service.exitAwayMode();

      expect(priority.getUserMode()).toBe('WORK');
      expect(open()?.status).toBe('TRACKING');
      expect(service.getResumePrompt()).toBeNull();
      expect(told).toEqual([{ sessionId: open()!.sessionId, taskKey: A.key, fromUtc: utc(15, 0), toUtc: utc(15, 20) }]);
    });

    it('EnterAwayMode_Twice_TheAbsenceRunsFromTheFirst', () => {
      // Windows sends lock-screen and suspend for one absence.
      const told = awaySpans();
      startA();
      at(15, 0);
      service.enterAwayMode();
      at(15, 5);
      service.enterAwayMode();
      at(15, 30);

      service.exitAwayMode();

      expect(told.map(s => s.fromUtc)).toEqual([utc(15, 0)]);
    });

    it('ChooseMode_AwayThenWork_TellsTheAbsence', () => {
      // The mode chip's way back is WORK, not an unlock.
      const told = awaySpans();
      startA();
      at(15, 0);
      service.chooseMode('AWAY');
      expect(open()?.status).toBe('TRACKING');
      at(15, 40);

      service.chooseMode('WORK');

      expect(told.map(s => [s.fromUtc, s.toUtc])).toEqual([[utc(15, 0), utc(15, 40)]]);
    });

    it('ExitAwayMode_TaskStoppedMeanwhile_TellsNothing', () => {
      // Stopped from the deck while locked: no time left to ask about.
      const told = awaySpans();
      startA();
      service.enterAwayMode();
      engine.stopSession();

      service.exitAwayMode();

      expect(told).toEqual([]);
    });

    it('ExitAwayMode_NothingTimingWhenItBegan_TellsNothing', () => {
      const told = awaySpans();
      service.enterAwayMode();
      startA();

      service.exitAwayMode();

      expect(told).toEqual([]);
    });

    it('EnterAwayMode_DuringAnInterruption_LeavesItRunning', () => {
      // A call goes on away from the desk.
      startA();
      engine.startInterruption(new Date(), 'window');

      service.enterAwayMode();

      expect(open()?.interruption).toBeDefined();
      expect(open()?.status).toBe('TRACKING');
    });

    it('ExitAwayMode_AfterLunchEnded_AsksAboutTheTaskThen', () => {
      startA();
      check(12, 45);
      service.enterAwayMode();
      check(13, 31);
      expect(service.getResumePrompt()).toBeNull();

      service.exitAwayMode();

      expect(service.getResumePrompt()).toEqual(heldPrompt());
    });

    it('LockedWhenLunchStarts_LunchPausesIt_AndAsksAfter', () => {
      startA();
      at(12, 20);
      service.enterAwayMode();

      check(12, 31);

      expect(open()?.status).toBe('PAUSED');
      expect(priority.getUserMode()).toBe('AWAY');
      at(13, 40);
      service.exitAwayMode();
      // Back at 13:40, past lunch's end: the break ends at the return, and
      // the locked ten minutes after lunch are not the task's.
      expect(service.getResumePrompt()).toEqual(heldPrompt('lunch', iso(13, 40)));
    });

    it('ExitAwayMode_DuringLunch_ShowsLunchStraightAway', () => {
      // WORK first and LUNCH at the next check drew the screen twice.
      startA();
      at(12, 20);
      service.enterAwayMode();
      check(12, 31);
      renderer.setContextMode.mockClear();

      at(12, 50);
      service.exitAwayMode();

      expect(priority.getUserMode()).toBe('LUNCH');
      expect(renderer.setContextMode.mock.calls).toEqual([['LUNCH']]);
      expect(service.getResumePrompt()).toBeNull();
    });

    it('ExitAwayMode_DuringALunchWorkedThrough_GoesBackToWorkStillTiming', () => {
      const told = awaySpans();
      check(12, 35);
      startA();
      at(12, 40);
      service.enterAwayMode();
      check(12, 41);
      at(12, 50);

      service.exitAwayMode();

      expect(priority.getUserMode()).toBe('WORK');
      expect(open()?.status).toBe('TRACKING');
      expect(service.getResumePrompt()).toBeNull();
      expect(told.map(s => s.fromUtc)).toEqual([utc(12, 40)]);
    });

    it('LockedWhenLunchStarts_LunchPausedIt_TellsNoAbsence', () => {
      // Lunch's own question is about that task; nothing is asked twice.
      const told = awaySpans();
      startA();
      at(12, 20);
      service.enterAwayMode();
      check(12, 31);
      at(13, 40);

      service.exitAwayMode();

      expect(told).toEqual([]);
    });
  });

  describe('working through lunch', () => {
    it('StartTask_DuringLunch_LeavesLunchAtOnce', () => {
      // The sandwich stayed over the running session.
      check(12, 45);

      engine.startTask(B.id, false, B.title, B.projectId, B.key);

      expect(priority.getUserMode()).toBe('WORK');
      expect(renderer.setContextMode).toHaveBeenLastCalledWith('WORK');
    });

    it('StartTask_DuringLunch_TheNextCheckDoesNotPauseIt', () => {
      check(12, 45);
      engine.startTask(B.id, false, B.title, B.projectId, B.key);

      check(12, 46);

      expect(priority.getUserMode()).toBe('WORK');
      expect(open()).toMatchObject({ taskId: B.id, status: 'TRACKING' });
    });

    it('SwitchTask_DuringLunch_NothingAskedAtTheEnd', () => {
      startA();
      check(12, 45);
      engine.startTask(B.id, false, B.title, B.projectId, B.key);

      check(13, 31);

      expect(open()).toMatchObject({ taskId: B.id, status: 'TRACKING' });
      expect(service.getResumePrompt()).toBeNull();
    });

    it('ResumeTheLunchPause_DuringLunch_LeavesLunch_NothingAskedAtTheEnd', () => {
      startA();
      check(12, 45);
      const sessionId = open()?.sessionId;

      engine.resumeSession();
      expect(priority.getUserMode()).toBe('WORK');
      check(13, 0);
      check(13, 31);

      expect(open()).toMatchObject({ sessionId, status: 'TRACKING' });
      expect(service.getResumePrompt()).toBeNull();
    });

    it('StopTheLunchPausedTask_DuringLunch_NothingAskedAtTheEnd', () => {
      startA();
      check(12, 45);
      engine.stopSession('Done before lunch');

      check(13, 31);

      expect(open()).toBeNull();
      expect(service.getResumePrompt()).toBeNull();
    });

    it('StartTask_DuringLunchHoursAfterAwayEnded_TheNextCheckDoesNotPauseIt', () => {
      check(12, 35);
      service.enterAwayMode();
      at(12, 50);
      service.exitAwayMode();
      engine.startTask(B.id, false, B.title, B.projectId, B.key);

      check(12, 51);

      expect(open()).toMatchObject({ taskId: B.id, status: 'TRACKING' });
    });

    it('StartTask_OutsideLunch_ChangesNothing', () => {
      check(11, 0);

      startA();

      expect(settings.getSetting(ContextScheduleService.LUNCH_SKIPPED_KEY, null)).toBeNull();
    });

    it('WorkingThroughLunch_TheNextDay_LunchStartsAgain', () => {
      check(12, 45);
      engine.startTask(B.id, false, B.title, B.projectId, B.key);
      engine.stopSession('Done');

      at(12, 45, 15);
      service.evaluateSchedule();

      expect(priority.getUserMode()).toBe('LUNCH');
    });
  });

  describe('a task that left the list over the break', () => {
    /** Lunch pauses A; the provider stops listing A; lunch ends. */
    const reassignOverLunch = async () => {
      startA();
      check(12, 45);
      remoteTasks = [B];
      await sync();
      check(13, 31);
    };

    it('LunchEnds_TaskNoLongerListed_SaysSoInTheQuestion', async () => {
      await reassignOverLunch();

      expect(service.getResumePrompt()).toEqual({ ...heldPrompt(), unlisted: true });
    });

    it('LunchEnds_AsksOnlyOnceAcrossChecks', async () => {
      await reassignOverLunch();

      check(13, 32);
      check(13, 33);

      expect(renderer.renderResumePrompt).toHaveBeenCalledTimes(1);
    });

    it('AnswerResumePrompt_Yes_ResumesItWithoutTakingItBack', async () => {
      // The sync left it unlisted over lunch; resuming moves nothing at the
      // provider -- a task now someone else's.
      await reassignOverLunch();
      statusPushes = [];

      expect(service.answerResumePrompt(true)).toBe(true);

      expect(open()).toMatchObject({ taskId: A.id, status: 'TRACKING', taskUnlisted: true });
      expect(statusPushes).toEqual([]);
      expect(service.getResumePrompt()).toBeNull();
      expect(send).toHaveBeenLastCalledWith(IPCChannel.ON_RESUME_PROMPT, null);
    });

    it('AnswerResumePrompt_Twice_TheSecondAnswerFindsNothing', async () => {
      // The bar and the window both ask; the slower answer is a no-op.
      await reassignOverLunch();
      service.answerResumePrompt(false);

      expect(service.answerResumePrompt(true)).toBe(false);
      expect(open()?.status).toBe('PAUSED');
    });

    it('Restart_WhileAsking_AsksAgain', async () => {
      await reassignOverLunch();

      restart();
      check(13, 40);

      expect(service.getResumePrompt()).toEqual({ ...heldPrompt(), unlisted: true });
    });

    it('StartAnotherTask_WhileAsking_ClosesTheQuestion', async () => {
      await reassignOverLunch();

      engine.startTask(B.id, false, B.title, B.projectId, B.key);

      expect(service.getResumePrompt()).toBeNull();
      expect(send).toHaveBeenLastCalledWith(IPCChannel.ON_RESUME_PROMPT, null);
      restart();
      check(13, 40);
      expect(open()?.taskId).toBe(B.id);
    });
  });

  it('LegacyStoppedResume_FromAnEarlierVersion_StillRestartsTheTask', () => {
    // Stored by a version where lunch stopped the session: no held session.
    settings.setSetting(ContextScheduleService.LUNCH_RESUME_KEY, {
      taskId: A.id, isAdHoc: false, customTitle: A.title, projectId: A.projectId, taskKey: A.key, dateKey: '2026-10-14'
    });

    check(13, 31);

    expect(open()).toMatchObject({ taskId: A.id, status: 'TRACKING' });
  });

  it('EvaluateSchedule_ACorruptStoredResume_IsDroppedRatherThanStarted', () => {
    settings.setSetting(ContextScheduleService.LUNCH_RESUME_KEY, { taskId: 42 });

    check(14, 0);

    expect(open()).toBeNull();
    expect(settings.getSetting(ContextScheduleService.LUNCH_RESUME_KEY, 'unset')).toBeNull();
  });
});
