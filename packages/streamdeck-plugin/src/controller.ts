import type { DeckRequest } from '../../desktop-app/src/shared/deck-protocol';
import type { DeckAnswer } from './app-link';
import { KeyContext, LinkStatus, faceFor, hasLongPress, planPress, ticksWithTheClock } from './faces';
import { KeyKind } from './key-kinds';
import { renderFace } from './svg';

/**
 * How long a question stays asked -- NOT YOURS?, DISCARD? -- before the key
 * goes back to what it was. Long enough to read and press again, short
 * enough that a press much later is not taken as an answer.
 */
export const CONFIRM_WINDOW_MS = 4000;

/**
 * How long Session must be held to open the picker rather than pause.
 * Half a second: well past a tap, and short enough that holding is not a
 * wait. The picker opens as the time is reached, without waiting for the
 * key to come up, so the window appearing is the sign it was taken.
 */
export const LONG_PRESS_MS = 500;

/** The clock's step for a running session's key. */
export const TICK_MS = 1000;

/** One key on a deck, as the SDK gives it: an id and what can be done to it. */
export interface KeyHandle {
  readonly id: string;
  setImage(svg: string): Promise<void>;
  showAlert(): Promise<void>;
}

/** What the controller needs of AppLink. */
export interface LinkLike {
  readonly status: LinkStatus;
  readonly message: KeyContext['message'];
  onChange(listener: () => void): () => void;
  request(request: Omit<DeckRequest, 'id'>): Promise<DeckAnswer | null>;
}

export interface DeckControllerOptions {
  now?: () => Date;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /** Where a failure is told; the SDK's logger in the plugin. */
  log?: (message: string) => void;
}

interface Key {
  kind: KeyKind;
  handle: KeyHandle;
  armedUntil: number | null;
  disarm: unknown;
  /** Set while a key with a long press is down and not yet held long enough. */
  hold: unknown;
  /** The image last sent, so an unchanged face is not sent again. */
  drawn: string | null;
}

/**
 * Every key the plugin has on a deck, and what they do. The actions hand it
 * their keys as they appear; it draws each from the app's state, and turns a
 * press into a request -- or into a question, for the ends that ask first.
 */
export class DeckController {
  private readonly _link: LinkLike;
  private readonly _keys = new Map<string, Key>();
  private readonly _now: () => Date;
  private readonly _setInterval: (fn: () => void, ms: number) => unknown;
  private readonly _clearInterval: (handle: unknown) => void;
  private readonly _setTimeout: (fn: () => void, ms: number) => unknown;
  private readonly _clearTimeout: (handle: unknown) => void;
  private readonly _log: (message: string) => void;
  private readonly _unsubscribe: () => void;
  private _ticker: unknown = null;
  private _lastTaskId: string | null = null;

  constructor(link: LinkLike, options: DeckControllerOptions = {}) {
    if (!link) throw new Error('A deck controller needs a link to the app.');
    this._link = link;
    this._now = options.now ?? (() => new Date());
    this._setInterval = options.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this._clearInterval = options.clearInterval ?? (handle => clearInterval(handle as NodeJS.Timeout));
    this._setTimeout = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this._clearTimeout = options.clearTimeout ?? (handle => clearTimeout(handle as NodeJS.Timeout));
    this._log = options.log ?? (message => console.warn(message));
    this._unsubscribe = link.onChange(() => this.onAppChanged());
  }

  /** A key came into view: a page, a folder or a profile was shown. */
  public appear(kind: KeyKind, handle: KeyHandle): void {
    this._keys.set(handle.id, { kind, handle, armedUntil: null, disarm: null, hold: null, drawn: null });
    this.draw(handle.id);
    this.updateTicker();
  }

  /** A key left view; it is drawn afresh when it comes back. */
  public disappear(id: string): void {
    const key = this._keys.get(id);
    if (!key) return;
    this.clearArm(key);
    this.clearHold(key);
    this._keys.delete(id);
    this.updateTicker();
  }

  /**
   * A key went down. Most keys act now; one with a long press waits to see
   * whether it is held ({@link LONG_PRESS_MS}) or let go first.
   */
  public async keyDown(id: string): Promise<void> {
    const key = this._keys.get(id);
    if (!key) return;
    if (!hasLongPress(key.kind)) {
      await this.act(key, false);
      return;
    }
    this.clearHold(key);
    key.hold = this._setTimeout(() => {
      key.hold = null;
      if (this._keys.get(id) !== key) return;
      this.act(key, true).catch(err => this._log(`[SprintTicker] A held press failed: ${String(err)}`));
    }, LONG_PRESS_MS);
  }

