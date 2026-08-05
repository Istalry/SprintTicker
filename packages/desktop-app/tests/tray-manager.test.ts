import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TrayManager } from '../src/main/tray/tray-manager';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { app, Menu, BrowserWindow } from 'electron';

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
    Tray: vi.fn().mockImplementation(() => {
      lastMockTray = {
        setToolTip: vi.fn(),
        setContextMenu: vi.fn(),
        on: vi.fn(),
        destroy: vi.fn()
      };
      return lastMockTray;
    }),
    nativeImage: {
      createFromDataURL: vi.fn().mockReturnValue({})
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
    engine = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo);

    mockWindow = {
      isMinimized: vi.fn().mockReturnValue(false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      hide: vi.fn(),
      on: vi.fn()
    } as unknown as BrowserWindow;
  });

  afterEach(() => {
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
});
