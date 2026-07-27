import fastify, { FastifyInstance } from 'fastify';
import { DTOValidator } from '../../shared/dtos';

export interface UnityCompilePayload {
  state: 'started' | 'finished';
  projectName: string;
  unityVersion?: string;
  success?: boolean;
  elapsedSeconds?: number;
  errorCount?: number;
  warningCount?: number;
}

export interface UnityPlayModePayload {
  state: 'entered' | 'exited';
  projectName: string;
}

export interface UnityConsolePayload {
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

/**
 * Embedded Fastify HTTP server listening on 127.0.0.1:39123 (and legacy 8080 fallback)
 * to receive non-blocking webhooks from Unity Editor and VS Code extensions.
 */
export class WebhookServer {
  private server: FastifyInstance;
  private port: number;
  private readonly host: string = '127.0.0.1';
  private compileCallbacks: Set<(payload: UnityCompilePayload) => void> = new Set();
  private playModeCallbacks: Set<(payload: UnityPlayModePayload) => void> = new Set();
  private consoleCallbacks: Set<(payload: UnityConsolePayload) => void> = new Set();
  private vsCodeCallbacks: Set<(payload: VSCodeActivityPayload) => void> = new Set();

  constructor(port: number = 39123) {
    this.port = port;
    this.server = fastify({ logger: false });
    this.registerRoutes();
  }

  public onCompileEvent(cb: (payload: UnityCompilePayload) => void): void {
    this.compileCallbacks.add(cb);
  }

  public onPlayModeEvent(cb: (payload: UnityPlayModePayload) => void): void {
    this.playModeCallbacks.add(cb);
  }

  public onConsoleEvent(cb: (payload: UnityConsolePayload) => void): void {
    this.consoleCallbacks.add(cb);
  }

  public onVSCodeEvent(cb: (payload: VSCodeActivityPayload) => void): void {
    this.vsCodeCallbacks.add(cb);
  }

  /**
   * Registers Unity C# plugin & VS Code extension webhook endpoints.
   */
  private registerRoutes(): void {
    // API v1 Unity Compile Route
    this.server.post('/api/v1/unity/compile', async (request, reply) => {
      const body = request.body as UnityCompilePayload;
      if (!body || typeof body.projectName !== 'string' || !['started', 'finished'].includes(body.state)) {
        return reply.status(400).send({ error: 'INVALID_PAYLOAD', message: 'Invalid compile payload' });
      }

      for (const cb of this.compileCallbacks) cb(body);
      return reply.status(200).send({ status: 'ACCEPTED' });
    });

    // API v1 Unity Play Mode Route
    this.server.post('/api/v1/unity/playmode', async (request, reply) => {
      const body = request.body as UnityPlayModePayload;
      if (!body || typeof body.projectName !== 'string' || !['entered', 'exited'].includes(body.state)) {
        return reply.status(400).send({ error: 'INVALID_PAYLOAD', message: 'Invalid playmode payload' });
      }

      for (const cb of this.playModeCallbacks) cb(body);
      return reply.status(200).send({ status: 'ACCEPTED' });
    });

    // API v1 Unity Console Warning / Exception Route
    this.server.post('/api/v1/unity/console', async (request, reply) => {
      const body = request.body as UnityConsolePayload;
      if (!body || typeof body.projectName !== 'string' || typeof body.message !== 'string') {
        return reply.status(400).send({ error: 'INVALID_PAYLOAD', message: 'Invalid console payload' });
      }

      for (const cb of this.consoleCallbacks) cb(body);
      return reply.status(200).send({ status: 'ACCEPTED' });
    });

    // API v1 VS Code Activity Route
    this.server.post('/api/v1/vscode/activity', async (request, reply) => {
      const body = request.body as VSCodeActivityPayload;
      if (!body || typeof body.workspaceName !== 'string') {
        return reply.status(400).send({ error: 'INVALID_PAYLOAD', message: 'Invalid VS Code payload' });
      }

      for (const cb of this.vsCodeCallbacks) cb(body);
      return reply.status(200).send({ status: 'ACCEPTED' });
    });

    // Legacy Compatibility Routes (/unity/*)
    this.server.post('/unity/compile-start', async (request, reply) => {
      if (!DTOValidator.isValidCompileStart(request.body)) {
        return reply.status(400).send({ error: 'INVALID_PAYLOAD', message: 'Invalid compile start payload' });
      }
      for (const cb of this.compileCallbacks) {
        cb({ state: 'started', projectName: request.body.project, unityVersion: request.body.unityVersion });
      }
      return reply.status(200).send({ status: 'ACCEPTED' });
    });

    this.server.post('/unity/compile-finish', async (request, reply) => {
      if (!DTOValidator.isValidCompileFinish(request.body)) {
        return reply.status(400).send({ error: 'INVALID_PAYLOAD', message: 'Invalid compile finish payload' });
      }
      for (const cb of this.compileCallbacks) {
        cb({
          state: 'finished',
          projectName: request.body.project,
          success: request.body.success,
          elapsedSeconds: request.body.elapsedSeconds,
          errorCount: request.body.errorCount,
          warningCount: request.body.warningCount
        });
      }
      return reply.status(200).send({ status: 'ACCEPTED' });
    });

    this.server.post('/unity/playmode', async (request, reply) => {
      if (!DTOValidator.isValidPlayMode(request.body)) {
        return reply.status(400).send({ error: 'INVALID_PAYLOAD', message: 'Invalid playmode payload' });
      }
      for (const cb of this.playModeCallbacks) {
        cb({
          state: request.body.state === 'EnteredPlayMode' ? 'entered' : 'exited',
          projectName: request.body.project
        });
      }
      return reply.status(200).send({ status: 'ACCEPTED' });
    });

    this.server.post('/unity/exception', async (request, reply) => {
      if (!DTOValidator.isValidException(request.body)) {
        return reply.status(400).send({ error: 'INVALID_PAYLOAD', message: 'Invalid exception payload' });
      }
      for (const cb of this.consoleCallbacks) {
        cb({
          type: 'exception',
          projectName: request.body.project,
          message: request.body.message,
          stackTrace: request.body.stackTrace
        });
      }
      return reply.status(200).send({ status: 'ACCEPTED' });
    });
  }

  /**
   * Starts the Fastify HTTP server.
   */
  public async start(): Promise<string> {
    try {
      const address = await this.server.listen({ port: this.port, host: this.host });
      return address;
    } catch (err) {
      this.server.log.error(err);
      throw err;
    }
  }

  /**
   * Stops the Fastify server gracefully.
   */
  public async stop(): Promise<void> {
    await this.server.close();
  }

  public getFastifyInstance(): FastifyInstance {
    return this.server;
  }
}
