import { exec } from 'child_process';
import { ArgumentNullException, ArgumentException } from '../../shared/dtos';

export interface EditorSaveResult {
  isSaved: boolean;
  isEditorDetected: boolean;
}

export interface ISystemAutomationService {
  saveOpenEditors(): Promise<EditorSaveResult>;
  scheduleShutdown(timeoutSeconds?: number, reason?: string): Promise<boolean>;
  abortShutdown(): Promise<boolean>;
  isShutdownPending(): boolean;
}

export type CommandExecFn = (command: string) => Promise<{ stdout: string; stderr: string }>;

/**
 * Service responsible for operating system power management (PC shutdown, shutdown cancellation)
 * and safely orchestrating open code editor file-saving without launching empty editor instances.
 */
export class SystemAutomationService implements ISystemAutomationService {
  private static readonly DEFAULT_SHUTDOWN_TIMEOUT_SECONDS = 30;
  private static readonly DEFAULT_SHUTDOWN_REASON = 'BUSY Bar End-of-Day Wrap-Up';
  private static readonly EDITOR_PROCESS_NAMES = ['Code', 'Code - Insiders', 'Cursor', 'Antigravity'];

  private readonly _execFn: CommandExecFn;
  private _isShutdownScheduled: boolean = false;

  constructor(execFn?: CommandExecFn) {
    this._execFn = execFn ?? SystemAutomationService.defaultExec;
  }

  /**
   * Whether this instance would run real commands against the developer's own
   * machine.
   *
   * Three methods below short-circuit on this, and audit F-36's sibling F-35
   * flagged the `NODE_ENV` reads as test logic leaking into production code.
   * They are kept deliberately, and the second half of the condition is why:
   * the guard fires only when **nobody injected an executor**. A test that
   * passes its own `execFn` is exercising the real path, so the guard is not a
   * hole in the coverage -- it is the backstop for a test that forgot, and what
   * it prevents is this service shutting down or driving UI automation on the
   * machine running the suite. CLAUDE.md states that as a rule ("tests must not
   * spawn PowerShell against the developer's own machine"); this enforces it
   * where the spawning actually happens rather than trusting every future test
   * to remember.
   */
  private get wouldTouchThisMachine(): boolean {
    return process.env.NODE_ENV === 'test' && this._execFn === SystemAutomationService.defaultExec;
  }

