import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
import { IPCHandlerRegistry } from '../src/main/ipc/ipc-handler-registry';
import { ProviderEventService } from '../src/main/services/provider-event-service';
import { IPCChannel } from '../src/shared/ipc-channels';
import { DEFAULT_PROVIDER_EVENT_SETTINGS, MIN_PROVIDER_EVENT_POLL_SECONDS } from '../src/shared/provider-events';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), emit: vi.fn() },
  BrowserWindow: vi.fn(),
  app: { isPackaged: false, getSystemLocale: () => 'en-US' },
  powerMonitor: { on: vi.fn() }
}));

import { ipcMain } from 'electron';

describe('provider event IPC', () => {
  let dbConn: DatabaseConnection;
  let engine: TimeTrackingEngine;
  let settingsRepo: SettingsRepository;

  type Handler = (...args: unknown[]) => unknown;
  function handlerFor(channel: string): Handler {
    const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
    const found = [...calls].reverse().find(([name]) => name === channel);
    if (!found) throw new Error(`No handler for ${channel}`);
    return found[1];
  }

  function register(providerEvents?: ProviderEventService): void {
    const driver = new BusyBarDriver('10.0.4.20', true);
    new IPCHandlerRegistry({
      engine,
      taskRepo: new TaskRepository(dbConn),
      settingsRepo,
      driver,
      inputDecoder: new InputDecoder(driver, engine, settingsRepo),
      renderer: new DisplayRenderer(driver),
      getWindow: () => null,
      saveUnityScenes: async () => false,
      providerEvents
    }).registerAllHandlers();
  }

  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
    dbConn = new DatabaseConnection(':memory:');
    settingsRepo = new SettingsRepository(dbConn);
    engine = new TimeTrackingEngine(
      new SessionRepository(dbConn),
      new WorklogRepository(dbConn),
      new TaskRepository(dbConn),
      undefined,
      new ProjectRepository(dbConn)
    );
  });

  afterEach(() => {
    engine.dispose();
    dbConn.close();
  });

  it('SaveThenGet_RoundTripsThroughTheDatabaseNormalised', async () => {
    register();

    const saved = await handlerFor(IPCChannel.SAVE_PROVIDER_EVENT_SETTINGS)({}, { ...DEFAULT_PROVIDER_EVENT_SETTINGS, pollIntervalSeconds: 5 });
    const read = await handlerFor(IPCChannel.GET_PROVIDER_EVENT_SETTINGS)({});

    expect(saved).toMatchObject({ pollIntervalSeconds: MIN_PROVIDER_EVENT_POLL_SECONDS });
    expect(read).toEqual(saved);
  });

  it('Test_DefaultServiceHasNoToasts_SaysNothingWasShown', async () => {
    // The registry's own default never shows anything; main passes the real one.
    register();

    expect(await handlerFor(IPCChannel.TEST_PROVIDER_EVENTS)({})).toEqual({ toast: false, bar: false });
  });

  it('Test_GoesToTheServiceMainPassed', async () => {
    const show = vi.fn().mockReturnValue(true);
    register(new ProviderEventService({ getActiveProvider: () => null, settings: settingsRepo, toasts: { show } }));

    expect(await handlerFor(IPCChannel.TEST_PROVIDER_EVENTS)({})).toEqual({ toast: true, bar: false });
    expect(show).toHaveBeenCalledTimes(1);
  });
});
