import { describe, it, expect, vi } from 'vitest';
import {
  LAUNCH_HIDDEN_FLAG,
  LaunchAtLoginEnvironment,
  LaunchAtLoginService,
  launchedHidden
} from '../src/main/services/launch-at-login';
import { ArgumentException, ArgumentNullException } from '../src/shared/dtos';

const INSTALLED = 'C:\\Users\\me\\AppData\\Local\\Programs\\SprintTicker\\SprintTicker.exe';

/**
 * Windows' Run key and its Startup-apps switch, answering as Electron 44 was
 * measured to (2026-10-22): `executableWillLaunchAtLogin` is true while an
 * entry for the path exists and Windows has not switched it off, and a
 * write approves it again.
 */
function windows(initial: { entry?: boolean; switchedOff?: boolean } = {}) {
  const state = { entry: initial.entry ?? false, switchedOff: initial.switchedOff ?? false };
  const api = {
    getLoginItemSettings: vi.fn(() => ({ executableWillLaunchAtLogin: state.entry && !state.switchedOff })),
    setLoginItemSettings: vi.fn((s: { openAtLogin: boolean }) => {
      state.entry = s.openAtLogin;
      state.switchedOff = false;
    })
  };
  return { api, state };
}

const env = (overrides: Partial<LaunchAtLoginEnvironment> = {}): LaunchAtLoginEnvironment => ({
  platform: 'win32',
  isPackaged: true,
  execPath: INSTALLED,
  ...overrides
});

describe('LaunchAtLoginService', () => {
  it('Constructor_MissingDependency_Throws', () => {
    const { api } = windows();
    expect(() => new LaunchAtLoginService(null as never, env())).toThrow(ArgumentNullException);
    expect(() => new LaunchAtLoginService(api, null as never)).toThrow(ArgumentNullException);
  });

  it('GetStatus_NoEntry_IsOff', () => {
    const { api } = windows();
    expect(new LaunchAtLoginService(api, env()).getStatus()).toEqual({ enabled: false, available: true, reason: null });
  });

  it('GetStatus_SwitchedOffInWindows_ReadsOffThoughTheEntryIsThere', () => {
    // Task Manager's Startup apps leaves the Run value and marks it
    // disabled; the switch has to say what Windows will do.
    const { api } = windows({ entry: true, switchedOff: true });
    expect(new LaunchAtLoginService(api, env()).getStatus().enabled).toBe(false);
  });

  it('SetEnabled_On_WritesTheExecutableWithTheHiddenFlag', () => {
    const { api } = windows();
    const service = new LaunchAtLoginService(api, env());

    expect(service.setEnabled(true)).toEqual({ enabled: true, available: true, reason: null });
    expect(api.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, path: INSTALLED, args: [LAUNCH_HIDDEN_FLAG] });
  });

  it('SetEnabled_Off_RemovesTheEntryForTheSamePath', () => {
    const { api } = windows({ entry: true });
    const service = new LaunchAtLoginService(api, env());

    expect(service.setEnabled(false).enabled).toBe(false);
    expect(api.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false, path: INSTALLED, args: [LAUNCH_HIDDEN_FLAG] });
  });

  it('SetEnabled_Portable_RegistersTheFileTheUserRanNotTheUnpackedCopy', () => {
    // The portable stub unpacks into a temp folder on each run; that folder
    // is gone by the next login.
    const { api } = windows();
    const service = new LaunchAtLoginService(api, env({
      execPath: 'C:\\Users\\me\\AppData\\Local\\Temp\\2abc\\SprintTicker.exe',
      portableExecutable: 'D:\\Tools\\SprintTicker-portable.exe'
    }));

    service.setEnabled(true);

    expect(api.setLoginItemSettings).toHaveBeenCalledWith(expect.objectContaining({ path: 'D:\\Tools\\SprintTicker-portable.exe' }));
    expect(api.getLoginItemSettings).toHaveBeenLastCalledWith({ path: 'D:\\Tools\\SprintTicker-portable.exe', args: [LAUNCH_HIDDEN_FLAG] });
  });

  it('SetEnabled_NotABoolean_Throws', () => {
    const { api } = windows();
    const service = new LaunchAtLoginService(api, env());

    expect(() => service.setEnabled('true' as never)).toThrow(ArgumentException);
    expect(api.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it.each([
    ['not-packaged', env({ isPackaged: false })],
    ['not-windows', env({ platform: 'darwin' })]
  ] as const)('SetEnabled_Unavailable_%s_WritesNothing', (reason, environment) => {
    // From `pnpm dev`, execPath is a bare electron.exe that would start at
    // every login with no app in it.
    const { api } = windows();
    const service = new LaunchAtLoginService(api, environment);

    expect(service.setEnabled(true)).toEqual({ enabled: false, available: false, reason });
    expect(api.setLoginItemSettings).not.toHaveBeenCalled();
    expect(api.getLoginItemSettings).not.toHaveBeenCalled();
  });

  it('Subscribe_HearsEveryChangeUntilUnsubscribed', () => {
    const { api } = windows();
    const service = new LaunchAtLoginService(api, env());
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    service.setEnabled(true);
    unsubscribe();
    service.setEnabled(false);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(() => service.subscribe(null as never)).toThrow(ArgumentNullException);
  });

  it('Refresh_Enabled_RewritesTheEntry', () => {
    // An entry from an earlier version had no --hidden and opened the
    // window at every login.
    const { api } = windows({ entry: true });

    new LaunchAtLoginService(api, env()).refresh();

    expect(api.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true, path: INSTALLED, args: [LAUNCH_HIDDEN_FLAG] });
  });

  it('Refresh_SwitchedOffInWindows_LeavesItOff', () => {
    // A write approves the entry again: refreshing it would undo the
    // user's own choice in Windows.
    const { api, state } = windows({ entry: true, switchedOff: true });

    new LaunchAtLoginService(api, env()).refresh();

    expect(api.setLoginItemSettings).not.toHaveBeenCalled();
    expect(state.switchedOff).toBe(true);
  });

  it('Refresh_NoEntry_WritesNothing', () => {
    const { api } = windows();
    new LaunchAtLoginService(api, env()).refresh();
    expect(api.setLoginItemSettings).not.toHaveBeenCalled();
  });
});

describe('launchedHidden', () => {
  it('LaunchedHidden_ReadsTheFlagAnywhereInArgv', () => {
    expect(launchedHidden([INSTALLED, LAUNCH_HIDDEN_FLAG])).toBe(true);
    expect(launchedHidden([INSTALLED, '--mock-hardware', LAUNCH_HIDDEN_FLAG])).toBe(true);
    expect(launchedHidden([INSTALLED])).toBe(false);
    expect(launchedHidden([INSTALLED, '--hiddenx'])).toBe(false);
  });
});
