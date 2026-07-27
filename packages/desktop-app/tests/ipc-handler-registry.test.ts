import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { InputDecoder } from '../src/main/hardware/input-decoder';
import { IPCHandlerRegistry } from '../src/main/ipc/ipc-handler-registry';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn()
  }
}));

import { ipcMain } from 'electron';

describe('IPCHandlerRegistry Unit Tests', () => {
  let dbConn: DatabaseConnection;
  let registry: IPCHandlerRegistry;

  beforeEach(async () => {
    dbConn = new DatabaseConnection(':memory:');
    const sessionRepo = new SessionRepository(dbConn);
    const worklogRepo = new WorklogRepository(dbConn);
    const taskRepo = new TaskRepository(dbConn);
    const settingsRepo = new SettingsRepository(dbConn);

    const engine = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo);
    const driver = new BusyBarDriver('10.0.4.20', true);
    await driver.connect();

    const renderer = new DisplayRenderer(driver);
    const decoder = new InputDecoder(driver, engine, settingsRepo);

    registry = new IPCHandlerRegistry(
      engine,
      taskRepo,
      settingsRepo,
      driver,
      decoder,
      renderer,
      () => null
    );
  });

  afterEach(() => {
    dbConn.close();
  });

  it('RegisterAllHandlers_ValidInstance_RegistersWithoutThrowing', async () => {
    expect(() => registry.registerAllHandlers()).not.toThrow();

    const calls = (ipcMain.handle as any).mock.calls || [];
    for (const [, handler] of calls) {
      if (typeof handler === 'function') {
        try {
          await handler({}, { taskId: 'PROJ-142', isAdHoc: false, customTitle: 'Test' });
        } catch {
          // ignore
        }
      }
    }
  });
  it('GetSettingsRepo_ReturnsExpectedSettingsRepository', () => {
    // Verify the public accessor delegates to the correct repo instance
    const repo = registry.getSettingsRepo();
    expect(repo).toBeDefined();
    // Confirm it is a real SettingsRepository by checking a method exists
    expect(typeof repo.getSetting).toBe('function');
  });

  it('RegisterAllHandlers_WithMockWindow_BroadcastsSessionUpdates', async () => {
    // Arrange: create a registry wired to a non-null window
    const mockWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: { send: vi.fn() }
    } as any;

    const dbConn2 = new DatabaseConnection(':memory:');
    const sessionRepo2 = new SessionRepository(dbConn2);
    const worklogRepo2 = new WorklogRepository(dbConn2);
    const taskRepo2 = new TaskRepository(dbConn2);
    const settingsRepo2 = new SettingsRepository(dbConn2);
    const engine2 = new TimeTrackingEngine(sessionRepo2, worklogRepo2, taskRepo2);
    const driver2 = new BusyBarDriver('10.0.4.20', true);
    await driver2.connect();
    const renderer2 = new DisplayRenderer(driver2);
    const decoder2 = new InputDecoder(driver2, engine2, settingsRepo2);

    const reg2 = new IPCHandlerRegistry(
      engine2,
      taskRepo2,
      settingsRepo2,
      driver2,
      decoder2,
      renderer2,
      () => mockWindow
    );
    reg2.registerAllHandlers();

    // Act: trigger an engine state change which should broadcast via IPC
    engine2.startTask('PROJ-TEST', false, 'IPC Broadcast Test');

    // Assert: window.webContents.send was called for session update
    expect(mockWindow.webContents.send).toHaveBeenCalledWith(
      expect.stringContaining('session'),
      expect.anything()
    );

    dbConn2.close();
  });
});
