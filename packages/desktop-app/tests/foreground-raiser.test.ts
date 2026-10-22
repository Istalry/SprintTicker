import { describe, it, expect, vi, afterEach } from 'vitest';
import type { BrowserWindow } from 'electron';
import { ForegroundRaiser } from '../src/main/windows/foreground-raiser';
import { openTaskPickerInMainWindow, revealMainWindow } from '../src/main/windows/main-window-actions';
import { IPCChannel } from '../src/shared/ipc-channels';

/**
 * Bringing the window forward for a caller the user is not using -- a
 * Stream Deck key. The PowerShell runner is always a fake: a test must
 * never move windows on the developer's desktop.
 */
describe('ForegroundRaiser', () => {
  afterEach(() => vi.restoreAllMocks());

  const handle = (value: bigint) => {
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64LE(value);
    return buffer;
  };
  const decoded = (encoded: string) => Buffer.from(encoded, 'base64').toString('utf16le');

  it('Raise_OnWindows_RunsTheScriptForThatWindow', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const raiser = new ForegroundRaiser(run, 'win32');

    await expect(raiser.raise(handle(0x1a2b3cn))).resolves.toBe(true);

    expect(run).toHaveBeenCalledTimes(1);
    const script = decoded(run.mock.calls[0][0] as string);
    expect(script).toContain('AttachThreadInput');
    expect(script).toContain(`[IntPtr][long]${0x1a2b3c}`);
    expect(script).not.toContain('{HWND}');
  });

  it('Raise_WindowsRefuses_FalseAndWarnsNeverThrows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const raiser = new ForegroundRaiser(vi.fn().mockRejectedValue(new Error('exit code 1')), 'win32');

    await expect(raiser.raise(handle(42n))).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith('[ForegroundRaiser] Windows did not bring the window forward:', 'exit code 1');
  });

  it('Raise_NotWindows_RunsNothing', async () => {
    const run = vi.fn();
    await expect(new ForegroundRaiser(run, 'darwin').raise(handle(42n))).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('Raise_AHandleNotAPointer_RunsNothing', async () => {
    const run = vi.fn();
    await expect(new ForegroundRaiser(run, 'win32').raise(Buffer.alloc(3))).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('HandleOf_32And64Bit_ReadLittleEndian', () => {
    expect(ForegroundRaiser.handleOf(handle(0x0102030405n))).toBe(0x0102030405n);
    const small = Buffer.alloc(4);
    small.writeUInt32LE(0xabcd);
    expect(ForegroundRaiser.handleOf(small)).toBe(0xabcdn);
  });
});

describe('revealMainWindow', () => {
  const fakeWindow = () => {
    const win = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      getNativeWindowHandle: vi.fn(() => Buffer.alloc(8)),
      webContents: { send: vi.fn() }
    };
    return { win, asWindow: win as unknown as BrowserWindow };
  };

  it('Reveal_WithARaiser_AsksForTheForegroundToo', () => {
    const { win, asWindow } = fakeWindow();
    const raiser = { raise: vi.fn().mockResolvedValue(true) } as unknown as ForegroundRaiser;

    expect(revealMainWindow(asWindow, raiser)).toBe(true);

    expect(win.restore).toHaveBeenCalled();
    expect(win.show).toHaveBeenCalled();
    expect(raiser.raise).toHaveBeenCalledWith(win.getNativeWindowHandle.mock.results[0].value);
  });

  it('Reveal_WithoutARaiser_ShowsAndFocusesOnly', () => {
    const { win, asWindow } = fakeWindow();

    expect(revealMainWindow(asWindow)).toBe(true);

    expect(win.focus).toHaveBeenCalled();
    expect(win.getNativeWindowHandle).not.toHaveBeenCalled();
  });

  it('Reveal_NoWindow_FalseAndRaisesNothing', () => {
    const raiser = { raise: vi.fn() } as unknown as ForegroundRaiser;
    expect(revealMainWindow(null, raiser)).toBe(false);
    expect(raiser.raise).not.toHaveBeenCalled();
  });

  it('OpenTaskPicker_WithARaiser_RaisesAndOpensThePicker', () => {
    const { win, asWindow } = fakeWindow();
    const raiser = { raise: vi.fn().mockResolvedValue(true) } as unknown as ForegroundRaiser;

    expect(openTaskPickerInMainWindow(asWindow, raiser)).toBe(true);

    expect(raiser.raise).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith(IPCChannel.ON_HARDWARE_INPUT_EVENT, expect.objectContaining({ actionAssigned: 'TRIGGER_TASK_SELECTOR_MODAL' }));
  });
});
