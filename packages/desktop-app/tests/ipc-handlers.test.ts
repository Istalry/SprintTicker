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
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { InputDecoder } from '../src/main/hardware/input-decoder';
import { PriorityPreemptionEngine } from '../src/main/services/priority-preemption-engine';
import { IPCHandlerRegistry } from '../src/main/ipc/ipc-handler-registry';
import { IPCChannel } from '../src/shared/ipc-channels';
import { ProviderSettingKey } from '../src/shared/provider-settings';
import type { PriorityRule, UpdateStatusDTO } from '../src/shared/dtos';
import { RESUME_PROMPT_EVENT } from '../src/shared/priority-defaults';
import { OWN_PROJECT_PROVIDER_ID } from '../src/shared/local-provider';

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
  let saveUnityScenes: ReturnType<typeof vi.fn>;
  let dir: string;

  const handler = (channel: string) => {
    const found = electron.ipcMain.handle.mock.calls.filter(([name]) => name === channel).at(-1);
    if (!found) throw new Error(`No handler for ${channel}`);
    return found[1] as (event: unknown, payload?: unknown) => Promise<unknown>;
  };
  const invoke = (channel: string, payload?: unknown) => handler(channel)({}, payload);
  const sentOn = (channel: string) => sent.filter(s => s.channel === channel).map(s => s.payload);

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
      saveUnityScenes,
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
    saveUnityScenes = vi.fn().mockResolvedValue(false);
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
      build({ contextScheduleService: { answerResumePrompt } });
      vi.spyOn(priorityEngine, 'getActiveLockEventName').mockReturnValue(RESUME_PROMPT_EVENT);
      decoder.setPriorityEngine(priorityEngine);

      decoder.handleHardwareInput({ key, type: 'press', timestamp: new Date().toISOString() });

      expect(answerResumePrompt).toHaveBeenCalledWith(resume);
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
      const getResumePrompt = vi.fn().mockReturnValue({ taskKey: 'SCRUM-2', taskTitle: 'Tache 2' });
      build({ contextScheduleService: { answerResumePrompt, getResumePrompt } });

      expect(await invoke(IPCChannel.GET_RESUME_PROMPT)).toEqual({ taskKey: 'SCRUM-2', taskTitle: 'Tache 2' });
      expect(await invoke(IPCChannel.ANSWER_RESUME_PROMPT, false)).toBe(true);
      expect(answerResumePrompt).toHaveBeenCalledWith(false);
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
      saveUnityScenes.mockResolvedValue(true);

      const res = await invoke(IPCChannel.TRIGGER_EOD_WRAP_UP, {});

      expect(res).toEqual({ success: true, savedUnityScenes: true, savedVSCode: true });
    });

    it('WrapUp_EditorSaveThrows_StillWrapsUp', async () => {
      // Saving editors is a courtesy; the wrap-up is what the user asked for.
      automation.saveOpenEditors.mockRejectedValue(new Error('code: not found'));

      const res = await invoke(IPCChannel.TRIGGER_EOD_WRAP_UP, {});

      expect(res).toEqual({ success: true, savedUnityScenes: false, savedVSCode: false });
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

  describe('provider settings', () => {
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
    it.each([
      [{ canceled: true, filePaths: [] }, null],
      [{ canceled: false, filePaths: [] }, null],
      [{ canceled: false, filePaths: ['D:\\Unity'] }, 'D:\\Unity']
    ])('OpenFolderPicker_%j_Answers%s', async (answer, expected) => {
      electron.dialog.showOpenDialog.mockResolvedValue(answer);

      await expect(invoke(IPCChannel.OPEN_FOLDER_PICKER)).resolves.toBe(expected);
    });

    it('OpenFolderPicker_NoWindow_StillOpensTheDialog', async () => {
      window = null;
      electron.dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:\\Unity'] });

      await expect(invoke(IPCChannel.OPEN_FOLDER_PICKER)).resolves.toBe('D:\\Unity');
      expect(electron.dialog.showOpenDialog).toHaveBeenCalledWith({ properties: ['openDirectory'] });
    });

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
});
