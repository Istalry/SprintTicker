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
import { DAILY_STANDUP_TITLE } from '../src/shared/schedule-defaults';
import { ProjectDTO, TaskDTO } from '../src/shared/dtos';

/**
 * Joining the stand-up switches the timer to the Daily Standup task and
 * brings the task before it back when the stand-up ends -- by the lunch
 * rules: once, the same day, never over what the user started themselves,
 * and asking first about a task that has left their lists.
 *
 * It used to change nothing: the prompt said the current task "will keep
 * tracking normally", so the meeting was logged against whatever was open.
 *
 * Real engine, priority engine and settings on a database in memory; only
 * the renderer is a stand-in, and the clock is faked.
 */
describe('Joining the stand-up', () => {
  let dbConn: DatabaseConnection;
  let settings: SettingsRepository;
  let tasks: TaskRepository;
  let worklogs: WorklogRepository;
  let engine: TimeTrackingEngine;
  let priority: PriorityPreemptionEngine;
  let renderer: { setContextMode: ReturnType<typeof vi.fn>; renderResumePrompt: ReturnType<typeof vi.fn> };
  let send: ReturnType<typeof vi.fn>;
  let service: ContextScheduleService;
  let remoteTasks: TaskDTO[];

  const PROJECT: ProjectDTO = { id: '10000', key: 'SCRUM', name: 'My Software Team' };
  const A: TaskDTO = { id: '10001', projectId: '10000', key: 'SCRUM-2', title: 'Tache 2', status: 'todo' };
  const B: TaskDTO = { id: '10002', projectId: '10000', key: 'SCRUM-3', title: 'Tache 3', status: 'todo' };

  /** 14 October 2026, local time. The stand-up is at 09:30, lunch 12:30 to 13:30. */
  const at = (hours: number, minutes: number, day = 14) => vi.setSystemTime(new Date(2026, 9, day, hours, minutes, 0));
  const sync = () => engine.getSyncWorker().syncTasksAndProjects();
  const startA = () => engine.startTask(A.id, false, A.title, A.projectId, A.key);
  const session = () => engine.getCurrentSession();
  /** The restart waits until every listener has heard the stand-up end. */
  const settle = () => Promise.resolve();
  const createService = () =>
    new ContextScheduleService(
      priority,
      settings,
      engine,
      renderer as unknown as DisplayRenderer,
      () => ({ isDestroyed: () => false, webContents: { send } }) as unknown as BrowserWindow
    );
  const restart = () => {
    service.dispose();
    priority = new PriorityPreemptionEngine(settings);
    service = createService();
  };
  /** Working on A, then the stand-up from 09:30 to 09:45. */
  const standupOverA = () => {
    at(9, 0);
    startA();
    at(9, 30);
    service.joinStandup();
    at(9, 45);
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
    tasks = new TaskRepository(dbConn);
    worklogs = new WorklogRepository(dbConn);
    engine = new TimeTrackingEngine(new SessionRepository(dbConn), worklogs, tasks, manager, new ProjectRepository(dbConn));
    await sync();
    priority = new PriorityPreemptionEngine(settings);
    renderer = { setContextMode: vi.fn(), renderResumePrompt: vi.fn() };
    send = vi.fn();
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

  describe('the switch', () => {
    it('JoinStandup_WhileTracking_SwitchesTheTimerToTheStandup', () => {
      standupOverA();

      expect(session()).toMatchObject({ taskTitle: DAILY_STANDUP_TITLE, isAdHoc: true, status: 'TRACKING' });
      // The half hour before goes to A, where it was spent.
      expect(worklogs.getWorklogsByDate('2026-10-14').map(w => [w.taskId, w.durationSeconds])).toEqual([[A.id, 30 * 60]]);
    });

    it('JoinStandup_FromThePrompt_ReleasesItsLock', () => {
      priority.evaluateRequest('standupPromptPriority', undefined, () => undefined);
      startA();

      service.joinStandup();

      expect(priority.getActiveLockEventName()).not.toBe('standupPromptPriority');
    });

    it('JoinStandup_NothingRunning_StartsTheStandupAndRestartsNothingAfter', async () => {
      service.joinStandup();
      engine.stopSession('Stand-up over');
      await settle();

      expect(session()).toBeNull();
    });

    it('JoinStandup_AlreadyInIt_ChangesNothing', () => {
      standupOverA();
      const standup = session()!.sessionId;

      service.joinStandup();

      expect(session()!.sessionId).toBe(standup);
    });

    it('JoinStandup_EveryMorning_ReusesOneTask', async () => {
      standupOverA();
      const first = session()!.taskId;
      engine.stopSession('Stand-up over');
      await settle();
      engine.stopSession('Day over');

      at(9, 30, 15);
      service.joinStandup();

      expect(session()!.taskId).toBe(first);
      const rows = dbConn.getDb().prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM tasks WHERE title = ?').get(DAILY_STANDUP_TITLE);
      expect(rows?.n).toBe(1);
    });
  });

  describe('when it ends', () => {
    it.each([
      ['stopped', () => engine.stopSession('Stand-up over')],
      ['finished', () => engine.stopSession('Stand-up over', true)],
      ['discarded', () => engine.discardSession()]
    ])('StandupEnds_%s_RestartsTheTaskBefore', async (_how, end) => {
      standupOverA();

      end();
      await settle();

      expect(session()).toMatchObject({ taskId: A.id, taskKey: A.key, status: 'TRACKING' });
    });

    it('StandupEnds_RestartsItOnlyOnce', async () => {
      standupOverA();
      engine.stopSession('Stand-up over');
      await settle();

      engine.stopSession('Back to work, then done');
      await settle();

      expect(session()).toBeNull();
    });

    it('StandupPaused_RestartsNothing', async () => {
      // A pause is not the end of the meeting.
      standupOverA();

      engine.pauseSession();
      await settle();

      expect(session()).toMatchObject({ taskTitle: DAILY_STANDUP_TITLE, status: 'PAUSED' });
    });

    it('UserStartsAnotherTask_NothingComesBack', async () => {
      // Their choice wins: B now, and A does not return when B stops.
      standupOverA();
      engine.startTask(B.id, false, B.title, B.projectId, B.key);
      await settle();

      engine.stopSession('B done');
      await settle();

      expect(session()).toBeNull();
    });

    it('StandupEndsTheNextDay_RestartsNothing', async () => {
      // Left running overnight: yesterday's task is not today's.
      standupOverA();
      at(9, 0, 15);

      engine.stopSession('Forgotten');
      await settle();

      expect(session()).toBeNull();
    });

    it('StandupEnds_TaskLeftTheListMeanwhile_AsksFirst', async () => {
      standupOverA();
      remoteTasks = [B];
      await sync();

      engine.stopSession('Stand-up over');
      await settle();

      expect(session()).toBeNull();
      expect(renderer.renderResumePrompt).toHaveBeenCalledWith('standup');
      expect(service.getResumePrompt()).toEqual({ taskKey: A.key, taskTitle: A.title, after: 'standup' });
      expect(send).toHaveBeenCalledWith(IPCChannel.ON_RESUME_PROMPT, { taskKey: A.key, taskTitle: A.title, after: 'standup' });
    });

    it('StandupEnds_TaskLeftTheList_AYesResumesIt', async () => {
      standupOverA();
      remoteTasks = [B];
      await sync();
      engine.stopSession('Stand-up over');
      await settle();

      service.answerResumePrompt(true);

      expect(session()).toMatchObject({ taskId: A.id, status: 'TRACKING', taskUnlisted: true });
    });
  });

  describe('lunch in the middle of it', () => {
    it('LunchStopsTheStandup_LunchEnds_TheTaskBeforeComesBackNotTheMeeting', async () => {
      // Lunch keeps what it stopped to restart, which here is the meeting.
      at(12, 0);
      startA();
      at(12, 20);
      service.joinStandup();

      at(12, 31);
      service.evaluateSchedule();
      await settle();
      expect(session()).toBeNull();

      at(13, 31);
      service.evaluateSchedule();

      expect(session()).toMatchObject({ taskId: A.id, status: 'TRACKING' });
    });
  });

  describe('a restart of the app', () => {
    it('Restart_DuringTheStandup_TheTaskStillComesBackAtTheEnd', async () => {
      standupOverA();

      restart();
      engine.stopSession('Stand-up over');
      await settle();

      expect(session()).toMatchObject({ taskId: A.id, status: 'TRACKING' });
    });

    it('Restart_AfterTheStandupEndedWhileClosed_RestartsNothing', async () => {
      // The meeting ended with the app closed -- a crash, a forgotten night.
      // Nothing restarts behind the user's back at the next start.
      standupOverA();
      service.dispose();
      settings.setSetting('standup_resume', { ...settings.getSetting<object>('standup_resume', {}), standupSessionId: 'sess_gone' });

      service = createService();

      expect(settings.getSetting('standup_resume', 'unset')).toBeNull();
    });
  });
});
