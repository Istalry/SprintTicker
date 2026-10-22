import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import WebSocket, { RawData, WebSocketServer } from 'ws';
import { ArgumentNullException } from '../../shared/dtos';
import {
  DECK_MAX_MESSAGE_BYTES,
  DECK_PROTOCOL_VERSION,
  DeckRequest,
  DeckResultMessage,
  DeckServerMessage,
  DeckStateMessage,
  parseDeckRequest
} from '../../shared/deck-protocol';

/**
 * How many decks may be connected at once. One is the case; a few cover the
 * plugin restarting before its old socket has closed. More is a local
 * program opening sockets in a loop, and each would hear every state.
 */
export const DECK_MAX_CLIENTS = 4;

/** What the server needs of DeckActionService. */
export interface DeckBackend {
  getStateMessage(): DeckStateMessage;
  subscribe(listener: (message: DeckStateMessage) => void): () => void;
  perform(request: DeckRequest): DeckResultMessage;
}

/**
 * The Stream Deck plugin's WebSocket, on the app's local port.
 *
 * Reached through WebhookServer's upgrade, which has already refused a
 * handshake carrying an `Origin`: a browser opens a cross-origin WebSocket
 * without any CORS check, so that header is what stands between a web page
 * and the user's session. No token, as for Unity's webhooks -- any local
 * program can still connect, and can already do as much over HTTP.
 */
export class DeckServer {
  private readonly _backend: DeckBackend;
  private readonly _wss: WebSocketServer;
  private _unsubscribe: (() => void) | null = null;

  constructor(backend: DeckBackend) {
    if (!backend) throw new ArgumentNullException('backend');
    this._backend = backend;
    // A message past the cap closes the socket (1009) before it is buffered whole.
    this._wss = new WebSocketServer({ noServer: true, maxPayload: DECK_MAX_MESSAGE_BYTES });
  }

  /** Completes a WebSocket handshake WebhookServer has screened. */
  public handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (this._wss.clients.size >= DECK_MAX_CLIENTS) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    this._wss.handleUpgrade(req, socket, head, ws => this.accept(ws));
  }

  /** How many decks are connected, for the diagnostics bundle and the tests. */
  public getClientCount(): number {
    return this._wss.clients.size;
  }

  /**
   * Closes every deck's socket and stops listening for state. Before the HTTP
   * server stops: an upgraded socket still counts as one of its connections,
   * and its close would wait on the deck.
   */
  public close(): Promise<void> {
    this.stopHearing();
    for (const client of this._wss.clients) client.terminate();
    return new Promise(resolve => this._wss.close(() => resolve()));
  }

  private accept(ws: WebSocket): void {
    this.send(ws, { type: 'hello', protocol: DECK_PROTOCOL_VERSION });
    if (this._unsubscribe) {
      this.send(ws, this._backend.getStateMessage());
    } else {
      // Subscribing pushes the state at once, to every deck -- this one included.
      this._unsubscribe = this._backend.subscribe(message => this.broadcast(message));
    }

    ws.on('message', (data, isBinary) => this.receive(ws, data, isBinary));
    ws.on('close', () => {
      if (this._wss.clients.size === 0) this.stopHearing();
    });
    ws.on('error', err => console.warn('[Deck] Socket error:', err.message));
  }

  private receive(ws: WebSocket, data: RawData, isBinary: boolean): void {
    if (isBinary) {
      this.refuse(ws, '', 'Deck requests are JSON text.');
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(DeckServer.textOf(data));
    } catch {
      this.refuse(ws, '', 'Malformed JSON.');
      return;
    }
    let request: DeckRequest;
    try {
      request = parseDeckRequest(raw);
    } catch (err) {
      // The id is echoed when there is a usable one, so the plugin can tell
      // which key's request was refused.
      const id = typeof (raw as { id?: unknown } | null)?.id === 'string' ? (raw as { id: string }).id : '';
      this.refuse(ws, id, err instanceof Error ? err.message : String(err));
      return;
    }
    this.send(ws, this._backend.perform(request));
  }

  private refuse(ws: WebSocket, id: string, message: string): void {
    this.send(ws, { type: 'result', id, ok: false, error: 'invalid-request', message });
  }

  private broadcast(message: DeckServerMessage): void {
    for (const client of this._wss.clients) this.send(client, message);
  }

  private send(ws: WebSocket, message: DeckServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  }

  private stopHearing(): void {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  private static textOf(data: RawData): string {
    if (Array.isArray(data)) return Buffer.concat(data).toString('utf-8');
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf-8');
    return data.toString('utf-8');
  }
}
