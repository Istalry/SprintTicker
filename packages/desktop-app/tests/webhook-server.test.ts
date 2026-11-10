import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MAX_WEBHOOK_BODY_BYTES, WebhookServer } from '../src/main/api/webhook-server';

describe('WebhookServer Unit Tests', () => {
  let webhookServer: WebhookServer;

  beforeAll(async () => {
    // Arrange: Instantiate and start native HTTP server on ephemeral port for testing
    webhookServer = new WebhookServer(0);
    await webhookServer.start();
  });

  afterAll(async () => {
    await webhookServer.stop();
  });

  describe('request screening', () => {
    /**
     * Loopback is not a security boundary. Any page in any browser on this
     * machine can POST to 127.0.0.1, and this API injects hardware input, so
     * a request that looks like it came from a web page is refused.
     */
    it('Post_WithBrowserOriginHeader_IsRejected', async () => {
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/input',
        payload: { key: 'ok' },
        headers: { Origin: 'https://example.com' }
      });

      expect(response.statusCode).toBe(403);
      expect(JSON.parse(response.payload).error).toBe('FORBIDDEN_ORIGIN');
    });

    it('Post_WithFormContentType_IsRejected', async () => {
      // The content type is what actually closes the hole: a cross-origin POST
      // may skip the CORS preflight only while it stays "simple", and
      // form-encoded is one of the three types that qualify.
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/input',
        payload: { key: 'ok' },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      expect(response.statusCode).toBe(415);
    });

    it('Post_WithTextPlainContentType_IsRejected', async () => {
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/input',
        payload: { key: 'ok' },
        headers: { 'Content-Type': 'text/plain' }
      });

      expect(response.statusCode).toBe(415);
    });

    it('Post_WithCharsetParameterOnJson_IsAccepted', async () => {
      // A native client is entitled to send `application/json; charset=utf-8`.
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/input',
        payload: { key: 'ok' },
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });

      expect(response.statusCode).toBe(200);
    });

    it('Get_AnyUrl_IsRejectedAsMethodNotAllowed', async () => {
      const response = await webhookServer.inject({
        method: 'GET',
        url: '/api/input'
      });

      expect(response.statusCode).toBe(405);
    });

    it('Post_BodyOverTheCap_IsRejectedWithoutBuffering', async () => {
      // There was no cap: the body was accumulated a chunk at a time into a
      // string, so a client could make the main process allocate without limit.
      const oversized = 'x'.repeat(MAX_WEBHOOK_BODY_BYTES + 1024);
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/input',
        rawBody: JSON.stringify({ key: oversized })
      });

      expect(response.statusCode).toBe(413);
    });

    it('Post_MalformedJson_Returns400', async () => {
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/input',
        rawBody: '{ not json'
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.payload).error).toBe('INVALID_JSON');
    });
  });

  describe('routes', () => {
    it('PostInput_ValidPayload_TriggersCallbackAndReturns200Accepted', async () => {
      let capturedKey = '';
      webhookServer.onInputEvent(key => {
        capturedKey = key;
      });

      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/input?key=ok',
        payload: {}
      });

      expect(response.statusCode).toBe(200);
      expect(capturedKey).toBe('ok');
    });

    it('PostInput_NoKey_Returns400', async () => {
      const response = await webhookServer.inject({ method: 'POST', url: '/api/input', payload: {} });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.payload).error).toBe('INVALID_PAYLOAD');
    });

    it('Post_RemovedUnityRoute_Returns404', async () => {
      // The Unity Editor's routes went with its plugin (2026-11-09), and the
      // four older /unity/* ones had no caller even before. A removed route
      // must not linger reachable and unauthenticated.
      for (const url of [
        '/api/v1/unity/compile',
        '/api/v1/unity/playmode',
        '/api/v1/unity/console',
        '/api/v1/unity/heartbeat',
        '/unity/compile-start',
        '/unity/exception'
      ]) {
        const response = await webhookServer.inject({ method: 'POST', url, payload: {} });
        expect(response.statusCode, url).toBe(404);
      }
    });

    it('Post_RemovedVsCodeRoute_Returns404', async () => {
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/v1/vscode/activity',
        payload: { workspaceName: 'busy-bar' }
      });

      expect(response.statusCode).toBe(404);
    });
  });

  it('Stop_CalledTwice_DoesNotThrow', async () => {
    const server = new WebhookServer(0);
    await server.start();
    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it('Start_ErrorOnPortConflict_ThrowsError', async () => {
    const first = new WebhookServer(0);
    const address = await first.start();
    const port = Number(new URL(address).port);

    const second = new WebhookServer(port);
    await expect(second.start()).rejects.toThrow();

    await first.stop();
  });
});
