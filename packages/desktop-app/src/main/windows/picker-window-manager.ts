import { ArgumentNullException } from '../../shared/dtos';
import type { PickerWindowMode } from '../../shared/picker-window';
import type { Rectangle } from './mini-window-manager';
import { PICKER_WINDOW_SIZE } from './window-constants';

/** The slice of `BrowserWindow` the manager drives, so a test can fake it. */
export interface PickerWindowLike {
  isDestroyed(): boolean;
  isVisible(): boolean;
  show(): void;
  focus(): void;
  destroy(): void;
  getNativeWindowHandle(): Buffer;
  once(event: 'ready-to-show', listener: () => void): unknown;
  on(event: 'closed' | 'blur', listener: () => void): unknown;
}

/** The slice of Electron's `screen` the manager reads. */
export interface PickerScreenLike {
  getCursorScreenPoint(): { x: number; y: number };
  getDisplayNearestPoint(point: { x: number; y: number }): { workArea: Rectangle };
}

/** The slice of `ForegroundRaiser` the manager needs. */
export interface RaiserLike {
  raise(nativeHandle: Buffer): Promise<boolean>;
}

export interface PickerWindowDeps {
  /** Builds the window at these bounds, hidden, and loads the picker in `mode`. */
  createWindow: (bounds: Rectangle, mode: PickerWindowMode) => PickerWindowLike;
  screen: PickerScreenLike;
  raiser: RaiserLike;
  /**
   * The picker in the main window, for when this one cannot be made:
   * `openTaskPickerInMainWindow`. Answers whether it opened.
   */
  fallback: (mode: PickerWindowMode, raise: boolean) => boolean;
}

export interface PickerOpenOptions {
  /**
   * Ask Windows for the foreground: for a press that reached another app --
   * a Stream Deck key, a global shortcut. A click on the tray or the mini
   * timer is the user's, and gives the app the foreground already.
   */
  raise?: boolean;
}

/** What the tray, the deck and the IPC layer need of the picker window. */
export interface PickerWindowController {
  /** Opens the picker; answers whether a picker opened, here or in the main window. */
  open(mode: PickerWindowMode, options?: PickerOpenOptions): boolean;
}

/**
 * The task picker as its own small window (redesign P7b, S7): opened from
 * the tray, the mini timer and the deck, without bringing the whole
 * dashboard over what the user was doing.
 *
 * One at a time: opening it again in the same mode brings it forward, and in
 * another mode replaces it. It closes itself after a pick or Escape (the
 * renderer's `window.close()`), and when it loses the focus it had -- a
 * picker left on top of the user's work, forgotten, would be in the way.
 * Opened from another app it is raised with `ForegroundRaiser`, never
 * `focus()` alone: Windows refuses the foreground to a process the user is
 * not using, and only flashes the taskbar (`CLAUDE.md` §3).
 *
 * The main window's picker stays the fallback (`openTaskPickerInMainWindow`)
 * until this window has run on a packaged build.
 */
export class PickerWindowManager implements PickerWindowController {
  private window: PickerWindowLike | null = null;
  private mode: PickerWindowMode | null = null;

  constructor(private readonly deps: PickerWindowDeps) {
    if (!deps) throw new ArgumentNullException('deps');
    if (!deps.createWindow) throw new ArgumentNullException('deps.createWindow');
    if (!deps.screen) throw new ArgumentNullException('deps.screen');
    if (!deps.raiser) throw new ArgumentNullException('deps.raiser');
    if (!deps.fallback) throw new ArgumentNullException('deps.fallback');
  }

  public isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  public open(mode: PickerWindowMode, options: PickerOpenOptions = {}): boolean {
    const raise = options.raise === true;
    if (this.isOpen()) {
      if (this.mode === mode) {
        // Still loading, it shows itself when ready.
        if (this.window!.isVisible()) this.bringForward(this.window!, raise);
        return true;
      }
      this.dispose();
    }

    let win: PickerWindowLike;
    try {
      win = this.deps.createWindow(this.centredBounds(), mode);
    } catch (err) {
      console.warn('[PickerWindow] Could not open the picker window; opening the main window\'s picker:', err);
      return this.deps.fallback(mode, raise);
    }
    this.window = win;
    this.mode = mode;

    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) this.bringForward(win, raise);
    });
    // Losing the focus it had closes it, as a launcher does.
    win.on('blur', () => {
      if (!win.isDestroyed()) win.destroy();
    });
    win.on('closed', () => {
      if (this.window === win) {
        this.window = null;
        this.mode = null;
      }
    });
    return true;
  }

  /** Closes it with the app. Safe to call twice. */
  public dispose(): void {
    const win = this.window;
    this.window = null;
    this.mode = null;
    if (win && !win.isDestroyed()) win.destroy();
  }

  private bringForward(win: PickerWindowLike, raise: boolean): void {
    win.show();
    win.focus();
    if (raise) void this.deps.raiser.raise(win.getNativeWindowHandle());
  }

  /** Centred on the display the pointer is on: where the user is looking. */
  private centredBounds(): Rectangle {
    const { width, height } = PICKER_WINDOW_SIZE;
    const area = this.deps.screen.getDisplayNearestPoint(this.deps.screen.getCursorScreenPoint()).workArea;
    const w = Math.min(width, area.width);
    const h = Math.min(height, area.height);
    return {
      x: Math.round(area.x + (area.width - w) / 2),
      y: Math.round(area.y + (area.height - h) / 2),
      width: w,
      height: h
    };
  }
}
