import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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
        url: '/api/v1/unity/heartbeat',
        payload: { projectName: 'Game' },
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
        url: '/api/v1/unity/heartbeat',
        payload: { projectName: 'Game' },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      expect(response.statusCode).toBe(415);
    });

    it('Post_WithTextPlainContentType_IsRejected', async () => {
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/v1/unity/heartbeat',
        payload: { projectName: 'Game' },
        headers: { 'Content-Type': 'text/plain' }
      });

      expect(response.statusCode).toBe(415);
    });

    it('Post_WithCharsetParameterOnJson_IsAccepted', async () => {
      // A native client is entitled to send `application/json; charset=utf-8`.
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/v1/unity/heartbeat',
        payload: { projectName: 'Game' },
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });

      expect(response.statusCode).toBe(200);
    });

    it('Get_AnyUrl_IsRejectedAsMethodNotAllowed', async () => {
      const response = await webhookServer.inject({
        method: 'GET',
        url: '/api/v1/unity/heartbeat'
      });

      expect(response.statusCode).toBe(405);
    });

    it('Post_BodyOverTheCap_IsRejectedWithoutBuffering', async () => {
      // There was no cap: the body was accumulated a chunk at a time into a
      // string, so a client could make the main process allocate without limit.
      const oversized = 'x'.repeat(MAX_WEBHOOK_BODY_BYTES + 1024);
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/v1/unity/console',
        rawBody: JSON.stringify({ projectName: 'Game', message: oversized })
      });

      expect(response.statusCode).toBe(413);
    });

    it('Post_MalformedJson_Returns400', async () => {
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/v1/unity/heartbeat',
        rawBody: '{ not json'
      });

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.payload).error).toBe('INVALID_JSON');
    });
  });

  describe('routes', () => {
    it('PostApiV1UnityCompile_ValidPayload_Returns200Accepted', async () => {
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/v1/unity/compile',
        payload: { projectName: 'Game', state: 'started', unityVersion: '2022.3.10f1' }
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.payload)).toEqual({ status: 'ACCEPTED' });
    });

    it('PostApiV1UnityCompile_InvalidPayload_Returns400', async () => {
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/v1/unity/compile',
        payload: { projectName: 'Game', state: 'exploded' }
      });

      expect(response.statusCode).toBe(400);
    });

    it('PostApiV1UnityPlaymode_ValidPayload_Returns200Accepted', async () => {
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/v1/unity/playmode',
        payload: { projectName: 'Game', state: 'entered' }
      });

      expect(response.statusCode).toBe(200);
    });

    it('PostApiV1UnityPlaymode_InvalidPayload_Returns400', async () => {
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/v1/unity/playmode',
        payload: { projectName: 'Game', state: 'paused' }
      });

      expect(response.statusCode).toBe(400);
    });

    it('PostApiV1UnityHeartbeat_ValidPayload_Returns200Accepted', async () => {
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/v1/unity/heartbeat',
        payload: { projectName: 'Game' }
      });

      expect(response.statusCode).toBe(200);
    });

    it('PostApiV1UnityConsole_InvalidPayload_Returns400', async () => {
      const response = await webhookServer.inject({
        method: 'POST',
        url: '/api/v1/unity/console',
        payload: { projectName: 'Game' }
      });

      expect(response.statusCode).toBe(400);
    });

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

    it('Post_RemovedLegacyUnityRoute_Returns404', async () => {
      // The four /unity/* routes had no caller in the plugin, the docs or the
      // repository; they were reachable, unauthenticated, and unused.
      for (const url of [
        '/unity/compile-start',
        '/unity/compile-finish',
        '/unity/playmode',
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

  describe('Unity console throttling', () => {
    let throttleServer: WebhookServer;
    let received: number;

    beforeEach(async () => {
      throttleServer = new WebhookServer(0);
      await throttleServer.start();
      received = 0;
      throttleServer.onConsoleEvent(() => {
        received++;
      });
    });

    it('PostConsole_BurstOfErrors_ReachesTheHandlerOnce', async () => {
      // A script throwing inside Update posts once per frame, and every one used
      // to redraw the banner already on the display.
      for (let i = 0; i < 20; i++) {
        await throttleServer.inject({
          method: 'POST',
          url: '/api/v1/unity/console',
          payload: { projectName: 'Game', message: `NullReferenceException ${i}` }
        });
      }

      expect(received).toBe(1);
      await throttleServer.stop();
    });

    it('PostConsole_Throttled_StillReportsSuccessSoThePluginDoesNotRetry', async () => {
      await throttleServer.inject({
        method: 'POST',
        url: '/api/v1/unity/console',
        payload: { projectName: 'Game', message: 'first' }
      });
      const second = await throttleServer.inject({
        method: 'POST',
        url: '/api/v1/unity/console',
        payload: { projectName: 'Game', message: 'second' }
      });

      expect(second.statusCode).toBe(200);
      expect(JSON.parse(second.payload).status).toBe('THROTTLED');
      await throttleServer.stop();
    });

    it('PostConsole_AfterTheThrottleWindow_ReachesTheHandlerAgain', async () => {
      const now = Date.now();
      await throttleServer.inject({
        method: 'POST',
        url: '/api/v1/unity/console',
        payload: { projectName: 'Game', message: 'first' }
      });

      vi.spyOn(Date, 'now').mockReturnValue(now + 10_000);
      await throttleServer.inject({
        method: 'POST',
        url: '/api/v1/unity/console',
        payload: { projectName: 'Game', message: 'later' }
      });
      vi.restoreAllMocks();

      expect(received).toBe(2);
      await throttleServer.stop();
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
