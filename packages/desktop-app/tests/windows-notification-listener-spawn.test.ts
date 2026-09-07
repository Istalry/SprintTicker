import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WindowsNotificationListenerService } from '../src/main/services/windows-notification-listener-service';
import { PriorityPreemptionEngine } from '../src/main/services/priority-preemption-engine';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { AppIconResolver } from '../src/main/services/app-icon-resolver';

const { spawnCalls, spawnMock } = vi.hoisted(() => {
  const calls: { command: string; args: string[] }[] = [];
  return {
    spawnCalls: calls,
    spawnMock: (command: string, args: string[]) => {
      calls.push({ command, args });
      return { stdout: null, stderr: null, on: () => undefined, kill: () => undefined };
    }
  };
});

vi.mock('child_process', () => ({ spawn: spawnMock }));

/**
 * How the PowerShell listener is launched.
 *
 * The script used to travel as a `-EncodedCommand` argument: base64 of UTF-16LE,
 * which costs about 2.67 characters of command line per character of script.
 * Windows caps a command line at 32,767 characters, so the script had an
 * undocumented ceiling of roughly 12,000 characters and nothing measured it.
 *
 * Commit a97c6f6 crossed that ceiling. `spawn` failed with ENAMETOOLONG on every
 * launch, and because this listener is the single source of every Windows
 * notification, Slack, Discord, Teams and the rest all went silent at once --
 * while the app logged one line and reported successful initialisation.
 *
 * These tests assert the invariant that failed, not the mechanism that happened
 * to fix it: the command line stays bounded however large the script grows.
 */
describe('WindowsNotificationListenerService launch', () => {
  /** CreateProcess rejects a command line at or beyond this length. */
  const WINDOWS_MAX_COMMAND_LINE = 32767;

  let scriptDir: string;
  let service: WindowsNotificationListenerService;
  let originalPlatform: PropertyDescriptor | undefined;

  beforeEach(() => {
    spawnCalls.length = 0;
    scriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprintticker-listener-'));

    // The listener is Windows-only by design. Forcing the platform keeps the
    // assertion meaningful wherever the suite runs.
    originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    const store = new Map<string, unknown>();
    const settingsRepo = {
      getSetting: vi.fn((key: string, defaultValue: unknown) => store.get(key) ?? defaultValue),
      setSetting: vi.fn((key: string, value: unknown) => store.set(key, value))
    } as unknown as SettingsRepository;

    service = new WindowsNotificationListenerService(
      settingsRepo,
      new PriorityPreemptionEngine(settingsRepo),
      undefined,
      new AppIconResolver(
        async () => '',
        async () => null
      ),
      scriptDir
    );
  });

  afterEach(() => {
    service.stopListening();
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
    fs.rmSync(scriptDir, { recursive: true, force: true });
  });

  it('StartListening_AnyScriptSize_KeepsCommandLineWithinWindowsLimit', () => {
    service.startListening();

    expect(spawnCalls).toHaveLength(1);
    const { command, args } = spawnCalls[0];
    const commandLineLength = command.length + args.reduce((n, a) => n + a.length + 1, 0);

    expect(commandLineLength).toBeLessThan(WINDOWS_MAX_COMMAND_LINE);
  });

  it('StartListening_ValidSettings_PassesScriptAsFileRatherThanArgument', () => {
    service.startListening();

    const { args } = spawnCalls[0];
    expect(args).toContain('-File');
    expect(args).not.toContain('-EncodedCommand');

    const scriptPath = args[args.indexOf('-File') + 1];
    expect(fs.existsSync(scriptPath)).toBe(true);
    expect(path.dirname(scriptPath)).toBe(scriptDir);
  });

  it('StartListening_GeneratedScript_IsWrittenAsUtf8WithBom', () => {
    service.startListening();

    const scriptPath = spawnCalls[0].args[spawnCalls[0].args.indexOf('-File') + 1];
    const contents = fs.readFileSync(scriptPath, 'utf8');

    // PowerShell 5.1 reads a BOM-less .ps1 as the system ANSI codepage.
    expect(contents.charCodeAt(0)).toBe(0xfeff);
    expect(contents).toContain('BUSYSEP');
  });

  it('StopListening_AfterStart_RemovesTheGeneratedScript', () => {
    service.startListening();
    const scriptPath = spawnCalls[0].args[spawnCalls[0].args.indexOf('-File') + 1];
    expect(fs.existsSync(scriptPath)).toBe(true);

    service.stopListening();

    expect(fs.existsSync(scriptPath)).toBe(false);
  });

  it('StartListening_RepeatedStartStop_ReusesOneScriptFile', () => {
    service.startListening();
    service.stopListening();
    service.startListening();

    // A fixed filename means a crash leaves one stale script, not one per launch.
    expect(fs.readdirSync(scriptDir)).toHaveLength(1);
  });
});