  /// <summary>
  /// Default child_process execution wrapped in a Promise.
  /// Why: Decouples native process execution for robust error handling and mockability in tests.
  /// </summary>
  private static defaultExec(command: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout: stdout ? stdout.toString() : '', stderr: stderr ? stderr.toString() : '' });
        }
      });
    });
  }

  /// <summary>
  /// Indicates whether a PC shutdown timer is currently active and pending execution.
  /// Why: Prevents duplicate shutdown dispatch calls and allows conditional aborts.
  /// </summary>
  public isShutdownPending(): boolean {
    return this._isShutdownScheduled;
  }

  /// <summary>
  /// Instructs open editor windows (VS Code, Cursor) to save all open dirty files.
  /// Why: Avoids losing uncommitted developer work prior to PC shutdown or EOD wrap-up.
  /// Architectural Rationale: Checks for active editor processes first before invoking UI automation,
  /// avoiding the bug where 'code --command' erroneously spawned brand new blank editor windows.
  /// </summary>
  public async saveOpenEditors(): Promise<EditorSaveResult> {
    if (this.wouldTouchThisMachine) {
      return { isSaved: true, isEditorDetected: true };
    }

    const platform = process.platform;

    if (platform === 'win32') {
      return this.saveOpenEditorsWindows();
    } else if (platform === 'darwin') {
      return this.saveOpenEditorsMac();
    } else {
      return this.saveOpenEditorsLinux();
    }
  }

  /// <summary>
  /// Executes PowerShell automation to trigger 'Save All' on running VS Code / Cursor windows on Windows.
  /// Why: Sends standard Save All keystrokes (Ctrl+K, S) directly to active windows without spawning new CLI processes.
  /// </summary>
  private async saveOpenEditorsWindows(): Promise<EditorSaveResult> {
    try {
      const processFilter = SystemAutomationService.EDITOR_PROCESS_NAMES.map(n => `"${n}"`).join(',');
      const psScript = `
        $editors = Get-Process -Name ${processFilter} -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' };
        if ($editors) {
          $wshell = New-Object -ComObject wscript.shell;
          foreach ($proc in $editors) {
            if ($wshell.AppActivate($proc.Id)) {
              Start-Sleep -Milliseconds 80;
              $wshell.SendKeys('^(ks)');
              Start-Sleep -Milliseconds 50;
            }
          }
          Write-Output 'EDITORS_SAVED';
        } else {
          Write-Output 'NO_EDITORS_RUNNING';
        }
      `.replace(/\r?\n\s+/g, ' ').trim();

      const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
      const { stdout } = await this._execFn(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encodedCommand}`);

      if (stdout && stdout.includes('EDITORS_SAVED')) {
        return { isSaved: true, isEditorDetected: true };
      } else {
        return { isSaved: false, isEditorDetected: false };
      }
    } catch (error) {
      console.warn('[SystemAutomationService] Could not automate editor file save on Windows:', error);
      return { isSaved: false, isEditorDetected: false };
    }
  }

  /// <summary>
  /// Executes AppleScript automation to trigger file saves on macOS editor applications.
  /// </summary>
  private async saveOpenEditorsMac(): Promise<EditorSaveResult> {
    try {
      const appleScript = `
        tell application "System Events"
          set codeProcs to (every process whose name is "Code" or name is "Cursor")
          if (count of codeProcs) > 0 then
            repeat with proc in codeProcs
              tell proc to set frontmost to true
              keystroke "s" using {command down, option down}
            end repeat
            return "EDITORS_SAVED"
          else
            return "NO_EDITORS_RUNNING"
          end if
        end tell
      `.replace(/\r?\n\s+/g, ' ').trim();

      const { stdout } = await this._execFn(`osascript -e '${appleScript}'`);
      if (stdout && stdout.includes('EDITORS_SAVED')) {
        return { isSaved: true, isEditorDetected: true };
      }
      return { isSaved: false, isEditorDetected: false };
    } catch (error) {
      console.warn('[SystemAutomationService] Could not automate editor file save on macOS:', error);
      return { isSaved: false, isEditorDetected: false };
    }
  }

  /// <summary>
  /// Fallback save handler for Linux desktop environments using xdotool if available.
  /// </summary>
  private async saveOpenEditorsLinux(): Promise<EditorSaveResult> {
    try {
      const { stdout } = await this._execFn('which xdotool');
      if (!stdout || !stdout.trim()) {
        return { isSaved: false, isEditorDetected: false };
      }
      await this._execFn('xdotool search --onlyvisible --class "code" windowactivate --sync key --clearmodifiers ctrl+k s');
      return { isSaved: true, isEditorDetected: true };
    } catch {
      return { isSaved: false, isEditorDetected: false };
    }
  }

  /// <summary>
  /// Schedules a system shutdown sequence after the specified timeout delay.
  /// Why: Allows developers to walk away at EOD with the workstation safely closing down.
  /// </summary>
  public async scheduleShutdown(
    timeoutSeconds: number = SystemAutomationService.DEFAULT_SHUTDOWN_TIMEOUT_SECONDS,
    reason: string = SystemAutomationService.DEFAULT_SHUTDOWN_REASON
  ): Promise<boolean> {
    if (timeoutSeconds < 0) {
      throw new ArgumentException('Timeout seconds cannot be negative', 'timeoutSeconds');
    }
    if (!reason) {
      throw new ArgumentNullException('reason');
    }

    if (this.wouldTouchThisMachine) {
      console.log(`[SystemAutomationService] [TEST ENV] Simulated shutdown scheduled (${timeoutSeconds}s): ${reason}`);
      this._isShutdownScheduled = true;
      return true;
    }

    try {
      const platform = process.platform;
      let command: string;

      if (platform === 'win32') {
        const sanitizedReason = reason.replace(/"/g, '');
        command = `shutdown /s /f /t ${timeoutSeconds} /c "${sanitizedReason}"`;
      } else if (platform === 'darwin') {
        command = `osascript -e 'tell app "System Events" to shut down'`;
      } else {
        const minutes = Math.max(1, Math.ceil(timeoutSeconds / 60));
        command = `shutdown -h +${minutes} "${reason}"`;
      }

      await this._execFn(command);
      this._isShutdownScheduled = true;
      console.log(`[SystemAutomationService] Scheduled system shutdown in ${timeoutSeconds}s`);
      return true;
    } catch (error) {
      console.error('[SystemAutomationService] Failed to schedule shutdown:', error);
      return false;
    }
  }

  /// <summary>
  /// Aborts an active scheduled shutdown timer if one was previously scheduled.
  /// Why: Restores system state if the user cancels or dismisses the EOD prompt during the grace window.
  /// </summary>
  public async abortShutdown(): Promise<boolean> {
    if (this.wouldTouchThisMachine) {
      console.log('[SystemAutomationService] [TEST ENV] Simulated shutdown cancelled');
      this._isShutdownScheduled = false;
      return true;
    }

    if (!this._isShutdownScheduled) {
      return true;
    }

    try {
      const platform = process.platform;
      if (platform === 'win32') {
        await this._execFn('shutdown /a');
      } else if (platform === 'linux') {
        await this._execFn('shutdown -c');
      }
      this._isShutdownScheduled = false;
      console.log('[SystemAutomationService] Pending system shutdown aborted successfully.');
      return true;
    } catch (error) {
      console.warn('[SystemAutomationService] Failed to abort shutdown or no shutdown in progress:', error);
      this._isShutdownScheduled = false;
      return false;
    }
  }
}
