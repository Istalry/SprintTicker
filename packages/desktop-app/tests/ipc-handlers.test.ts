import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const electron = vi.hoisted(() => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), emit: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn() },
  app: { isPackaged: false, getVersion: () => '9.9.9', getSystemLocale: () => 'fr-BE' },
  BrowserWindow: vi.fn(),
  powerMonitor: { on: vi.fn() },
  // A keystore that answers, so a secret stored in the clear shows up as one.
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from([...plain].reverse().join('')),
    decryptString: (sealed: Buffer) => [...sealed.toString()].reverse().join('')
  }
}));

vi.mock('electron', () => electron);

import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { ProviderManager } from '../src/main/providers/provider-manager';
import { selectableProviders } from '../src/shared/provider-names';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { InputDecoder } from '../src/main/hardware/input-decoder';
import { PriorityPreemptionEngine } from '../src/main/services/priority-preemption-engine';
import { ContextScheduleService } from '../src/main/services/context-schedule-service';
import { IPCHandlerRegistry } from '../src/main/ipc/ipc-handler-registry';
import { LaunchAtLoginService } from '../src/main/services/launch-at-login';
import { IPCChannel } from '../src/shared/ipc-channels';
import { ProviderSettingKey } from '../src/shared/provider-settings';
import type { PriorityRule, UpdateStatusDTO } from '../src/shared/dtos';
import { RESUME_PROMPT_EVENT } from '../src/shared/priority-defaults';
import { OWN_PROJECT_PROVIDER_ID } from '../src/shared/local-provider';
import { localDateKey } from '../src/shared/local-date';

/**
 * The IPC handlers as the renderer sees them: a channel, a payload, an answer,
 * and what the rest of the app did about it.
 */
