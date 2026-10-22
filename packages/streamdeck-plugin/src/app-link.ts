import {
  DECK_PATH,
  DECK_PROTOCOL_VERSION,
  DeckRequest,
  DeckResultMessage,
  DeckServerMessage,
  DeckStateMessage,
  DeckTasksMessage,
  LOCAL_API_PORT
} from '../../desktop-app/src/shared/deck-protocol';
import type { LinkStatus } from './faces';

/** Waits between attempts to reach the app, in order, then the last one forever. */
export const RECONNECT_DELAYS_MS: readonly number[] = [1000, 2000, 5000, 10000];

/** How long a request waits for its answer before the key says it failed. */
export const REQUEST_TIMEOUT_MS = 5000;

export type DeckAnswer = DeckResultMessage | DeckTasksMessage;

/** The part of a WebSocket this uses: Node 24's own, or a test's. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface AppLinkOptions {
  url?: string;
  /**
   * Opens a socket. Node 24's global WebSocket by default, which sends no
   * `Origin` -- measured 2026-10-22 -- so the app's refusal of browser
   * handshakes lets it through.
   */
  connect?: (url: string) => SocketLike;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

const OPEN = 1;

/**
 * The plugin's line to SprintTicker. It keeps trying while the app is
 * closed, and every key reads its status: a deck laid out before the app
 * starts shows OFFLINE rather than failing on the first press.
 */
export class AppLink {
  private readonly _url: string;
  private readonly _connect: (url: string) => SocketLike;
  private readonly _setTimeout: (fn: () => void, ms: number) => unknown;
  private readonly _clearTimeout: (handle: unknown) => void;
  private readonly _listeners = new Set<() => void>();
  private readonly _pending = new Map<string, { resolve: (answer: DeckAnswer | null) => void; timer: unknown }>();
  private _socket: SocketLike | null = null;
  private _status: LinkStatus = 'offline';
  private _message: DeckStateMessage | null = null;
  private _attempt = 0;
  private _retry: unknown = null;
  private _stopped = true;
  private _nextId = 0;

  constructor(options: AppLinkOptions = {}) {
    this._url = options.url ?? `ws://127.0.0.1:${LOCAL_API_PORT}${DECK_PATH}`;
    this._connect = options.connect ?? (url => new WebSocket(url) as unknown as SocketLike);
    this._setTimeout = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
    this._clearTimeout = options.clearTimeout ?? (handle => clearTimeout(handle as NodeJS.Timeout));
  }

  public get status(): LinkStatus {
    return this._status;
  }

  /** The last state the app pushed, or null while there is none to trust. */
  public get message(): DeckStateMessage | null {
    return this._status === 'online' ? this._message : null;
  }

  /** Hears every change of status or state. */
  public onChange(listener: () => void): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  public start(): void {
    if (!this._stopped) return;
    this._stopped = false;
    this.open();
  }

  public stop(): void {
    this._stopped = true;
    if (this._retry !== null) this._clearTimeout(this._retry);
    this._retry = null;
    const socket = this._socket;
    this._socket = null;
    socket?.close();
    this.failPending();
    this.setStatus('offline');
  }

  /**
   * Sends one request and resolves with its answer -- or null when the app
   * is not there, or did not answer in time. Never rejects: a key turns
   * either into an alert.
   */
  public request(request: Omit<DeckRequest, 'id'>): Promise<DeckAnswer | null> {
    const socket = this._socket;
    if (this._status !== 'online' || !socket || socket.readyState !== OPEN) return Promise.resolve(null);
    const id = `k${++this._nextId}`;
    return new Promise(resolve => {
      const timer = this._setTimeout(() => {
        this._pending.delete(id);
        resolve(null);
      }, REQUEST_TIMEOUT_MS);
      this._pending.set(id, { resolve, timer });
      socket.send(JSON.stringify({ ...request, id }));
    });
  }

  private open(): void {
    let socket: SocketLike;
    try {
      socket = this._connect(this._url);
    } catch {
      // A malformed URL or a runtime without WebSocket: no different, to the
      // keys, from an app that is closed.
      this.scheduleRetry();
      return;
    }
    this._socket = socket;
    socket.onmessage = ev => {
      if (this._socket === socket) this.receive(ev.data);
    };
    socket.onclose = () => {
      // A socket this link already replaced or let go of says nothing now.
      if (this._socket !== socket) return;
      this._socket = null;
      this.failPending();
      this.setStatus('offline');
      this.scheduleRetry();
    };
    // Node's WebSocket reports a refused connection as an error then a close;
    // the close does the work.
    socket.onerror = () => undefined;
  }

  private receive(data: unknown): void {
    let message: DeckServerMessage;
    try {
      message = JSON.parse(typeof data === 'string' ? data : String(data)) as DeckServerMessage;
    } catch {
      return;
    }
    switch (message.type) {
      case 'hello':
        this._attempt = 0;
        // Another protocol: stay connected, so an upgraded app is found at
        // once, but trust nothing it sends.
        this.setStatus(message.protocol === DECK_PROTOCOL_VERSION ? 'online' : 'incompatible');
        return;
      case 'state':
        this._message = message;
        if (this._status === 'online') this.notify();
        return;
      case 'result':
      case 'tasks': {
        const pending = this._pending.get(message.id);
        if (!pending) return;
        this._pending.delete(message.id);
        this._clearTimeout(pending.timer);
        pending.resolve(message);
        return;
      }
    }
  }

  private scheduleRetry(): void {
    if (this._stopped) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this._attempt, RECONNECT_DELAYS_MS.length - 1)];
    this._attempt++;
    this._retry = this._setTimeout(() => {
      this._retry = null;
      if (!this._stopped) this.open();
    }, delay);
  }

  private failPending(): void {
    for (const [id, pending] of this._pending) {
      this._clearTimeout(pending.timer);
      pending.resolve(null);
      this._pending.delete(id);
    }
  }

  private setStatus(status: LinkStatus): void {
    if (status !== 'online') this._message = null;
    if (this._status === status) return;
    this._status = status;
    this.notify();
  }

  private notify(): void {
    for (const listener of this._listeners) listener();
  }
}
