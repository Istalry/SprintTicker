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
import { IPCChannel } from '../src/shared/ipc-channels';
import {
  DEFAULT_USB_IP,
  DEFAULT_DEVICE_CONFIG,
  DEVICE_CONFIG_SETTING_KEY
} from '../src/shared/device-constants';
import { DeviceConfigDTO } from '../src/shared/dtos';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), emit: vi.fn() },
  BrowserWindow: vi.fn(),
  app: { isPackaged: false, getVersion: () => '0.0.0-test' },
  powerMonitor: { on: vi.fn() }
}));

import { ipcMain } from 'electron';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

/**
 * The device address became a setting, so the handler that writes it is now
 * load-bearing: it is the only thing standing between a typed string and the
 * URL every hardware request is built from.
 */
describe('device config IPC', () => {
  let dbConn: DatabaseConnection;
  let engine: TimeTrackingEngine;
  let settingsRepo: SettingsRepository;
  let driver: BusyBarDriver;

  const handlerFor = (channel: string): Handler => {
    const calls = (ipcMain.handle as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, Handler]
    >;
    const found = calls.find(([name]) => name === channel);
    if (!found) throw new Error(`No handler registered for ${channel}`);
    return found[1];
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    dbConn = new DatabaseConnection(':memory:');
    settingsRepo = new SettingsRepository(dbConn);
    const taskRepo = new TaskRepository(dbConn);

    engine = new TimeTrackingEngine(
      new SessionRepository(dbConn),
      new WorklogRepository(dbConn),
      taskRepo,
      undefined,
      new ProjectRepository(dbConn)
    );

    driver = new BusyBarDriver({ ipAddress: DEFAULT_USB_IP, forceMock: true });
    await driver.connect();

    const renderer = new DisplayRenderer(driver);
    new IPCHandlerRegistry({
      engine,
      taskRepo,
      settingsRepo,
      driver,
      inputDecoder: new InputDecoder(driver, engine, settingsRepo),
      renderer,
      getWindow: () => null
    }).registerAllHandlers();
  });

  afterEach(() => {
    engine?.dispose();
    driver?.disconnect();
    dbConn.close();
  });

  it('GetDeviceConfig_FirstRun_ReturnsTheUsbDefault', async () => {
    const config = (await handlerFor(IPCChannel.GET_DEVICE_CONFIG)({})) as DeviceConfigDTO;

    expect(config.ipAddress).toBe(DEFAULT_USB_IP);
    expect(config.apiToken).toBe('');
  });

  it('GetDeviceConfig_RowWrittenBeforeTheAddressExisted_FillsTheMissingFields', async () => {
    // The migration case, and the reason GET spreads over the defaults. An
    // install predating this feature has a `device_config` row with only
    // `showIdleClockFallback`; returning it as-is hands the renderer
    // `undefined` and puts the string "undefined" in an address box.
    settingsRepo.setSetting(DEVICE_CONFIG_SETTING_KEY, { showIdleClockFallback: false });

    const config = (await handlerFor(IPCChannel.GET_DEVICE_CONFIG)({})) as DeviceConfigDTO;

    expect(config.showIdleClockFallback).toBe(false);
    expect(config.ipAddress).toBe(DEFAULT_USB_IP);
    expect(config.apiToken).toBe('');
  });

  it('SetDeviceConfig_NewAddress_PersistsAndReconnectsTheDriver', async () => {
    const reconfigure = vi.spyOn(driver, 'reconfigure');

    await handlerFor(IPCChannel.SET_DEVICE_CONFIG)({}, {
      ...DEFAULT_DEVICE_CONFIG,
      ipAddress: '10.0.4.21'
    });

    expect(reconfigure).toHaveBeenCalledWith({ ipAddress: '10.0.4.21', apiToken: '' });
    const stored = settingsRepo.getSetting<DeviceConfigDTO>(
      DEVICE_CONFIG_SETTING_KEY,
      DEFAULT_DEVICE_CONFIG
    );
    expect(stored.ipAddress).toBe('10.0.4.21');
  });

  it('SetDeviceConfig_SurroundingWhitespace_StoresTheTrimmedAddress', async () => {
    await handlerFor(IPCChannel.SET_DEVICE_CONFIG)({}, {
      ...DEFAULT_DEVICE_CONFIG,
      ipAddress: '  10.0.4.21  '
    });

    expect(driver.getIpAddress()).toBe('10.0.4.21');
  });

  it('SetDeviceConfig_UnchangedTarget_DoesNotReconnect', async () => {
    // Toggling an unrelated setting must not drop the hardware link. The
    // display fallback checkbox writes through this same handler.
    const reconfigure = vi.spyOn(driver, 'reconfigure');

    await handlerFor(IPCChannel.SET_DEVICE_CONFIG)({}, {
      ...DEFAULT_DEVICE_CONFIG,
      showIdleClockFallback: false
    });

    expect(reconfigure).not.toHaveBeenCalled();
  });

  it('SetDeviceConfig_AddressThatWouldRetargetRequests_ThrowsAndChangesNothing', async () => {
    const reconfigure = vi.spyOn(driver, 'reconfigure');

    for (const bad of ['http://10.0.4.21', '10.0.4.21/api', 'user@10.0.4.21', '']) {
      await expect(
        handlerFor(IPCChannel.SET_DEVICE_CONFIG)({}, { ...DEFAULT_DEVICE_CONFIG, ipAddress: bad })
      ).rejects.toThrow();
    }

    // Validated in main and not only in the renderer: the renderer is not the
    // only caller, and a host carrying a path or credentials silently sends
    // every device request to another origin.
    expect(reconfigure).not.toHaveBeenCalled();
    expect(driver.getIpAddress()).toBe(DEFAULT_USB_IP);
  });

  it('SetDeviceConfig_TokenChangedOnly_StillReconnects', async () => {
    // The token is part of the target, not a cosmetic field: it goes into
    // every request header and the StateStream URL, so a live socket opened
    // without it stays unauthenticated until something re-dials.
    const reconfigure = vi.spyOn(driver, 'reconfigure');

    await handlerFor(IPCChannel.SET_DEVICE_CONFIG)({}, {
      ...DEFAULT_DEVICE_CONFIG,
      apiToken: 'wifi-token'
    });

    expect(reconfigure).toHaveBeenCalledWith({ ipAddress: DEFAULT_USB_IP, apiToken: 'wifi-token' });
  });
});
