import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebhookServer } from '../src/main/api/webhook-server';

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

  it('PostCompileStart_ValidPayload_Returns200Accepted', async () => {
    // Arrange
    const payload = {
      project: 'MyFantasyGame',
      unityVersion: '2022.3.10f1',
      timestampUtc: '2026-07-27T09:30:00.000Z'
    };

    // Act
    const response = await webhookServer.inject({
      method: 'POST',
      url: '/unity/compile-start',
      payload
    });

    // Assert
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ status: 'ACCEPTED' });
  });

  it('PostCompileStart_InvalidPayload_Returns400BadRequest', async () => {
    // Arrange
    const payload = { invalidField: 'test' };

    // Act
    const response = await webhookServer.inject({
      method: 'POST',
      url: '/unity/compile-start',
      payload
    });

    // Assert
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).error).toBe('INVALID_PAYLOAD');
  });

  it('PostCompileFinish_ValidPayload_Returns200Accepted', async () => {
    // Arrange
    const payload = {
      project: 'MyFantasyGame',
      success: true,
      elapsedSeconds: 14.2,
      errorCount: 0,
      warningCount: 3
    };

    // Act
    const response = await webhookServer.inject({
      method: 'POST',
      url: '/unity/compile-finish',
      payload
    });

    // Assert
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ status: 'ACCEPTED' });
  });

  it('PostCompileFinish_InvalidPayload_Returns400BadRequest', async () => {
    // Arrange
    const payload = { project: 'MyFantasyGame', success: 'not-a-boolean' };

    // Act
    const response = await webhookServer.inject({
      method: 'POST',
      url: '/unity/compile-finish',
      payload
    });

    // Assert
    expect(response.statusCode).toBe(400);
  });

  it('PostPlayMode_ValidPayload_Returns200Accepted', async () => {
    // Arrange
    const payload = {
      project: 'MyFantasyGame',
      state: 'EnteredPlayMode'
    };

    // Act
    const response = await webhookServer.inject({
      method: 'POST',
      url: '/unity/playmode',
      payload
    });

    // Assert
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ status: 'ACCEPTED' });
  });

  it('PostPlayMode_InvalidState_Returns400BadRequest', async () => {
    // Arrange
    const payload = {
      project: 'MyFantasyGame',
      state: 'UnknownState'
    };

    // Act
    const response = await webhookServer.inject({
      method: 'POST',
      url: '/unity/playmode',
      payload
    });

    // Assert
    expect(response.statusCode).toBe(400);
  });

  it('PostException_ValidPayload_Returns200Accepted', async () => {
    // Arrange
    const payload = {
      project: 'MyFantasyGame',
      exceptionType: 'NullReferenceException',
      message: 'Object reference not set to an instance of an object',
      stackTrace: 'at PlayerController.Update () in PlayerController.cs:24'
    };

    // Act
    const response = await webhookServer.inject({
      method: 'POST',
      url: '/unity/exception',
      payload
    });

    // Assert
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ status: 'ACCEPTED' });
  });

  it('PostException_InvalidPayload_Returns400BadRequest', async () => {
    // Arrange
    const payload = { message: 'Missing fields' };

    // Act
    const response = await webhookServer.inject({
      method: 'POST',
      url: '/unity/exception',
      payload
    });

    // Assert
    expect(response.statusCode).toBe(400);
  });

  it('PostApiV1UnityCompile_ValidPayload_Returns200Accepted', async () => {
    const payload = { state: 'started', projectName: 'MyFantasyGame' };

    const response = await webhookServer.inject({
      method: 'POST',
      url: '/api/v1/unity/compile',
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ status: 'ACCEPTED' });
  });

  it('PostApiV1UnityPlaymode_ValidPayload_Returns200Accepted', async () => {
    const payload = { state: 'entered', projectName: 'MyFantasyGame' };

    const response = await webhookServer.inject({
      method: 'POST',
      url: '/api/v1/unity/playmode',
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ status: 'ACCEPTED' });
  });

  it('PostApiV1VSCodeActivity_ValidPayload_Returns200Accepted', async () => {
    const payload = { workspaceName: 'BUSY_Bar', fileName: 'App.tsx', action: 'edit' };

    let callbackTriggered = false;
    webhookServer.onVSCodeEvent((p) => {
      if (p.workspaceName === 'BUSY_Bar') callbackTriggered = true;
    });

    const response = await webhookServer.inject({
      method: 'POST',
      url: '/api/v1/vscode/activity',
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(callbackTriggered).toBe(true);
  });

  it('PostApiV1UnityConsole_ValidPayload_TriggersConsoleCallbacks', async () => {
    const payload = { type: 'exception', message: 'NullRef', projectName: 'MyGame' };

    let callbackTriggered = false;
    webhookServer.onConsoleEvent((p) => {
      if (p.projectName === 'MyGame') callbackTriggered = true;
    });

    const response = await webhookServer.inject({
      method: 'POST',
      url: '/api/v1/unity/console',
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(callbackTriggered).toBe(true);
  });

  it('PostApiV1UnityConsole_InvalidPayload_Returns400', async () => {
    const payload = { type: 'error' }; // missing projectName and message

    const response = await webhookServer.inject({
      method: 'POST',
      url: '/api/v1/unity/console',
      payload
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).error).toBe('INVALID_PAYLOAD');
  });

  it('PostApiV1UnityCompile_InvalidPayload_Returns400', async () => {
    const payload = { state: 'invalid-state', projectName: 'MyGame' };

    const response = await webhookServer.inject({
      method: 'POST',
      url: '/api/v1/unity/compile',
      payload
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).error).toBe('INVALID_PAYLOAD');
  });

  it('PostApiV1UnityPlaymode_InvalidPayload_Returns400', async () => {
    const payload = { state: 'bad-state', projectName: 'MyGame' };

    const response = await webhookServer.inject({
      method: 'POST',
      url: '/api/v1/unity/playmode',
      payload
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).error).toBe('INVALID_PAYLOAD');
  });

  it('PostApiV1VSCodeActivity_InvalidPayload_Returns400', async () => {
    const payload = { fileName: 'App.tsx' }; // missing workspaceName

    const response = await webhookServer.inject({
      method: 'POST',
      url: '/api/v1/vscode/activity',
      payload
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).error).toBe('INVALID_PAYLOAD');
  });

  it('OnCompileEvent_CallbackFired_WhenLegacyCompileStartPosted', async () => {
    let callbackPayload: unknown = null;

    webhookServer.onCompileEvent((p) => {
      callbackPayload = p;
    });

    await webhookServer.inject({
      method: 'POST',
      url: '/unity/compile-start',
      payload: { project: 'MyGame', unityVersion: '2022.3.10f1', timestampUtc: new Date().toISOString() }
    });

    expect(callbackPayload).not.toBeNull();
    expect(callbackPayload.state).toBe('started');
    expect(callbackPayload.projectName).toBe('MyGame');
  });

  it('OnPlayModeEvent_ExitedPlayMode_MapsStateToExited', async () => {
    let mappedState: string | null = null;

    webhookServer.onPlayModeEvent((p) => {
      mappedState = p.state;
    });

    await webhookServer.inject({
      method: 'POST',
      url: '/unity/playmode',
      payload: { project: 'MyGame', state: 'ExitedPlayMode' }
    });

    expect(mappedState).toBe('exited');
  });

  it('Stop_CalledTwice_DoesNotThrow', async () => {
    const server = new WebhookServer(0);
    await server.start();
    await expect(server.stop()).resolves.not.toThrow();
  });

  it('PostInput_ValidPayload_TriggersCallbackAndReturns200Accepted', async () => {
    let capturedKey: string | null = null;
    webhookServer.onInputEvent((k) => {
      capturedKey = k;
    });

    const response = await webhookServer.inject({
      method: 'POST',
      url: '/api/input?key=ok'
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ status: 'ACCEPTED', key: 'ok' });
    expect(capturedKey).toBe('ok');
  });

  it('Start_ErrorOnPortConflict_ThrowsError', async () => {
    // Arrange: start first server on a fixed port then try to bind again on same port
    const server1 = new WebhookServer(0);
    const address = await server1.start();
    const port = parseInt(new URL(address).port, 10);

    const server2 = new WebhookServer(port);
    await expect(server2.start()).rejects.toThrow();

    await server1.stop();
  });
});
