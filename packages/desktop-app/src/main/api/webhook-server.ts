import http, { Server, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { DTOValidator } from '../../shared/dtos';

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

export interface VSCodeActivityPayload {
  workspaceName: string;
  fileName?: string;
  action?: string;
}

export interface UnityHeartbeatPayload {
  instanceId?: string;
  projectName: string;
  unityVersion?: string;
  compiling?: boolean;
  playMode?: boolean;
  savePort?: number;
}

export interface SlackEventPayload {
  sender?: string;
  message?: string;
  channel?: string;
  isUrgent?: boolean;
}

export interface DiscordWebhookPayload {
  author?: string;
  content?: string;
  mentionUrgent?: boolean;
}

export interface InjectOptions {
  method: string;
  url: string;
  payload?: unknown;
}

export interface InjectResponse {
  statusCode: number;
  payload: string;
}

/**
 * Embedded HTTP server built on Node.js native `http` module listening on 127.0.0.1:39123
 * (and fallback port) to receive webhooks from Unity Editor and VS Code extensions.
 */
export class WebhookServer {
  private readonly server: Server;
  private readonly port: number;
  private readonly host: string = '127.0.0.1';
  private listeningAddress: string = '';
  private compileCallbacks: Set<(payload: UnityCompilePayload) => void> = new Set();
  private playModeCallbacks: Set<(payload: UnityPlayModePayload) => void> = new Set();
  private consoleCallbacks: Set<(payload: UnityConsolePayload) => void> = new Set();
  private vsCodeCallbacks: Set<(payload: VSCodeActivityPayload) => void> = new Set();
  private heartbeatCallbacks: Set<(payload: UnityHeartbeatPayload) => void> = new Set();
  private slackCallbacks: Set<(payload: SlackEventPayload) => void> = new Set();
  private discordCallbacks: Set<(payload: DiscordWebhookPayload) => void> = new Set();

  constructor(port: number = 39123) {
    this.port = port;
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
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
  /// Registers a callback listener for VS Code editor activity events.
  /// </summary>
  public onVSCodeEvent(cb: (payload: VSCodeActivityPayload) => void): void {
    this.vsCodeCallbacks.add(cb);
  }

  /// <summary>
  /// Registers a callback listener for Unity plugin heartbeat pings.
  /// </summary>
  public onHeartbeatEvent(cb: (payload: UnityHeartbeatPayload) => void): void {
    this.heartbeatCallbacks.add(cb);
  }

  /// <summary>
  /// Registers a callback listener for Slack event notifications.
  /// </summary>
  public onSlackEvent(cb: (payload: SlackEventPayload) => void): void {
    this.slackCallbacks.add(cb);
  }

  /// <summary>
  /// Registers a callback listener for Discord webhook notifications.
  /// </summary>
  public onDiscordWebhookEvent(cb: (payload: DiscordWebhookPayload) => void): void {
    this.discordCallbacks.add(cb);
  }

  /// <summary>
  /// Asynchronously processes incoming HTTP requests and routes JSON POST webhooks.
  /// </summary>
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST') {
      this.sendJSON(res, 405, { error: 'METHOD_NOT_ALLOWED', message: 'Method Not Allowed' });
      return;
    }

    let bodyText = '';
    req.on('data', (chunk: Buffer) => {
      bodyText += chunk.toString('utf-8');
    });

    req.on('end', () => {
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
  }

  /// <summary>
  /// Routes parsed body content to corresponding webhook handlers.
  /// </summary>
  private routeRequest(url: string, body: unknown, res: ServerResponse): void {
    switch (url) {
      case '/api/v1/unity/compile':
        return this.handleApiV1Compile(body, res);
      case '/api/v1/unity/playmode':
        return this.handleApiV1PlayMode(body, res);
      case '/api/v1/unity/console':
        return this.handleApiV1Console(body, res);
      case '/api/v1/unity/heartbeat':
        return this.handleApiV1UnityHeartbeat(body, res);
      case '/api/v1/slack/events':
        return this.handleApiV1SlackEvents(body, res);
      case '/api/v1/discord/webhook':
        return this.handleApiV1DiscordWebhook(body, res);
      case '/api/v1/vscode/activity':
        return this.handleApiV1VSCodeActivity(body, res);
      case '/unity/compile-start':
        return this.handleLegacyCompileStart(body, res);
      case '/unity/compile-finish':
        return this.handleLegacyCompileFinish(body, res);
      case '/unity/playmode':
        return this.handleLegacyPlayMode(body, res);
      case '/unity/exception':
        return this.handleLegacyException(body, res);
      default:
        return this.sendJSON(res, 404, { error: 'NOT_FOUND', message: 'Endpoint Not Found' });
    }
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
    for (const cb of this.consoleCallbacks) cb(p);
    return this.sendJSON(res, 200, { status: 'ACCEPTED' });
  }

  private handleApiV1VSCodeActivity(body: unknown, res: ServerResponse): void {
    const p = body as VSCodeActivityPayload;
    if (!p || typeof p.workspaceName !== 'string') {
      return this.sendJSON(res, 400, { error: 'INVALID_PAYLOAD', message: 'Invalid VS Code payload' });
    }
    for (const cb of this.vsCodeCallbacks) cb(p);
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

  private handleApiV1SlackEvents(body: unknown, res: ServerResponse): void {
    const p = body as SlackEventPayload;
    if (!p || typeof p !== 'object') {
      return this.sendJSON(res, 400, { error: 'INVALID_PAYLOAD', message: 'Invalid Slack payload' });
    }
    for (const cb of this.slackCallbacks) cb(p);
    return this.sendJSON(res, 200, { status: 'ACCEPTED' });
  }

  private handleApiV1DiscordWebhook(body: unknown, res: ServerResponse): void {
    const p = body as DiscordWebhookPayload;
    if (!p || typeof p !== 'object') {
      return this.sendJSON(res, 400, { error: 'INVALID_PAYLOAD', message: 'Invalid Discord payload' });
    }
    for (const cb of this.discordCallbacks) cb(p);
    return this.sendJSON(res, 200, { status: 'ACCEPTED' });
  }

  private handleLegacyCompileStart(body: unknown, res: ServerResponse): void {
    if (!DTOValidator.isValidCompileStart(body)) {
      return this.sendJSON(res, 400, { error: 'INVALID_PAYLOAD', message: 'Invalid compile start payload' });
    }
    const b = body as Record<string, unknown>;
    for (const cb of this.compileCallbacks) {
      cb({ state: 'started', projectName: b.project as string, unityVersion: b.unityVersion as string });
    }
    return this.sendJSON(res, 200, { status: 'ACCEPTED' });
  }

  private handleLegacyCompileFinish(body: unknown, res: ServerResponse): void {
    if (!DTOValidator.isValidCompileFinish(body)) {
      return this.sendJSON(res, 400, { error: 'INVALID_PAYLOAD', message: 'Invalid compile finish payload' });
    }
    const b = body as Record<string, unknown>;
    for (const cb of this.compileCallbacks) {
      cb({
        state: 'finished',
        projectName: b.project as string,
        success: b.success as boolean,
        elapsedSeconds: b.elapsedSeconds as number,
        errorCount: b.errorCount as number,
        warningCount: b.warningCount as number
      });
    }
    return this.sendJSON(res, 200, { status: 'ACCEPTED' });
  }

  private handleLegacyPlayMode(body: unknown, res: ServerResponse): void {
    if (!DTOValidator.isValidPlayMode(body)) {
      return this.sendJSON(res, 400, { error: 'INVALID_PAYLOAD', message: 'Invalid playmode payload' });
    }
    const b = body as Record<string, unknown>;
    for (const cb of this.playModeCallbacks) {
      cb({
        state: b.state === 'EnteredPlayMode' ? 'entered' : 'exited',
        projectName: b.project as string
      });
    }
    return this.sendJSON(res, 200, { status: 'ACCEPTED' });
  }

  private handleLegacyException(body: unknown, res: ServerResponse): void {
    if (!DTOValidator.isValidException(body)) {
      return this.sendJSON(res, 400, { error: 'INVALID_PAYLOAD', message: 'Invalid exception payload' });
    }
    const b = body as Record<string, unknown>;
    for (const cb of this.consoleCallbacks) {
      cb({
        type: 'exception',
        projectName: b.project as string,
        message: b.message as string,
        stackTrace: b.stackTrace as string
      });
    }
    return this.sendJSON(res, 200, { status: 'ACCEPTED' });
  }

  private sendJSON(res: ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  /// <summary>
  /// Starts the HTTP server on the configured port.
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
    const postData = opts.payload ? JSON.stringify(opts.payload) : '';

    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: urlObj.hostname,
          port: urlObj.port,
          path: urlObj.pathname,
          method: opts.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
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
