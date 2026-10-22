import { ArgumentException, ArgumentNullException, LaunchAtLoginStatusDTO } from '../../shared/dtos';

/**
 * The flag the login item passes: start in the tray, with no window.
 * Read once at startup by `launchedHidden`.
 */
export const LAUNCH_HIDDEN_FLAG = '--hidden';

/** What this needs of Electron's `app`: the login item, on Windows' Run key. */
export interface LoginItemApi {
  getLoginItemSettings(options: { path: string; args: string[] }): { executableWillLaunchAtLogin?: boolean };
  setLoginItemSettings(settings: { openAtLogin: boolean; path: string; args: string[] }): void;
}

export interface LaunchAtLoginEnvironment {
  platform: NodeJS.Platform;
  /** `app.isPackaged`. */
  isPackaged: boolean;
  /** `process.execPath`. */
  execPath: string;
  /**
   * `process.env.PORTABLE_EXECUTABLE_FILE`, which electron-builder's portable
   * stub sets to the file the user ran.
   */
  portableExecutable?: string;
}

/** Whether this run was started by the login item. */
export function launchedHidden(argv: readonly string[]): boolean {
  return argv.includes(LAUNCH_HIDDEN_FLAG);
}

/**
 * Starting SprintTicker with Windows: one switch, in the window and in the
 * tray, both reading Windows' own answer.
 *
 * Measured on Electron 44 with a probe entry (2026-10-22), three things the
 * API does not say:
 * - **`openAtLogin` is not the answer.** It stayed false for an entry that
 *   was there; `executableWillLaunchAtLogin` reads the entry for this
 *   executable whatever its arguments, and turns false when the user
 *   switches it off in Task Manager or Windows' Startup apps. So the state
 *   is always read back, never kept here.
 * - **`launchItems[].args` reads empty** while the Run value carries
 *   `--hidden`: nothing may be decided from it.
 * - **Writing the entry again approves it again**, undoing a switch-off the
 *   user made in Windows. So it is rewritten only while still enabled.
 */
export class LaunchAtLoginService {
  private readonly _api: LoginItemApi;
  private readonly _env: LaunchAtLoginEnvironment;
  private readonly _listeners = new Set<() => void>();

  constructor(api: LoginItemApi, env: LaunchAtLoginEnvironment) {
    if (!api) throw new ArgumentNullException('api');
    if (!env) throw new ArgumentNullException('env');
    this._api = api;
    this._env = env;
  }

  public getStatus(): LaunchAtLoginStatusDTO {
    const reason = this.unavailableBecause();
    if (reason) return { enabled: false, available: false, reason };
    const settings = this._api.getLoginItemSettings({ path: this.executable(), args: [LAUNCH_HIDDEN_FLAG] });
    return { enabled: settings.executableWillLaunchAtLogin === true, available: true, reason: null };
  }

  /** Turns it on or off, and answers the state Windows then reports. */
  public setEnabled(enabled: boolean): LaunchAtLoginStatusDTO {
    if (typeof enabled !== 'boolean') throw new ArgumentException('Starting with Windows is on or off.', 'enabled');
    if (this.unavailableBecause()) return this.getStatus();
    this.write(enabled);
    for (const listener of this._listeners) listener();
    return this.getStatus();
  }

  /**
   * Hears every change made through {@link setEnabled}, wherever it came
   * from: the tray's checkbox follows a switch thrown in the window. One
   * made in Windows' own settings has no event; the state is read again
   * each time it is shown.
   */
  public subscribe(listener: () => void): () => void {
    if (!listener) throw new ArgumentNullException('listener');
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * Brings an entry still enabled up to date: one written by an earlier
   * version, which had no `--hidden` and opened the window at every login,
   * or a portable build since moved. Called once at startup.
   */
  public refresh(): void {
    if (this.getStatus().enabled) this.write(true);
  }

  private write(enabled: boolean): void {
    this._api.setLoginItemSettings({ openAtLogin: enabled, path: this.executable(), args: [LAUNCH_HIDDEN_FLAG] });
  }

  /**
   * The file Windows should start. The portable build unpacks itself into a
   * temporary folder on each run, so `execPath` names a folder gone by the
   * next login; its stub says which file the user ran.
   */
  private executable(): string {
    return this._env.portableExecutable || this._env.execPath;
  }

  /**
   * Not on another platform; and not from `pnpm dev`, where `execPath` is
   * a bare electron.exe that would start at every login with no app.
   */
  private unavailableBecause(): LaunchAtLoginStatusDTO['reason'] {
    if (this._env.platform !== 'win32') return 'not-windows';
    if (!this._env.isPackaged) return 'not-packaged';
    return null;
  }
}
