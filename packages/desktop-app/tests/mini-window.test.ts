import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
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
import {
  MiniWindowController,
  MiniWindowLike,
  MiniWindowManager,
  MiniWindowState,
  Rectangle
} from '../src/main/windows/mini-window-manager';
import { MINI_WINDOW_MARGIN, MINI_WINDOW_SETTING_KEY, MINI_WINDOW_SIZE } from '../src/main/windows/window-constants';
import { IPCChannel } from '../src/shared/ipc-channels';
import { ArgumentNullException } from '../src/shared/dtos';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), emit: vi.fn() },
  BrowserWindow: vi.fn(),
  app: { isPackaged: false, getSystemLocale: () => 'en-US' },
  powerMonitor: { on: vi.fn() }
}));

import { ipcMain } from 'electron';

const PRIMARY: Rectangle = { x: 0, y: 0, width: 1920, height: 1040 };
const SECOND: Rectangle = { x: 1920, y: 0, width: 1280, height: 1024 };

/** A window that records what was done to it and fires its own events. */
class FakeMiniWindow implements MiniWindowLike {
  public destroyed = false;
  public bounds: Rectangle;
  public readonly shown = vi.fn();
  public readonly focused = vi.fn();
  private readonly handlers = new Map<string, Array<() => void>>();

  constructor(bounds: Rectangle) {
    this.bounds = bounds;
  }

  isDestroyed(): boolean { return this.destroyed; }
  show(): void { this.shown(); }
  focus(): void { this.focused(); }
  getBounds(): Rectangle { return this.bounds; }
  on(event: 'moved' | 'closed', listener: () => void): this {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener]);
    return this;
  }
  /** As Electron does: a close destroys the window, then reports 'closed'. */
  close(): void { this.destroy(); }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.fire('closed');
  }
  moveTo(x: number, y: number): void {
    this.bounds = { ...this.bounds, x, y };
    this.fire('moved');
  }
  private fire(event: string): void {
    for (const listener of this.handlers.get(event) ?? []) listener();
  }
}

/** The settings repository's two calls, over a map, so state is inspectable. */
class MemorySettings {
  public readonly values = new Map<string, unknown>();
  getSetting<T>(key: string, defaultValue: T): T {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as T;
  }
  setSetting<T>(key: string, value: T): void {
    this.values.set(key, value);
  }
  stored(): MiniWindowState | undefined {
    return this.values.get(MINI_WINDOW_SETTING_KEY) as MiniWindowState | undefined;
  }
}

