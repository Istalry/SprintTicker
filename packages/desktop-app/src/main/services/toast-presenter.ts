export interface ToastRequest {
  title: string;
  body: string;
  /** Opened when the toast is clicked -- only if it is an http(s) link. */
  url?: string;
}

export interface ToastPresenter {
  /** Answers whether a toast was handed to Windows. */
  show(toast: ToastRequest): boolean;
}

/** The slice of Electron's `Notification` this uses, so a test can fake it. */
export interface NotificationLike {
  show(): void;
  on(event: 'click' | 'close' | 'failed', listener: (...args: unknown[]) => void): unknown;
}

export interface ElectronToastDeps {
  isSupported: () => boolean;
  create: (options: { title: string; body: string }) => NotificationLike;
  openExternal: (url: string) => Promise<void>;
}

/**
 * How many shown toasts keep a reference. Electron routes a click only to a
 * Notification object that is still alive; one the garbage collector took
 * leaves its toast unclickable. Bounded, because Windows does not reliably
 * report a toast that went quietly to the Action Center.
 */
export const MAX_LIVE_TOASTS = 20;

/**
 * Whether a link from a remote server may be handed to the shell.
 *
 * An allow-list of two schemes: the URL comes from the provider's API, and
 * `shell.openExternal` would as happily run a `file:` or a custom protocol
 * handler as open a web page.
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    // Not a URL at all, which is as unsafe to open as a bad scheme.
    return false;
  }
}

/**
 * Windows toasts through Electron's `Notification`.
 *
 * Windows shows a toast only for the AppUserModelID the app set, and
 * attributes it to the shortcut carrying that ID; see APP_USER_MODEL_ID. A
 * toast Windows refuses reports `failed`, which is logged -- otherwise the
 * only symptom would be nothing appearing.
 */
export class ElectronToastPresenter implements ToastPresenter {
  private readonly live: NotificationLike[] = [];
  private warnedUnsupported = false;

  constructor(private readonly deps: ElectronToastDeps) {}

  public show(toast: ToastRequest): boolean {
    if (!this.deps.isSupported()) {
      if (!this.warnedUnsupported) {
        console.warn('[Toasts] This system does not support notifications; none will be shown.');
        this.warnedUnsupported = true;
      }
      return false;
    }

    const notification = this.deps.create({ title: toast.title, body: toast.body });
    this.keep(notification);
    notification.on('click', () => {
      this.release(notification);
      if (toast.url) this.open(toast.url);
    });
    notification.on('close', () => this.release(notification));
    notification.on('failed', (_event: unknown, error: unknown) => {
      this.release(notification);
      console.warn('[Toasts] Windows did not show a notification:', error);
    });
    notification.show();
    return true;
  }

  private open(url: string): void {
    if (!isSafeExternalUrl(url)) {
      console.warn('[Toasts] Refused to open a notification link that is not http(s).');
      return;
    }
    this.deps.openExternal(url).catch(err => console.warn('[Toasts] Could not open the notification link:', err));
  }

  private keep(notification: NotificationLike): void {
    this.live.push(notification);
    if (this.live.length > MAX_LIVE_TOASTS) this.live.shift();
  }

  private release(notification: NotificationLike): void {
    const index = this.live.indexOf(notification);
    if (index >= 0) this.live.splice(index, 1);
  }
}
