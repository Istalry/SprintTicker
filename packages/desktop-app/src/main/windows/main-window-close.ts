import type { ToastPresenter } from '../services/toast-presenter';

/** Set once the first close to the tray has said where the app went (S26). */
export const CLOSE_TO_TRAY_TOLD_KEY = 'close_to_tray_told';

/** What the first close to the tray says: where the app went, and how to quit. */
export const STILL_RUNNING_TOAST = {
  title: 'SprintTicker is still running',
  body: "It's in the tray, by the clock, and your timer keeps running. Quit from its menu."
} as const;

export interface MainWindowCloseDeps {
  /** The user's "When I close the window" (`close_to_tray`), read at each close. */
  closeToTray: () => boolean;
  /** True once a quit is under way -- the tray's Quit, or Windows shutting down. */
  isQuitting: () => boolean;
  hide: () => void;
  settings: {
    getSetting<T>(key: string, fallback: T): T;
    setSetting(key: string, value: unknown): void;
  };
  toasts?: ToastPresenter;
  /** The toast's click: the window again. */
  reveal: () => void;
}

/**
 * The dashboard's close (redesign P12a): hidden to the tray, so the timer,
 * the bar and the deck keep running, unless a quit is under way or the user
 * chose to quit on close. A close used to quit the app -- clearing the bar
 * and stopping the deck's socket -- which made the window's ✕ the most
 * expensive button in it.
 *
 * A quit must never be held here: Windows' shutdown, End my day's included,
 * closes the window, and a close that only hides would hold the shutdown.
 */
export class MainWindowCloseGuard {
  constructor(private readonly deps: MainWindowCloseDeps) {}

  /** The window's `close`: answers whether it was hidden rather than closed. */
  public onClose(event: { preventDefault(): void }): 'hidden' | 'closing' {
    if (this.deps.isQuitting() || !this.deps.closeToTray()) return 'closing';
    event.preventDefault();
    this.deps.hide();
    this.tellOnce();
    return 'hidden';
  }

  private tellOnce(): void {
    if (this.deps.settings.getSetting<boolean>(CLOSE_TO_TRAY_TOLD_KEY, false)) return;
    const shown = this.deps.toasts?.show({ ...STILL_RUNNING_TOAST, onClick: () => this.deps.reveal() }) ?? false;
    // Only once it reached Windows: a toast that could not be shown has told nobody.
    if (shown) this.deps.settings.setSetting(CLOSE_TO_TRAY_TOLD_KEY, true);
  }
}
