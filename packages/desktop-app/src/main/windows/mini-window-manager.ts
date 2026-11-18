import { ArgumentNullException } from '../../shared/dtos';
import {
  MINI_WINDOW_MARGIN,
  MINI_WINDOW_RECLAIM_AFTER_SYSTEM_MS,
  MINI_WINDOW_RECLAIM_DELAY_MS,
  MINI_WINDOW_SETTING_KEY,
  MINI_WINDOW_SIZE,
  MINI_WINDOW_TOP_LEVEL
} from './window-constants';

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The slice of `BrowserWindow` the manager drives, so a test can fake it. */
export interface MiniWindowLike {
  isDestroyed(): boolean;
  show(): void;
  /** Shown without taking the focus: for an opening the user did not click (P12d). */
  showInactive(): void;
  focus(): void;
  close(): void;
  destroy(): void;
  getBounds(): Rectangle;
  setAlwaysOnTop(flag: boolean, level?: typeof MINI_WINDOW_TOP_LEVEL): void;
  /** To the top of the z-order without the focus. */
  moveTop(): void;
  on(event: 'moved' | 'closed' | 'blur', listener: () => void): unknown;
}

/** The slice of Electron's `screen` the manager reads. */
export interface ScreenLike {
  getAllDisplays(): Array<{ workArea: Rectangle }>;
  getPrimaryDisplay(): { workArea: Rectangle };
}

export interface SettingsStore {
  getSetting<T>(key: string, defaultValue: T): T;
  setSetting<T>(key: string, value: T): void;
}

/** What is remembered between launches. */
export interface MiniWindowState {
  /** Open when the app last quit, so it comes back open. */
  open: boolean;
  x?: number;
  y?: number;
}

export interface MiniWindowDeps {
  /**
   * Builds and loads the window at these bounds; the manager owns it after.
   * `inactive`: shown without the focus once it is ready.
   */
  createWindow: (bounds: Rectangle, options?: { inactive?: boolean }) => MiniWindowLike;
  screen: ScreenLike;
  settings: SettingsStore;
  /** Whether a window of the app's own has the focus: that one keeps the front. */
  appHasFocus?: () => boolean;
}

/** What the IPC layer and the tray need of the mini window. */
export interface MiniWindowController {
  isOpen(): boolean;
  toggle(): boolean;
  subscribe(listener: (open: boolean) => void): () => void;
}

/**
 * The always-on-top mini timer: the bar's job, done on screen, for people
 * without one -- and handy with one, when the bar is out of sight.
 *
 * It remembers where it was put and whether it was open, and comes back the
 * same way. The position is checked against the displays that exist *now*: a
 * window saved on a second monitor that has since been unplugged would
 * otherwise open off-screen, always on top of nothing, with no way to reach it.
 */
export class MiniWindowManager implements MiniWindowController {
  private window: MiniWindowLike | null = null;
  private disposing = false;
  private reclaimTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(open: boolean) => void>();

  constructor(private readonly deps: MiniWindowDeps) {
    if (!deps) throw new ArgumentNullException('deps');
    if (!deps.createWindow) throw new ArgumentNullException('deps.createWindow');
    if (!deps.screen) throw new ArgumentNullException('deps.screen');
    if (!deps.settings) throw new ArgumentNullException('deps.settings');
  }

  public isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  /** Opens it, or brings it forward if it is already open. */
  public open(): void {
    if (this.isOpen()) {
      this.window!.show();
      this.window!.focus();
      return;
    }
    this.create(false);
  }

  /**
   * Opens it, or shows it, without taking the focus (P12d): an interruption
   * started from the bar, the deck or the shortcut puts its name field on
   * screen while the user goes on typing wherever they were.
   */
  public openQuietly(): void {
    if (this.isOpen()) {
      this.window!.showInactive();
      return;
    }
    this.create(true);
  }

