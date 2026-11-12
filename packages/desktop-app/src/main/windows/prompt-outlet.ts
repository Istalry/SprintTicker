import type { ToastPresenter } from '../services/toast-presenter';
import type { WindowRoute } from '../../shared/window-route';

/** A question to the user, as a toast says it. */
export interface PromptAnnouncement {
  title: string;
  body: string;
  /** Where the toast's click opens the window: Today, where the question waits as a card, unless said. */
  route?: WindowRoute;
}

/**
 * Where the schedule's questions go (redesign P8c). **A prompt never takes
 * the focus**: the stand-up, Lunch's end, a forgotten session used to
 * `show()` + `focus()` the dashboard, which pulled it over whatever the user
 * was typing into. Now a question is a card on Today and a row on the mini
 * timer -- both fed by `send`, to every window -- and a toast only when the
 * dashboard is not on screen, whose click opens it.
 */
export interface PromptOutlet {
  /** To every open window: the dashboard and the mini timer. */
  send(channel: string, payload: unknown): void;
  /** A toast, only when the dashboard is not on screen. Never takes the focus. */
  announce(announcement: PromptAnnouncement): void;
}

/** The slice of a BrowserWindow this needs, so a test can fake it. */
export interface OutletWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  webContents: { isDestroyed(): boolean; send(channel: string, payload: unknown): void };
}

export interface WindowPromptOutletDeps {
  /** Every window a prompt reaches: the dashboard and, when open, the mini timer. */
  getWindows: () => readonly OutletWindow[];
  getDashboard: () => OutletWindow | null;
  toasts: ToastPresenter;
}

export class WindowPromptOutlet implements PromptOutlet {
  constructor(private readonly deps: WindowPromptOutletDeps) {}

  public send(channel: string, payload: unknown): void {
    for (const win of this.deps.getWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      win.webContents.send(channel, payload);
    }
  }

  public announce(announcement: PromptAnnouncement): void {
    if (this.dashboardOnScreen()) return;
    this.deps.toasts.show({ ...announcement, route: announcement.route ?? 'today' });
  }

  /** Visible and not minimised; hidden in the tray, or never shown at login, is not. */
  private dashboardOnScreen(): boolean {
    const win = this.deps.getDashboard();
    return win !== null && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
  }
}
