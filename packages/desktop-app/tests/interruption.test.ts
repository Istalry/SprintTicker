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
import { WorklogCorrectionService } from '../src/main/services/worklog-correction-service';
import { InterruptionService } from '../src/main/services/interruption-service';
import { UndoService } from '../src/main/services/undo-service';
import { ContextScheduleService } from '../src/main/services/context-schedule-service';
import type { DisplayRenderer } from '../src/main/hardware/display-renderer';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import { IPCChannel } from '../src/shared/ipc-channels';
import { ProjectDTO, TaskDTO } from '../src/shared/dtos';

/**
 * Interruptions in a row (P6, D2): the task running is held as it was --
 * paused, with the reason `interruption` -- and each ⚡ is a fragment of its
 * own, placed on a task afterwards, kept off the provider, or left for later.
 * Nothing is logged or sent at the start.
 *
 * Real engine, priority engine and settings on a database in memory; only
 * the renderer is a stand-in, and the clock is faked.
 */
describe('Interruptions in a row', () => {
  let dbConn: DatabaseConnection;
  let settings: SettingsRepository;
  let tasks: TaskRepository;
  let worklogs: WorklogRepository;
  let sessions: SessionRepository;
  let engine: TimeTrackingEngine;
  let priority: PriorityPreemptionEngine;
  let renderer: { setContextMode: ReturnType<typeof vi.fn>; renderResumePrompt: ReturnType<typeof vi.fn> };
  let send: ReturnType<typeof vi.fn>;
  let service: ContextScheduleService;

  const PROJECT: ProjectDTO = { id: '10000', key: 'SCRUM', name: 'My Software Team' };
  const A: TaskDTO = { id: '10001', projectId: '10000', key: 'SCRUM-2', title: 'Tache 2', status: 'todo' };
  const B: TaskDTO = { id: '10002', projectId: '10000', key: 'SCRUM-3', title: 'Tache 3', status: 'todo' };
  const DAY = '2026-10-14';

  /** 14 October 2026, local time; lunch 12:30 to 13:30. */
  const at = (hours: number, minutes: number, day = 14) => vi.setSystemTime(new Date(2026, 9, day, hours, minutes, 0));
  const startA = () => engine.startTask(A.id, false, A.title, A.projectId, A.key);
  const session = () => engine.getCurrentSession();
  const minutes = (n: number) => n * 60;
  const logged = (taskId: string) => worklogs.getWorklogsByDate(DAY).filter(w => w.taskId === taskId).map(w => w.durationSeconds);
  const queued = (taskId: string) =>
    dbConn.getDb().prepare('SELECT task_id AS taskId, duration_seconds AS seconds FROM worklog_sync_queue WHERE task_id = ?').all(taskId);
  const prompts = () => send.mock.calls.filter(([channel]) => channel === IPCChannel.ON_RESUME_PROMPT).map(([, prompt]) => prompt);
  const settle = () => Promise.resolve();
  const corrections = () =>
    new WorklogCorrectionService(worklogs, null, () => undefined, Date.now, {
      getTask: taskId => tasks.getTaskById(taskId),
      destinationOf: taskId => engine.sendDestinationOfTask(taskId),
      retireAdHocIfUnused: taskId => engine.retireAdHocTaskIfUnused(taskId)
    });

  /** Working on A from 10:00, interrupted at 10:30, now 10:45. */
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
    const manager = {
      getActiveProvider: () => ({ providerId: 'jira', minimumLoggableSeconds: 60 }),
      getProjects: async () => [PROJECT],
      getTasks: async () => [A, B],
      updateTaskStatus: async () => true,
      logTimeForProvider: () => new Promise(() => undefined)
    } as unknown as ProviderManager;
    tasks = new TaskRepository(dbConn);
    worklogs = new WorklogRepository(dbConn);
    sessions = new SessionRepository(dbConn);
    engine = new TimeTrackingEngine(sessions, worklogs, tasks, manager, new ProjectRepository(dbConn));
    await engine.getSyncWorker().syncTasksAndProjects();
    priority = new PriorityPreemptionEngine(settings);
    renderer = { setContextMode: vi.fn(), renderResumePrompt: vi.fn() };
    send = vi.fn();
    service = new ContextScheduleService(
      priority,
      settings,
      engine,
      renderer as unknown as DisplayRenderer,
      () => ({ isDestroyed: () => false, webContents: { send } }) as unknown as BrowserWindow
    );
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
    it('WhileTracking_HoldsTheTaskPaused_AndLogsNothing', () => {
      const interruption = interruptA();

      expect(interruption).toMatchObject({
        isAdHoc: true,
        taskTitle: 'Interruption 10:30',
        status: 'TRACKING',
        interruption: { index: 1, interruptedTaskKey: A.key, interruptedWasPaused: false, source: 'window' }
      });
      expect(worklogs.getWorklogsByDate(DAY)).toEqual([]);
      expect(sessions.getActiveSession()).toMatchObject({ taskId: A.id, status: 'PAUSED', elapsedSeconds: minutes(30) });
      expect(session()?.elapsedSeconds).toBe(minutes(15));
    });

    it('Backdated_ThePauseStartsThen', () => {
      at(10, 0);
      startA();
      at(10, 30);

      service.interrupt('shortcut', new Date(2026, 9, 14, 10, 25));

      expect(session()).toMatchObject({ startTimeUtc: new Date(2026, 9, 14, 10, 25).toISOString(), interruption: { source: 'shortcut' } });
      expect(sessions.getActiveSession()?.elapsedSeconds).toBe(minutes(25));
    });

    it('Backdated_NeverBeforeTheTaskBegan', () => {
      at(10, 0);
      startA();
      at(10, 5);

      service.interrupt('window', new Date(2026, 9, 14, 9, 0));

      expect(session()?.startTimeUtc).toBe(new Date(2026, 9, 14, 10, 0).toISOString());
    });

    it('NothingRunning_AnInterruptionAlone', () => {
      at(10, 0);
      service.interrupt();

      expect(session()).toMatchObject({ status: 'TRACKING', interruption: { interruptedSessionId: null } });
    });
  });

  describe('a run: Marc, Ana, Marc', () => {
    it('AnotherTwice_ThreeFragments_ThenBackResumesTheTask', () => {
      interruptA();
      engine.renameAdHocSession('Call with Marc');
      at(10, 50);
      service.interrupt();
      engine.renameAdHocSession("Ana's question");
      at(10, 55);
      expect(session()?.interruption).toMatchObject({ index: 2, interruptedTaskKey: A.key });
      engine.anotherInterruption();
      engine.renameAdHocSession('Marc again');
      at(11, 0);

      engine.backFromInterruption();

      expect(session()).toMatchObject({ taskId: A.id, status: 'TRACKING', elapsedSeconds: minutes(30) });
      expect(engine.getInterruptionsToPlace().map(f => [f.title, f.durationSeconds, f.index, f.ofRun, f.interruptedTaskKey])).toEqual([
        ['Call with Marc', minutes(20), 1, 3, A.key],
        ["Ana's question", minutes(5), 2, 3, A.key],
        ['Marc again', minutes(5), 3, 3, A.key]
      ]);
    });

    it('TimeAddsUp_NothingCountedTwice', () => {
      interruptA();
      at(11, 0);
      engine.backFromInterruption();
      at(11, 30);

      engine.stopSession('Done for now');

      // 10:00-10:30 and 11:00-11:30: the 30-minute pause splits the entry.
      expect(logged(A.id)).toEqual([minutes(30), minutes(30)]);
      expect(engine.getToPlaceSummary()).toEqual({ count: 1, seconds: minutes(30) });
    });
  });

  describe('back', () => {
    it('ARunningTask_RunsAgain', () => {
      interruptA();

      engine.backFromInterruption();

      expect(session()).toMatchObject({ taskId: A.id, status: 'TRACKING', elapsedSeconds: minutes(30) });
      expect(session()?.interruption).toBeUndefined();
    });

    it('APausedTask_StaysPaused', () => {
      at(10, 0);
      startA();
      at(10, 20);
      engine.pauseSession();
      at(10, 30);
      service.interrupt();
      expect(session()?.interruption?.interruptedWasPaused).toBe(true);

      engine.backFromInterruption();

      expect(session()).toMatchObject({ taskId: A.id, status: 'PAUSED', elapsedSeconds: minutes(20) });
    });

    it('NothingToComeBackFrom_IsRefused', () => {
      at(10, 0);
      startA();

      expect(() => engine.backFromInterruption()).toThrow(/No interruption/);
    });
  });

  describe('stop, and the question after it', () => {
    it('Stop_TheTaskStaysPaused_AndBackIsAsked', async () => {
      interruptA();

      engine.stopSession();
      await settle();

      expect(session()).toMatchObject({ taskId: A.id, status: 'PAUSED' });
      expect(prompts()).toEqual([expect.objectContaining({ taskKey: A.key, after: 'interruption', interruptionEndedAtUtc: new Date(2026, 9, 14, 10, 45).toISOString() })]);
      expect(engine.getToPlaceSummary().count).toBe(1);
    });

    it('StopThenBackPlusTheGap_TheGapCountsAsWork', () => {
      interruptA();
      engine.stopInterruption();
      at(10, 51);

      service.answerResumePrompt(true, 6);

      // Paused 10:30 to 10:45 only: 10:45 to 10:51 is work.
      expect(session()).toMatchObject({ taskId: A.id, status: 'TRACKING', elapsedSeconds: minutes(36) });
    });

    it('StopThenBack_TheGapIsNot', () => {
      interruptA();
      engine.stopInterruption();
      at(10, 51);

      service.answerResumePrompt(true);

      expect(session()).toMatchObject({ status: 'TRACKING', elapsedSeconds: minutes(30) });
    });

    it('No_LeavesTheTaskPaused', () => {
      interruptA();
      engine.stopInterruption();

      service.answerResumePrompt(false);

      expect(session()).toMatchObject({ taskId: A.id, status: 'PAUSED' });
    });

    it('APausedTaskInterrupted_NothingIsAsked', () => {
      at(10, 0);
      startA();
      engine.pauseSession();
      service.interrupt();

      engine.stopInterruption();

      expect(prompts()).toEqual([]);
    });

    it('PauseOnAnInterruption_IsItsStop', () => {
      interruptA();

      engine.pauseSession();

      expect(session()).toMatchObject({ taskId: A.id, status: 'PAUSED' });
      expect(engine.isInterrupted()).toBe(false);
    });

    it('SomethingStartsWhileAsked_TheQuestionGoes', () => {
      interruptA();
      engine.stopInterruption();

      engine.startTask(B.id);

      expect(prompts().at(-1)).toBeNull();
    });
  });

  describe('switch task', () => {
    it('Switch_TheInterruptionWaits_TheTaskBeforeIsLogged', () => {
      interruptA();

      engine.switchFromInterruption(B.id);

      expect(session()).toMatchObject({ taskId: B.id, status: 'TRACKING' });
      expect(logged(A.id)).toEqual([minutes(30)]);
      expect(engine.getInterruptionsToPlace()).toHaveLength(1);
    });

    it('SwitchTakingItAlong_ItsTimeGoesToTheNewTask', () => {
      interruptA();

      engine.switchFromInterruption(B.id, true);

      expect(logged(B.id)).toEqual([minutes(15)]);
      expect(queued(B.id)).toEqual([{ taskId: B.id, seconds: minutes(15) }]);
      expect(engine.getInterruptionsToPlace()).toEqual([]);
    });

    it('AStartFromAnyList_IsASwitch', () => {
      interruptA();

      engine.startTask(B.id);

      expect(session()?.taskId).toBe(B.id);
      expect(engine.getInterruptionsToPlace()).toHaveLength(1);
    });

    it('AssignWhileItRuns_PlacesItAndRunsTheTask', () => {
      interruptA();

      engine.assignSessionToTask(B.id);

      expect(session()?.taskId).toBe(B.id);
      expect(logged(B.id)).toEqual([minutes(15)]);
    });
  });

  describe('while it runs (S9, P8e3)', () => {
    it('StartedEarlier_TheMinutesComeOffTheTask', () => {
      interruptA();

      engine.moveInterruptionStart(new Date(2026, 9, 14, 10, 25));
      engine.backFromInterruption();
      at(11, 0);
      engine.stopSession();

      // 10:00-10:25 and 10:45-11:00 on A -- two entries, cut at a pause of
      // 15 min or more -- and the interruption from 10:25 to 10:45.
      expect(logged(A.id)).toEqual([minutes(15), minutes(25)]);
      expect(engine.getInterruptionsToPlace().map(f => [f.startedAtUtc, f.durationSeconds])).toEqual([
        [new Date(2026, 9, 14, 10, 25).toISOString(), minutes(20)]
      ]);
    });

    it('StartedEarlier_NeverBeforeTheTaskBegan_NorInTheFuture', () => {
      interruptA();

      engine.moveInterruptionStart(new Date(2026, 9, 14, 9, 0));
      expect(session()?.interruption?.startedAtUtc).toBe(new Date(2026, 9, 14, 10, 0).toISOString());

      engine.moveInterruptionStart(new Date(2026, 9, 14, 12, 0));
      expect(session()?.interruption?.startedAtUtc).toBe(new Date(2026, 9, 14, 10, 45).toISOString());
    });

    it('StartedEarlier_NeverBeforeTheTasksLastPause', () => {
      at(10, 0);
      startA();
      at(10, 10);
      engine.pauseSession();
      at(10, 20);
      engine.resumeSession();
      at(10, 30);
      service.interrupt();

      engine.moveInterruptionStart(new Date(2026, 9, 14, 10, 5));

      expect(session()?.interruption?.startedAtUtc).toBe(new Date(2026, 9, 14, 10, 20).toISOString());
    });

    it('StartedEarlier_TheSecondOfARun_NeverOverTheFirst', () => {
      interruptA();
      engine.anotherInterruption();

      engine.moveInterruptionStart(new Date(2026, 9, 14, 10, 35));

      expect(session()?.interruption?.startedAtUtc).toBe(new Date(2026, 9, 14, 10, 45).toISOString());
    });

    it('ChosenTask_TheTimerRuns_ItsTimeGoesThereAtTheEnd', () => {
      interruptA();

      engine.chooseTaskForInterruption(B.id);
      expect(session()?.interruption?.chosenTask).toEqual({ id: B.id, key: B.key, title: B.title });
      expect(session()?.status).toBe('TRACKING');
      engine.backFromInterruption();

      expect(logged(B.id)).toEqual([minutes(15)]);
      expect(queued(B.id)).toHaveLength(1);
      expect(engine.getInterruptionsToPlace()).toEqual([]);
    });

    it('ChosenThenLater_WaitsToBePlaced', () => {
      interruptA();

      engine.chooseTaskForInterruption(B.id);
      engine.chooseTaskForInterruption(null);
      engine.stopInterruption();

      expect(logged(B.id)).toEqual([]);
      expect(engine.getInterruptionsToPlace()).toHaveLength(1);
    });

    it('ChosenTask_Another_OnlyThatOneGoesThere', () => {
      interruptA();
      engine.chooseTaskForInterruption(B.id);

      engine.anotherInterruption();
      at(10, 50);
      engine.stopInterruption();

      expect(logged(B.id)).toEqual([minutes(15)]);
      expect(engine.getInterruptionsToPlace()).toHaveLength(1);
    });

    it('ChosenTask_Discarded_NothingPlaced', () => {
      interruptA();
      engine.chooseTaskForInterruption(B.id);

      engine.discardInterruption();

      expect(logged(B.id)).toEqual([]);
    });

    it.each([
      ['ad-hoc work', 'adhoc_1_x', /ad-hoc/],
      ['an unknown task', 'nope', /No task/]
    ])('ChooseTask_%s_Refused', (_name, taskId, message) => {
      interruptA();

      expect(() => engine.chooseTaskForInterruption(taskId)).toThrow(message);
    });
  });

  describe('place, keep off, discard', () => {
    const endedOne = () => {
      interruptA();
      engine.stopInterruption();
      return engine.getInterruptionsToPlace()[0];
    };

    it('Place_AWorklogOfItsSpan_SentLikeAnyEntry', () => {
      const fragment = endedOne();

      engine.placeInterruption(fragment.id, B.id);

      expect(worklogs.getWorklogsByDate(DAY).filter(w => w.taskId === B.id).map(w => [w.durationSeconds, w.startedAtUtc])).toEqual([
        [minutes(15), new Date(2026, 9, 14, 10, 30).toISOString()]
      ]);
      expect(queued(B.id)).toHaveLength(1);
      expect(engine.getInterruptionsToPlace()).toEqual([]);
    });

    it('Place_TheEntryReadsAsAnInterruption_OthersDoNot', () => {
      const fragment = endedOne();

      engine.placeInterruption(fragment.id, B.id);

      const day = worklogs.getWorklogsByDate(DAY);
      expect(day.filter(w => w.taskId === B.id).map(w => w.fromInterruption)).toEqual([true]);
      expect(day.filter(w => w.taskId !== B.id).every(w => w.fromInterruption === undefined)).toBe(true);
    });

    it('KeepOff_InHistoryAsItsName_NeverSent', () => {
      const fragment = endedOne();
      engine.renameInterruption(fragment.id, 'Coffee with Sam');

      engine.keepInterruptionOff(fragment.id);

      const kept = worklogs.getWorklogsByDate(DAY).filter(w => w.taskTitle === 'Coffee with Sam');
      expect(kept.map(w => w.durationSeconds)).toEqual([minutes(15)]);
      expect(queued(kept[0].taskId)).toEqual([]);
      expect(engine.getInterruptionsToPlace()).toEqual([]);
    });

    it('DiscardRunning_NothingKept_BackIsAsked', async () => {
      interruptA();

      expect(engine.discardSession()).toEqual({ success: true, discardedSeconds: minutes(15) });
      await settle();

      expect(engine.getInterruptionsToPlace()).toEqual([]);
      expect(session()).toMatchObject({ taskId: A.id, status: 'PAUSED' });
      expect(prompts()).toHaveLength(1);
    });

    it('PlaceTwice_IsRefused', () => {
      const fragment = endedOne();
      engine.placeInterruption(fragment.id, B.id);

      expect(() => engine.placeInterruption(fragment.id, B.id)).toThrow(/already/);
    });

    it('PlaceManyWithUndo_UndoPutsThemBack', () => {
      interruptA();
      engine.anotherInterruption();
      at(10, 50);
      engine.stopInterruption();
      const undo = new UndoService();
      const places = new InterruptionService({
        engine,
        db: dbConn.getDb(),
        undo,
        corrections: corrections(),
        getTaskKey: id => tasks.getTaskById(id)?.key ?? null
      });

      places.place(engine.getInterruptionsToPlace().map(f => f.id), B.id);
      expect(logged(B.id).sort((a, b) => b - a)).toEqual([minutes(15), minutes(5)]);
      expect(undo.current()?.label).toBe('Placed on SCRUM-3 · 20m');

      expect(undo.run()).toBe(true);

      expect(logged(B.id)).toEqual([]);
      expect(queued(B.id)).toEqual([]);
      expect(engine.getInterruptionsToPlace()).toHaveLength(2);
      undo.dispose();
    });
  });

  describe('an interruption of the model before', () => {
    it('AnUnsortedTasksEnd_WaitsToBePlaced_AndPlacingMovesItsEntry', () => {
      const old = tasks.createAdHocTask('Interruption 09:30', 'MISC-1', true);
      at(9, 30);
      engine.startTask(old.id, true, old.title);
      at(9, 45);
      engine.stopSession();

      const [fragment] = engine.getInterruptionsToPlace();
      expect(fragment).toMatchObject({ title: 'Interruption 09:30', durationSeconds: minutes(15), source: 'legacy' });

      new InterruptionService({ engine, corrections: corrections(), getTaskKey: () => null }).place([fragment.id], B.id);

      expect(logged(B.id)).toEqual([minutes(15)]);
      expect(tasks.getTaskById(old.id)).toBeNull();
      expect(engine.getInterruptionsToPlace()).toEqual([]);
    });
  });

  describe('lunch, the wrap-up, a restart', () => {
    it('LunchTime_DuringAnInterruption_AsksAndNothingChangesUntilAnswered', () => {
      // S25 (P8c2): lunch would end the call the user is in, so it asks.
      at(12, 0);
      startA();
      at(12, 20);
      service.interrupt();

      at(12, 31);
      service.evaluateSchedule();
      at(12, 32);
      service.evaluateSchedule();

      expect(service.getCeremonyPrompt()).toMatchObject({ type: 'LUNCH', endsInterruption: expect.any(String) });
      expect(session()?.interruption).toBeTruthy();
      expect(priority.getUserMode()).toBe('WORK');
    });

    it('LunchQuestion_NotNow_TheCallGoesOnAndLunchIsSkippedToday', () => {
      at(12, 0);
      startA();
      at(12, 20);
      service.interrupt();
      at(12, 31);
      service.evaluateSchedule();

      expect(service.answerLunchQuestion(false)).toBe(true);
      engine.backFromInterruption();
      at(12, 45);
      service.evaluateSchedule();

      expect(service.getCeremonyPrompt()).toBeNull();
      expect(priority.getUserMode()).toBe('WORK');
      expect(session()).toMatchObject({ taskId: A.id, status: 'TRACKING' });
    });

    it('LunchQuestion_BackToTheTaskInstead_IsWorkingThroughLunch', () => {
      // Back resumes the task during lunch's hour: the user working through
      // it, as any start or resume then is. The question goes with the call.
      at(12, 0);
      startA();
      at(12, 20);
      service.interrupt();
      at(12, 31);
      service.evaluateSchedule();

      engine.backFromInterruption();
      at(12, 32);
      service.evaluateSchedule();

      expect(service.getCeremonyPrompt()).toBeNull();
      expect(priority.getUserMode()).toBe('WORK');
      expect(session()).toMatchObject({ taskId: A.id, status: 'TRACKING' });
    });

    it('LunchTime_LockedInAnInterruption_AsksAndUnlockingKeepsTheCallGoing', () => {
      // Away leaves a call running; lunch asks rather than ending it, and
      // unlocking during lunch goes to WORK with the question, not to LUNCH.
      at(12, 0);
      startA();
      at(12, 20);
      service.interrupt();
      service.enterAwayMode();

      at(12, 31);
      service.evaluateSchedule();
      expect(service.getCeremonyPrompt()).toMatchObject({ type: 'LUNCH' });
      expect(session()?.interruption).toBeTruthy();

      service.exitAwayMode();

      expect(priority.getUserMode()).toBe('WORK');
      expect(session()?.interruption).toBeTruthy();
      expect(service.getCeremonyPrompt()).toMatchObject({ type: 'LUNCH' });
    });

    it('LunchQuestion_StillOpenWhenLunchEnds_Closes', () => {
      at(12, 0);
      startA();
      at(12, 20);
      service.interrupt();
      at(12, 31);
      service.evaluateSchedule();

      at(13, 31);
      service.evaluateSchedule();

      expect(service.getCeremonyPrompt()).toBeNull();
      expect(service.answerLunchQuestion(true)).toBe(false);
    });

    it('Lunch_StartedFromTheQuestion_EndsTheInterruption_TheTaskItHeldTakesLunchsPause', async () => {
      // P8b: the interruption waits to be placed; the task stays paused,
      // now for lunch, and "Back at your desk?" resumes it after.
      at(12, 0);
      startA();
      at(12, 20);
      service.interrupt();

      at(12, 31);
      service.evaluateSchedule();
      service.answerLunchQuestion(true);
      await settle();

      expect(session()).toMatchObject({ taskId: A.id, status: 'PAUSED' });
      expect(engine.openPauseReason()).toBe('lunch');
      expect(prompts()).toEqual([]);
      expect(logged(A.id)).toEqual([]);
      expect(engine.getInterruptionsToPlace()).toHaveLength(1);

      at(13, 31);
      service.evaluateSchedule();
      expect(service.getResumePrompt()).toMatchObject({ taskKey: A.key, after: 'lunch', held: true });
      service.answerResumePrompt(true);

      expect(session()).toMatchObject({ taskId: A.id, status: 'TRACKING' });
      at(14, 31);
      engine.stopSession('Done');
      expect(logged(A.id).sort((a, b) => a - b)).toEqual([minutes(20), minutes(60)]);
    });

    it('WrapUp_EndsTheInterruptionAndTheTaskItHeld', () => {
      interruptA();

      service.stopForWrapUp();

      expect(session()).toBeNull();
      expect(logged(A.id)).toEqual([minutes(30)]);
      expect(prompts()).toEqual([]);
    });

    it('Restart_TheInterruptionStillRuns', () => {
      interruptA();
      engine.dispose();

      const again = new TimeTrackingEngine(sessions, worklogs, tasks, undefined, new ProjectRepository(dbConn));
      again.reconcileStartupState();

      expect(again.getCurrentSession()).toMatchObject({ status: 'TRACKING', interruption: { interruptedTaskKey: A.key } });
      again.dispose();
    });

    it('TheBarsPausedMenu_Interrupts_FromTheBar', () => {
      at(10, 0);
      startA();
      engine.pauseSession();

      service.answerFromBar('START_INTERRUPTION');

      expect(session()?.interruption).toMatchObject({ source: 'bar', interruptedWasPaused: true });
    });
  });
});
