import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TrayManager } from '../src/main/tray/tray-manager';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { app, Menu, BrowserWindow, nativeImage } from 'electron';
import fs from 'fs';
import { IPCChannel } from '../src/shared/ipc-channels';
import { LaunchAtLoginService } from '../src/main/services/launch-at-login';
import type { UserMode } from '../src/shared/dtos';

// Shared mock tray instance — populated by the Tray constructor mock on each initialize() call
let lastMockTray: {
  setToolTip: ReturnType<typeof vi.fn>;
  setContextMenu: ReturnType<typeof vi.fn>;
  popUpContextMenu: ReturnType<typeof vi.fn>;
  setImage: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
} | null = null;

vi.mock('electron', () => {
  return {
    app: {
      isPackaged: false,
      quit: vi.fn()
    },
    Menu: {
      buildFromTemplate: vi.fn().mockReturnValue({})
    },
    // A function expression, not an arrow. TrayManager calls `new Tray(...)`,
    // and vitest 5 invokes the mock implementation as the constructor -- an
    // arrow function has no [[Construct]] slot, so it throws "is not a
    // constructor". Returning an object from a constructor call overrides
    // `this`, which is what makes this work.
    Tray: vi.fn(function () {
      lastMockTray = {
        setToolTip: vi.fn(),
        setContextMenu: vi.fn(),
        popUpContextMenu: vi.fn(),
        setImage: vi.fn(),
        on: vi.fn(),
        destroy: vi.fn()
      };
      return lastMockTray;
    }),
    nativeImage: {
      createFromDataURL: vi.fn().mockReturnValue({}),
      createFromPath: vi.fn().mockReturnValue({}),
      createFromBuffer: vi.fn(() => ({ addRepresentation: vi.fn() }))
    }
  };
});

