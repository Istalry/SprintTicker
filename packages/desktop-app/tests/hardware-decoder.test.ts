import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { InputDecoder } from '../src/main/hardware/input-decoder';

describe('Hardware Bridge & InputDecoder Unit Tests', () => {
  let dbConn: DatabaseConnection;
  let driver: BusyBarDriver;
  let engine: TimeTrackingEngine;
  let decoder: InputDecoder;
  let renderer: DisplayRenderer;

  beforeEach(async () => {
    dbConn = new DatabaseConnection(':memory:');
    const sessionRepo = new SessionRepository(dbConn);
    const worklogRepo = new WorklogRepository(dbConn);
    const taskRepo = new TaskRepository(dbConn);
    const settingsRepo = new SettingsRepository(dbConn);

    engine = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo);
    driver = new BusyBarDriver('10.0.4.20', true); // Mock Mode
    await driver.connect();

    renderer = new DisplayRenderer(driver);
    decoder = new InputDecoder(driver, engine, settingsRepo);
  });

  afterEach(() => {
    driver.disconnect();
    dbConn.close();
  });

  it('Connect_MockMode_ReturnsConnectedDeviceStatus', () => {
    // Act
    const status = driver.getDeviceStatus();

    // Assert
    expect(status.connected).toBe(true);
    expect(status.ipAddress).toBe('10.0.4.20');
    expect(driver.getIsMockMode()).toBe(true);
  });

  it('RenderActiveSession_ValidSession_Generates72x16FrontAndOledRearPayload', () => {
    // Arrange
    const session = engine.startTask('PROJ-142', false, 'Implement Dash Mechanics');

    // Act
    const payload = renderer.renderActiveSession(session);

    // Assert
    expect(payload.frontElements).toHaveLength(2);
    expect(payload.frontElements[0].text).toContain('PROJ-142');
    expect(payload.backElements[0].text).toContain('BUSY BAR DIAGNOSTICS');
    expect(payload.ledColorHex).toBe('#10B981FF'); // Green LED for TRACKING
  });

  it('HandleHardwareInput_StartButtonPress_TogglesTrackingToPaused', () => {
    // Arrange
    engine.startTask('PROJ-142', false, 'Implement Dash Mechanics');
    expect(engine.getCurrentSession()?.status).toBe('TRACKING');

    // Act: Simulate physical "start" button press
    const action = decoder.handleHardwareInput({ key: 'start', type: 'press', timestamp: new Date().toISOString() });

    // Assert
    expect(action).toBe('TOGGLE_TRACK_PAUSE');
    expect(engine.getCurrentSession()?.status).toBe('PAUSED');
  });

  it('HandleHardwareInput_BackButtonLongPress_CompletesAndLogsActiveTask', () => {
    // Arrange
    engine.startTask('PROJ-142', false, 'Implement Dash Mechanics');
    expect(engine.getCurrentSession()).not.toBeNull();

    // Act: Simulate physical long press on Back button
    const action = decoder.handleHardwareInput({ key: 'back_hold', type: 'long_press', timestamp: new Date().toISOString() });

    // Assert
    expect(action).toBe('COMPLETE_AND_LOG_ACTIVE_TASK');
    expect(engine.getCurrentSession()).toBeNull();
  });

  it('RenderPlayMode_ValidProject_RendersOnAirPayload', () => {
    // Act
    const payload = renderer.renderPlayMode('MyFantasyGame');

    // Assert
    expect(payload.frontElements[0].text).toBe('ON AIR');
    expect(payload.frontElements[1].text).toBe('MyFantasyGame');
    expect(payload.ledColorHex).toBe('#FF0000FF');
  });

  it('RenderCompilation_ValidProject_RendersProgressBarPayload', () => {
    // Act
    const payload = renderer.renderCompilation('MyFantasyGame', 75);

    // Assert
    expect(payload.frontElements[0].text).toBe('MyFantasyGame: Compiling...');
    expect(payload.frontElements[1].width).toBe(54); // 75% of 72
    expect(payload.ledColorHex).toBe('#3B82F6FF');
  });

  it('HandleHardwareInput_WheelRotationsAndClick_ExecutesMappedActions', () => {
    // Act
    const upAction = decoder.handleHardwareInput({ key: 'up', type: 'press', timestamp: new Date().toISOString() });
    const downAction = decoder.handleHardwareInput({ key: 'down', type: 'press', timestamp: new Date().toISOString() });
    const backShort = decoder.handleHardwareInput({ key: 'back', type: 'press', timestamp: new Date().toISOString() });

    // Assert
    expect(upAction).toBe('NAVIGATE_QUEUE_PREV');
    expect(downAction).toBe('NAVIGATE_QUEUE_NEXT');
    expect(backShort).toBe('DISMISS_NOTIFICATION_ALERT');
  });

  it('InputDecoder_CustomBindings_SavesAndRetrievesBindings', () => {
    // Arrange
    const customConfig = {
      startButtonPress: 'CUSTOM_START',
      wheelRotateLeft: 'CUSTOM_LEFT',
      wheelRotateRight: 'CUSTOM_RIGHT',
      wheelClick: 'CUSTOM_CLICK',
      backButtonShortPress: 'CUSTOM_BACK',
      backButtonLongPress: 'CUSTOM_LONG_BACK'
    };

    // Act
    decoder.saveBindings(customConfig);
    const bindings = decoder.getBindings();

    // Assert
    expect(bindings.startButtonPress).toBe('CUSTOM_START');
  });

  it('BusyBarDriver_WifiOptionsAndApiToken_ConfiguresHeadersAndWifiConnectionType', () => {
    // Arrange & Act
    const wifiDriver = new BusyBarDriver({
      ipAddress: '192.168.1.100',
      apiToken: 'my_secret_token',
      forceMock: true
    });

    // Assert
    expect(wifiDriver.getApiToken()).toBe('my_secret_token');
    const status = wifiDriver.getDeviceStatus();
    expect(status.connectionType).toBe('wifi');
    expect(status.ipAddress).toBe('192.168.1.100');

    // Update Token
    wifiDriver.setApiToken('new_token');
    expect(wifiDriver.getApiToken()).toBe('new_token');
  });

  it('BusyBarDriver_LiveMode_SendsPayloadWithApiTokenHeader', async () => {
    // Arrange
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      return { ok: true, json: async () => ({ status: 'connected' }) } as Response;
    }) as typeof fetch;

    const liveDriver = new BusyBarDriver({
      ipAddress: '192.168.1.105',
      apiToken: 'secret_x_api_token',
      forceMock: false
    });

    try {
      // Act
      const connected = await liveDriver.connect();
      const payloadSuccess = await liveDriver.sendDisplayPayload({ test: 'data' });

      // Assert
      expect(connected).toBe(true);
      expect(payloadSuccess).toBe(true);
      expect(capturedUrl).toBe('http://192.168.1.105/busybar/display/draw');
      expect(capturedHeaders['X-API-Token']).toBe('secret_x_api_token');
    } finally {
      liveDriver.disconnect();
      globalThis.fetch = originalFetch;
    }
  });
});
