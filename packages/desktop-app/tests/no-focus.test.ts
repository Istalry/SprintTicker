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
import { ForgottenSessionService } from '../src/main/services/forgotten-session-service';
import { PresenceMonitor } from '../src/main/services/presence-monitor';
import { ElectronToastPresenter, NotificationLike, ToastPresenter } from '../src/main/services/toast-presenter';
import { OutletWindow, PromptOutlet, WindowPromptOutlet } from '../src/main/windows/prompt-outlet';
import type { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { IPCChannel } from '../src/shared/ipc-channels';

/**
 * A prompt never takes the focus (redesign P8c).
 *
 * The stand-up, the wrap-up, Lunch's end and a session left running all
 * used to show() and focus() the dashboard, which came up over whatever the
 * user was typing into. Now a question goes to every window -- a card on
 * Today, a row on the mini timer -- and to a toast only while the dashboard
 * is hidden; only the toast's click, the user's, brings it forward.
 */
describe('Prompts without focus', () => {
  const windowLike = (over: Partial<OutletWindow> = {}) => {
    const send = vi.fn();
    const win = {
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      webContents: { isDestroyed: () => false, send },
      ...over
    };
    return { win, send };
  };

  describe('WindowPromptOutlet', () => {
    const outletOver = (dashboard: OutletWindow | null, windows: OutletWindow[] = dashboard ? [dashboard] : []) => {
      const toasts: ToastPresenter = { show: vi.fn().mockReturnValue(true) };
      const outlet = new WindowPromptOutlet({ getWindows: () => windows, getDashboard: () => dashboard, toasts });
      return { outlet, toasts };
    };

    it('Send_TwoWindowsAndADestroyedOne_ReachesTheLiveOnes', () => {
      const dashboard = windowLike();
      const mini = windowLike();
      const gone = windowLike({ isDestroyed: () => true });
      const { outlet } = outletOver(dashboard.win, [dashboard.win, mini.win, gone.win]);

      outlet.send('channel', { a: 1 });

      expect(dashboard.send).toHaveBeenCalledWith('channel', { a: 1 });
      expect(mini.send).toHaveBeenCalledWith('channel', { a: 1 });
      expect(gone.send).not.toHaveBeenCalled();
    });

    it('Announce_DashboardOnScreen_NoToast', () => {
      const { outlet, toasts } = outletOver(windowLike().win);

      outlet.announce({ title: 'Stand-up at 09:30', body: 'Click to join or skip.' });

      expect(toasts.show).not.toHaveBeenCalled();
    });

    it.each([
      ['hidden in the tray', { isVisible: () => false }],
      ['minimised', { isMinimized: () => true }]
    ])('Announce_Dashboard%s_ToastsAndItsClickOpensToday', (_what, over) => {
      const { outlet, toasts } = outletOver(windowLike(over).win);

      outlet.announce({ title: 'Stand-up at 09:30', body: 'Click to join or skip.' });

      // Today, where the question waits as a card (P12c).
      expect(toasts.show).toHaveBeenCalledWith({ title: 'Stand-up at 09:30', body: 'Click to join or skip.', route: 'today' });
    });

    it('Announce_WithARoute_KeepsIt', () => {
      const { outlet, toasts } = outletOver(null);

      outlet.announce({ title: 'x', body: 'y', route: 'end-day' });

      expect(vi.mocked(toasts.show).mock.calls[0][0].route).toBe('end-day');
    });

    it('Announce_NoDashboardYet_Toasts', () => {
      const { outlet, toasts } = outletOver(null);

      outlet.announce({ title: 'x', body: 'y' });

      expect(toasts.show).toHaveBeenCalledTimes(1);
    });
  });

  it('ElectronToastPresenter_Clicked_OpensTheWindowOnItsRoute', () => {
    const listeners: Record<string, (...args: unknown[]) => void> = {};
    const notification: NotificationLike = { show: vi.fn(), on: (event, listener) => { listeners[event] = listener; return notification; } };
    const openRoute = vi.fn();
    const presenter = new ElectronToastPresenter({ isSupported: () => true, create: () => notification, openExternal: vi.fn(), openRoute });

    presenter.show({ title: 't', body: 'b', route: 'today' });
    listeners.click();

    expect(openRoute).toHaveBeenCalledWith('today');
  });

  describe('the schedule and a forgotten session', () => {
    let dbConn: DatabaseConnection;
    let settings: SettingsRepository;
    let engine: TimeTrackingEngine;
    let priority: PriorityPreemptionEngine;
    let service: ContextScheduleService;
    let raised: { show: ReturnType<typeof vi.fn>; focus: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn> };
    let outlet: { send: ReturnType<typeof vi.fn>; announce: ReturnType<typeof vi.fn> };

    /** 14 October 2026, a Wednesday. */
    const at = (hours: number, minutes: number, day = 14) => vi.setSystemTime(new Date(2026, 9, day, hours, minutes, 0));
    const sent = (channel: IPCChannel) => outlet.send.mock.calls.filter(([c]) => c === channel).map(([, payload]) => payload);
    const minimisedWindow = () => ({
      isDestroyed: () => false,
      isMinimized: () => true,
      ...raised,
      webContents: { send: vi.fn() }
    }) as unknown as BrowserWindow;

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      at(9, 0);
      dbConn = new DatabaseConnection(':memory:');
      settings = new SettingsRepository(dbConn);
      settings.setSetting('schedule_settings', {
        standupTime: '09:30', lunchStartTime: '12:30', lunchEndTime: '13:30', eodWrapUpTime: '17:30'
      });
      engine = new TimeTrackingEngine(
        new SessionRepository(dbConn), new WorklogRepository(dbConn), new TaskRepository(dbConn), undefined, new ProjectRepository(dbConn)
      );
      priority = new PriorityPreemptionEngine(settings);
      raised = { show: vi.fn(), focus: vi.fn(), restore: vi.fn() };
      outlet = { send: vi.fn(), announce: vi.fn() };
      const renderer = { setContextMode: vi.fn(), renderResumePrompt: vi.fn(), renderCeremonyPrompt: vi.fn() };
      service = new ContextScheduleService(priority, settings, engine, renderer as unknown as DisplayRenderer, minimisedWindow);
      service.setPromptOutlet(outlet as PromptOutlet);
      service.evaluateSchedule(); // the first check, at 09:00
    });

    afterEach(() => {
      service.dispose();
      engine.dispose();
      dbConn.close();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('Standup_Due_ACardEverywhereAndAToast_NeverTheFocus', () => {
      at(9, 30);
      service.evaluateSchedule();

      expect(sent(IPCChannel.ON_CEREMONY_PROMPT)).toEqual([{ type: 'STANDUP', title: 'Daily Stand-Up', at: '09:30' }]);
      expect(outlet.announce).toHaveBeenCalledWith({ title: 'Stand-up at 09:30', body: 'Click to join or skip.' });
      expect(service.getCeremonyPrompt()).toMatchObject({ type: 'STANDUP' });
      expect(raised.show).not.toHaveBeenCalled();
      expect(raised.focus).not.toHaveBeenCalled();
      expect(raised.restore).not.toHaveBeenCalled();
    });

    it('Standup_StaysUntilAnswered_JoinClosesItEverywhere', () => {
      at(9, 30);
      service.evaluateSchedule();
      at(9, 45);
      service.evaluateSchedule();
      expect(service.getCeremonyPrompt()).not.toBeNull();

      service.joinStandup();

      expect(service.getCeremonyPrompt()).toBeNull();
      expect(sent(IPCChannel.ON_CEREMONY_PROMPT).at(-1)).toBeNull();
    });

    it.each([
      ['skipped', (s: ContextScheduleService) => s.skipStandup()],
      ['put off 10 min', (s: ContextScheduleService) => s.snoozeCeremony('STANDUP', 10)]
    ])('Standup_%s_ClosesTheCard', (_what, answer) => {
      at(9, 30);
      service.evaluateSchedule();

      answer(service);

      expect(service.getCeremonyPrompt()).toBeNull();
      expect(sent(IPCChannel.ON_CEREMONY_PROMPT).at(-1)).toBeNull();
    });

    it('Standup_Skipped_ReleasesTheBarsPrompt', () => {
      at(9, 30);
      service.evaluateSchedule();
      const release = vi.spyOn(priority, 'releaseActiveLock');

      service.skipStandup();

      expect(release).toHaveBeenCalledWith('standupPromptPriority');
    });

    it('Check_EveryTick_TellsItsListeners_AFailingOneDoesNotStopTheOthers', () => {
      const failing = vi.fn(() => { throw new Error('boom'); });
      const listener = vi.fn();
      service.onChecked(failing);
      const off = service.onChecked(listener);

      service.evaluateSchedule();
      off();
      service.evaluateSchedule();

      expect(failing).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('StandupRunning_SaysTheTaskItGoesBackTo', () => {
      // The mini timer's "then back to MG-12, as it was" (P12d).
      const before = engine.startNamedAdHocTask('Lantern glow');
      expect(service.standupRunning()).toBeNull();
      at(9, 30);
      service.evaluateSchedule();

      service.joinStandup();

      expect(service.standupRunning()).toEqual({ returnsToKey: before.taskKey });
    });

    it('StandupRunning_NothingBefore_GoesBackToNothing', () => {
      at(9, 30);
      service.evaluateSchedule();

      service.joinStandup();

      expect(service.standupRunning()).toEqual({ returnsToKey: null });
    });

    it('IsStandup_TheLocalStandupOrTheChosenTask', () => {
      const local = engine.startNamedAdHocTask('Daily Standup');
      expect(service.isStandup(local)).toBe(true);

      service.setStandupTask({ taskId: 'T-9', taskKey: 'OPS-4', title: 'Team ceremonies' });
      expect(service.isStandup({ ...local, taskId: 'T-9', isAdHoc: false, taskTitle: 'Team ceremonies' })).toBe(true);
      expect(service.isStandup({ ...local, taskId: 'T-1', isAdHoc: false, taskTitle: 'Other' })).toBe(false);
    });

    it('WrapUp_Due_TheWindowIsToldButNotRaised', () => {
      at(17, 30);
      service.evaluateSchedule();

      expect(sent(IPCChannel.ON_CEREMONY_PROMPT).at(-1)).toEqual({ type: 'EOD', title: 'End-of-Day Wrap-Up', at: '17:30' });
      expect(outlet.announce).toHaveBeenCalledWith(expect.objectContaining({ title: 'Time to end your day' }));
      expect(raised.show).not.toHaveBeenCalled();
      expect(raised.focus).not.toHaveBeenCalled();

      service.closeEodPrompt();
      expect(service.getCeremonyPrompt()).toBeNull();
    });

    it('Lunch_PausesTheTaskWithAToast_ItsEndAsksWithAnother_NeverTheFocus', () => {
      at(10, 0);
      engine.startTask('T-1', false, 'Fix the lantern glow', 'P', 'MG-12');

      at(12, 30);
      service.evaluateSchedule();
      expect(outlet.announce).toHaveBeenCalledWith({
        title: 'Lunch -- MG-12 paused',
        body: 'At 13:30 you are asked if you are back. Click to keep working instead.'
      });

      at(13, 30);
      service.evaluateSchedule();
      expect(sent(IPCChannel.ON_RESUME_PROMPT).at(-1)).toMatchObject({ taskKey: 'MG-12', held: true });
      expect(outlet.announce).toHaveBeenLastCalledWith({ title: 'Lunch is over. Back at your desk?', body: 'MG-12 starts when you say.' });
      expect(raised.show).not.toHaveBeenCalled();
      expect(raised.focus).not.toHaveBeenCalled();
    });

    it('ForgottenSession_Found_TheQuestionWaitsWithAToast_NeverTheFocus', () => {
      let lastInput = new Date(2026, 9, 16, 18, 4).getTime();
      const presence = new PresenceMonitor(settings, () => (Date.now() - lastInput) / 1000);
      const forgotten = new ForgottenSessionService(engine, settings, presence, minimisedWindow);
      forgotten.setPromptOutlet(outlet as PromptOutlet);
      vi.setSystemTime(new Date(2026, 9, 16, 10, 0));
      engine.startTask('T-1', false, 'Fix the lantern glow', 'P', 'MG-12');
      vi.setSystemTime(lastInput);
      forgotten.check();

      lastInput = new Date(2026, 9, 19, 9, 0).getTime();
      vi.setSystemTime(lastInput);
      forgotten.check();

      expect(sent(IPCChannel.ON_FORGOTTEN_SESSION_REVIEW).at(-1)).toMatchObject({ taskKey: 'MG-12' });
      expect(outlet.announce).toHaveBeenCalledWith(expect.objectContaining({ title: 'MG-12 ran all night' }));
      expect(raised.show).not.toHaveBeenCalled();
      expect(raised.focus).not.toHaveBeenCalled();
      forgotten.dispose?.();
    });
  });
});
