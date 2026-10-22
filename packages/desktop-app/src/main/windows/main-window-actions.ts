import type { BrowserWindow } from 'electron';
import { IPCChannel } from '../../shared/ipc-channels';
import type { ForegroundRaiser } from './foreground-raiser';

/**
 * Brings the dashboard to the front, out of the tray or a minimised state.
 *
 * `raiser` is for a caller the user is not using -- a Stream Deck key --
 * where Windows refuses `focus()` and only flashes the taskbar. The tray
 * and the mini timer need none: a click on them is the user's, and gives
 * the app the foreground.
 */
export function revealMainWindow(win: BrowserWindow | null, raiser?: ForegroundRaiser): boolean {
  if (!win || win.isDestroyed()) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (raiser) void raiser.raise(win.getNativeWindowHandle());
  return true;
}

/**
 * Brings the dashboard forward with its task picker open -- for the tray menu
 * and the mini timer, which have no room for a picker of their own.
 *
 * Sent as the hardware action the picker already answers to, on the channel
 * the renderer actually listens on. The tray used to send it on
 * `input:hardware-event`, a channel nothing subscribes to, so its "Trigger
 * Task Selector Modal" entry showed the window and opened nothing.
 *
 * The key is named for where the press came from: Device Diagnostics logs
 * `inputKey` as a key of the bar, and `ok` there would record a press nobody
 * made on it.
 */
export function openTaskPickerInMainWindow(win: BrowserWindow | null, raiser?: ForegroundRaiser): boolean {
  if (!revealMainWindow(win, raiser)) return false;
  win!.webContents.send(IPCChannel.ON_HARDWARE_INPUT_EVENT, {
    inputKey: 'app',
    actionAssigned: 'TRIGGER_TASK_SELECTOR_MODAL'
  });
  return true;
}