describe('TrayManager Unit Tests', () => {
  let dbConn: DatabaseConnection;
  let sessionRepo: SessionRepository;
  let worklogRepo: WorklogRepository;
  let taskRepo: TaskRepository;
  let engine: TimeTrackingEngine;
  let mockWindow: BrowserWindow;

  beforeEach(() => {
    dbConn = new DatabaseConnection(':memory:');
    sessionRepo = new SessionRepository(dbConn);
    worklogRepo = new WorklogRepository(dbConn);
    taskRepo = new TaskRepository(dbConn);
    engine = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo, undefined, new ProjectRepository(dbConn));

    mockWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      isMinimized: vi.fn().mockReturnValue(false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      hide: vi.fn(),
      on: vi.fn(),
      // The task-selector menu item forwards to the renderer over this, and a
      // window without it made that one item unreachable from a test.
      webContents: { send: vi.fn() }
    } as unknown as BrowserWindow;
  });

  afterEach(() => {
    engine.dispose();
    dbConn.close();
  });

  /** The tray's handler for `event`, as `initialize` registered it. */
  const trayHandler = (event: string): (() => void) =>
    (lastMockTray!.on.mock.calls as Array<[string, () => void]>).find(c => c[0] === event)![1];

  it('TrayManager_SingleClick_OpensTheWindow', () => {
    // S26: a single click; the double-click it replaced was a second guess.
    const manager = new TrayManager(mockWindow, engine);
    manager.initialize();

    trayHandler('click')();

    expect(mockWindow.show).toHaveBeenCalled();
    expect(mockWindow.focus).toHaveBeenCalled();
    manager.destroy();
  });

  it('TrayManager_Initialize_LeavesTheWindowsCloseAlone', () => {
    // The close is MainWindowCloseGuard's now: it hides to the tray. The
    // tray used to take it as a quit.
    const manager = new TrayManager(mockWindow, engine);
    manager.initialize();

    expect(mockWindow.on).not.toHaveBeenCalledWith('close', expect.any(Function));
    manager.destroy();
  });

  it('TrayManager_RightClick_PopsUpTheMenuBuiltNow', () => {
    const manager = new TrayManager(mockWindow, engine);
    manager.initialize();
    const builds = vi.mocked(Menu.buildFromTemplate).mock.calls.length;

    trayHandler('right-click')();

    expect(vi.mocked(Menu.buildFromTemplate).mock.calls.length).toBe(builds + 1);
    expect(lastMockTray!.popUpContextMenu).toHaveBeenCalledTimes(1);
    manager.destroy();
  });

  it('TrayManager_RestoreWindow_WhenMinimized_RestoresAndShows', () => {
    mockWindow.isMinimized = vi.fn().mockReturnValue(true);

    const manager = new TrayManager(mockWindow, engine);
    manager.initialize();
    manager.restoreWindow();

    expect(mockWindow.restore).toHaveBeenCalled();
    expect(mockWindow.show).toHaveBeenCalled();
    manager.destroy();
  });

  it('TrayManager_UpdateStatusTooltip_WhenPaused_SetsPausedTooltip', () => {
    // Arrange: initialize creates a fresh tray captured in lastMockTray
    const manager = new TrayManager(mockWindow, engine);
    manager.initialize();
    const trayInstance = lastMockTray!;

    // Transition: TRACKING → PAUSED fires engine subscriber → updateStatusTooltip
    engine.startTask('PROJ-101', false, 'Tooltip Test');
    engine.pauseSession();

    const hasPausedTooltip = (trayInstance.setToolTip.mock.calls as string[][]).some(
      args => args[0].includes('PAUSED')
    );
    expect(hasPausedTooltip).toBe(true);
    manager.destroy();
  });

  it('TrayManager_UpdateStatusTooltip_WhenTracking_SetsTrackingTooltip', () => {
    const manager = new TrayManager(mockWindow, engine);
    manager.initialize();
    const trayInstance = lastMockTray!;

    engine.startTask('PROJ-202', false, 'Tracking Tooltip Test');

    // Names the app, as the idle tooltip does -- not the device it drives.
    const hasTrackingTooltip = (trayInstance.setToolTip.mock.calls as string[][]).some(
      args => args[0].startsWith('SprintTicker: TRACKING')
    );
    expect(hasTrackingTooltip).toBe(true);
    manager.destroy();
  });

  /**
   * The menu of S26, as `buildMenu` answers it for each state: the template
   * Menu.buildFromTemplate receives, so any item's click can be invoked by
   * its label.
   */
  describe('the menu', () => {
    type MenuTemplateItem = {
      label?: string;
      type?: string;
      checked?: boolean;
      click?: (item: { checked: boolean }) => void;
    };

    let template: MenuTemplateItem[];

    beforeEach(() => {
      template = [];
      vi.mocked(Menu.buildFromTemplate).mockImplementation((built: MenuTemplateItem[]) => {
        template = built;
        return {} as unknown as Menu;
      });
    });

    const labels = () => template.filter(i => i.label).map(i => i.label);

    function click(label: string, item: { checked: boolean } = { checked: false }): void {
      const entry = template.find(i => i.label === label);
      if (!entry?.click) throw new Error(`No clickable menu item labelled '${label}'`);
      entry.click(item);
    }

    function commands(mode: UserMode = 'WORK') {
      let current = mode;
      return {
        stop: vi.fn(),
        chooseMode: vi.fn((next: UserMode) => { current = next; }),
        getMode: () => current,
        endDay: vi.fn()
      };
    }

    function trayWith(options: { interrupt?: () => void; commands?: ReturnType<typeof commands> } = {}): TrayManager {
      const manager = new TrayManager(mockWindow, engine, undefined, undefined, options.interrupt, undefined, options.commands);
      manager.initialize();
      manager.buildMenu();
      return manager;
    }

    it('Menu_NothingTiming_SwitchInterruptModesAndQuit', () => {
      const manager = trayWith({ interrupt: vi.fn(), commands: commands() });

      expect(labels()).toEqual([
        'Open SprintTicker', 'Switch task…', 'Interrupt', 'Lunch', 'Away', 'End my day…', 'Quit'
      ]);
      manager.destroy();
    });

    it('Menu_Timing_PauseStopAndThePreviousTask', () => {
      engine.startTask('PROJ-2', false, 'Second');
      // Which task is previous is the engine's rule (previous-task.test.ts).
      vi.spyOn(engine, 'getPreviousTask').mockReturnValue({ id: 'PROJ-1', projectId: 'P', key: 'PROJ-1', title: 'First', status: 'todo' });
      const tray = commands();
      const manager = trayWith({ interrupt: vi.fn(), commands: tray });

      expect(labels()).toEqual([
        'Open SprintTicker', 'Switch task…', 'Previous task: PROJ-1', 'Pause', 'Stop', 'Interrupt',
        'Lunch', 'Away', 'End my day…', 'Quit'
      ]);
      click('Previous task: PROJ-1');
      expect(engine.getCurrentSession()?.taskId).toBe('PROJ-1');
      click('Stop');
      expect(tray.stop).toHaveBeenCalledTimes(1);
      manager.destroy();
    });

    it('Menu_PauseThenResume_FollowTheSession', () => {
      engine.startTask('PROJ-301', false, 'Tray pause');
      const manager = trayWith({ commands: commands() });

      click('Pause');
      expect(engine.getCurrentSession()?.status).toBe('PAUSED');
      manager.buildMenu();
      click('Resume');
      expect(engine.getCurrentSession()?.status).toBe('TRACKING');
      manager.destroy();
    });

    it('Menu_DuringAnInterruption_BackToTheTask_NoPauseNorPrevious', () => {
      engine.startTask('PROJ-1', false, 'First');
      engine.startTask('PROJ-2', false, 'Second');
      engine.startInterruption(new Date(), 'tray');
      const manager = trayWith({ interrupt: vi.fn(), commands: commands() });

      expect(labels()).toContain('↩ Back to PROJ-2');
      expect(labels()).not.toContain('Pause');
      expect(labels().some(l => l?.startsWith('Previous'))).toBe(false);
      expect(labels()).not.toContain('Interrupt');
      // Choosing a task does nothing during one (2026-11-12).
      expect(labels()).not.toContain('Switch task…');
      click('↩ Back to PROJ-2');
      expect(engine.getCurrentSession()).toMatchObject({ taskId: 'PROJ-2', status: 'TRACKING' });
      expect(engine.getCurrentSession()?.interruption).toBeUndefined();
      manager.destroy();
    });

    it('Menu_InterruptionHoldingNothing_InterruptIsAnother', () => {
      engine.startInterruption(new Date(), 'tray');
      const interrupt = vi.fn();
      const manager = trayWith({ interrupt, commands: commands() });

      click('Another interruption');

      expect(interrupt).toHaveBeenCalledTimes(1);
      manager.destroy();
    });

    it('Menu_Interrupt_StartsItWithoutTheWindow', () => {
      const interrupt = vi.fn();
      const manager = trayWith({ interrupt });

      click('Interrupt');

      expect(interrupt).toHaveBeenCalledTimes(1);
      expect(mockWindow.show).not.toHaveBeenCalled();
      manager.destroy();
    });

    it('Menu_ActionFails_TheClickDoesNotThrow', () => {
      // A throw from a menu click would reach Electron's main process.
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const manager = trayWith({ interrupt: () => { throw new Error('database closed'); } });

      expect(() => click('Interrupt')).not.toThrow();
      manager.destroy();
    });

    it('Menu_NoInterrupt_OffersNoEntry', () => {
      const manager = trayWith();

      expect(labels()).not.toContain('Interrupt');
      manager.destroy();
    });

    it('Menu_LunchAndAway_TickedWhileOn_ClickingTheOneOnGoesBackToWork', () => {
      const tray = commands('LUNCH');
      const manager = trayWith({ commands: tray });

      expect(template.find(i => i.label === 'Lunch')?.checked).toBe(true);
      expect(template.find(i => i.label === 'Away')?.checked).toBe(false);
      click('Lunch');
      expect(tray.chooseMode).toHaveBeenLastCalledWith('WORK');
      manager.buildMenu();
      click('Away');
      expect(tray.chooseMode).toHaveBeenLastCalledWith('AWAY');
      manager.destroy();
    });

    it('Menu_EndMyDay_OpensItInTheWindow', () => {
      const tray = commands();
      const manager = trayWith({ commands: tray });

      click('End my day…');

      expect(tray.endDay).toHaveBeenCalledTimes(1);
      manager.destroy();
    });

    it('Menu_Quit_QuitsTheApp', () => {
      const manager = trayWith();

      click('Quit');

      expect(vi.mocked(app).quit).toHaveBeenCalled();
      manager.destroy();
    });

    it('Menu_OpenSprintTicker_RestoresTheWindow', () => {
      const manager = trayWith();

      click('Open SprintTicker');

      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.focus).toHaveBeenCalled();
      manager.destroy();
    });

    it('Menu_SwitchTask_RestoresAndSendsOnTheChannelTheRendererHears', () => {
      // It once sent on 'input:hardware-event', which nothing subscribes
      // to: the window came up and the picker never opened. The channel is
      // the preload's, compared by value so a rename cannot drift past it.
      const manager = trayWith();

      click('Switch task…');

      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.webContents.send).toHaveBeenCalledWith(IPCChannel.ON_HARDWARE_INPUT_EVENT, {
        inputKey: 'app',
        actionAssigned: 'TRIGGER_TASK_SELECTOR_MODAL'
      });
      manager.destroy();
    });

    it('Menu_SwitchTask_WithPickerWindow_OpensItAndLeavesTheDashboard', () => {
      // P7b: the picker as its own window, not the dashboard over the user's work.
      const pickerWindow = { open: vi.fn(() => true) };
      const manager = new TrayManager(mockWindow, engine, undefined, undefined, undefined, pickerWindow);
      manager.initialize();
      manager.buildMenu();

      click('Switch task…');

      expect(pickerWindow.open).toHaveBeenCalledWith('start');
      expect(mockWindow.show).not.toHaveBeenCalled();
      manager.destroy();
    });

    it('Menu_NoMiniWindow_OffersNoMiniTimerEntry', () => {
      const manager = trayWith();

      expect(labels()).not.toContain('Mini timer');
      manager.destroy();
    });

    it('Menu_MiniTimer_TogglesAndIsTickedAtTheNextOpening', () => {
      let open = false;
      const miniWindow = {
        isOpen: () => open,
        toggle: vi.fn(() => { open = !open; return open; }),
        subscribe: () => () => undefined
      };
      const manager = new TrayManager(mockWindow, engine, miniWindow);
      manager.initialize();
      manager.buildMenu();
      expect(template.find(i => i.label === 'Mini timer')?.checked).toBe(false);

      click('Mini timer');
      expect(miniWindow.toggle).toHaveBeenCalledTimes(1);
      // Built at each right-click, so a close from the window's own button
      // shows the next time too.
      manager.buildMenu();
      expect(template.find(i => i.label === 'Mini timer')?.checked).toBe(true);
      manager.destroy();
    });

    const EXE = 'C:\\SprintTicker\\SprintTicker.exe';

    /** A login item held in memory, answering as Electron does on Windows. */
    function launchAtLogin(isPackaged = true) {
      let entry = false;
      const api = {
        getLoginItemSettings: vi.fn(() => ({ executableWillLaunchAtLogin: entry })),
        setLoginItemSettings: vi.fn((settings: { openAtLogin: boolean }) => { entry = settings.openAtLogin; })
      };
      const service = new LaunchAtLoginService(api, { platform: 'win32', isPackaged, execPath: EXE });
      return { api, service };
    }

    it('Menu_StartWithWindows_WritesTheHiddenLoginItem', () => {
      const { api, service } = launchAtLogin();
      const manager = new TrayManager(mockWindow, engine, undefined, service);
      manager.initialize();
      manager.buildMenu();
      expect(template.find(i => i.label === 'Start with Windows')?.checked).toBe(false);

      click('Start with Windows', { checked: true });

      expect(api.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, path: EXE, args: ['--hidden'] });
      manager.buildMenu();
      expect(template.find(i => i.label === 'Start with Windows')?.checked).toBe(true);
      manager.destroy();
    });

    it('Menu_StartWithWindows_NotPackaged_OffersNoEntry', () => {
      // From `pnpm dev` the entry would start a bare electron.exe at login.
      const { service } = launchAtLogin(false);
      const manager = new TrayManager(mockWindow, engine, undefined, service);
      manager.initialize();
      manager.buildMenu();

      expect(labels()).not.toContain('Start with Windows');
      manager.destroy();
    });
  });

  /** The icon of S26 (P12b): a mark per state and the entries waiting. */
  describe('the icon', () => {
    function trayWith(state: { mode?: UserMode; inHours?: boolean; waiting?: number } = {}) {
      const live = { mode: state.mode ?? 'WORK', inHours: state.inHours ?? true, waiting: state.waiting ?? 0 };
      const manager = new TrayManager(mockWindow, engine, undefined, undefined, undefined, undefined, {
        stop: vi.fn(),
        chooseMode: vi.fn(),
        getMode: () => live.mode as UserMode,
        endDay: vi.fn(),
        inWorkingHours: () => live.inHours,
        countWaiting: () => live.waiting
      });
      manager.initialize();
      return { manager, live };
    }

    it('Icon_IsDrawnAt16And32', () => {
      const { manager } = trayWith();

      const drawn = vi.mocked(nativeImage.createFromBuffer).mock.results.at(-1)!.value as { addRepresentation: ReturnType<typeof vi.fn> };
      expect(vi.mocked(nativeImage.createFromBuffer).mock.calls.at(-1)![1]).toEqual({ scaleFactor: 1 });
      expect(drawn.addRepresentation).toHaveBeenCalledWith(expect.objectContaining({ scaleFactor: 2 }));
      expect(vi.mocked(nativeImage).createFromPath).not.toHaveBeenCalled();
      manager.destroy();
    });

    it('Icon_RedrawnWhenTheMarkChanges_NotOnEveryRead', () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        const { manager } = trayWith();
        const tray = lastMockTray!;

        engine.startTask('PROJ-1', false, 'One');
        expect(tray.setImage).toHaveBeenCalledTimes(1);
        engine.pauseSession();
        engine.resumeSession();
        expect(tray.setImage).toHaveBeenCalledTimes(3);

        // Reads with nothing changed draw nothing.
        vi.advanceTimersByTime(15_000);
        expect(tray.setImage).toHaveBeenCalledTimes(3);
        manager.destroy();
      } finally {
        vi.useRealTimers();
      }
    });

    it('Icon_TheNumberWaiting_IsReadEveryFewSeconds_AndSaidInTheTooltip', () => {
      vi.useFakeTimers();
      try {
        const { manager, live } = trayWith();
        const tray = lastMockTray!;

        live.waiting = 2;
        vi.advanceTimersByTime(5_000);

        expect(tray.setImage).toHaveBeenCalledTimes(1);
        expect(tray.setToolTip).toHaveBeenLastCalledWith('SprintTicker (Idle) · 2 waiting to send');
        manager.destroy();
        vi.advanceTimersByTime(5_000);
        expect(tray.setImage).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('Icon_DrawingFails_TheFileIconStandsIn', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.mocked(nativeImage.createFromBuffer).mockImplementationOnce(() => { throw new Error('no image'); });
      const exists = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

      const { manager } = trayWith();

      expect(vi.mocked(nativeImage).createFromPath).toHaveBeenCalledWith(expect.stringContaining('tray-icon.png'));
      manager.destroy();
      exists.mockRestore();
    });
  });
});
