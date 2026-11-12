import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { PriorityPreemptionEngine } from '../src/main/services/priority-preemption-engine';
import { ContextScheduleService } from '../src/main/services/context-schedule-service';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { InputDecoder } from '../src/main/hardware/input-decoder';
import type { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import type { ProviderManager } from '../src/main/providers/provider-manager';
import { DECK_ELAPSED_DRIFT_SECONDS, DECK_STATE_REFRESH_MS, DeckActionService } from '../src/main/services/deck-action-service';
import { DeckRequest, DeckResultMessage, DeckStateMessage } from '../src/shared/deck-protocol';
import { OWN_PROJECT_PROVIDER_ID } from '../src/shared/local-provider';
import { DAILY_STANDUP_TITLE } from '../src/shared/schedule-defaults';
import { SCENE_ICONS, FRONT_ANIMATIONS, ANIMATED_ICONS } from '../src/shared/render-constants';
import { TaskOwnership } from '../src/shared/task-ownership';
import { TaskDTO } from '../src/shared/dtos';

/**
 * What a Stream Deck key does. Every action must be what the window, the
 * mini timer or the bar already does -- so the collaborators are real: the
 * engine, the priority engine, the renderer that takes a prompt's lock, the
 * decoder that answers it, and the ceremonies behind it. Only the device is
 * a stand-in, and the database lives in memory.
 */
describe('DeckActionService', () => {
  let db: DatabaseConnection;
  let settings: SettingsRepository;
  let taskRepo: TaskRepository;
  let engine: TimeTrackingEngine;
  let priority: PriorityPreemptionEngine;
  let renderer: DisplayRenderer;
  let decoder: InputDecoder;
  let schedule: ContextScheduleService;
  let openPicker: ReturnType<typeof vi.fn>;
  let workingNow: boolean;
  let decoded: string[];
  let service: DeckActionService;

  const PROJECT = { id: 'P1', key: 'SPR', name: 'Sprint', providerId: OWN_PROJECT_PROVIDER_ID };
  const task = (id: string, over: Partial<TaskDTO> = {}): TaskDTO =>
    ({ id, projectId: PROJECT.id, key: `SPR-${id}`, title: `Task ${id}`, status: 'todo', ...over });
  const MINE = task('1');
  const MINE_IN_PROGRESS = task('2', { status: 'in_progress' });
  const THEIRS = task('3', { status: 'in_progress', ownership: TaskOwnership.OTHER, assigneeName: 'Sam' });

  /** What main wires: the schedule service's Interrupt, as the window's button. */
  const interrupt = () => { schedule.interrupt(); };

  let nextId = 0;
  const ask = (action: DeckRequest['action'], extra: Partial<DeckRequest> = {}, protocol?: number) =>
    service.perform({ id: `r${++nextId}`, action, ...extra }, protocol) as DeckResultMessage;
  const refused = (result: DeckResultMessage) => (result.ok ? null : result.error);
  /** Wednesday 21 October 2026, local time. */
  const at = (hours: number, minutes: number, seconds = 0) =>
    vi.setSystemTime(new Date(2026, 9, 21, hours, minutes, seconds));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    at(9, 0);

    db = new DatabaseConnection(':memory:');
    settings = new SettingsRepository(db);
    // Nothing the clock would start on its own: each test raises its prompt.
    settings.setSetting('schedule_settings', {
      enableStandupPrompt: false, lunchStartTime: '12:30', lunchEndTime: '13:30', eodWrapUpTime: '23:00'
    });
    taskRepo = new TaskRepository(db);
    const projects = new ProjectRepository(db);
    projects.saveProject(PROJECT);
    for (const t of [MINE, MINE_IN_PROGRESS, THEIRS]) taskRepo.saveTask(t);

    const manager = {
      getActiveProvider: () => null,
      getProjects: async () => [],
      getTasks: async () => [],
      updateTaskStatus: async () => true
    } as unknown as ProviderManager;
    engine = new TimeTrackingEngine(new SessionRepository(db), new WorklogRepository(db), taskRepo, manager, projects);

    const driver = Object.assign(new EventEmitter(), {
      sendDisplayPayload: vi.fn().mockResolvedValue('drawn'),
      sendPixelFrame: vi.fn().mockResolvedValue('sent'),
      clearDisplay: vi.fn().mockResolvedValue('cleared'),
      uploadAsset: vi.fn().mockResolvedValue(undefined),
      drawOverlay: vi.fn().mockResolvedValue('drawn'),
      removeDisplayElements: vi.fn().mockResolvedValue(undefined),
      getDeviceStatus: vi.fn(() => ({ connected: true })),
      isEnabled: () => true
    }) as unknown as BusyBarDriver;
    priority = new PriorityPreemptionEngine(settings);
    renderer = new DisplayRenderer(driver);
    renderer.setPriorityEngine(priority);
    priority.setRenderer(renderer);
    decoder = new InputDecoder(driver, engine, settings, priority, renderer);
    schedule = new ContextScheduleService(priority, settings, engine, renderer);
    // What IPCHandlerRegistry wires in the app: the decoder's answers reach the ceremonies.
    decoded = [];
    decoder.registerActionHandler(action => {
      decoded.push(action);
      schedule.answerFromBar(action);
    });

    openPicker = vi.fn(() => true);
    workingNow = false;
    // As main wires it: the schedule, the tray's working hours, the picker's recent tasks.
    service = new DeckActionService({
      engine, renderer, priorityEngine: priority, inputDecoder: decoder, openPicker, interrupt,
      schedule, isWorkingNow: () => workingNow, recentTasks: limit => taskRepo.getRecent(limit)
    });
  });

  afterEach(() => {
    service.dispose();
    schedule.dispose();
    decoder.dispose();
    renderer.dispose();
    engine.dispose();
    db.close();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('the icon in motion', () => {
    const MOTION = { fps: 10, poses: [[['#22C55E']], [['#10B981']]], sequence: [0, 1] };

    /** The motions, read or not yet as the test says. */
    const motions = (read: boolean) => {
      const listeners = new Set<() => void>();
      const fake = {
        read,
        get: vi.fn((_name: string) => (fake.read ? MOTION : null)),
        onLoaded: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        loaded: () => {
          fake.read = true;
          for (const listener of listeners) listener();
        }
      };
      return fake;
    };

    it('GetState_IconThatMoves_CarriesItsMotionAndNotItsFileName', () => {
      const iconMotions = motions(true);
      service = new DeckActionService({ engine, renderer, priorityEngine: priority, inputDecoder: decoder, openPicker, interrupt, iconMotions });
      engine.startTask(MINE.id);
      renderer.renderActiveSession(engine.getCurrentSession());

      const icon = service.getState().icon!;
      expect(iconMotions.get).toHaveBeenCalledWith(ANIMATED_ICONS.stopwatch);
      expect(icon.motion).toBe(MOTION);
      expect(icon).not.toHaveProperty('animation');
    });

    it('GetState_NoMotions_TheIconStill', () => {
      engine.startTask(MINE.id);
      renderer.renderActiveSession(engine.getCurrentSession());
      const icon = service.getState().icon!;
      expect(icon).not.toHaveProperty('motion');
      expect(icon).not.toHaveProperty('animation');
    });

    it('Subscribe_MotionReadAfterTheIcon_PushesTheStateAgain', () => {
      const iconMotions = motions(false);
      service = new DeckActionService({ engine, renderer, priorityEngine: priority, inputDecoder: decoder, openPicker, interrupt, iconMotions });
      engine.startTask(MINE.id);
      renderer.renderActiveSession(engine.getCurrentSession());
      const heard: DeckStateMessage[] = [];
      service.subscribe(message => heard.push(message));
      expect(heard.at(-1)?.state.icon?.motion).toBeUndefined();

      iconMotions.loaded();
      expect(heard.at(-1)?.state.icon?.motion).toBe(MOTION);
      const pushed = heard.length;

      // And not again each second: the motion is in the signature as a yes.
      vi.advanceTimersByTime(DECK_STATE_REFRESH_MS * 3);
      expect(heard).toHaveLength(pushed);
    });
  });

  describe('the state', () => {
    it('GetState_NothingRunning_NoSessionNoIconNoPrompt', () => {
      expect(service.getState()).toEqual({
        session: null, icon: null, prompt: null,
        toPlace: 0, previousTask: null, recent: [], standupRunning: null, nothingTimingInHours: false
      });
    });

    it('GetState_NothingTimingInWorkingHours_SaysSo', () => {
      workingNow = true;
      expect(service.getState().nothingTimingInHours).toBe(true);

      engine.startTask(MINE.id);
      expect(service.getState().nothingTimingInHours).toBe(false);
    });

    it('GetState_Recent_NewestFirstWithoutTheOpenTask', () => {
      engine.startTask(MINE.id);
      at(9, 10);
      engine.startTask(MINE_IN_PROGRESS.id);

      const state = service.getState();
      expect(state.recent).toEqual([{ taskId: MINE.id, taskKey: MINE.key, taskTitle: MINE.title }]);
      expect(state.previousTask).toEqual({ taskId: MINE.id, taskKey: MINE.key, taskTitle: MINE.title });
    });

    it('GetState_DuringAnInterruption_ItsTitleAndBackToKeyNoPrevious', () => {
      engine.startTask(MINE_IN_PROGRESS.id);
      at(9, 10);
      engine.startTask(MINE.id);
      at(9, 30);
      ask('interrupt');

      const state = service.getState();
      expect(state.session?.interruption).toEqual({ name: null, backToKey: MINE.key });
      // Going back is A during an interruption (S29).
      expect(state.previousTask).toBeNull();
    });

    it('GetState_AnInterruptionEnded_CountedToPlace', () => {
      ask('interrupt');
      at(9, 20);
      ask('stop');

      expect(service.getState().toPlace).toBe(1);
    });

    it('GetState_ATeammatesTask_TheirName', () => {
      engine.startTask(THEIRS.id);

      expect(service.getState().session).toMatchObject({ finishNeedsConfirmation: true, ownerName: 'Sam' });
    });

    it('GetState_Tracking_TheSessionAndTheBarsIcon', () => {
      engine.startTask(MINE.id);
      renderer.renderActiveSession(engine.getCurrentSession());

      expect(service.getState()).toMatchObject({
        session: { taskId: MINE.id, taskKey: MINE.key, taskTitle: MINE.title, status: 'tracking', finishNeedsConfirmation: false },
        icon: { label: `${MINE.key}: ${MINE.title}` }
      });
    });

    it('GetState_ATeammatesTask_FinishingItAsks', () => {
      engine.startTask(THEIRS.id);

      expect(service.getState().session).toMatchObject({ status: 'tracking', finishNeedsConfirmation: true });
    });
  });

  describe('the session keys', () => {
    it('Perform_PauseThenResume_AsTheMiniTimer', () => {
      engine.startTask(MINE.id);

      expect(ask('pause').ok).toBe(true);
      expect(engine.getCurrentSession()?.status).toBe('PAUSED');
      expect(ask('resume').ok).toBe(true);
      expect(engine.getCurrentSession()?.status).toBe('TRACKING');
    });

    it('Perform_PauseWithNothingRunning_RefusedNoSession', () => {
      expect(refused(ask('pause'))).toBe('no-session');
      expect(refused(ask('resume'))).toBe('no-session');
      expect(refused(ask('stop'))).toBe('no-session');
      expect(refused(ask('finish'))).toBe('no-session');
      expect(refused(ask('discard', { confirmed: true }))).toBe('no-session');
    });

    it('Perform_ResumeWhileTracking_RefusedNoSession', () => {
      engine.startTask(MINE.id);

      expect(refused(ask('resume'))).toBe('no-session');
    });

    it('Perform_Stop_LogsTheTimeAndPlaysLogged', () => {
      engine.startTask(MINE.id);
      at(9, 30);

      expect(ask('stop').ok).toBe(true);

      expect(engine.getCurrentSession()).toBeNull();
      expect(new WorklogRepository(db).getTodaysWorklogs()).toEqual([
        expect.objectContaining({ taskId: MINE.id, durationSeconds: 1800 })
      ]);
      expect(taskRepo.getTaskById(MINE.id)?.status).not.toBe('done');
      // The window's own scene: the key went through completeSession.
      expect(renderer.getScreenIcon()?.label).toBe(SCENE_ICONS[FRONT_ANIMATIONS.TASK_LOGGED].label);
    });

    it('Perform_FinishUnconfirmed_AskedAlwaysInProtocol2', () => {
      engine.startTask(MINE.id);

      // DONE changes the ticket: two presses, even for the user's own task (S29).
      expect(refused(ask('finish'))).toBe('needs-confirmation');
      expect(engine.getCurrentSession()?.status).toBe('TRACKING');
    });

    it('Perform_FinishUnconfirmedFromPlugin05_DoneAsProtocol1Did', () => {
      engine.startTask(MINE.id);

      expect(ask('finish', {}, 1).ok).toBe(true);
      expect(taskRepo.getTaskById(MINE.id)?.status).toBe('done');
    });

    it('Perform_Finish_MarksTheTaskDoneAndPlaysDone', () => {
      engine.startTask(MINE.id);
      at(9, 30);

      expect(ask('finish', { confirmed: true }).ok).toBe(true);

      expect(taskRepo.getTaskById(MINE.id)?.status).toBe('done');
      expect(renderer.getScreenIcon()?.label).toBe(SCENE_ICONS[FRONT_ANIMATIONS.TASK_DONE].label);
    });

    it('Perform_FinishATeammatesTaskUnconfirmed_AsksAndKeepsTheSession', () => {
      engine.startTask(THEIRS.id);

      expect(refused(ask('finish'))).toBe('needs-confirmation');
      expect(engine.getCurrentSession()?.status).toBe('TRACKING');

      expect(ask('finish', { confirmed: true }).ok).toBe(true);
      expect(engine.getCurrentSession()).toBeNull();
    });

    it('Perform_DiscardUnconfirmed_AsksAndKeepsTheSession', () => {
      engine.startTask(MINE.id);

      expect(refused(ask('discard'))).toBe('needs-confirmation');
      expect(engine.getCurrentSession()?.status).toBe('TRACKING');
    });

    it('Perform_DiscardConfirmed_KeepsNothing', () => {
      engine.startTask(MINE.id);
      at(9, 30);

      expect(ask('discard', { confirmed: true }).ok).toBe(true);

      expect(engine.getCurrentSession()).toBeNull();
      expect(new WorklogRepository(db).getTodaysWorklogs()).toEqual([]);
    });
  });

  describe('the prompt key', () => {
    it('Perform_PromptWithNothingAsked_RefusedNoPrompt', () => {
      expect(refused(ask('prompt-yes'))).toBe('no-prompt');
      expect(refused(ask('prompt-no'))).toBe('no-prompt');
      expect(decoded).toEqual([]);
    });

    it('Perform_YesOnTheStandup_JoinsItAsOkOnTheBar', () => {
      engine.startTask(MINE.id);
      schedule.triggerStandupPrompt();
      expect(service.getState().prompt).toBe('standup');

      expect(ask('prompt-yes').ok).toBe(true);

      expect(decoded).toEqual(['CONFIRM_STANDUP_PROMPT']);
      expect(engine.getCurrentSession()).toMatchObject({ taskTitle: DAILY_STANDUP_TITLE, isAdHoc: true });
      expect(service.getState().prompt).toBeNull();
    });

    it('Perform_NoOnTheStandup_DismissesItAsBackOnTheBar', () => {
      engine.startTask(MINE.id);
      schedule.triggerStandupPrompt();

      expect(ask('prompt-no').ok).toBe(true);

      expect(decoded).toEqual(['DISMISS_STANDUP_PROMPT']);
      expect(engine.getCurrentSession()?.taskId).toBe(MINE.id);
      expect(service.getState().prompt).toBeNull();
    });

    it('Perform_YesTwiceOnTheWrapUp_ArmsThenRunsIt', () => {
      schedule.triggerEodPrompt();
      expect(service.getState().prompt).toBe('wrap-up');

      ask('prompt-yes');
      expect(service.getState().prompt).toBe('wrap-up-confirm');

      ask('prompt-yes');
      // The window's wrap-up runs on this, as on the bar's second press.
      expect(decoded).toEqual(['CONFIRM_EOD_WRAP_UP_STEP_1', 'EXECUTE_EOD_WRAP_UP']);
    });

    it('Perform_NoOnTheWrapUp_DismissesIt', () => {
      schedule.triggerEodPrompt();

      ask('prompt-no');

      expect(decoded).toEqual(['DISMISS_EOD_WRAP_UP']);
      expect(service.getState().prompt).toBeNull();
    });
  });

  describe('the other keys', () => {
    it('Perform_OpenPicker_OpensTheWindowsPicker', () => {
      expect(ask('open-picker').ok).toBe(true);
      expect(openPicker).toHaveBeenCalledTimes(1);
    });

    it('Perform_OpenPickerWithNoWindow_RefusedNoWindow', () => {
      openPicker.mockReturnValue(false);

      expect(refused(ask('open-picker'))).toBe('no-window');
    });

    it('Perform_Interrupt_StopsTheTaskAndAsksAboutItWhenTheInterruptionEnds', async () => {
      engine.startTask(MINE.id);
      at(9, 30);

      expect(ask('interrupt').ok).toBe(true);
      expect(engine.getCurrentSession()).toMatchObject({ isAdHoc: true, taskTitle: 'Interruption 09:30' });

      at(9, 45);
      expect(ask('stop').ok).toBe(true);
      // The question waits for the engine's listeners.
      await Promise.resolve();
      expect(service.getState().prompt).toBe('back');

      // Yes on the deck is OK on the bar: the task comes back.
      expect(ask('prompt-yes').ok).toBe(true);
      expect(engine.getCurrentSession()).toMatchObject({ taskId: MINE.id, status: 'TRACKING' });
    });

    it('Perform_Back_EndsTheInterruptionAndResumesTheTask', () => {
      engine.startTask(MINE.id);
      at(9, 30);
      ask('interrupt');
      at(9, 40);

      expect(ask('back').ok).toBe(true);

      expect(engine.getCurrentSession()).toMatchObject({ taskId: MINE.id, status: 'TRACKING' });
      expect(service.getState().toPlace).toBe(1);
    });

    it('Perform_BackWithNoInterruption_RefusedNoSession', () => {
      engine.startTask(MINE.id);

      expect(refused(ask('back'))).toBe('no-session');
    });

    it('Perform_BackFromAnInterruptionHoldingNothing_RefusedNoTask', () => {
      ask('interrupt');

      expect(refused(ask('back'))).toBe('no-task');
      expect(engine.getCurrentSession()?.interruption).toBeDefined();
    });

    it('Perform_Another_EndsTheInterruptionAndStartsTheNext', () => {
      engine.startTask(MINE.id);
      ask('interrupt');
      at(9, 10);

      expect(ask('another').ok).toBe(true);

      expect(engine.getCurrentSession()?.interruption).toMatchObject({ index: 2, interruptedTaskKey: MINE.key });
    });

    it('Perform_AnotherWithNoInterruption_RefusedNoSession', () => {
      engine.startTask(MINE.id);

      expect(refused(ask('another'))).toBe('no-session');
      expect(engine.getCurrentSession()?.interruption).toBeUndefined();
    });

    it('Perform_Previous_StartsTheTaskTimedBefore', () => {
      engine.startTask(MINE.id);
      at(9, 10);
      engine.startTask(MINE_IN_PROGRESS.id);
      at(9, 20);

      expect(ask('previous').ok).toBe(true);

      expect(engine.getCurrentSession()).toMatchObject({ taskId: MINE.id, status: 'TRACKING' });
    });

    it('Perform_PreviousWithNone_RefusedNoTask', () => {
      expect(refused(ask('previous'))).toBe('no-task');
    });

    it('Perform_PreviousDuringAnInterruption_RefusedNoTask', () => {
      engine.startTask(MINE.id);
      at(9, 10);
      engine.startTask(MINE_IN_PROGRESS.id);
      ask('interrupt');

      expect(refused(ask('previous'))).toBe('no-task');
      expect(engine.getCurrentSession()?.interruption).toBeDefined();
    });

    it('Perform_StartRecent_StartsThatRecentTask', () => {
      engine.startTask(MINE.id);
      at(9, 10);
      engine.startTask(MINE_IN_PROGRESS.id);
      at(9, 20);
      engine.stopSession();

      expect(ask('start-recent', { index: 2 }).ok).toBe(true);

      expect(engine.getCurrentSession()).toMatchObject({ taskId: MINE.id, status: 'TRACKING' });
    });

    it('Perform_StartRecentPastTheList_RefusedNoTask', () => {
      engine.startTask(MINE.id);

      // The open task is never offered: there is no first recent task yet.
      expect(refused(ask('start-recent', { index: 1 }))).toBe('no-task');
    });

    it.each([['open-picker', {}], ['start-recent', { index: 1 }]] as const)('Perform_%sDuringAnInterruption_RefusedNoTask', (action, extra) => {
      // Choosing a task does nothing during an interruption (2026-11-12).
      engine.startTask(MINE.id);
      at(9, 10);
      engine.startTask(MINE_IN_PROGRESS.id);
      ask('interrupt');

      expect(refused(ask(action, extra))).toBe('no-task');
      expect(openPicker).not.toHaveBeenCalled();
      expect(engine.getCurrentSession()?.interruption).toBeDefined();
    });

    it('Perform_EndStandup_EndsItAndBringsTheTaskBack', async () => {
      engine.startTask(MINE.id);
      schedule.triggerStandupPrompt();
      ask('prompt-yes');
      expect(service.getState().standupRunning).toEqual({ returnsToKey: MINE.key });
      at(9, 15);

      expect(ask('end-standup').ok).toBe(true);
      // The restart waits for the engine's listeners (CLAUDE.md §5).
      await Promise.resolve();

      expect(engine.getCurrentSession()).toMatchObject({ taskId: MINE.id, status: 'TRACKING' });
      expect(service.getState().standupRunning).toBeNull();
    });

    it('Perform_EndStandupWithNoneRunning_RefusedNoSession', () => {
      engine.startTask(MINE.id);

      expect(refused(ask('end-standup'))).toBe('no-session');
      expect(engine.getCurrentSession()?.taskId).toBe(MINE.id);
    });

    it('Perform_YesToLunchsQuestion_AnsweredAsTheWindowDoes', () => {
      const answerLunchQuestion = vi.fn(() => true);
      const lunch = new DeckActionService({
        engine, renderer, priorityEngine: priority, inputDecoder: decoder, openPicker, interrupt,
        schedule: {
          standupRunning: () => null,
          getResumePrompt: () => null,
          getCeremonyPrompt: () => ({ type: 'LUNCH', title: 'Lunch' }) as never,
          answerLunchQuestion
        }
      });
      expect(lunch.getState().prompt).toBe('lunch');

      expect(lunch.perform({ id: 'l', action: 'prompt-yes' }).ok).toBe(true);
      expect(lunch.perform({ id: 'm', action: 'prompt-no' }).ok).toBe(true);

      expect(answerLunchQuestion.mock.calls).toEqual([[true], [false]]);
      expect(decoded).toEqual([]);
      answerLunchQuestion.mockReturnValue(false);
      expect(lunch.perform({ id: 'n', action: 'prompt-yes' })).toMatchObject({ ok: false, error: 'no-prompt' });
      lunch.dispose();
    });

    it('Perform_Interrupt_NothingRunning_StartsATimer', () => {
      expect(ask('interrupt').ok).toBe(true);

      expect(engine.getCurrentSession()).toMatchObject({ isAdHoc: true, status: 'TRACKING' });
    });

    it('Perform_InterruptFails_FailedWithItsMessage', () => {
      const broken = new DeckActionService({
        engine, renderer, priorityEngine: priority, inputDecoder: decoder, openPicker,
        interrupt: () => { throw new Error('The schedule service is not running.'); }
      });

      expect(broken.perform({ id: 'x', action: 'interrupt' })).toMatchObject({ ok: false, error: 'failed' });
    });

    it('Perform_TheAppThrows_FailedWithItsMessage', () => {
      openPicker.mockImplementation(() => {
        throw new Error('window crashed');
      });

      expect(ask('open-picker')).toMatchObject({ ok: false, error: 'failed', message: 'window crashed' });
    });
  });

  describe('pushing the state', () => {
    let pushed: DeckStateMessage[];
    let unsubscribe: () => void;

    beforeEach(() => {
      pushed = [];
      unsubscribe = service.subscribe(message => pushed.push(message));
    });

    afterEach(() => unsubscribe());

    it('Subscribe_First_PushesTheStateAtOnce', () => {
      expect(pushed).toHaveLength(1);
      expect(pushed[0]).toMatchObject({ type: 'state', state: { session: null }, at: new Date(2026, 9, 21, 9, 0).toISOString() });
    });

    it('Subscribe_TheSessionTicking_PushesNothingMore', async () => {
      engine.startTask(MINE.id);
      const afterStart = pushed.length;

      await vi.advanceTimersByTimeAsync(10 * DECK_STATE_REFRESH_MS);

      // The engine ticked ten times; the plugin counts on its own.
      expect(pushed).toHaveLength(afterStart);
      expect(pushed.at(-1)?.state.session?.status).toBe('tracking');
    });

    it('Subscribe_APause_PushedOnce', () => {
      engine.startTask(MINE.id);
      const before = pushed.length;

      engine.pauseSession();

      expect(pushed).toHaveLength(before + 1);
      expect(pushed.at(-1)?.state.session?.status).toBe('paused');
    });

    it('Subscribe_APromptTakingTheBar_PushedWithinARefresh', async () => {
      schedule.triggerEodPrompt();
      await vi.advanceTimersByTimeAsync(DECK_STATE_REFRESH_MS);

      expect(pushed.at(-1)?.state.prompt).toBe('wrap-up');
    });

    it('Subscribe_TheClockSetBack_PushesTheTimeAgain', () => {
      engine.startTask(MINE.id);
      at(9, 10);
      engine.pauseSession();
      engine.resumeSession();
      const before = pushed.length;

      // Thirty seconds back: past the drift the plugin is allowed.
      at(9, 9, 60 - 30);
      vi.advanceTimersByTime(DECK_STATE_REFRESH_MS);

      expect(DECK_ELAPSED_DRIFT_SECONDS).toBeLessThan(30);
      expect(pushed.length).toBeGreaterThan(before);
    });

    it('Subscribe_LastListenerGone_StopsReading', async () => {
      unsubscribe();
      const before = pushed.length;

      engine.startTask(MINE.id);
      await vi.advanceTimersByTimeAsync(5 * DECK_STATE_REFRESH_MS);

      expect(pushed).toHaveLength(before);
      unsubscribe(); // twice is harmless
    });

    it('Subscribe_AListenerThrows_OthersStillHear', () => {
      const other: DeckStateMessage[] = [];
      const off = service.subscribe(() => {
        throw new Error('plugin gone');
      });
      const offOther = service.subscribe(message => other.push(message));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);

      engine.startTask(MINE.id);

      expect(other.at(-1)?.state.session?.taskId).toBe(MINE.id);
      off();
      offOther();
    });
  });

  it('Constructor_MissingADependency_Throws', () => {
    expect(() => new DeckActionService({ ...({} as never) })).toThrow();
  });

  it('Refresh_TheStateUnreadable_PushesNothingAndWarns', () => {
    const broken = new DeckActionService({ engine, renderer, priorityEngine: priority, inputDecoder: decoder, openPicker, interrupt });
    const pushed: DeckStateMessage[] = [];
    vi.spyOn(renderer, 'getScreenIcon').mockImplementation(() => {
      throw new Error('database closed');
    });

    const off = broken.subscribe(message => pushed.push(message));

    expect(pushed).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith('[Deck] Could not read the state:', expect.any(Error));
    off();
    broken.dispose();
  });
});