describe('IPC handlers', () => {
  let db: DatabaseConnection;
  let engine: TimeTrackingEngine;
  let taskRepo: TaskRepository;
  let settingsRepo: SettingsRepository;
  let driver: BusyBarDriver;
  let decoder: InputDecoder;
  let priorityEngine: PriorityPreemptionEngine;
  let registry: IPCHandlerRegistry;
  let sent: Array<{ channel: string; payload: unknown }>;
  let window: { isDestroyed(): boolean; webContents: { isDestroyed(): boolean; send(channel: string, payload: unknown): void } } | null;
  let automation: {
    saveOpenEditors: ReturnType<typeof vi.fn>;
    scheduleShutdown: ReturnType<typeof vi.fn>;
    abortShutdown: ReturnType<typeof vi.fn>;
    isShutdownPending: ReturnType<typeof vi.fn>;
  };
  let dir: string;

  const handler = (channel: string) => {
    const found = electron.ipcMain.handle.mock.calls.filter(([name]) => name === channel).at(-1);
    if (!found) throw new Error(`No handler for ${channel}`);
    return found[1] as (event: unknown, payload?: unknown) => Promise<unknown>;
  };
  const invoke = (channel: string, payload?: unknown) => handler(channel)({}, payload);
  const sentOn = (channel: string) => sent.filter(s => s.channel === channel).map(s => s.payload);

  /**
   * A stand-in schedule service that routes the bar's answers as the real
   * one does, to the methods the test spies on.
   */
  const barAnswering = <T extends object>(stub: T) => ({ ...stub, answerFromBar: ContextScheduleService.prototype.answerFromBar });

  const build = (extra: Record<string, unknown> = {}) => {
    electron.ipcMain.handle.mockClear();
    registry = new IPCHandlerRegistry({
      engine,
      taskRepo,
      settingsRepo,
      driver,
      inputDecoder: decoder,
      renderer: new DisplayRenderer(driver),
      priorityEngine,
      getWindow: () => window as never,
      systemAutomationService: automation,
      ...extra
    });
    registry.registerAllHandlers();
  };

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    electron.dialog.showOpenDialog.mockReset();
    electron.dialog.showSaveDialog.mockReset();
    electron.shell.openExternal.mockReset();

    db = new DatabaseConnection(':memory:');
    taskRepo = new TaskRepository(db);
    settingsRepo = new SettingsRepository(db);
    engine = new TimeTrackingEngine(new SessionRepository(db), new WorklogRepository(db), taskRepo, undefined, new ProjectRepository(db));
    driver = new BusyBarDriver('10.0.4.20', true);
    await driver.connect();
    decoder = new InputDecoder(driver, engine, settingsRepo);
    priorityEngine = new PriorityPreemptionEngine(settingsRepo);
    sent = [];
    window = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: (channel, payload) => sent.push({ channel, payload }) }
    };
    automation = {
      saveOpenEditors: vi.fn().mockResolvedValue({ isSaved: true }),
      scheduleShutdown: vi.fn().mockResolvedValue(true),
      abortShutdown: vi.fn().mockResolvedValue(true),
      isShutdownPending: vi.fn().mockReturnValue(false)
    };
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprintticker-ipc-'));
    build();
  });

  afterEach(() => {
    engine.dispose();
    driver.disconnect();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('hardware input', () => {
    it('HardwareAction_OnePress_ReachesTheRendererOnce', () => {
      // The wrap-up modal counts presses to step through its confirmation.
      // Delivered twice, one START both armed and ran the wrap-up.
      decoder.handleHardwareInput({ key: 'up', type: 'press', timestamp: new Date().toISOString() });

      expect(sentOn(IPCChannel.ON_HARDWARE_INPUT_EVENT)).toEqual([
        { inputKey: 'up', actionAssigned: 'NAVIGATE_QUEUE_PREV' }
      ]);
    });

    it.each([
      ['ok', true],
      ['back', false]
    ])('HardwareAction_%sOnTheResumeQuestion_AnswersIt', (key, resume) => {
      // The decoder only says which answer; the schedule service owns the question.
      const answerResumePrompt = vi.fn().mockReturnValue(true);
      build({ contextScheduleService: barAnswering({ answerResumePrompt }) });
      vi.spyOn(priorityEngine, 'getActiveLockEventName').mockReturnValue(RESUME_PROMPT_EVENT);
      decoder.setPriorityEngine(priorityEngine);

      decoder.handleHardwareInput({ key, type: 'press', timestamp: new Date().toISOString() });

      expect(answerResumePrompt).toHaveBeenCalledWith(resume);
    });

    it('HardwareAction_OkOnTheStandupPrompt_JoinsIt', () => {
      const joinStandup = vi.fn();
      build({ contextScheduleService: barAnswering({ joinStandup }) });
      vi.spyOn(priorityEngine, 'getActiveLockEventName').mockReturnValue('standupPromptPriority');
      decoder.setPriorityEngine(priorityEngine);

      decoder.handleHardwareInput({ key: 'ok', type: 'press', timestamp: new Date().toISOString() });

      expect(joinStandup).toHaveBeenCalledTimes(1);
    });

    it('HardwareAction_BackOnTheStandupPrompt_DoesNotJoin', () => {
      const joinStandup = vi.fn();
      build({ contextScheduleService: barAnswering({ joinStandup }) });
      vi.spyOn(priorityEngine, 'getActiveLockEventName').mockReturnValue('standupPromptPriority');
      decoder.setPriorityEngine(priorityEngine);

      decoder.handleHardwareInput({ key: 'back', type: 'press', timestamp: new Date().toISOString() });

      expect(joinStandup).not.toHaveBeenCalled();
    });
  });

  describe('the week', () => {
    it('WeekEnded_ReadAndDismissed_ThroughTheScheduleService', async () => {
      const week = { weekStart: '2026-10-12', weekEnd: '2026-10-16', loggedSeconds: 3600 };
      const getWeekEnded = vi.fn().mockReturnValue(week);
      const dismissWeekEnded = vi.fn();
      build({ contextScheduleService: { getWeekEnded, dismissWeekEnded } });

      expect(await invoke(IPCChannel.GET_WEEK_ENDED)).toEqual(week);
      expect(await invoke(IPCChannel.DISMISS_WEEK_ENDED)).toBe(true);
      expect(dismissWeekEnded).toHaveBeenCalledTimes(1);
    });

    it('LastWeekClosed_ReadThroughTheScheduleService', async () => {
      build({ contextScheduleService: { getLastWeekClosed: vi.fn().mockReturnValue('2026-11-02') } });

      expect(await invoke(IPCChannel.GET_LAST_WEEK_CLOSED)).toBe('2026-11-02');
    });
  });

  describe('the stand-up', () => {
    it('JoinStandup_FromTheWindow_ReachesTheScheduleService', async () => {
      const joinStandup = vi.fn();
      build({ contextScheduleService: { joinStandup } });

      expect(await invoke(IPCChannel.JOIN_STANDUP)).toBe(true);
      expect(joinStandup).toHaveBeenCalledTimes(1);
    });
  });

  describe('the days a session is filed under', () => {
    it('GetSessionDays_NoSession_Nothing', async () => {
      build();

      expect(await invoke(IPCChannel.GET_SESSION_DAYS)).toEqual([]);
    });

    it('GetSessionDays_ASessionToday_OneDay', async () => {
      build();
      engine.startTask('', true, 'Pairing');

      expect(await invoke(IPCChannel.GET_SESSION_DAYS)).toEqual([{ dateKey: localDateKey(), seconds: expect.any(Number) }]);
    });
  });

  describe('a session left running', () => {
    it('ForgottenReview_ServiceWired_AsksAndAnswersThroughIt', async () => {
      const review = { sessionId: 's1', taskKey: 'MG-12' };
      const getReview = vi.fn().mockReturnValue(review);
      const resolve = vi.fn().mockReturnValue(true);
      build({ forgottenSessionService: { getReview, resolve } });

      expect(await invoke(IPCChannel.GET_FORGOTTEN_REVIEW)).toEqual(review);
      expect(await invoke(IPCChannel.RESOLVE_FORGOTTEN_SESSION, { action: 'stop', endUtc: '2026-10-16T16:04:00.000Z' })).toBe(true);
      expect(resolve).toHaveBeenCalledWith({ action: 'stop', endUtc: '2026-10-16T16:04:00.000Z' });
    });

    it('ForgottenReview_NoService_NothingIsEverAsked', async () => {
      expect(await invoke(IPCChannel.GET_FORGOTTEN_REVIEW)).toBeNull();
      expect(await invoke(IPCChannel.RESOLVE_FORGOTTEN_SESSION, { action: 'keep' })).toBe(false);
    });
  });

  describe('the question after lunch', () => {
    it('AnswerResumePrompt_ABoolean_ReachesTheScheduleService', async () => {
      const answerResumePrompt = vi.fn().mockReturnValue(true);
      const getResumePrompt = vi.fn().mockReturnValue({ taskKey: 'SCRUM-2', taskTitle: 'Tache 2', after: 'lunch' });
      build({ contextScheduleService: { answerResumePrompt, getResumePrompt } });

      expect(await invoke(IPCChannel.GET_RESUME_PROMPT)).toEqual({ taskKey: 'SCRUM-2', taskTitle: 'Tache 2', after: 'lunch' });
      expect(await invoke(IPCChannel.ANSWER_RESUME_PROMPT, false)).toBe(true);
      expect(answerResumePrompt).toHaveBeenCalledWith(false, 0);
    });

    it('AnswerResumePrompt_WithTheGap_PassesItsMinutes_RefusesANegativeOne', async () => {
      const answerResumePrompt = vi.fn().mockReturnValue(true);
      build({ contextScheduleService: { answerResumePrompt, getResumePrompt: vi.fn() } });

      await handler(IPCChannel.ANSWER_RESUME_PROMPT)({}, true, 6);
      expect(answerResumePrompt).toHaveBeenCalledWith(true, 6);
      await expect(handler(IPCChannel.ANSWER_RESUME_PROMPT)({}, true, -6)).rejects.toThrow(/minutes/);
      await expect(handler(IPCChannel.ANSWER_RESUME_PROMPT)({}, true, '6')).rejects.toThrow(/minutes/);
      expect(answerResumePrompt).toHaveBeenCalledTimes(1);
    });

    it('AnswerResumePrompt_NotABoolean_IsRefused', async () => {
      // "false" as a string is truthy: taken loosely, it would resume the task.
      const answerResumePrompt = vi.fn();
      build({ contextScheduleService: { answerResumePrompt } });

      await expect(invoke(IPCChannel.ANSWER_RESUME_PROMPT, 'false')).rejects.toThrow(/true or false/);
      expect(answerResumePrompt).not.toHaveBeenCalled();
    });
  });

  describe('the schedule', () => {
    it('SaveSchedule_LunchEndingBeforeItStarts_IsRefusedAndNothingIsWritten', async () => {
      const evaluateSchedule = vi.fn();
      build({ contextScheduleService: { evaluateSchedule } });

      await expect(
        invoke(IPCChannel.SAVE_SCHEDULE_SETTINGS, { lunchStartTime: '13:30', lunchEndTime: '12:30' })
      ).rejects.toThrow(/Lunch must end after it starts/);
      expect(settingsRepo.getSetting('schedule_settings', null)).toBeNull();
      expect(evaluateSchedule).not.toHaveBeenCalled();
    });

    it('SaveSchedule_AValidOne_IsKeptAndAppliedAtOnce', async () => {
      const evaluateSchedule = vi.fn();
      build({ contextScheduleService: { evaluateSchedule } });

      await invoke(IPCChannel.SAVE_SCHEDULE_SETTINGS, { lunchStartTime: '12:00', lunchEndTime: '12:45' });

      expect(settingsRepo.getSetting<{ lunchEnd: string }>('schedule_settings', { lunchEnd: '' }).lunchEnd).toBe('12:45');
      expect(evaluateSchedule).toHaveBeenCalledTimes(1);
    });
  });

  describe('correcting a worklog', () => {
    const correction = { durationSeconds: 3600, startedAtUtc: '2026-10-13T09:00:00.000Z', comment: 'Pairing' };

    it('UpdateWorklog_AWellFormedCorrection_ReachesTheServiceAndTheTableIsResent', async () => {
      const correct = vi.fn().mockReturnValue({ id: 'w1', ...correction });
      build({ worklogCorrections: { correct } });

      expect(await handler(IPCChannel.UPDATE_WORKLOG)({}, 'w1', correction)).toMatchObject({ id: 'w1' });
      expect(correct).toHaveBeenCalledWith('w1', correction);
      expect(sentOn(IPCChannel.ON_WORKLOGS_UPDATED)).toHaveLength(1);
    });

    it.each([
      ['no id', undefined, correction],
      ['a duration as text', 'w1', { ...correction, durationSeconds: '3600' }],
      ['no correction', 'w1', null]
    ])('UpdateWorklog_%s_IsRefused', async (_label, id, payload) => {
      const correct = vi.fn();
      build({ worklogCorrections: { correct } });

      await expect(handler(IPCChannel.UPDATE_WORKLOG)({}, id, payload)).rejects.toThrow(/needs a worklog id/);
      expect(correct).not.toHaveBeenCalled();
    });

    it('DeleteWorklog_AnId_ReachesTheServiceAndTheTableIsResent', async () => {
      const remove = vi.fn();
      build({ worklogCorrections: { remove } });

      expect(await invoke(IPCChannel.DELETE_WORKLOG, 'w1')).toBe(true);
      expect(remove).toHaveBeenCalledWith('w1');
      expect(sentOn(IPCChannel.ON_WORKLOGS_UPDATED)).toHaveLength(1);
      await expect(invoke(IPCChannel.DELETE_WORKLOG, 7)).rejects.toThrow(/needs a worklog id/);
    });

    it('CorrectingAWorklog_NoService_IsRefused', async () => {
      await expect(handler(IPCChannel.UPDATE_WORKLOG)({}, 'w1', correction)).rejects.toThrow(/unavailable/);
      await expect(invoke(IPCChannel.DELETE_WORKLOG, 'w1')).rejects.toThrow(/unavailable/);
    });
  });

  describe('end-of-day wrap-up', () => {
    it('WrapUp_AnEditorSaved_ReportsIt', async () => {
      const res = await invoke(IPCChannel.TRIGGER_EOD_WRAP_UP, {});

      expect(res).toEqual({ success: true, savedVSCode: true });
    });

    it('WrapUp_EditorSaveThrows_StillWrapsUp', async () => {
      // Saving editors is a courtesy; the wrap-up is what the user asked for.
      automation.saveOpenEditors.mockRejectedValue(new Error('code: not found'));

      const res = await invoke(IPCChannel.TRIGGER_EOD_WRAP_UP, {});

      expect(res).toEqual({ success: true, savedVSCode: false });
    });

    it('WrapUp_WithShutdown_SchedulesItWithAGracePeriod', async () => {
      await invoke(IPCChannel.TRIGGER_EOD_WRAP_UP, { shouldShutdown: true });

      // The service's defaults: a grace period, and a reason naming SprintTicker.
      expect(automation.scheduleShutdown).toHaveBeenCalledTimes(1);
    });

    it('WrapUp_WithoutShutdown_SchedulesNothing', async () => {
      await invoke(IPCChannel.TRIGGER_EOD_WRAP_UP, { shouldShutdown: false });

      expect(automation.scheduleShutdown).not.toHaveBeenCalled();
    });

    it('WrapUp_ShutdownRefused_StillAnswersSuccess', async () => {
      automation.scheduleShutdown.mockRejectedValue(new Error('access denied'));

      await expect(invoke(IPCChannel.TRIGGER_EOD_WRAP_UP, { shouldShutdown: true })).resolves.toMatchObject({ success: true });
    });

    it('WrapUp_TaskRunning_StopsAndLogsIt', async () => {
      engine.startTask('T-1', true, 'Ad hoc');

      await invoke(IPCChannel.TRIGGER_EOD_WRAP_UP, {});

      expect(engine.getCurrentSession()).toBeNull();
    });

    it('StartInterruption_TaskRunning_HoldsItPaused', async () => {
      const before = engine.startTask('', true, 'Writing the spec');

      const interruption = (await invoke(IPCChannel.START_INTERRUPTION)) as {
        taskTitle: string;
        interruption: { interruptedSessionId: string };
      };

      expect(interruption.taskTitle).toMatch(/^Interruption \d\d:\d\d$/);
      expect(interruption.interruption.interruptedSessionId).toBe(before.sessionId);
      expect(settingsRepo.getSetting('set_aside', null)).toBeNull();
    });

    it('InterruptionStart_ASource_IsKept', async () => {
      const started = (await invoke(IPCChannel.INTERRUPTION_START, { source: 'mini' })) as { interruption: { source: string } };

      expect(started.interruption.source).toBe('mini');
    });

    it('InterruptionStart_NotATime_IsRefused', async () => {
      await expect(invoke(IPCChannel.INTERRUPTION_START, { startedAtUtc: 'soon' })).rejects.toThrow(/time/);
    });

    it('InterruptionBack_ResumesTheTaskHeld', async () => {
      const before = engine.startTask('', true, 'Writing the spec');
      await invoke(IPCChannel.INTERRUPTION_START);

      const back = (await invoke(IPCChannel.INTERRUPTION_BACK)) as { sessionId: string; status: string };

      expect(back).toMatchObject({ sessionId: before.sessionId, status: 'TRACKING' });
    });

    it('InterruptionStopThenRenameThenKeepOff_ListsItNoMore', async () => {
      await invoke(IPCChannel.INTERRUPTION_START);
      await invoke(IPCChannel.INTERRUPTION_STOP);
      const [waiting] = (await invoke(IPCChannel.INTERRUPTION_GET_TO_PLACE)) as Array<{ id: string }>;
      expect(waiting).toBeDefined();

      const rename = handler(IPCChannel.INTERRUPTION_RENAME) as (event: unknown, id: unknown, name: unknown) => Promise<unknown>;
      await rename({}, waiting.id, ' Printer jam ');
      expect(await invoke(IPCChannel.INTERRUPTION_GET_TO_PLACE)).toMatchObject([{ title: 'Printer jam' }]);

      await invoke(IPCChannel.INTERRUPTION_KEEP_OFF, waiting.id);

      expect(await invoke(IPCChannel.INTERRUPTION_GET_TO_PLACE)).toEqual([]);
      expect(sentOn(IPCChannel.ON_INTERRUPTIONS_UPDATED).at(-1)).toEqual([]);
    });

    it.each([
      [IPCChannel.INTERRUPTION_PLACE, [undefined, 'T-1']],
      [IPCChannel.INTERRUPTION_PLACE, ['int_1', '']],
      [IPCChannel.INTERRUPTION_PLACE_MANY, ['int_1', 'T-1']],
      [IPCChannel.INTERRUPTION_PLACE_MANY, [[], 'T-1']],
      [IPCChannel.INTERRUPTION_KEEP_OFF, [7]],
      [IPCChannel.INTERRUPTION_RENAME, ['', 'Name']],
      [IPCChannel.INTERRUPTION_SWITCH, ['']],
      [IPCChannel.INTERRUPTION_DISCARD, [7]]
    ])('%s_BadArguments_AreRefused_%#', async (channel, args) => {
      const call = handler(channel) as (event: unknown, ...rest: unknown[]) => Promise<unknown>;
      await expect(call({}, ...(args as unknown[]))).rejects.toThrow();
    });

    it('RenameSession_Interruption_TakesTheTrimmedName', async () => {
      await invoke(IPCChannel.START_INTERRUPTION);

      const renamed = (await invoke(IPCChannel.RENAME_SESSION, '  Call with Marc ')) as { taskTitle: string };

      expect(renamed.taskTitle).toBe('Call with Marc');
    });

    it.each([[undefined], [42], ['   ']])('RenameSession_NotAName_IsRefused_%#', async title => {
      await invoke(IPCChannel.START_INTERRUPTION);

      await expect(invoke(IPCChannel.RENAME_SESSION, title)).rejects.toThrow();
    });

    it.each([[undefined, 'Name'], [7, 'Name'], ['adhoc_1_x', 42]])('RenameAdHocTask_BadArguments_AreRefused_%#', async (taskId, title) => {
      const rename = handler(IPCChannel.RENAME_AD_HOC_TASK) as (event: unknown, taskId: unknown, title: unknown) => Promise<unknown>;
      await expect(rename({}, taskId, title)).rejects.toThrow();
    });

    it.each([[undefined, 'T-1'], ['w1', undefined], [7, 'T-1'], ['', 'T-1']])('MoveWorklog_BadArguments_AreRefused_%#', async (worklogId, taskId) => {
      const move = handler(IPCChannel.MOVE_WORKLOG) as (event: unknown, worklogId: unknown, taskId: unknown) => Promise<unknown>;
      await expect(move({}, worklogId, taskId)).rejects.toThrow();
    });

    it.each([[undefined], [7], ['']])('AssignSession_NotATaskId_IsRefused_%#', async taskId => {
      await invoke(IPCChannel.START_INTERRUPTION);

      await expect(invoke(IPCChannel.ASSIGN_SESSION, taskId)).rejects.toThrow(/task id/);
    });

    it('WrapUp_DuringTheStandup_RestartsNothingOvernight', async () => {
      // The stand-up's end restarts the task it stopped -- but the day's end
      // is not the meeting's: the task restarted then ran all night.
      engine.startTask('', true, 'Writing the spec');
      await invoke(IPCChannel.JOIN_STANDUP);

      await invoke(IPCChannel.TRIGGER_EOD_WRAP_UP, {});
      await Promise.resolve();

      expect(engine.getCurrentSession()).toBeNull();
      expect(settingsRepo.getSetting('set_aside', 'unset')).toBeNull();
    });

    it('CancelWrapUp_OnTheBar_TheScreenBehindItIsDrawnOnce', async () => {
      // The release hands the display back itself; drawing the session after
      // it drew idle twice -- two clears of the device's screen, the shape
      // CLAUDE.md §5 forbids. Seen on the real bar on 2026-10-15 as a removal
      // of a frame already gone.
      const renderer = new DisplayRenderer(driver);
      renderer.setPriorityEngine(priorityEngine);
      build({ renderer });
      renderer.renderCeremonyPrompt('EOD', 'End-of-Day Wrap-Up');
      expect(priorityEngine.getActiveLockEventName()).toBe('eodWrapUpPriority');
      const drawn = vi.spyOn(renderer, 'renderActiveSession');

      await invoke(IPCChannel.CANCEL_EOD_WRAP_UP);

      expect(priorityEngine.getActiveLockEventName()).not.toBe('eodWrapUpPriority');
      expect(drawn).toHaveBeenCalledTimes(1);
    });

    it('CancelWrapUp_NothingHeldByIt_DrawsNothing', async () => {
      // The window's Cancel with no prompt on the bar: whatever holds the
      // display keeps it.
      const renderer = new DisplayRenderer(driver);
      renderer.setPriorityEngine(priorityEngine);
      build({ renderer });
      const drawn = vi.spyOn(renderer, 'renderActiveSession');

      await invoke(IPCChannel.CANCEL_EOD_WRAP_UP);

      expect(drawn).not.toHaveBeenCalled();
    });

    it.each([
      [true, 1],
      [false, 0]
    ])('CancelWrapUp_ShutdownPending%s_AbortsOnlyWhenOneIs', async (pending, aborts) => {
      automation.isShutdownPending.mockReturnValue(pending);

      await invoke(IPCChannel.CANCEL_EOD_WRAP_UP);

      expect(automation.abortShutdown).toHaveBeenCalledTimes(aborts);
    });
  });

  describe('user mode', () => {
    it('SetUserMode_LunchThenWork_SplitsTheSessionAndResumesIt', async () => {
      engine.startTask('T-1', true, 'Ad hoc');

      await invoke(IPCChannel.SET_USER_MODE, 'LUNCH');
      expect(priorityEngine.getUserMode()).toBe('LUNCH');
      expect(engine.getCurrentSession()).toBeNull();

      await invoke(IPCChannel.SET_USER_MODE, 'WORK');
      expect(priorityEngine.getUserMode()).toBe('WORK');
      expect(engine.getCurrentSession()?.taskTitle).toBe('Ad hoc');
    });

    it('SetUserMode_Away_IsReportedToTheRenderer', async () => {
      await invoke(IPCChannel.SET_USER_MODE, 'AWAY');

      expect(sentOn(IPCChannel.ON_USER_MODE_UPDATED)).toContain('AWAY');
    });
  });

  describe('priority rules', () => {
    const edited = async () => {
      const rules = (await invoke(IPCChannel.GET_PRIORITY_RULES)) as PriorityRule[];
      return rules.map((r, i) => (i === 0 ? { ...r, priority: 7 } : r));
    };

    it.each([
      ['a bare array', (rules: PriorityRule[]) => rules],
      ['wrapped in { rules }', (rules: PriorityRule[]) => ({ rules })]
    ])('SavePriorityRules_As%s_IsWhatTheNextReadReturns', async (_label, wrap) => {
      const rules = await edited();

      await invoke(IPCChannel.SAVE_PRIORITY_RULES, wrap(rules));

      expect(((await invoke(IPCChannel.GET_PRIORITY_RULES)) as PriorityRule[])[0].priority).toBe(7);
    });
  });

  describe('projects and tasks, by payload shape', () => {
    // The renderer has sent both a bare id and an object for these, depending
    // on the view; both must work, and an empty payload must do nothing.
    const projects = () => new ProjectRepository(db);

    beforeEach(() => {
      projects().saveProject({ id: 'P1', key: 'P1', name: 'Alpha' });
      taskRepo.saveTask({ id: 'T1', projectId: 'P1', key: 'A-1', title: 'One', status: 'todo' });
    });

    it.each([
      ['an id', 'P1'],
      ['{ projectId }', { projectId: 'P1' }],
      ['{ id }', { id: 'P1' }]
    ])('GetTasks_Given%s_ListsTheProjectsTasks', async (_label, payload) => {
      expect(((await invoke(IPCChannel.GET_TASKS, payload)) as unknown[]).length).toBe(1);
    });

    it('GetTasks_NoProject_IsEmpty', async () => {
      await expect(invoke(IPCChannel.GET_TASKS, {})).resolves.toEqual([]);
    });

    it.each([['an id', 'T1'], ['{ taskId }', { taskId: 'T1' }]])('DeleteTask_Given%s_DeletesIt', async (_label, payload) => {
      await invoke(IPCChannel.DELETE_TASK, payload);

      expect(taskRepo.getTaskById('T1')).toBeFalsy();
    });

    it('DeleteProject_EmptyPayload_DeletesNothing', async () => {
      await invoke(IPCChannel.DELETE_PROJECT, {});

      expect(projects().getAllProjects()).toHaveLength(1);
    });

    it('CreateProject_WhateverTheCallerSays_IsMadeHere', async () => {
      // Its tasks exist nowhere else: their time must never be queued.
      await invoke(IPCChannel.CREATE_PROJECT, { id: 'MINE', key: 'MINE', name: 'Mine', providerId: 'jira' });

      expect(projects().getProviderIdOf('MINE')).toBe(OWN_PROJECT_PROVIDER_ID);
    });

    it('DeleteProject_GivenAnObject_DeletesIt', async () => {
      await invoke(IPCChannel.DELETE_PROJECT, { projectId: 'P1' });

      expect(projects().getAllProjects()).toHaveLength(0);
    });

    it.each([['a title', 'Quick fix'], ['{ customTitle }', { customTitle: 'Quick fix' }]])(
      'CreateAdHocTask_Given%s_CreatesIt',
      async (_label, payload) => {
        expect(await invoke(IPCChannel.CREATE_AD_HOC_TASK, payload)).toMatchObject({ title: 'Quick fix' });
      }
    );

    it('CreateAdHocTask_NoTitle_CreatesNothing', async () => {
      await expect(invoke(IPCChannel.CREATE_AD_HOC_TASK, {})).resolves.toBeNull();
    });
  });

  describe('flow settings', () => {
    const save = (key: unknown, value: unknown) => handler(IPCChannel.SAVE_FLOW_SETTING)({}, key, value);

    it('Unset_AnswersTheDefault', async () => {
      expect(await invoke(IPCChannel.GET_FLOW_SETTING, 'start_side_effects')).toEqual({ enabled: true, afterSeconds: 120 });
    });

    it('Save_StoresTheValueWholeAndValid', async () => {
      // A partial value lands whole; an out-of-range number takes the default.
      expect(await save('start_side_effects', { enabled: false, afterSeconds: -5 })).toEqual({ enabled: false, afterSeconds: 120 });

      expect(settingsRepo.getSetting('start_side_effects', null)).toEqual({ enabled: false, afterSeconds: 120 });
      expect(await invoke(IPCChannel.GET_FLOW_SETTING, 'start_side_effects')).toEqual({ enabled: false, afterSeconds: 120 });
    });

    it.each([['nonsense'], [''], [42]])('Key_%s_Throws', async key => {
      await expect(invoke(IPCChannel.GET_FLOW_SETTING, key)).rejects.toThrow(/flow setting/);
      await expect(save(key, true)).rejects.toThrow(/flow setting/);
    });
  });

  describe('stars, recent and previous task', () => {
    beforeEach(() => {
      taskRepo.saveTask({ id: 'T1', projectId: 'P1', key: 'A-1', title: 'One', status: 'todo' });
      taskRepo.saveTask({ id: 'T2', projectId: 'P1', key: 'A-2', title: 'Two', status: 'todo' });
    });

    it('StarAndUnstar_AnswerTheStarredList', async () => {
      expect(await invoke(IPCChannel.STAR_TASK, 'T1')).toMatchObject([{ id: 'T1' }]);
      expect(await invoke(IPCChannel.GET_STARRED_TASKS)).toMatchObject([{ id: 'T1' }]);
      expect(await invoke(IPCChannel.UNSTAR_TASK, 'T1')).toEqual([]);
    });

    it.each([[IPCChannel.STAR_TASK], [IPCChannel.UNSTAR_TASK]])('%s_NoTaskId_Throws', async channel => {
      await expect(invoke(channel, '')).rejects.toThrow(/task id/);
    });

    it('RecentAndPrevious_FollowTheSessions', async () => {
      engine.startTask('T1');
      engine.startTask('T2');

      // Both started in the same millisecond: the order is the repository's test.
      const recent = (await invoke(IPCChannel.GET_RECENT_TASKS)) as Array<{ id: string }>;
      expect(recent.map(t => t.id).sort()).toEqual(['T1', 'T2']);
      expect(await invoke(IPCChannel.GET_PREVIOUS_TASK)).toMatchObject({ id: 'T1' });
    });
  });

  describe('the task picker', () => {
    beforeEach(() => {
      new ProjectRepository(db).saveProject({ id: 'P1', key: 'A', name: 'Alpha', providerId: 'jira' });
      taskRepo.saveTask({ id: 'T1', projectId: 'P1', key: 'A-1', title: 'One', status: 'todo' });
    });

    it('GetPickerData_OneRead_EverythingThePickerLists', async () => {
      taskRepo.star('T1');
      engine.startTask('T1');

      const data = await invoke(IPCChannel.GET_PICKER_DATA);

      expect(data).toMatchObject({
        previous: null,
        recent: [{ id: 'T1' }],
        starred: [{ id: 'T1' }],
        tasks: [{ id: 'T1' }],
        projects: [{ id: 'P1' }],
        projectSeconds: {}
      });
    });

    it('FetchTaskByKey_Found_KeepsItAndAnswersTheRow', async () => {
      const getTaskByKey = vi.fn().mockResolvedValue({ id: 'T77', projectId: 'P1', key: 'A-77', title: 'New', status: 'todo' });
      build({ providerManager: { getTaskByKey } as unknown as ProviderManager });

      expect(await invoke(IPCChannel.FETCH_TASK_BY_KEY, ' a-77 ')).toMatchObject({ id: 'T77', key: 'A-77' });
      expect(getTaskByKey).toHaveBeenCalledWith('a-77');
      expect(taskRepo.getTaskById('T77')).toMatchObject({ title: 'New' });
    });

    it('FetchTaskByKey_ProviderHasNone_Null', async () => {
      build({ providerManager: { getTaskByKey: vi.fn().mockResolvedValue(null) } as unknown as ProviderManager });

      expect(await invoke(IPCChannel.FETCH_TASK_BY_KEY, 'A-99')).toBeNull();
    });

    it('FetchTaskByKey_ProjectNotListed_RefusedAndNotKept', async () => {
      // Kept, it would be filed under nothing, and the next sync would retire it.
      const getTaskByKey = vi.fn().mockResolvedValue({ id: 'T88', projectId: 'P9', key: 'Z-88', title: 'Elsewhere', status: 'todo' });
      build({ providerManager: { getTaskByKey } as unknown as ProviderManager });

      await expect(invoke(IPCChannel.FETCH_TASK_BY_KEY, 'Z-88')).rejects.toThrow(/does not list/);
      expect(taskRepo.getTaskById('T88')).toBeNull();
    });

    it.each([[''], ['   '], [42]])('FetchTaskByKey_%s_Throws', async key => {
      await expect(invoke(IPCChannel.FETCH_TASK_BY_KEY, key)).rejects.toThrow(/key/);
    });
  });

  describe('provider settings', () => {
    it('GetProviders_List_NamesEachProviderAsTheAppWritesIt', async () => {
      const read = (await invoke(IPCChannel.GET_PROVIDERS)) as { providers: unknown };

      expect(read.providers).toEqual(selectableProviders());
    });

    it('GetProviderCapabilities_NoProvidersWired_ClaimsNothing', async () => {
      settingsRepo.setSetting(ProviderSettingKey.ACTIVE_PROVIDER_ID, 'jira');

      expect(await invoke(IPCChannel.GET_PROVIDER_CAPABILITIES)).toEqual({
        providerId: 'jira',
        canAssign: false,
        canTransition: false,
        canFindWorklog: false,
        canFetchByKey: false,
        hasHolidays: false
      });
    });

    it('GetProviderCapabilities_ProvidersWired_AreTheActiveOnes', async () => {
      settingsRepo.setSetting(ProviderSettingKey.ACTIVE_PROVIDER_ID, 'adhoc');
      build({ providerManager: new ProviderManager(settingsRepo) });

      expect(await invoke(IPCChannel.GET_PROVIDER_CAPABILITIES)).toMatchObject({ providerId: 'adhoc', canTransition: false });
    });

    it('SetActiveProvider_Secrets_AreReadBackButNotStoredInTheClear', async () => {
      await invoke(IPCChannel.SET_ACTIVE_PROVIDER, { providerId: 'jira', jiraApiToken: 'tok-123', opApiKey: 'key-456' });

      const read = (await invoke(IPCChannel.GET_PROVIDERS)) as Record<string, unknown>;
      expect(read.jiraApiToken).toBe('tok-123');
      expect(read.opApiKey).toBe('key-456');
      for (const key of [ProviderSettingKey.JIRA_API_TOKEN, ProviderSettingKey.OP_API_KEY]) {
        expect(settingsRepo.getSetting<string>(key, '')).toMatch(/^enc:/);
      }
    });

    it('SetActiveProvider_EveryField_IsWhatTheFormReadsBack', async () => {
      const fields = {
        opDomain: 'op.example', opStatusInProgress: '7', opStatusToTest: '8', opStatusToReview: '9',
        opCompletionAction: 'review', opTaskQuery: 'q-op', jiraSite: 'x.atlassian.net', jiraEmail: 'a@b.c',
        jiraTaskQuery: 'q-jira', jiraTransitionInProgress: '21', jiraTransitionToTest: '31',
        jiraTransitionToReview: '41', jiraCompletionAction: 'test', fallbackTicketKey: 'GEN-1'
      };

      await invoke(IPCChannel.SET_ACTIVE_PROVIDER, { providerId: 'openproject', ...fields });

      expect(await invoke(IPCChannel.GET_PROVIDERS)).toMatchObject({ activeProviderId: 'openproject', ...fields });
    });

    it('SetActiveProvider_UnknownTaskScope_IsStoredAsOneTheProviderKnows', async () => {
      // A value from an older renderer must not reach the provider as-is.
      await invoke(IPCChannel.SET_ACTIVE_PROVIDER, { providerId: 'jira', jiraTaskScope: 'everything-ever', opTaskScope: 'all_open' });
      const read = (await invoke(IPCChannel.GET_PROVIDERS)) as Record<string, string>;

      expect(read.jiraTaskScope).toBe('assigned_to_me');
      expect(read.opTaskScope).toBe('all_open');
    });
  });

  describe('dialogs and the shell', () => {
    describe('notification settings', () => {
      const platform = process.platform;
      const on = (value: string) => Object.defineProperty(process, 'platform', { value, configurable: true });
      afterEach(() => on(platform));

      it('OpenNotificationSettings_PrivacyPageMissing_FallsBackToTheGeneralOne', async () => {
        on('win32');
        electron.shell.openExternal.mockRejectedValueOnce(new Error('no handler')).mockResolvedValueOnce(undefined);

        await expect(invoke(IPCChannel.OPEN_NOTIFICATION_SETTINGS)).resolves.toBe(true);
        expect(electron.shell.openExternal).toHaveBeenLastCalledWith('ms-settings:notifications');
      });

      it('OpenNotificationSettings_NotWindows_OpensNothing', async () => {
        on('linux');

        await expect(invoke(IPCChannel.OPEN_NOTIFICATION_SETTINGS)).resolves.toBe(false);
        expect(electron.shell.openExternal).not.toHaveBeenCalled();
      });
    });

    it('OpenReleasePage_AnyOtherUrl_IsRefused', async () => {
      // The URL comes from the renderer; openExternal launches any protocol handler.
      await expect(invoke(IPCChannel.OPEN_RELEASE_PAGE, 'file:///C:/Windows/System32/calc.exe')).resolves.toBe(false);
      await expect(invoke(IPCChannel.OPEN_RELEASE_PAGE, 'https://github.com/Istalry/SprintTicker.evil/')).resolves.toBe(false);
      expect(electron.shell.openExternal).not.toHaveBeenCalled();
    });

    it('OpenReleasePage_ThisProjectsRelease_OpensIt', async () => {
      const url = 'https://github.com/Istalry/SprintTicker/releases/tag/v1.2.0';

      await expect(invoke(IPCChannel.OPEN_RELEASE_PAGE, url)).resolves.toBe(true);
      expect(electron.shell.openExternal).toHaveBeenCalledWith(url);
    });
  });

  describe('diagnostics export', () => {
    it('ExportDiagnostics_PathChosen_WritesTheBundleThere', async () => {
      const file = path.join(dir, 'bundle.json');
      electron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: file });

      await expect(invoke(IPCChannel.EXPORT_DIAGNOSTIC_LOGS)).resolves.toBe(true);
      expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toBeTypeOf('object');
    });

    it('ExportDiagnostics_Cancelled_WritesNothing', async () => {
      electron.dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });

      await expect(invoke(IPCChannel.EXPORT_DIAGNOSTIC_LOGS)).resolves.toBe(false);
      expect(fs.readdirSync(dir)).toEqual([]);
    });

    it('ExportDiagnostics_NoWindow_AnswersFalse', async () => {
      window = null;

      await expect(invoke(IPCChannel.EXPORT_DIAGNOSTIC_LOGS)).resolves.toBe(false);
      expect(electron.dialog.showSaveDialog).not.toHaveBeenCalled();
    });

    it('ExportDiagnostics_WriteFails_AnswersFalse', async () => {
      electron.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: path.join(dir, 'missing', 'x.json') });

      await expect(invoke(IPCChannel.EXPORT_DIAGNOSTIC_LOGS)).resolves.toBe(false);
    });
  });

  describe('update check', () => {
    it('CheckForUpdate_NoChecker_SaysDisabled', async () => {
      await expect(invoke(IPCChannel.CHECK_FOR_UPDATE)).resolves.toEqual({ status: 'disabled', currentVersion: '9.9.9' });
      await expect(invoke(IPCChannel.GET_UPDATE_CHECK_ENABLED)).resolves.toBe(false);
      await expect(invoke(IPCChannel.SET_UPDATE_CHECK_ENABLED, true)).resolves.toBe(false);
    });

    it('CheckForUpdate_CheckerThrows_SaysFailedNotUpToDate', async () => {
      // "Up to date" when the check could not run is the lie audit F-18 was about.
      build({ updateChecker: { checkForUpdate: vi.fn().mockRejectedValue(new Error('rate limited')), isEnabled: () => true, setEnabled: vi.fn() } });

      await expect(invoke(IPCChannel.CHECK_FOR_UPDATE)).resolves.toEqual({
        status: 'failed',
        currentVersion: '9.9.9',
        reason: 'rate limited'
      });
    });

    it('GetSystemLocale_AnswersWindowsRegionalFormat', async () => {
      // Not the app's locale, which is en-US everywhere once only en-US ships.
      await expect(invoke(IPCChannel.GET_SYSTEM_LOCALE)).resolves.toBe('fr-BE');
    });

    it('BroadcastUpdateStatus_ReachesTheRenderer', () => {
      const status: UpdateStatusDTO = { status: 'disabled', currentVersion: '9.9.9' };

      registry.broadcastUpdateStatus(status);

      expect(sentOn(IPCChannel.ON_UPDATE_STATUS)).toEqual([status]);
    });
  });

  describe('start with Windows', () => {
    const service = () => {
      let entry = false;
      const api = {
        getLoginItemSettings: vi.fn(() => ({ executableWillLaunchAtLogin: entry })),
        setLoginItemSettings: vi.fn((s: { openAtLogin: boolean }) => { entry = s.openAtLogin; })
      };
      return { api, launchAtLogin: new LaunchAtLoginService(api, { platform: 'win32', isPackaged: true, execPath: 'C:\\App\\SprintTicker.exe' }) };
    };

    it('LaunchAtLogin_NoService_SaysUnavailableAndWritesNothing', async () => {
      await expect(invoke(IPCChannel.GET_LAUNCH_AT_LOGIN)).resolves.toEqual({ enabled: false, available: false, reason: null });
      await expect(invoke(IPCChannel.SET_LAUNCH_AT_LOGIN, true)).resolves.toEqual({ enabled: false, available: false, reason: null });
    });

    it('LaunchAtLogin_Set_AnswersWhatWindowsThenReports', async () => {
      const { api, launchAtLogin } = service();
      build({ launchAtLogin });

      await expect(invoke(IPCChannel.SET_LAUNCH_AT_LOGIN, true)).resolves.toEqual({ enabled: true, available: true, reason: null });
      await expect(invoke(IPCChannel.GET_LAUNCH_AT_LOGIN)).resolves.toEqual({ enabled: true, available: true, reason: null });
      expect(api.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, path: 'C:\\App\\SprintTicker.exe', args: ['--hidden'] });
    });

    it('LaunchAtLogin_SetNotABoolean_RefusesAndWritesNothing', async () => {
      // "false" as a string is truthy: passed through, it would switch it on.
      const { api, launchAtLogin } = service();
      build({ launchAtLogin });

      await expect(invoke(IPCChannel.SET_LAUNCH_AT_LOGIN, 'false')).rejects.toThrow(/on or off/);
      expect(api.setLoginItemSettings).not.toHaveBeenCalled();
    });
  });

  describe('the task key colour', () => {
    it('ColorTheme_NothingStored_ReadsTheDefault', async () => {
      await expect(invoke(IPCChannel.GET_COLOR_THEME)).resolves.toBe('emerald');
    });

    it('ColorTheme_Set_StoredAndReadBack', async () => {
      // A restart used to forget it: it lived in the renderer's memory alone.
      await invoke(IPCChannel.SET_COLOR_THEME, 'retro_arcade');

      expect(settingsRepo.getSetting('color_theme', null)).toBe('retro_arcade');
      await expect(invoke(IPCChannel.GET_COLOR_THEME)).resolves.toBe('retro_arcade');
    });

    it('ColorTheme_Unknown_RefusedAndNothingStored', async () => {
      await expect(invoke(IPCChannel.SET_COLOR_THEME, 'sepia')).rejects.toThrow(/key colour/);
      expect(settingsRepo.getSetting('color_theme', null)).toBeNull();
    });

    it('ColorTheme_StoredValueNoLongerKnown_ReadsTheDefault', async () => {
      settingsRepo.setSetting('color_theme', 'sepia');

      await expect(invoke(IPCChannel.GET_COLOR_THEME)).resolves.toBe('emerald');
    });
  });

  describe('the Interrupt shortcut', () => {
    const OFF = { enabled: false, accelerator: 'Ctrl+Alt+Shift+I', registered: false, problem: null };
    const service = () => ({
      getStatus: vi.fn().mockReturnValue(OFF),
      set: vi.fn((s: { enabled: boolean; accelerator: string }) => ({ ...s, registered: s.enabled, problem: null })),
      setRecording: vi.fn().mockReturnValue(OFF)
    });

    it('InterruptShortcut_NoService_SaysOffAndRegistersNothing', async () => {
      await expect(invoke(IPCChannel.GET_INTERRUPT_SHORTCUT)).resolves.toEqual(OFF);
      await expect(invoke(IPCChannel.SET_INTERRUPT_SHORTCUT, { enabled: true, accelerator: 'Ctrl+Alt+Shift+I' })).resolves.toEqual(OFF);
    });

    it('InterruptShortcut_Set_AnswersTheService', async () => {
      const interruptShortcut = service();
      build({ interruptShortcut });

      await expect(invoke(IPCChannel.SET_INTERRUPT_SHORTCUT, { enabled: true, accelerator: 'Ctrl+Shift+F9' }))
        .resolves.toEqual({ enabled: true, accelerator: 'Ctrl+Shift+F9', registered: true, problem: null });
      await expect(invoke(IPCChannel.GET_INTERRUPT_SHORTCUT)).resolves.toEqual(OFF);
    });

    it('InterruptShortcut_SetNotASetting_Refused', async () => {
      const interruptShortcut = service();
      build({ interruptShortcut });

      await expect(invoke(IPCChannel.SET_INTERRUPT_SHORTCUT, 'Ctrl+Alt+Shift+I')).rejects.toThrow(/setting/);
      expect(interruptShortcut.set).not.toHaveBeenCalled();
    });

    it('InterruptShortcut_Recording_PassedOnAsABoolean', async () => {
      const interruptShortcut = service();
      build({ interruptShortcut });

      await invoke(IPCChannel.SET_INTERRUPT_SHORTCUT_RECORDING, true);
      expect(interruptShortcut.setRecording).toHaveBeenCalledWith(true);
      await expect(invoke(IPCChannel.SET_INTERRUPT_SHORTCUT_RECORDING, 'yes')).rejects.toThrow(/on or off/);
      expect(interruptShortcut.setRecording).toHaveBeenCalledTimes(1);
    });
  });
});
