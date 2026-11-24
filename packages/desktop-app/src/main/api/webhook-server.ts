import http, { Server, IncomingMessage, IncomingHttpHeaders, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import type { Duplex } from 'stream';
import { LOCAL_API_PORT } from '../../shared/deck-protocol';

/**
 * Answers a screened POST under a prefix -- the agent's routes. Its answer
 * is sent as JSON; a throw answers 500.
 */
export type PostHandler = (path: string, body: unknown, headers: IncomingHttpHeaders) => { status: number; body: unknown };

/** Takes over a connection asking to become a WebSocket, once screened. */
export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

export interface InjectOptions {
  method: string;
  url: string;
  payload?: unknown;
  /**
   * Headers to send instead of the defaults.
   *
   * Needed to exercise the request screening: a test cannot check that a
   * browser-shaped request is refused if it has no way to send an `Origin`.
   */
  headers?: Record<string, string>;
  /** Raw body, bypassing JSON encoding, for oversized or malformed payloads. */
  rawBody?: string;
}

export interface InjectResponse {
  statusCode: number;
  payload: string;
}

/**
 * Largest accepted request body.
 *
 * Generous for the payloads this actually receives -- a remote key press -- and
 * small enough that a hostile or looping client cannot make the main process
 * buffer without limit. There was no cap at all, and the body
 * was accumulated into a string one chunk at a time.
 */
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

/**
 * Embedded HTTP server on 127.0.0.1:39123: remote key presses on
 * `/api/input`, and the Stream Deck plugin's WebSocket (see DeckServer).
 *
 * Loopback is not a security boundary. Any page in any browser on this machine
 * can POST here, and this API can drive the hardware and inject input events,
 * so requests are screened before they are routed. See {@link screenRequest}.
 */
export class WebhookServer {
  private readonly server: Server;
  private readonly port: number;
  private readonly host: string = '127.0.0.1';
  private listeningAddress: string = '';
  private inputCallbacks: Set<(key: string) => void> = new Set();
  private readonly upgradeHandlers = new Map<string, UpgradeHandler>();
  private readonly postHandlers = new Map<string, PostHandler>();

  constructor(port: number = LOCAL_API_PORT) {
    this.port = port;
    // One listener. A second server was opened unconditionally on port 8080 --
    // a far more commonly probed port -- doubling the exposed surface for an
    // address nothing in this repository or its documentation ever
    // referenced.
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
    this.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => this.handleUpgrade(req, socket, head));
  }

  /**
   * Hands WebSocket handshakes for `path` to `handler` -- the Stream Deck's.
   * One handler per path; the query string is not part of it.
   */
  public onUpgrade(path: string, handler: UpgradeHandler): void {
    if (!path.startsWith('/')) throw new Error(`An upgrade path starts with '/': ${path}`);
    this.upgradeHandlers.set(path, handler);
  }

  /**
   * Hands screened POSTs under `prefix` to `handler`: the agent's routes,
   * which add their own checks (AGENT-INTERFACE.md §5) on top of this
   * server's. One handler per prefix.
   */
  public onPost(prefix: string, handler: PostHandler): void {
    if (!prefix.startsWith('/')) throw new Error(`A route prefix starts with '/': ${prefix}`);
    this.postHandlers.set(prefix, handler);
  }

  /**
   * Screens a WebSocket handshake as {@link screenRequest} screens a POST,
   * and harder: a browser opens a cross-origin WebSocket without any CORS
   * preflight, so the content-type check that stops a page's POST does not
   * exist here, and the `Origin` header is the whole of the defence. Every
   * browser sends it on a WebSocket handshake; native clients do not.
   */
  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    // A client that resets mid-handshake would otherwise raise an unhandled
    // 'error' and take the main process down.
    socket.on('error', err => console.warn('[Webhook] Upgrade socket error:', err.message));
    if (req.headers.origin) {
      WebhookServer.refuseUpgrade(socket, 403, 'Forbidden');
      return;
    }
    const path = (req.url || '/').split('?')[0];
    const handler = this.upgradeHandlers.get(path);
    if (!handler) {
      WebhookServer.refuseUpgrade(socket, 404, 'Not Found');
      return;
    }
    handler(req, socket, head);
  }

  private static refuseUpgrade(socket: Duplex, status: number, reason: string): void {
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  }

  /// <summary>
  /// Registers a callback listener for remote input key events.
  /// </summary>
  public onInputEvent(cb: (key: string) => void): void {
    this.inputCallbacks.add(cb);
  }

  /// <summary>
  /// Asynchronously processes incoming HTTP requests and routes JSON POST webhooks.
  /// </summary>
  /**
   * Rejects requests that a legitimate local client would not make.
   *
   * Two checks, and the content type is the load-bearing one. A browser can
   * send a cross-origin POST without asking permission only while the request
   * stays "simple", which limits it to form, plain-text or multipart content
   * types. Requiring `application/json` forces a CORS preflight, and since no
   * `Access-Control-Allow-Origin` is ever sent, that preflight fails and the
   * real request is never made.
   *
   * The `Origin` check then covers the same ground from the other direction:
   * browsers set it and native clients do not, so its presence marks a request
   * as page-driven regardless of what it claims to contain. Neither check is
   * authentication -- any local program can still call this -- but together they
   * close the path from a web page you happen to be visiting to your hardware.
   *
   * @returns true if the request was rejected and the response already sent.
   */
  private screenRequest(req: IncomingMessage, res: ServerResponse): boolean {
    if (req.method !== 'POST') {
      this.sendJSON(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' });
      return true;
    }

    if (req.headers.origin) {
      this.sendJSON(res, 403, {
        error: 'FORBIDDEN_ORIGIN',
        message: 'Browser-originated requests are not accepted.'
      });
      return true;
    }

    const contentType = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      this.sendJSON(res, 415, {
        error: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Content-Type must be application/json.'
      });
      return true;
    }

    return false;
  }

  /**
   * Refuses an oversized request without dropping the answer on the floor.
   *
   * Destroying the socket outright raced the response write, so the client saw
   * ECONNRESET rather than the 413 explaining what went wrong. Instead the
   * response is written with `Connection: close` and the remaining body is read
   * and discarded -- received, but never accumulated.
   */
  private rejectOversized(req: IncomingMessage, res: ServerResponse): void {
    if (!res.headersSent) {
      res.writeHead(413, { 'Content-Type': 'application/json', Connection: 'close' });
      res.end(
        JSON.stringify({ error: 'PAYLOAD_TOO_LARGE', message: 'Request body too large.' })
      );
    }
    req.resume();
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (this.screenRequest(req, res)) return;

    // Declared length is a hint, not a guarantee, so the running total is
    // checked as well -- a chunked request need not send Content-Length at all.
    const declaredLength = Number(req.headers['content-length'] || 0);
    if (declaredLength > MAX_WEBHOOK_BODY_BYTES) {
      this.rejectOversized(req, res);
      return;
    }

    const chunks: Buffer[] = [];
    let receivedBytes = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_WEBHOOK_BODY_BYTES) {
        aborted = true;
        chunks.length = 0;
        this.rejectOversized(req, res);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;

      // Decoded once at the end. Decoding per chunk splits multi-byte UTF-8
      // characters across boundaries and corrupts them.
      const bodyText = Buffer.concat(chunks).toString('utf-8');
      let body: unknown = null;
      if (bodyText.trim().length > 0) {
        try {
          body = JSON.parse(bodyText);
        } catch {
          this.sendJSON(res, 400, { error: 'INVALID_JSON', message: 'Malformed JSON payload' });
          return;
        }
      }

      this.routeRequest(req.url || '/', body, res, req.headers);
    });

    req.on('error', () => {
      aborted = true;
    });
  }

  /// <summary>
  /// Routes parsed body content to the remote input handler, the one route.
  /// </summary>
  private routeRequest(url: string, body: unknown, res: ServerResponse, headers: IncomingHttpHeaders = {}): void {
    if (url.startsWith('/api/input') || url.startsWith('/api/v1/input')) {
      return this.handleApiInput(url, body, res);
    }
    const path = url.split('?')[0];
    for (const [prefix, handler] of this.postHandlers) {
      if (!path.startsWith(prefix)) continue;
      try {
        const answer = handler(path, body, headers);
        return this.sendJSON(res, answer.status, answer.body);
      } catch (err) {
        console.error(`[Webhook] ${prefix} failed:`, err);
        return this.sendJSON(res, 500, { error: 'INTERNAL_ERROR', message: 'The request failed in SprintTicker.' });
      }
    }
    return this.sendJSON(res, 404, { error: 'NOT_FOUND', message: 'Endpoint Not Found' });
  }

  private handleApiInput(url: string, body: unknown, res: ServerResponse): void {
    let key: string | null = null;
    const queryIndex = url.indexOf('?');
    if (queryIndex !== -1) {
      const searchParams = new URLSearchParams(url.substring(queryIndex));
      key = searchParams.get('key');
    }

    if (!key && body && typeof body === 'object') {
      const b = body as Record<string, unknown>;
      key = String(b.key || b.input || b.button || '');
    }

    if (!key) {
      return this.sendJSON(res, 400, { error: 'INVALID_PAYLOAD', message: 'Missing key parameter' });
    }

    for (const cb of this.inputCallbacks) {
      cb(key);
    }
    return this.sendJSON(res, 200, { status: 'ACCEPTED', key });
  }

  private sendJSON(res: ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  /// <summary>
  /// Starts the HTTP server on the configured loopback port.
  /// </summary>
  public async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server.once('error', (err: Error) => reject(err));
      this.server.listen(this.port, this.host, () => {
        const addr = this.server.address() as AddressInfo;
        this.listeningAddress = `http://${this.host}:${addr.port}`;
        resolve(this.listeningAddress);
      });
    });
  }

  /**
   * Whether the socket is actually open, and on which port.
   *
   * Reads `server.listening` rather than a flag this class maintains: a flag
   * set in `start()` stays true after the socket dies, which is exactly the
   * case a diagnostic bundle exists to report. The diagnostics export used to
   * hardcode `listening: true` and the port, so it asserted the server was up
   * in precisely the bundle a user attaches when it is not.
   */
  public getStatus(): { listening: boolean; port: number } {
    const addr = this.server.address();
    return {
      listening: this.server.listening,
      port: addr && typeof addr === 'object' ? addr.port : this.port
    };
  }

  /// <summary>
  /// Gracefully stops the HTTP server.
  /// </summary>
  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server.listening) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
    });
  }

  /// <summary>
  /// Injects a simulated HTTP request directly for unit testing without an external caller.
  /// </summary>
  public async inject(opts: InjectOptions): Promise<InjectResponse> {
    if (!this.listeningAddress) {
      throw new Error('Server is not running. Call start() before inject().');
    }

    const urlObj = new URL(opts.url, this.listeningAddress);
    const postData = opts.rawBody ?? (opts.payload ? JSON.stringify(opts.payload) : '');

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname + urlObj.search,
          method: opts.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            ...opts.headers
          }
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode || 500,
              payload: body
            });
          });
        }
      );

      req.on('error', (err) => reject(err));
      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }
}
