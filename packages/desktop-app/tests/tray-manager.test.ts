import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TrayManager } from '../src/main/tray/tray-manager';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';

vi.mock('electron', () => {
  return {
    app: {
      getLoginItemSettings: () => ({ openAtLogin: false }),
      setLoginItemSettings: vi.fn(),
      quit: vi.fn()
    },
    Menu: {
      buildFromTemplate: vi.fn().mockReturnValue({})
    },
    Tray: vi.fn().mockImplementation(() => {
      return {
        setToolTip: vi.fn(),
        setContextMenu: vi.fn(),
        on: vi.fn(),
        destroy: vi.fn()
      };
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
  let mockWindow: any;

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
    };
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

    // Trigger close event interception
    const closeHandler = mockWindow.on.mock.calls.find((c: any) => c[0] === 'close')[1];
    const mockEvent = { preventDefault: vi.fn() };
    closeHandler(mockEvent);
    expect(mockEvent.preventDefault).toHaveBeenCalled();

    manager.destroy();
  });
});