  private create(inactive: boolean): void {
    const win = this.deps.createWindow(this.initialBounds(), inactive ? { inactive: true } : undefined);
    this.window = win;

    win.on('moved', () => {
      if (win.isDestroyed()) return;
      const { x, y } = win.getBounds();
      this.save({ ...this.state(), x, y });
    });

    // Windows keeps one band of always-on-top windows, the last one raised
    // in front, and can drop the flag altogether: set once at creation, the
    // mini timer ended up behind ordinary windows (2.0.0, 2026-11-18).
    win.on('blur', () => this.reclaimTopSoon(MINI_WINDOW_RECLAIM_DELAY_MS));

    win.on('closed', () => {
      if (this.window === win) this.window = null;
      // Closed with the app, it stays "open" so the next launch brings it
      // back; closed by the user, it stays closed.
      if (!this.disposing) {
        this.save({ ...this.state(), open: false });
        this.notify(false);
      }
    });

    this.save({ ...this.state(), open: true });
    this.notify(true);
  }

  public close(): void {
    if (this.isOpen()) this.window!.close();
  }

  /** Answers whether it is open afterwards. */
  public toggle(): boolean {
    if (this.isOpen()) {
      this.close();
      return false;
    }
    this.open();
    return true;
  }

  /** Reopens it at startup if it was open when the app last quit. */
  public restore(): void {
    if (this.state().open) this.open();
  }

  /**
   * Puts it back on top after `delayMs`, without taking the focus -- unless
   * a window of the app's own has it then. For a lost focus, and for a wake,
   * an unlock or a display change, over which Windows can drop the flag.
   */
  public reclaimTopSoon(delayMs: number = MINI_WINDOW_RECLAIM_AFTER_SYSTEM_MS): void {
    if (!this.isOpen()) return;
    if (this.reclaimTimer) clearTimeout(this.reclaimTimer);
    this.reclaimTimer = setTimeout(() => {
      this.reclaimTimer = null;
      if (!this.isOpen() || this.deps.appHasFocus?.()) return;
      this.window!.setAlwaysOnTop(true, MINI_WINDOW_TOP_LEVEL);
      this.window!.moveTop();
    }, delayMs);
  }

  public subscribe(listener: (open: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Closes it with the app. Kept "open" in the settings, unlike a close by
   * the user. Without this the mini window would outlive the main one, and
   * Windows quits an app only when its last window closes. Called at
   * `before-quit` as well as when the dashboard closes: a quit closes every
   * window, and the mini timer's own close must not count as the user's.
   * Safe to call twice.
   */
  public dispose(): void {
    this.disposing = true;
    if (this.reclaimTimer) clearTimeout(this.reclaimTimer);
    this.reclaimTimer = null;
    if (this.window && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  private initialBounds(): Rectangle {
    const { width, height } = MINI_WINDOW_SIZE;
    const saved = this.state();
    if (saved.x !== undefined && saved.y !== undefined) {
      const candidate = { x: saved.x, y: saved.y, width, height };
      if (this.deps.screen.getAllDisplays().some(d => contains(d.workArea, candidate))) {
        return candidate;
      }
    }
    // Bottom right of the primary display, clear of the taskbar: workArea
    // already excludes it.
    const area = this.deps.screen.getPrimaryDisplay().workArea;
    return {
      x: area.x + area.width - width - MINI_WINDOW_MARGIN,
      y: area.y + area.height - height - MINI_WINDOW_MARGIN,
      width,
      height
    };
  }

  private state(): MiniWindowState {
    const stored = this.deps.settings.getSetting<Partial<MiniWindowState>>(MINI_WINDOW_SETTING_KEY, {});
    return { ...stored, open: stored.open === true };
  }

  private save(state: MiniWindowState): void {
    this.deps.settings.setSetting(MINI_WINDOW_SETTING_KEY, state);
  }

  private notify(open: boolean): void {
    for (const listener of this.listeners) listener(open);
  }
}

/** Whether `inner` lies entirely inside `outer`. */
function contains(outer: Rectangle, inner: Rectangle): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}