  /** A key came up: a short press, for a key that was waiting to know. */
  public async keyUp(id: string): Promise<void> {
    const key = this._keys.get(id);
    if (!key || key.hold === null) return;
    this.clearHold(key);
    await this.act(key, false);
  }

  public dispose(): void {
    this._unsubscribe();
    for (const key of this._keys.values()) {
      this.clearArm(key);
      this.clearHold(key);
    }
    this._keys.clear();
    this.updateTicker();
  }

  /** Does what the key's face says. */
  private async act(key: Key, held: boolean): Promise<void> {
    const id = key.handle.id;
    const plan = planPress(key.kind, this.contextOf(key), held);
    if (plan.type === 'none') {
      await key.handle.showAlert();
      return;
    }
    if (plan.type === 'arm') {
      this.arm(key);
      return;
    }
    this.clearArm(key);
    this.draw(id);
    const answer = await this._link.request({ action: plan.action, ...(plan.confirmed ? { confirmed: true } : {}) });
    if (answer?.type === 'result' && !answer.ok) {
      // The app asks where the plugin did not know to: the task left the
      // list since the last state. Asked here too, on the same key.
      if (answer.error === 'needs-confirmation' && this._keys.has(id)) {
        this.arm(key);
        return;
      }
      this._log(`[SprintTicker] ${plan.action} refused: ${answer.error} -- ${answer.message}`);
      await key.handle.showAlert();
    } else if (!answer) {
      this._log(`[SprintTicker] ${plan.action} got no answer from the app.`);
      await key.handle.showAlert();
    }
    // Done: the app pushes the state that follows, and that redraws the keys.
  }

  private onAppChanged(): void {
    // A question is about the session it was asked of: another task, or
    // none, takes it back.
    const taskId = this._link.message?.state.session?.taskId ?? null;
    if (taskId !== this._lastTaskId) {
      for (const key of this._keys.values()) this.clearArm(key);
      this._lastTaskId = taskId;
    }
    for (const id of this._keys.keys()) this.draw(id);
    this.updateTicker();
  }

  private arm(key: Key): void {
    this.clearArm(key);
    key.armedUntil = this._now().getTime() + CONFIRM_WINDOW_MS;
    key.disarm = this._setTimeout(() => {
      key.disarm = null;
      key.armedUntil = null;
      if (this._keys.get(key.handle.id) === key) this.draw(key.handle.id);
    }, CONFIRM_WINDOW_MS);
    this.draw(key.handle.id);
  }

  private clearArm(key: Key): void {
    if (key.disarm !== null) this._clearTimeout(key.disarm);
    key.disarm = null;
    key.armedUntil = null;
  }

  private clearHold(key: Key): void {
    if (key.hold !== null) this._clearTimeout(key.hold);
    key.hold = null;
  }

  private contextOf(key: Key): KeyContext {
    const now = this._now();
    return {
      link: this._link.status,
      message: this._link.message,
      now,
      armed: key.armedUntil !== null && now.getTime() < key.armedUntil
    };
  }

  private draw(id: string): void {
    const key = this._keys.get(id);
    if (!key) return;
    const svg = renderFace(faceFor(key.kind, this.contextOf(key)));
    if (svg === key.drawn) return;
    key.drawn = svg;
    key.handle.setImage(svg).catch(err => this._log(`[SprintTicker] Could not draw a key: ${String(err)}`));
  }

  /** Ticks while a session runs and a key shows its time; idles otherwise. */
  private updateTicker(): void {
    const running = this._link.message?.state.session?.status === 'tracking';
    const needed = running && [...this._keys.values()].some(key => ticksWithTheClock(key.kind));
    if (needed && this._ticker === null) {
      this._ticker = this._setInterval(() => {
        for (const [id, key] of this._keys) if (ticksWithTheClock(key.kind)) this.draw(id);
      }, TICK_MS);
    } else if (!needed && this._ticker !== null) {
      this._clearInterval(this._ticker);
      this._ticker = null;
    }
  }
}
