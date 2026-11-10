import { ArgumentException, ArgumentNullException, UndoKind, UndoStateDTO } from '../../shared/dtos';
import { UNDO_WINDOW_MS } from '../sync/sync-constants';

/** An action that can be taken back while its sends are held. */
export interface UndoableAction {
  kind: UndoKind;
  label: string;
  /**
   * Puts things back. False when it could not -- something was sent after
   * all -- and nothing changed.
   */
  undo: () => boolean;
  /**
   * What waits for the action to be final: the Done transition of a stop.
   * Runs once, when the window ends or another action replaces this one;
   * never after an undo.
   */
  commit?: () => void;
}

/** Timers, injected so a test steps through the window. */
export interface UndoTimers {
  setTimeout: (run: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const REAL_TIMERS: UndoTimers = {
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout)
};

/**
 * The last action, held for the undo window (P5): Stop, Discard, a
 * correction, a move, a deletion, End my day.
 *
 * One at a time: offering a new action commits the previous at once, so
 * two holds never chain and Undo always means the last thing done. The
 * window is the queue's hold (`UNDO_WINDOW_MS`) and reads the same clock,
 * `Date.now()`: an undo before it ends finds every row of its action
 * unsent, and one at or after it is refused -- the worker may have claimed
 * a row by then. The action's own `undo` checks that too (`RestorePoint`),
 * so a row claimed early by some other path still refuses rather than
 * leaving the time at the provider and gone from here.
 *
 * Only this service undoes. Anything else that put rows back would have to
 * repeat both checks.
 */
export class UndoService {
  private readonly _now: () => number;
  private readonly _timers: UndoTimers;
  private readonly _windowMs: number;
  private _current: { action: UndoableAction; expiresAt: number; timer: unknown } | null = null;
  private readonly _listeners = new Set<(state: UndoStateDTO | null) => void>();

  constructor(now: () => number = Date.now, timers: UndoTimers = REAL_TIMERS, windowMs: number = UNDO_WINDOW_MS) {
    if (!now) throw new ArgumentNullException('now');
    if (!timers) throw new ArgumentNullException('timers');
    if (!(windowMs > 0)) throw new ArgumentException('The undo window must be positive.', 'windowMs');
    this._now = now;
    this._timers = timers;
    this._windowMs = windowMs;
  }

  /** Offers an action for undo, committing whatever was offered before. */
  public offer(action: UndoableAction): void {
    if (!action) throw new ArgumentNullException('action');
    if (!action.label) throw new ArgumentException('An undoable action says what it did.', 'action');
    this.commitPending();
    const expiresAt = this._now() + this._windowMs;
    const timer = this._timers.setTimeout(() => this.expire(action), this._windowMs);
    this._current = { action, expiresAt, timer };
    this.notify();
  }

  /** The action that can still be undone, or null. */
  public current(): UndoStateDTO | null {
    if (!this._current || this._now() >= this._current.expiresAt) return null;
    const { action, expiresAt } = this._current;
    return { kind: action.kind, label: action.label, expiresAtUtc: new Date(expiresAt).toISOString() };
  }

  /** The kind of action that can still be undone, or null. */
  public currentKind(): UndoKind | null {
    return this.current()?.kind ?? null;
  }

  /**
   * Undoes the last action. False when there is none, its window has ended,
   * or it could not be put back; nothing changes then, and the action is
   * final.
   */
  public run(): boolean {
    const pending = this._current;
    if (!pending) return false;
    if (this._now() >= pending.expiresAt) {
      this.expire(pending.action);
      return false;
    }
    this._timers.clearTimeout(pending.timer);
    this._current = null;
    let undone = false;
    try {
      undone = pending.action.undo();
    } catch (err) {
      console.error(`[UndoService] Undoing "${pending.action.label}" failed:`, err);
    }
    if (!undone) {
      console.warn(`[UndoService] "${pending.action.label}" could not be undone; it stands.`);
      this.runCommit(pending.action);
    }
    this.notify();
    return undone;
  }

  /** Makes the last action final now: another starts, or the app quits. */
  public commitPending(): void {
    const pending = this._current;
    if (!pending) return;
    this._timers.clearTimeout(pending.timer);
    this._current = null;
    this.runCommit(pending.action);
    this.notify();
  }

  /** Hears every change: an offer, an undo, the window ending. */
  public onChanged(listener: (state: UndoStateDTO | null) => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  public dispose(): void {
    this.commitPending();
    this._listeners.clear();
  }

  private expire(action: UndoableAction): void {
    if (this._current?.action !== action) return;
    this.commitPending();
  }

  private runCommit(action: UndoableAction): void {
    try {
      action.commit?.();
    } catch (err) {
      console.error(`[UndoService] Committing "${action.label}" failed:`, err);
    }
  }

  private notify(): void {
    const state = this.current();
    for (const listener of this._listeners) {
      try {
        listener(state);
      } catch (err) {
        // A window that could not redraw its bar; the action is unaffected.
        console.error('[UndoService] Listener failed:', err);
      }
    }
  }
}