describe('MiniWindowManager', () => {
  let settings: MemorySettings;
  let displays: Rectangle[];
  let created: FakeMiniWindow[];
  let manager: MiniWindowManager;

  beforeEach(() => {
    settings = new MemorySettings();
    displays = [PRIMARY];
    created = [];
    manager = new MiniWindowManager({
      createWindow: bounds => {
        const win = new FakeMiniWindow(bounds);
        created.push(win);
        return win;
      },
      screen: {
        getAllDisplays: () => displays.map(workArea => ({ workArea })),
        getPrimaryDisplay: () => ({ workArea: displays[0] })
      },
      settings
    });
  });

  it('Constructor_MissingDependency_Throws', () => {
    expect(() => new MiniWindowManager(undefined as never)).toThrow(ArgumentNullException);
    expect(() => new MiniWindowManager({ screen: {}, settings } as never)).toThrow(ArgumentNullException);
  });

  it('Open_NothingSaved_PlacesItBottomRightOfThePrimaryDisplay', () => {
    manager.open();

    expect(created).toHaveLength(1);
    expect(created[0].bounds).toEqual({
      x: PRIMARY.width - MINI_WINDOW_SIZE.width - MINI_WINDOW_MARGIN,
      y: PRIMARY.height - MINI_WINDOW_SIZE.height - MINI_WINDOW_MARGIN,
      ...MINI_WINDOW_SIZE
    });
    expect(manager.isOpen()).toBe(true);
    expect(settings.stored()?.open).toBe(true);
  });

  it('Open_SavedOnADisplayStillPresent_ReopensWhereItWasLeft', () => {
    displays = [PRIMARY, SECOND];
    settings.setSetting(MINI_WINDOW_SETTING_KEY, { open: false, x: 2000, y: 100 });

    manager.open();

    expect(created[0].bounds).toMatchObject({ x: 2000, y: 100 });
  });

  it('Open_SavedOnAMonitorSinceUnplugged_BringsItBackOnScreen', () => {
    // Saved on the second monitor; only the primary is left. Always on top of
    // nothing, off-screen, it would be unreachable.
    settings.setSetting(MINI_WINDOW_SETTING_KEY, { open: true, x: 2000, y: 100 });

    manager.open();

    const { x, y } = created[0].bounds;
    expect(x + MINI_WINDOW_SIZE.width).toBeLessThanOrEqual(PRIMARY.width);
    expect(y + MINI_WINDOW_SIZE.height).toBeLessThanOrEqual(PRIMARY.height);
  });

  it('Open_SavedHalfOffTheEdge_BringsItBackOnScreen', () => {
    settings.setSetting(MINI_WINDOW_SETTING_KEY, { open: false, x: PRIMARY.width - 100, y: 100 });

    manager.open();

    expect(created[0].bounds.x).toBe(PRIMARY.width - MINI_WINDOW_SIZE.width - MINI_WINDOW_MARGIN);
  });

  it('Open_AlreadyOpen_BringsTheSameWindowForward', () => {
    manager.open();
    manager.open();

    expect(created).toHaveLength(1);
    expect(created[0].shown).toHaveBeenCalled();
    expect(created[0].focused).toHaveBeenCalled();
  });

  it('Moved_RemembersThePositionAndKeepsItOpen', () => {
    manager.open();

    created[0].moveTo(300, 400);

    expect(settings.stored()).toEqual({ open: true, x: 300, y: 400 });
  });

  it('Moved_AfterDestroy_RecordsNothing', () => {
    manager.open();
    const win = created[0];
    win.destroyed = true; // destroyed without its 'closed' having run yet
    const before = settings.stored();

    win.moveTo(1, 2);

    expect(settings.stored()).toEqual(before);
  });

  it('Toggle_OpensThenCloses_AnsweringTheNewStateAndNotifying', () => {
    const seen: boolean[] = [];
    manager.subscribe(open => seen.push(open));

    expect(manager.toggle()).toBe(true);
    expect(manager.toggle()).toBe(false);

    expect(manager.isOpen()).toBe(false);
    expect(seen).toEqual([true, false]);
    // Closed by the user: it stays closed at the next launch.
    expect(settings.stored()?.open).toBe(false);
  });

  it('Subscribe_Unsubscribed_HearsNothingMore', () => {
    const listener = vi.fn();
    const unsubscribe = manager.subscribe(listener);
    unsubscribe();

    manager.toggle();

    expect(listener).not.toHaveBeenCalled();
  });

  it('Dispose_WithTheApp_ClosesItButRemembersItWasOpen', () => {
    // Windows quits an app only once its last window is gone; the mini timer
    // must go with the dashboard, and come back with it.
    const listener = vi.fn();
    manager.open();
    manager.subscribe(listener);

    manager.dispose();

    expect(created[0].destroyed).toBe(true);
    expect(manager.isOpen()).toBe(false);
    expect(settings.stored()?.open).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });

  it('Dispose_ThenTheWindowsOwnClose_StillRemembersItWasOpen', () => {
    // A quit closes every window; the mini timer's 'closed' arriving after
    // dispose must not be taken for the user closing it.
    manager.open();
    const win = created[0];

    manager.dispose();
    manager.dispose();
    win.close();

    expect(settings.stored()?.open).toBe(true);
  });

  it('Dispose_NeverOpened_DoesNothing', () => {
    expect(() => manager.dispose()).not.toThrow();
    expect(settings.stored()).toBeUndefined();
  });

  it('Restore_LeftOpenLastTime_ReopensIt', () => {
    settings.setSetting(MINI_WINDOW_SETTING_KEY, { open: true });

    manager.restore();

    expect(created).toHaveLength(1);
  });

  it('Restore_ClosedOrNeverUsed_LeavesItClosed', () => {
    manager.restore();
    settings.setSetting(MINI_WINDOW_SETTING_KEY, { open: false, x: 10, y: 10 });
    manager.restore();

    expect(created).toHaveLength(0);
  });

  it('Restore_CorruptSetting_ReadsAsClosed', () => {
    // Anything but a literal true is closed: a truthy string must not open a
    // window on every launch.
    settings.setSetting(MINI_WINDOW_SETTING_KEY, { open: 'yes' });

    manager.restore();

    expect(created).toHaveLength(0);
  });
});

