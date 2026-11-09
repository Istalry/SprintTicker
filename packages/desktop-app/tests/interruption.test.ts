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
import { WORKLOG_COMMENTS } from '../src/shared/worklog-comments';
import { ProjectDTO, TaskDTO } from '../src/shared/dtos';

/**
 * Interrupt: a timer at once, on a new ad-hoc task named for the time it
 * started, and the task it stopped asked about when it ends -- "back to
 * SCRUM-2?". It shares the stand-up's set-aside, with one difference: the
 * stand-up restarts the task on its own, an interruption always asks.
 *
 * Real engine, priority engine and settings on a database in memory; only
 * the renderer is a stand-in, and the clock is faked.
 */
describe('Interrupt', () => {
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

  /** 14 October 2026, local time; lunch 12:30 to 13:30. */
  const at = (hours: number, minutes: number, day = 14) => vi.setSystemTime(new Date(2026, 9, day, hours, minutes, 0));
  const sync = () => engine.getSyncWorker().syncTasksAndProjects();
  const startA = () => engine.startTask(A.id, false, A.title, A.projectId, A.key);
  const session = () => engine.getCurrentSession();
  /** The question waits until every listener has heard the interruption end. */
  const settle = () => Promise.resolve();
  const createService = () =>
    new ContextScheduleService(
      priority,
      settings,
      engine,
      renderer as unknown as DisplayRenderer,
      () => ({ isDestroyed: () => false, webContents: { send } }) as unknown as BrowserWindow
    );
  /** Working on A from 10:00, interrupted at 10:30, the interruption over at 10:45. */
  const interruptA = () => {
    at(10, 0);
    startA();
    at(10, 30);
    const interruption = service.interrupt();
    at(10, 45);
    return interruption;
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

  describe('the start', () => {
    it('Interrupt_WhileTracking_StartsAnUnsortedTaskNamedForTheTime', () => {
      const interruption = interruptA();

      expect(interruption).toMatchObject({ isAdHoc: true, taskTitle: 'Interruption 10:30', status: 'TRACKING' });
      expect(tasks.getTaskById(interruption.taskId)).toMatchObject({ title: 'Interruption 10:30', unsorted: true });
      expect(tasks.getUnsortedTasks().map(t => t.id)).toEqual([interruption.taskId]);
    });

    it('Interrupt_WhileTracking_LogsTheTaskBeforeUnderItsOwnComment', () => {
      interruptA();

      expect(worklogs.getWorklogsByDate('2026-10-14').map(w => [w.taskId, w.durationSeconds, w.comment])).toEqual([
        [A.id, 30 * 60, WORKLOG_COMMENTS.INTERRUPTED]
      ]);
    });

    it('Interrupt_TwiceInADay_TwoTasksToSort', () => {
      const first = interruptA();
      engine.stopSession('Over');
      at(11, 15);
      const second = service.interrupt();

      expect(second.taskId).not.toBe(first.taskId);
      expect(tasks.getUnsortedTasks()).toHaveLength(2);
    });

    it('Interrupt_NothingRunning_StartsAndAsksNothingAfter', async () => {
      service.interrupt();
      engine.stopSession('Over');
      await settle();

      expect(session()).toBeNull();
      expect(service.getResumePrompt()).toBeNull();
    });
  });

  describe('when it ends', () => {
    it.each([
      ['stopped', () => engine.stopSession('Over')],
      ['finished', () => engine.stopSession('Over', true)],
      // Interrupt pressed by mistake: exactly when the task is wanted back.
      ['discarded', () => engine.discardSession()]
    ])('InterruptionEnds_%s_AsksBackToTheTask', async (_how, end) => {
      interruptA();

      end();
      await settle();

      expect(session()).toBeNull();
      expect(service.getResumePrompt()).toEqual({ taskKey: A.key, taskTitle: A.title, after: 'interruption' });
      expect(renderer.renderResumePrompt).toHaveBeenCalledWith('interruption', A.key);
      expect(send).toHaveBeenCalledWith(IPCChannel.ON_RESUME_PROMPT, { taskKey: A.key, taskTitle: A.title, after: 'interruption' });
    });

    it('InterruptionEnds_Yes_ResumesTheTask', async () => {
      interruptA();
      engine.stopSession('Over');
      await settle();

      service.answerResumePrompt(true);

      expect(session()).toMatchObject({ taskId: A.id, status: 'TRACKING' });
      expect(service.getResumePrompt()).toBeNull();
    });

    it('InterruptionEnds_No_LeavesNothingRunning', async () => {
      interruptA();
      engine.stopSession('Over');
      await settle();

      service.answerResumePrompt(false);

      expect(session()).toBeNull();
      expect(settings.getSetting('set_aside', 'unset')).toBeNull();
    });

    it('InterruptionEnds_TaskLeftTheListMeanwhile_SaysSo', async () => {
      interruptA();
      remoteTasks = [B];
      await sync();

      engine.stopSession('Over');
      await settle();

      expect(service.getResumePrompt()).toEqual({ taskKey: A.key, taskTitle: A.title, after: 'interruption', unlisted: true });
    });

    it('InterruptionPaused_AsksNothing', async () => {
      // A pause is not the end of the interruption.
      interruptA();

      engine.pauseSession();
      await settle();

      expect(service.getResumePrompt()).toBeNull();
    });

    it('UserStartsAnotherTask_NothingIsAsked', async () => {
      interruptA();
      engine.startTask(B.id, false, B.title, B.projectId, B.key);
      await settle();

      engine.stopSession('B done');
      await settle();

      expect(service.getResumePrompt()).toBeNull();
    });

    it('SomethingStartsWhileAsked_TheQuestionGoes', async () => {
      interruptA();
      engine.stopSession('Over');
      await settle();

      engine.startTask(B.id, false, B.title, B.projectId, B.key);

      expect(service.getResumePrompt()).toBeNull();
      expect(session()).toMatchObject({ taskId: B.id });
    });

    it('WrapUpEndsTheInterruption_AsksNothing', async () => {
      interruptA();

      service.stopForWrapUp();
      await settle();

      expect(session()).toBeNull();
      expect(service.getResumePrompt()).toBeNull();
    });
  });

  describe('a task paused, or already set aside', () => {
    it('AnswerFromBar_InterruptInThePausedMenu_Interrupts', async () => {
      // The bar's click reaches this service as the decoder's action, as the
      // stand-up's OK does.
      at(10, 0);
      startA();
      engine.pauseSession();
      at(10, 30);

      service.answerFromBar('START_INTERRUPTION');

      expect(session()).toMatchObject({ isAdHoc: true, taskTitle: 'Interruption 10:30', status: 'TRACKING' });
      engine.stopSession('Over');
      await settle();
      expect(service.getResumePrompt()).toMatchObject({ taskKey: A.key, after: 'interruption' });
    });

    it('Interrupt_WhilePaused_TheTaskIsAskedAboutToo', async () => {
      // The bar's Interrupt is in its paused menu: the task is paused by then.
      at(10, 0);
      startA();
      at(10, 20);
      engine.pauseSession();
      at(10, 30);
      service.interrupt();
      engine.stopSession('Over');
      await settle();

      expect(service.getResumePrompt()).toMatchObject({ taskKey: A.key, after: 'interruption' });
      expect(worklogs.getWorklogsByDate('2026-10-14').filter(w => w.taskId === A.id).map(w => w.durationSeconds)).toEqual([20 * 60]);
    });

    it('InterruptDuringAnInterruption_AsksAboutTheFirstTask', async () => {
      interruptA();
      service.interrupt();

      engine.stopSession('Over');
      await settle();

      expect(service.getResumePrompt()).toMatchObject({ taskKey: A.key, after: 'interruption' });
    });

    it('InterruptDuringTheStandup_AsksAboutTheTaskBeforeTheMeeting', async () => {
      at(9, 0);
      startA();
      at(9, 30);
      service.joinStandup();
      at(9, 40);
      service.interrupt();

      engine.stopSession('Over');
      await settle();

      expect(service.getResumePrompt()).toMatchObject({ taskKey: A.key, after: 'interruption' });
    });
  });

  describe('lunch in the middle of it', () => {
    it('LunchStopsTheInterruption_LunchEnds_TheTaskBeforeComesBack', async () => {
      // Lunch keeps what it stopped to restart, which here is the interruption.
      at(12, 0);
      startA();
      at(12, 20);
      service.interrupt();

      at(12, 31);
      service.evaluateSchedule();
      await settle();
      expect(session()).toBeNull();

      at(13, 31);
      service.evaluateSchedule();

      expect(session()).toMatchObject({ taskId: A.id, status: 'TRACKING' });
    });
  });

  describe('naming it while it runs', () => {
    it('RenameAdHocSession_NamesTheSessionAndItsTask_AndSortsIt', () => {
      const interruption = interruptA();

      const renamed = engine.renameAdHocSession('Call with Marc');

      expect(renamed).toMatchObject({ sessionId: interruption.sessionId, taskTitle: 'Call with Marc' });
      expect(renamed.unsorted).toBeUndefined();
      expect(tasks.getTaskById(interruption.taskId)?.title).toBe('Call with Marc');
      expect(tasks.getUnsortedTasks()).toEqual([]);
    });

    it('GetCurrentSession_UnnamedInterruption_SaysItIsUnsorted', () => {
      interruptA();

      expect(session()?.unsorted).toBe(true);
    });

    it('RenameAdHocSession_ProviderTask_IsRefused', () => {
      // A provider's task is named by the provider: the sync would put it back.
      startA();

      expect(() => engine.renameAdHocSession('Something else')).toThrow(/ad-hoc/);
      expect(session()?.taskTitle).toBe(A.title);
    });

    it.each(['', '   ', 'x'.repeat(121)])('RenameAdHocSession_NameRefused_%#', name => {
      interruptA();

      expect(() => engine.renameAdHocSession(name)).toThrow();
      expect(session()?.taskTitle).toBe('Interruption 10:30');
    });
  });

  describe('naming it after it ended', () => {
    /** Interrupted at 10:30 and stopped at 10:45: its worklog, still to sort. */
    const endedInterruption = () => {
      const interruption = interruptA();
      engine.stopSession('Over');
      return interruption;
    };
    const today = () => worklogs.getWorklogsByDate('2026-10-14');

    it('Worklogs_OfAnUnnamedInterruption_AreAdHocAndToSort', () => {
      const interruption = endedInterruption();

      const log = today().find(w => w.taskId === interruption.taskId);
      expect(log).toMatchObject({ adHoc: true, unsorted: true, taskTitle: 'Interruption 10:30' });
      expect(worklogs.getUnsortedWorklogs().map(w => w.taskId)).toEqual([interruption.taskId]);
      expect(worklogs.getDailySummary('2026-10-14').items.find(i => i.taskId === interruption.taskId)?.unsorted).toBe(true);
      // The task it stopped is neither.
      const before = today().find(w => w.taskId === A.id);
      expect(before?.adHoc).toBeUndefined();
      expect(before?.unsorted).toBeUndefined();
    });

    it('RenameAdHocTask_RenamesItsHistoryAndSortsIt', () => {
      const interruption = endedInterruption();

      engine.renameAdHocTask(interruption.taskId, 'Call with Marc');

      const log = today().find(w => w.taskId === interruption.taskId);
      expect(log).toMatchObject({ adHoc: true, taskTitle: 'Call with Marc' });
      expect(log?.unsorted).toBeUndefined();
      expect(worklogs.getUnsortedWorklogs()).toEqual([]);
      expect(worklogs.getDailySummary('2026-10-14').items.find(i => i.taskId === interruption.taskId)?.unsorted).toBeUndefined();
    });

    it('RenameAdHocTask_SendsNothing', () => {
      // Ad-hoc time was never queued; naming it does not change that.
      const interruption = endedInterruption();
      const queued = () => dbConn.getDb().prepare('SELECT COUNT(*) AS n FROM worklog_sync_queue WHERE task_id = ?').get(interruption.taskId);

      engine.renameAdHocTask(interruption.taskId, 'Call with Marc');

      expect(queued()).toEqual({ n: 0 });
    });

    it('RenameAdHocTask_TheOpenSession_RenamesItsCopyToo', () => {
      // From History, while the interruption still runs: the session's own
      // copy of the title follows, as a rename on the session card would.
      const interruption = interruptA();
      const heard = vi.fn();
      const off = engine.subscribe(heard);
      heard.mockClear();

      engine.renameAdHocTask(interruption.taskId, 'Call with Marc');

      expect(session()).toMatchObject({ taskTitle: 'Call with Marc' });
      expect(session()?.unsorted).toBeUndefined();
      expect(heard).toHaveBeenCalledTimes(1);
      off();
    });

    it('RenameAdHocTask_ProviderTask_IsRefused', () => {
      endedInterruption();

      expect(() => engine.renameAdHocTask(A.id, 'Mine now')).toThrow(/ad-hoc/);
      expect(tasks.getTaskById(A.id)?.title).toBe(A.title);
    });

    it.each([['adhoc_0_missing', 'Name'], ['', 'Name']])('RenameAdHocTask_NoSuchTask_IsRefused_%#', (taskId, title) => {
      expect(() => engine.renameAdHocTask(taskId, title)).toThrow();
    });

    it('RenameAdHocTask_EmptyName_IsRefused', () => {
      const interruption = endedInterruption();

      expect(() => engine.renameAdHocTask(interruption.taskId, '   ')).toThrow();
      expect(worklogs.getUnsortedWorklogs()).toHaveLength(1);
    });
  });

  describe('assigning it to a task while it runs', () => {
    it('AssignSessionToTask_AllOfItsTimeGoesToTheTaskAndItsProvider', () => {
      const interruption = interruptA();
      engine.assignSessionToTask(B.id);
      at(11, 0);

      engine.stopSession('Over');

      // The interruption started at 10:30: its whole half hour is B's.
      const onB = worklogs.getWorklogsByDate('2026-10-14').filter(w => w.taskId === B.id);
      expect(onB.map(w => w.durationSeconds)).toEqual([30 * 60]);
      const queued = worklogs.getPendingQueueItems().filter(q => q.taskId === B.id);
      expect(queued.map(q => [q.providerId, q.durationSeconds])).toEqual([['jira', 30 * 60]]);
      expect(tasks.getTaskById(interruption.taskId)).toBeNull();
    });

    it('AssignSessionToTask_TheSessionNowShowsTheTask', () => {
      const interruption = interruptA();

      const assigned = engine.assignSessionToTask(B.id);

      expect(assigned).toMatchObject({
        sessionId: interruption.sessionId, taskId: B.id, taskKey: B.key, taskTitle: B.title, isAdHoc: false, startTimeUtc: interruption.startTimeUtc
      });
      expect(assigned.unsorted).toBeUndefined();
    });

    it('AssignSessionToTask_TheUsersTask_GoesInProgress', () => {
      interruptA();

      engine.assignSessionToTask(B.id);

      expect(tasks.getTaskById(B.id)?.status).toBe('in_progress');
    });

    it('AssignSessionToTask_TheTaskSetAside_NothingIsAskedAtTheEnd', async () => {
      // Back on A by assigning: asking "back to SCRUM-2?" would restart it.
      interruptA();
      engine.assignSessionToTask(A.id);

      engine.stopSession('Over');
      await settle();

      expect(service.getResumePrompt()).toBeNull();
      expect(session()).toBeNull();
    });

    it('AssignSessionToTask_AnotherTask_StillAsksBackToTheFirst', async () => {
      interruptA();
      engine.assignSessionToTask(B.id);

      engine.stopSession('Over');
      await settle();

      expect(service.getResumePrompt()).toMatchObject({ taskKey: A.key, after: 'interruption' });
    });

    it('AssignSessionToTask_ProviderSessionOpen_IsRefused', () => {
      // Moving a provider task's running session would move logged time
      // between issues; that is History's move, not this.
      startA();

      expect(() => engine.assignSessionToTask(B.id)).toThrow(/ad-hoc/);
    });

    it('AssignSessionToTask_ToAdHocWorkOrNoTask_IsRefused', () => {
      const interruption = interruptA();
      const other = tasks.createAdHocTask('Other', 'MISC-1');

      expect(() => engine.assignSessionToTask(other.id)).toThrow(/not to other ad-hoc/);
      expect(() => engine.assignSessionToTask('99999')).toThrow(/No task/);
      expect(session()?.taskId).toBe(interruption.taskId);
    });
  });

  describe('a restart of the app', () => {
    it('Restart_DuringTheInterruption_TheQuestionStillComesAtTheEnd', async () => {
      interruptA();

      service.dispose();
      priority = new PriorityPreemptionEngine(settings);
      service = createService();
      engine.stopSession('Over');
      await settle();

      expect(service.getResumePrompt()).toMatchObject({ taskKey: A.key, after: 'interruption' });
    });
  });
});
