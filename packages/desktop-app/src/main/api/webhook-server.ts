import http, { Server, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';

export interface UnityCompilePayload {
  instanceId?: string;
  state: 'started' | 'finished';
  type?: 'compile' | 'build' | 'bake';
  progress?: number;
  projectName: string;
  unityVersion?: string;
  success?: boolean;
  elapsedSeconds?: number;
  errorCount?: number;
  warningCount?: number;
}

export interface UnityPlayModePayload {
  instanceId?: string;
  state: 'entered' | 'exited';
  projectName: string;
}

export interface UnityConsolePayload {
  instanceId?: string;
  type: 'warning' | 'error' | 'exception';
  message: string;
  stackTrace?: string;
  projectName: string;
}


export interface UnityHeartbeatPayload {
  instanceId?: string;
  projectName: string;
  unityVersion?: string;
  compiling?: boolean;
  playMode?: boolean;
  savePort?: number;
}

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
 * Generous for the payloads this actually receives -- the biggest is a Unity
 * stack trace -- and small enough that a hostile or looping client cannot make
 * the main process buffer without limit. There was no cap at all, and the body
 * was accumulated into a string one chunk at a time.
 */
export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

/**
 * Minimum gap between Unity console events reaching their handlers.
 *
 * The Unity plugin posts on every logged error, which during a compile failure
 * or a script throwing inside Update means one per frame. Each one used to
 * reach the display, so the bar spent the burst redrawing an error banner it
 * had already drawn.
 */
export const UNITY_CONSOLE_THROTTLE_MS = 3000;

/**
 * Embedded HTTP server on 127.0.0.1:39123, receiving webhooks from the Unity
 * Editor plugin.
 *
 * Loopback is not a security boundary. Any page in any browser on this machine
 * can POST here, and this API can drive the hardware and inject input events,
 * so requests are screened before they are routed. See {@link screenRequest}.
 */
export class WebhookServer {
  private readonly server: Server;
  private lastConsoleEventMs = 0;
  private readonly port: number;
  private readonly host: string = '127.0.0.1';
  private listeningAddress: string = '';
  private compileCallbacks: Set<(payload: UnityCompilePayload) => void> = new Set();
  private playModeCallbacks: Set<(payload: UnityPlayModePayload) => void> = new Set();
  private consoleCallbacks: Set<(payload: UnityConsolePayload) => void> = new Set();
  private heartbeatCallbacks: Set<(payload: UnityHeartbeatPayload) => void> = new Set();
  private inputCallbacks: Set<(key: string) => void> = new Set();

  constructor(port: number = 39123) {
    this.port = port;
    // One listener. A second server was opened unconditionally on port 8080 --
    // a far more commonly probed port -- doubling the exposed surface for an
    // address nothing in this repository, its documentation or the Unity plugin
    // ever referenced.
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  /// <summary>
  /// Registers a callback listener for remote input key events.
  /// </summary>
  public onInputEvent(cb: (key: string) => void): void {
    this.inputCallbacks.add(cb);
  }

  /// <summary>
  /// Registers a callback listener for Unity compilation events.
  /// </summary>
  public onCompileEvent(cb: (payload: UnityCompilePayload) => void): void {
    this.compileCallbacks.add(cb);
  }

  /// <summary>
  /// Registers a callback listener for Unity playmode state changes.
  /// </summary>
  public onPlayModeEvent(cb: (payload: UnityPlayModePayload) => void): void {
    this.playModeCallbacks.add(cb);
  }

  /// <summary>
  /// Registers a callback listener for Unity console errors and warnings.
  /// </summary>
  public onConsoleEvent(cb: (payload: UnityConsolePayload) => void): void {
    this.consoleCallbacks.add(cb);
  }

  /// <summary>
  /// Registers a callback listener for Unity plugin heartbeat pings.
  /// </summary>
  public onHeartbeatEvent(cb: (payload: UnityHeartbeatPayload) => void): void {
    this.heartbeatCallbacks.add(cb);
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

      this.routeRequest(req.url || '/', body, res);
    });

    req.on('error', () => {
      aborted = true;
    });
  }

  /// <summary>
  /// Routes parsed body content to corresponding webhook handlers.
  /// </summary>
  private routeRequest(url: string, body: unknown, res: ServerResponse): void {
    if (url.startsWith('/api/input') || url.startsWith('/api/v1/input')) {
      return this.handleApiInput(url, body, res);
    }

    switch (url) {
      case '/api/v1/unity/compile':
        return this.handleApiV1Compile(body, res);
      case '/api/v1/unity/playmode':
        return this.handleApiV1PlayMode(body, res);
      case '/api/v1/unity/console':
        return this.handleApiV1Console(body, res);
      case '/api/v1/unity/heartbeat':
        return this.handleApiV1UnityHeartbeat(body, res);
      default:
        return this.sendJSON(res, 404, { error: 'NOT_FOUND', message: 'Endpoint Not Found' });
    }
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

  private handleApiV1Compile(body: unknown, res: ServerResponse): void {
    const p = body as UnityCompilePayload;
    if (!p || typeof p.projectName !== 'string' || !['started', 'finished'].includes(p.state)) {
      return this.sendJSON(res, 400, { error: 'INVALID_PAYLOAD', message: 'Invalid compile payload' });
    }
    for (const cb of this.compileCallbacks) cb(p);
    return this.sendJSON(res, 200, { status: 'ACCEPTED' });
  }

  private handleApiV1PlayMode(body: unknown, res: ServerResponse): void {
    const p = body as UnityPlayModePayload;
    if (!p || typeof p.projectName !== 'string' || !['entered', 'exited'].includes(p.state)) {
      return this.sendJSON(res, 400, { error: 'INVALID_PAYLOAD', message: 'Invalid playmode payload' });
    }
    for (const cb of this.playModeCallbacks) cb(p);
    return this.sendJSON(res, 200, { status: 'ACCEPTED' });
  }

  private handleApiV1Console(body: unknown, res: ServerResponse): void {
    const p = body as UnityConsolePayload;
    if (!p || typeof p.projectName !== 'string' || typeof p.message !== 'string') {
      return this.sendJSON(res, 400, { error: 'INVALID_PAYLOAD', message: 'Invalid console payload' });
    }

    // Accepted either way, so the plugin does not treat a throttled event as a
    // failure and retry it. What is dropped is the redraw: a script throwing
    // inside Update posts once a frame, and every one of those reached the
    // display to draw the banner that was already on it.
    const now = Date.now();
    if (now - this.lastConsoleEventMs < UNITY_CONSOLE_THROTTLE_MS) {
      return this.sendJSON(res, 200, { status: 'THROTTLED' });
    }
    this.lastConsoleEventMs = now;

    for (const cb of this.consoleCallbacks) cb(p);
    return this.sendJSON(res, 200, { status: 'ACCEPTED' });
  }

  private handleApiV1UnityHeartbeat(body: unknown, res: ServerResponse): void {
    const p = body as UnityHeartbeatPayload;
    if (!p || typeof p.projectName !== 'string') {
      return this.sendJSON(res, 400, { error: 'INVALID_PAYLOAD', message: 'Invalid Unity heartbeat payload' });
    }
    for (const cb of this.heartbeatCallbacks) cb(p);
    return this.sendJSON(res, 200, { status: 'ACCEPTED' });
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
