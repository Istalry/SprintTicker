/**
 * Debounced auto-save with a baseline, extracted from React so it can be
 * tested.
 *
 * The dangerous part of replacing a Save button with auto-save is not the
 * saving, it is the *first* save. A settings panel mounts holding defaults,
 * loads the stored values asynchronously, and sets state. A naive
 * "save whenever the values change" effect fires twice before the user has
 * touched anything: once with the defaults, and once with the freshly loaded
 * values. The first of those writes defaults over the user's configuration.
 *
 * So this deliberately does nothing until it is told the panel has loaded, and
 * then treats the first values it sees as a baseline to compare against rather
 * than something to persist.
 */

/** What the indicator should show. */
export type AutoSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface AutoSaveSchedulerOptions {
  /** Runs the actual persistence. Rejections surface as `error`. */
  save: (values: readonly unknown[]) => void | Promise<void>;
  /** Quiet period after the last change before saving. */
  delayMs?: number;
  /** Notified whenever the status changes, for re-rendering an indicator. */
  onStatusChange?: (status: AutoSaveStatus) => void;
  /** Injected for tests; defaults to the ambient timer functions. */
  setTimeoutFn?: (handler: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

/** Long enough that typing a URL is one save, short enough to feel immediate. */
export const AUTO_SAVE_DELAY_MS = 700;

/** How long a `saved` confirmation stays on screen before returning to idle. */
export const AUTO_SAVE_CONFIRMATION_MS = 2000;

export class AutoSaveScheduler {
  private readonly _save: (values: readonly unknown[]) => void | Promise<void>;
  private readonly _delayMs: number;
  private readonly _onStatusChange?: (status: AutoSaveStatus) => void;
  private readonly _setTimeout: (handler: () => void, ms: number) => unknown;
  private readonly _clearTimeout: (handle: unknown) => void;

  private _baseline: readonly unknown[] | null = null;
  private _timer: unknown = null;
  private _status: AutoSaveStatus = 'idle';
  private _disposed = false;

  constructor(options: AutoSaveSchedulerOptions) {
    if (!options || typeof options.save !== 'function') {
      throw new Error('AutoSaveScheduler requires a save function.');
    }
    this._save = options.save;
    this._delayMs = options.delayMs ?? AUTO_SAVE_DELAY_MS;
    this._onStatusChange = options.onStatusChange;
    this._setTimeout = options.setTimeoutFn ?? ((h, ms) => setTimeout(h, ms));
    this._clearTimeout = options.clearTimeoutFn ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  public get status(): AutoSaveStatus {
    return this._status;
  }

  /** True once a baseline has been taken, i.e. the panel reported itself loaded. */
  public get hasBaseline(): boolean {
    return this._baseline !== null;
  }

  /**
   * Reports the panel's current values.
   *
   * `loaded` is the panel's own "I have finished reading stored settings"
   * flag. While it is false nothing is scheduled and no baseline is taken, so
   * a slow load cannot be beaten by the effect that watches the values.
   */
  public sync(values: readonly unknown[], loaded: boolean): void {
    if (this._disposed || !loaded) return;

    if (this._baseline === null) {
      // First sight of real values. This is what the user already has stored;
      // writing it back would be a no-op at best and, for the provider panel,
      // would reinitialise the provider and start a sync on every visit.
      this._baseline = [...values];
      return;
    }

    if (shallowEqual(this._baseline, values)) return;

    this._baseline = [...values];
    this._schedule(values);
  }

  /** Persists immediately if a save is pending. */
  public flush(): void {
    if (this._timer === null) return;
    this._clearTimeout(this._timer);
    this._timer = null;
    if (this._baseline) this._runSave(this._baseline);
  }

  /** Cancels any pending save and stops accepting new ones. */
  public dispose(): void {
    this._disposed = true;
    if (this._timer !== null) {
      this._clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private _schedule(values: readonly unknown[]): void {
    if (this._timer !== null) this._clearTimeout(this._timer);
    this._setStatus('pending');
    this._timer = this._setTimeout(() => {
      this._timer = null;
      this._runSave(values);
    }, this._delayMs);
  }

  private _runSave(values: readonly unknown[]): void {
    this._setStatus('saving');
    let result: void | Promise<void>;
    try {
      result = this._save(values);
    } catch (err) {
      console.error('[AutoSave] Save threw:', err);
      this._setStatus('error');
      return;
    }

    if (!isPromise(result)) {
      this._setStatus('saved');
      return;
    }

    result.then(
      () => this._setStatus('saved'),
      err => {
        // Reported rather than swallowed: with no Save button there is nothing
        // for the user to retry, so a silent failure would lose the edit with
        // no trace.
        console.error('[AutoSave] Save failed:', err);
        this._setStatus('error');
      }
    );
  }

  private _setStatus(status: AutoSaveStatus): void {
    if (this._disposed || this._status === status) return;
    this._status = status;
    this._onStatusChange?.(status);
  }
}

function shallowEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, i) => Object.is(value, b[i]));
}

function isPromise(value: unknown): value is Promise<void> {
  return typeof (value as { then?: unknown })?.then === 'function';
}
