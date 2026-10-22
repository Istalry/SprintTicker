import { execFile } from 'child_process';

/**
 * Runs one PowerShell script, handed over base64-encoded (UTF-16LE, as
 * `-EncodedCommand` wants it). Injected, so a test never runs PowerShell
 * against the developer's own desktop (CLAUDE.md §6).
 */
export type EncodedPowerShellRunner = (encodedCommand: string) => Promise<void>;

/** Long enough for PowerShell to start and compile its helper (~0.8 s measured); a hang ends here. */
export const FOREGROUND_RAISE_TIMEOUT_MS = 5000;

/**
 * The script: attach this thread's input to the foreground window's thread,
 * then ask for the foreground. `{HWND}` is replaced by a decimal number.
 */
const RAISE_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class SprintTickerRaise {
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  public static bool Bring(IntPtr target) {
    uint fg = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
    uint me = GetCurrentThreadId();
    bool attached = fg != 0 && fg != me && AttachThreadInput(me, fg, true);
    try { BringWindowToTop(target); return SetForegroundWindow(target); }
    finally { if (attached) AttachThreadInput(me, fg, false); }
  }
}
"@
if (-not [SprintTickerRaise]::Bring([IntPtr][long]{HWND})) { exit 1 }
`;

/**
 * Brings a window to the front when the app is in the background.
 *
 * Windows refuses the foreground to a process the user is not using:
 * `BrowserWindow.focus()` then only flashes the taskbar button, and
 * `isFocused()` still answers true. A Stream Deck key is exactly that case
 * -- the press reaches Stream Deck, not SprintTicker -- so the deck's task
 * picker opened behind whatever the user had in front (2026-10-22). Measured that
 * day with another app in front: `show()` + `focus()`, the same with
 * `setAlwaysOnTop` toggled, and `minimize()` + `restore()` all left the other
 * app in front; attaching to the foreground thread's input, as here, brought
 * the window forward three times in three. A simulated Alt press works too,
 * but would reach the app the user was in.
 */
export class ForegroundRaiser {
  private readonly _run: EncodedPowerShellRunner;
  private readonly _platform: NodeJS.Platform;

  constructor(run: EncodedPowerShellRunner = ForegroundRaiser.defaultRun, platform: NodeJS.Platform = process.platform) {
    this._run = run;
    this._platform = platform;
  }

  /**
   * Asks for the foreground for the window whose native handle is given
   * (`BrowserWindow.getNativeWindowHandle()`). True when Windows granted it;
   * false otherwise, never a rejection -- the window is shown either way.
   */
  public async raise(nativeHandle: Buffer): Promise<boolean> {
    if (this._platform !== 'win32') return false;
    const hwnd = ForegroundRaiser.handleOf(nativeHandle);
    if (hwnd === null) return false;
    const script = RAISE_SCRIPT.replace('{HWND}', hwnd.toString());
    try {
      await this._run(Buffer.from(script, 'utf16le').toString('base64'));
      return true;
    } catch (err) {
      console.warn('[ForegroundRaiser] Windows did not bring the window forward:', err instanceof Error ? err.message : err);
      return false;
    }
  }

  /** The handle as a number; null for one that is not a pointer's size. */
  public static handleOf(nativeHandle: Buffer): bigint | null {
    if (!Buffer.isBuffer(nativeHandle)) return null;
    if (nativeHandle.length === 8) return nativeHandle.readBigUInt64LE(0);
    if (nativeHandle.length === 4) return BigInt(nativeHandle.readUInt32LE(0));
    return null;
  }

  private static defaultRun(encodedCommand: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand],
        { windowsHide: true, timeout: FOREGROUND_RAISE_TIMEOUT_MS },
        err => (err ? reject(err) : resolve())
      );
    });
  }
}
