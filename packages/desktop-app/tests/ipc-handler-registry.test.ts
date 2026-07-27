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
});