describe('IPCHandlerRegistry with the mini timer', () => {
  let dbConn: DatabaseConnection;
  let engine: TimeTrackingEngine;

  type Handler = (...args: unknown[]) => unknown;

  /** The handler registered last for a channel -- this test's registry. */
  function handlerFor(channel: string): Handler {
    const calls = vi.mocked(ipcMain.handle).mock.calls as unknown as Array<[string, Handler]>;
    const found = [...calls].reverse().find(([name]) => name === channel);
    if (!found) throw new Error(`No handler for ${channel}`);
    return found[1];
  }

  function fakeWindow(destroyed = false): BrowserWindow {
    return {
      isDestroyed: () => destroyed,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { isDestroyed: () => false, send: vi.fn() }
    } as unknown as BrowserWindow;
  }

  function fakeController(): MiniWindowController & { emit(open: boolean): void } {
    let open = false;
    const listeners: Array<(open: boolean) => void> = [];
    return {
      isOpen: () => open,
      toggle: () => { open = !open; return open; },
      subscribe: listener => { listeners.push(listener); return () => undefined; },
      emit: value => { open = value; listeners.forEach(l => l(value)); }
    };
  }

  function buildRegistry(options: Partial<ConstructorParameters<typeof IPCHandlerRegistry>[0]>): void {
    const settingsRepo = new SettingsRepository(dbConn);
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
      ...options
    }).registerAllHandlers();
  }

  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
    dbConn = new DatabaseConnection(':memory:');
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

  it('MiniHandlers_NoController_AnswerClosed', async () => {
    buildRegistry({});

    expect(await handlerFor(IPCChannel.MINI_TOGGLE)({})).toBe(false);
    expect(await handlerFor(IPCChannel.MINI_IS_OPEN)({})).toBe(false);
  });

  it('MiniHandlers_WithController_ToggleAndReport', async () => {
    buildRegistry({ miniWindow: fakeController() });

    expect(await handlerFor(IPCChannel.MINI_TOGGLE)({})).toBe(true);
    expect(await handlerFor(IPCChannel.MINI_IS_OPEN)({})).toBe(true);
    expect(await handlerFor(IPCChannel.MINI_TOGGLE)({})).toBe(false);
  });

  it('Broadcast_ReachesEveryLiveWindowAndSkipsADestroyedOne', () => {
    // The mini timer is a second window; a broadcast that reached only the
    // dashboard left it showing a session that had ended.
    const dashboard = fakeWindow();
    const mini = fakeWindow();
    const closing = fakeWindow(true);
    const controller = fakeController();
    buildRegistry({ getWindow: () => dashboard, getWindows: () => [dashboard, mini, closing], miniWindow: controller });

    controller.emit(true);

    expect(dashboard.webContents.send).toHaveBeenCalledWith(IPCChannel.ON_MINI_VISIBILITY, true);
    expect(mini.webContents.send).toHaveBeenCalledWith(IPCChannel.ON_MINI_VISIBILITY, true);
    expect(closing.webContents.send).not.toHaveBeenCalled();
  });

  it('Broadcast_NoWindowList_FallsBackToTheDashboard', () => {
    const dashboard = fakeWindow();
    const controller = fakeController();
    buildRegistry({ getWindow: () => dashboard, miniWindow: controller });

    controller.emit(false);

    expect(dashboard.webContents.send).toHaveBeenCalledWith(IPCChannel.ON_MINI_VISIBILITY, false);
  });

  it('OpenTaskPicker_RevealsTheDashboardWithThePickerAction', async () => {
    const dashboard = fakeWindow();
    buildRegistry({ getWindow: () => dashboard });

    expect(await handlerFor(IPCChannel.OPEN_TASK_PICKER)({})).toBe(true);

    expect(dashboard.show).toHaveBeenCalled();
    expect(dashboard.webContents.send).toHaveBeenCalledWith(IPCChannel.ON_HARDWARE_INPUT_EVENT, {
      inputKey: 'app',
      actionAssigned: 'TRIGGER_TASK_SELECTOR_MODAL'
    });
  });

  it('OpenTaskPicker_NoDashboard_AnswersFalse', async () => {
    buildRegistry({ getWindow: () => null });

    expect(await handlerFor(IPCChannel.OPEN_TASK_PICKER)({})).toBe(false);
  });
});
