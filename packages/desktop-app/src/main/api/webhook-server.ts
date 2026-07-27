import fastify, { FastifyInstance } from 'fastify';
import { DTOValidator } from '../../shared/dtos';

/**
 * Embedded Fastify HTTP server hosted by the Electron Main process.
 * Listens strictly on 127.0.0.1:8080 to accept local webhooks from Unity Editor and VS Code.
 */
export class WebhookServer {
  private server: FastifyInstance;
  private readonly port: number = 8080;
  private readonly host: string = '127.0.0.1';

  constructor(port: number = 8080) {
    this.port = port;
    this.server = fastify({ logger: false });
    this.registerRoutes();
  }

  /**
   * Registers Unity and local companion webhook routes.
   */
  private registerRoutes(): void {
    // 1. Unity Compile Start Webhook
    this.server.post('/unity/compile-start', async (request, reply) => {
      if (!DTOValidator.isValidCompileStart(request.body)) {
        return reply.status(400).send({ error: 'INVALID_PAYLOAD', message: 'Invalid compile start payload' });
      }
      // Telemetry received (will dispatch to PriorityDispatcher in Phase 5)
      return reply.status(200).send({ status: 'ACCEPTED' });
    });

    // 2. Unity Compile Finish Webhook
    this.server.post('/unity/compile-finish', async (request, reply) => {
      if (!DTOValidator.isValidCompileFinish(request.body)) {
        return reply.status(400).send({ error: 'INVALID_PAYLOAD', message: 'Invalid compile finish payload' });
      }
      return reply.status(200).send({ status: 'ACCEPTED' });
    });

    // 3. Unity Play Mode State Webhook
    this.server.post('/unity/playmode', async (request, reply) => {
      if (!DTOValidator.isValidPlayMode(request.body)) {
        return reply.status(400).send({ error: 'INVALID_PAYLOAD', message: 'Invalid playmode payload' });
      }
      return reply.status(200).send({ status: 'ACCEPTED' });
    });

    // 4. Unity Critical Console Exception Webhook
    this.server.post('/unity/exception', async (request, reply) => {
      if (!DTOValidator.isValidException(request.body)) {
        return reply.status(400).send({ error: 'INVALID_PAYLOAD', message: 'Invalid exception payload' });
      }
      return reply.status(200).send({ status: 'ACCEPTED' });
    });
  }

  /**
   * Starts the Fastify server on 127.0.0.1:8080.
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

  /**
   * Exposes internal Fastify instance for testing.
   */
  public getFastifyInstance(): FastifyInstance {
    return this.server;
  }
}
