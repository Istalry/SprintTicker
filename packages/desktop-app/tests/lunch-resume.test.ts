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
 * Lunch never undoes what the user does.
 *
 * It stops the running session when it starts and restarts it when it ends.
 * That restart used to live in a field, and three things went wrong with it:
 * a restart of the app during lunch forgot it; a task started or resumed
 * during lunch stayed under the lunch screen, and if the user stopped it the
 * old task came back at the end anyway; and a task reassigned over the break
 * was restarted without a word.
 *
 * Real engine, real priority engine, real settings, on a database in memory;
 * only the renderer is a stand-in, and the clock is faked.
 */
describe('Lunch and the session it stops', () => {
  let dbConn: DatabaseConnection;
  let settings: SettingsRepository;
  let engine: TimeTrackingEngine;
  let priority: PriorityPreemptionEngine;
  let renderer: { setContextMode: ReturnType<typeof vi.fn>; renderResumePrompt: ReturnType<typeof vi.fn> };
  let send: ReturnType<typeof vi.fn>;
  let service: ContextScheduleService;
  let remoteTasks: TaskDTO[];

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
    const manager = {
      getActiveProvider: () => ({ providerId: 'jira', minimumLoggableSeconds: 60 }),
      getProjects: async () => [PROJECT],
      getTasks: async () => remoteTasks,
      updateTaskStatus: async () => true,
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

  describe('the plain day', () => {
    it('EvaluateSchedule_LunchEnds_RestartsTheTaskLunchStopped', () => {
      startA();
      check(12, 45);
      expect(engine.getCurrentSession()).toBeNull();

      check(13, 31);

      expect(priority.getUserMode()).toBe('WORK');
      expect(engine.getCurrentSession()).toMatchObject({ taskId: A.id, taskKey: A.key, status: 'TRACKING' });
    });

    it('EvaluateSchedule_LunchEnds_RestartsItOnlyOnce', () => {
      startA();
      check(12, 45);
      check(13, 31);
      engine.stopSession('Done for now');

      check(13, 32);

      expect(engine.getCurrentSession()).toBeNull();
    });
  });

  describe('a restart of the app', () => {
    it('Restart_DuringLunch_TheTaskStillComesBackAtTheEnd', () => {
      // The resume was a field, and a restart during lunch forgot it.
      startA();
      check(12, 45);
      restart();

      check(12, 50); // back in LUNCH, with nothing running: the stored resume stays
      expect(priority.getUserMode()).toBe('LUNCH');
      check(13, 31);

      expect(engine.getCurrentSession()?.taskId).toBe(A.id);
    });

    it('Restart_AfterLunchEnded_TheFirstCheckRestartsIt', () => {
      startA();
      check(12, 45);
      restart();

      check(14, 0);

      expect(engine.getCurrentSession()?.taskId).toBe(A.id);
    });

    it('Restart_NextDay_YesterdaysResumeIsDropped', () => {
      startA();
      check(12, 45);
      restart();

      at(14, 0, 15);
      service.evaluateSchedule();

      expect(engine.getCurrentSession()).toBeNull();
      expect(settings.getSetting(ContextScheduleService.LUNCH_RESUME_KEY, 'unset')).toBeNull();
    });
  });

  describe('Away over the end of lunch', () => {
    it('ExitAwayMode_AfterLunchEnded_RestartsTheTaskThen', () => {
      // Locking Windows to go and eat: Away, which lunch never leaves, so the
      // restart had nobody to run it and was lost.
      startA();
      check(12, 45);
      service.enterAwayMode();
      check(13, 31);
      expect(engine.getCurrentSession()).toBeNull();

      service.exitAwayMode();
      check(13, 40);

      expect(engine.getCurrentSession()?.taskId).toBe(A.id);
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

    it('StartTask_DuringLunch_TheNextCheckDoesNotStopIt', () => {
      check(12, 45);
      engine.startTask(B.id, false, B.title, B.projectId, B.key);

      check(12, 46);

      expect(priority.getUserMode()).toBe('WORK');
      expect(engine.getCurrentSession()?.taskId).toBe(B.id);
    });

    it('SwitchTask_DuringLunch_TheNewTaskIsStillRunningAfterIt', () => {
      startA();
      check(12, 45);
      engine.startTask(B.id, false, B.title, B.projectId, B.key);

      check(13, 31);

      expect(engine.getCurrentSession()).toMatchObject({ taskId: B.id, status: 'TRACKING' });
    });

    it('StartThenStop_DuringLunch_NothingRestartsAtTheEnd', () => {
      // The old task came back at the end, over the user's own choice.
      startA();
      check(12, 45);
      engine.startTask(B.id, false, B.title, B.projectId, B.key);
      engine.stopSession('Quick fix done');

      check(13, 31);

      expect(engine.getCurrentSession()).toBeNull();
    });

    it('ResumePausedSession_DuringLunch_TheSessionIsUntouchedAfterIt', () => {
      // Paused before lunch, so lunch had nothing to stop.
      startA();
      engine.pauseSession();
      check(12, 45);
      const sessionId = engine.getCurrentSession()?.sessionId;

      engine.resumeSession();
      expect(priority.getUserMode()).toBe('WORK');
      check(13, 0);
      check(13, 31);

      expect(priority.getUserMode()).toBe('WORK');
      expect(engine.getCurrentSession()).toMatchObject({ sessionId, status: 'TRACKING' });
    });

    it('StartTask_DuringLunchHoursAfterAwayEnded_TheNextCheckDoesNotStopIt', () => {
      // Unlocked mid-lunch: WORK until the next check enters LUNCH, which
      // would stop a session started in between.
      check(12, 35);
      service.enterAwayMode();
      at(12, 50);
      service.exitAwayMode();
      engine.startTask(B.id, false, B.title, B.projectId, B.key);

      check(12, 51);

      expect(engine.getCurrentSession()).toMatchObject({ taskId: B.id, status: 'TRACKING' });
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
    /** Lunch stops A; the provider stops listing A; lunch ends. */
    const reassignOverLunch = async () => {
      startA();
      check(12, 45);
      remoteTasks = [B];
      await sync();
      check(13, 31);
    };

    it('LunchEnds_TaskNoLongerListed_AsksInsteadOfRestarting', async () => {
      await reassignOverLunch();

      expect(engine.getCurrentSession()).toBeNull();
      expect(renderer.renderResumePrompt).toHaveBeenCalledTimes(1);
      expect(service.getResumePrompt()).toEqual({ taskKey: A.key, taskTitle: A.title });
      expect(send).toHaveBeenCalledWith(IPCChannel.ON_RESUME_PROMPT, { taskKey: A.key, taskTitle: A.title });
    });

    it('LunchEnds_TaskNoLongerListed_AsksOnlyOnceAcrossChecks', async () => {
      await reassignOverLunch();

      check(13, 32);
      check(13, 33);

      expect(renderer.renderResumePrompt).toHaveBeenCalledTimes(1);
    });

    it('AnswerResumePrompt_Yes_ResumesItAndClosesTheQuestion', async () => {
      await reassignOverLunch();

      expect(service.answerResumePrompt(true)).toBe(true);

      expect(engine.getCurrentSession()).toMatchObject({ taskId: A.id, taskKey: A.key, status: 'TRACKING' });
      expect(service.getResumePrompt()).toBeNull();
      expect(send).toHaveBeenLastCalledWith(IPCChannel.ON_RESUME_PROMPT, null);
    });

    it('AnswerResumePrompt_No_LeavesItAndNothingAsksAgain', async () => {
      await reassignOverLunch();

      service.answerResumePrompt(false);
      restart();
      check(13, 40);

      expect(engine.getCurrentSession()).toBeNull();
      expect(service.getResumePrompt()).toBeNull();
    });

    it('AnswerResumePrompt_Twice_TheSecondAnswerFindsNothing', async () => {
      // The bar and the window both ask; the slower answer is a no-op.
      await reassignOverLunch();
      service.answerResumePrompt(false);

      expect(service.answerResumePrompt(true)).toBe(false);
      expect(engine.getCurrentSession()).toBeNull();
    });

    it('Restart_WhileAsking_AsksAgain', async () => {
      await reassignOverLunch();

      restart();
      check(13, 40);

      expect(service.getResumePrompt()).toEqual({ taskKey: A.key, taskTitle: A.title });
    });

    it('StartAnotherTask_WhileAsking_ClosesTheQuestion', async () => {
      await reassignOverLunch();

      engine.startTask(B.id, false, B.title, B.projectId, B.key);

      expect(service.getResumePrompt()).toBeNull();
      expect(send).toHaveBeenLastCalledWith(IPCChannel.ON_RESUME_PROMPT, null);
      restart();
      check(13, 40);
      expect(engine.getCurrentSession()?.taskId).toBe(B.id);
    });

    it('LunchEnds_AdHocTask_RestartsWithoutAsking', () => {
      // The provider never lists ad-hoc work; that is not news.
      engine.startTask('', true, 'Code review');
      check(12, 45);

      check(13, 31);

      expect(engine.getCurrentSession()).toMatchObject({ isAdHoc: true, taskTitle: 'Code review' });
      expect(renderer.renderResumePrompt).not.toHaveBeenCalled();
    });
  });

  it('EvaluateSchedule_ACorruptStoredResume_IsDroppedRatherThanStarted', () => {
    settings.setSetting(ContextScheduleService.LUNCH_RESUME_KEY, { taskId: 42 });

    check(14, 0);

    expect(engine.getCurrentSession()).toBeNull();
    expect(settings.getSetting(ContextScheduleService.LUNCH_RESUME_KEY, 'unset')).toBeNull();
  });
});
