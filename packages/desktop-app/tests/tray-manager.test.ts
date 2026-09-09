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

// Shared mock tray instance — populated by the Tray constructor mock on each initialize() call
let lastMockTray: { setToolTip: ReturnType<typeof vi.fn>; setContextMenu: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> } | null = null;

vi.mock('electron', () => {
  return {
    app: {
      isPackaged: false,
      getLoginItemSettings: () => ({ openAtLogin: false }),
      setLoginItemSettings: vi.fn(),
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
        on: vi.fn(),
        destroy: vi.fn()
      };
      return lastMockTray;
    }),
    nativeImage: {
      createFromDataURL: vi.fn().mockReturnValue({}),
      createFromPath: vi.fn().mockReturnValue({})
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

  it('TrayManager_Initialize_CreatesTrayAndSubscribesToWindowEvents', () => {
    const manager = new TrayManager(mockWindow, engine);
    manager.initialize();

    expect(mockWindow.on).toHaveBeenCalledWith('close', expect.any(Function));

    manager.restoreWindow();
    expect(mockWindow.show).toHaveBeenCalled();
    expect(mockWindow.focus).toHaveBeenCalled();

    manager.setAutoStart(true);

    // Trigger active task session to test tooltip update
    engine.startTask('PROJ-142', false, 'Implement Dash Mechanics');
    engine.pauseSession();
    engine.resumeSession();

    // Trigger close event
    const closeHandler = (mockWindow.on as unknown as { mock: { calls: Array<[string, (...args: unknown[]) => unknown]> } }).mock.calls.find(c => c[0] === 'close')![1];
    closeHandler();
    expect((app as unknown as { isQuitting?: boolean }).isQuitting).toBe(true);

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

    const hasTrackingTooltip = (trayInstance.setToolTip.mock.calls as string[][]).some(
      args => args[0].includes('TRACKING')
    );
    expect(hasTrackingTooltip).toBe(true);
    manager.destroy();
  });

  it('TrayManager_SetAutoStart_CallsLoginItemSettings', () => {
    const manager = new TrayManager(mockWindow, engine);
    manager.initialize();
    manager.setAutoStart(false);

    // app is the vi.fn() mock from vi.mock('electron')
    expect(vi.mocked(app).setLoginItemSettings).toHaveBeenCalledWith(
      expect.objectContaining({ openAtLogin: false })
    );
    manager.destroy();
  });

  it('TrayManager_ContextMenu_QuitMenuItem_SetsIsQuittingAndCallsQuit', () => {
    let quitClickHandler: ((item: unknown) => void) | null = null;

    vi.mocked(Menu.buildFromTemplate).mockImplementation((template: Array<{ label?: string; click?: () => void }>) => {
      const quitItem = template.find(i => i.label === 'Quit Application');
      if (quitItem && quitItem.click) quitClickHandler = quitItem.click;
      return {} as unknown as Menu;
    });

    const manager = new TrayManager(mockWindow, engine);
    manager.initialize();

    expect(quitClickHandler).not.toBeNull();
    quitClickHandler!(null);

    expect(vi.mocked(app).quit).toHaveBeenCalled();
    manager.destroy();
  });

  /**
   * The rest of the tray context menu.
   *
   * `updateContextMenu` is private and runs only from `initialize`, so the
   * click handlers are reachable only through the template Menu.buildFromTemplate
   * receives -- the technique the quit test above established. Only quit used
   * it, which left every item a user actually reaches for untested: the tray is
   * how you pause without opening the window.
   */
  describe('context menu items', () => {
    type MenuTemplateItem = {
      label?: string;
      type?: string;
      checked?: boolean;
      click?: (item: { checked: boolean }) => void;
    };

    let template: MenuTemplateItem[];

    /** Captures the template so any item's click can be invoked by label. */
    function captureTemplate(): void {
      template = [];
      vi.mocked(Menu.buildFromTemplate).mockImplementation((built: MenuTemplateItem[]) => {
        template = built;
        return {} as unknown as Menu;
      });
    }

    function click(label: string, item: { checked: boolean } = { checked: false }): void {
      const entry = template.find(i => i.label === label);
      if (!entry?.click) throw new Error(`No clickable menu item labelled '${label}'`);
      entry.click(item);
    }

    beforeEach(() => {
      captureTemplate();
    });

    it('TrayManager_ContextMenu_OpenDashboard_RestoresTheWindow', () => {
      const manager = new TrayManager(mockWindow, engine);
      manager.initialize();

      click('Open BUSY Bar Dashboard');

      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.focus).toHaveBeenCalled();
      manager.destroy();
    });

    it('TrayManager_ContextMenu_StartPause_NoSession_RestoresTheWindowInsteadOfGuessing', () => {
      // There is nothing to resume and no way to choose a task from a tray
      // menu, so the only useful move is to show the window.
      const manager = new TrayManager(mockWindow, engine);
      manager.initialize();

      click('Start / Pause Active Tracking');

      expect(mockWindow.show).toHaveBeenCalled();
      expect(engine.getCurrentSession()).toBeNull();
      manager.destroy();
    });

    it('TrayManager_ContextMenu_StartPause_WhileTracking_PausesTheSession', () => {
      const manager = new TrayManager(mockWindow, engine);
      manager.initialize();
      engine.startTask('PROJ-301', false, 'Tray pause');

      click('Start / Pause Active Tracking');

      expect(engine.getCurrentSession()?.status).toBe('PAUSED');
      manager.destroy();
    });

    it('TrayManager_ContextMenu_StartPause_WhilePaused_ResumesTheSession', () => {
      const manager = new TrayManager(mockWindow, engine);
      manager.initialize();
      engine.startTask('PROJ-302', false, 'Tray resume');
      engine.pauseSession();

      click('Start / Pause Active Tracking');

      expect(engine.getCurrentSession()?.status).toBe('TRACKING');
      manager.destroy();
    });

    it('TrayManager_ContextMenu_TaskSelector_RestoresAndForwardsTheHardwareEvent', () => {
      const manager = new TrayManager(mockWindow, engine);
      manager.initialize();

      click('Trigger Task Selector Modal');

      expect(mockWindow.show).toHaveBeenCalled();
      expect(mockWindow.webContents.send).toHaveBeenCalledWith('input:hardware-event', {
        actionAssigned: 'TRIGGER_TASK_SELECTOR_MODAL',
        rawKey: 'ok'
      });
      manager.destroy();
    });

    it('TrayManager_ContextMenu_StartupCheckbox_PassesTheCheckedStateThrough', () => {
      const manager = new TrayManager(mockWindow, engine);
      manager.initialize();

      click('Start with Windows Startup', { checked: true });

      expect(vi.mocked(app).setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
      manager.destroy();
    });
  });

  it('TrayManager_Initialize_TrayIconOnDisk_LoadsItRatherThanTheEmbeddedFallback', () => {
    // The packaged build ships build/tray-icon.png; only a source tree without
    // it falls back to the inline data URL. Both branches are live, and the
    // fallback one was the only one covered.
    const exists = vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const manager = new TrayManager(mockWindow, engine);
    manager.initialize();

    expect(vi.mocked(nativeImage).createFromPath).toHaveBeenCalledWith(
      expect.stringContaining('tray-icon.png')
    );
    manager.destroy();
    exists.mockRestore();
  });
});
