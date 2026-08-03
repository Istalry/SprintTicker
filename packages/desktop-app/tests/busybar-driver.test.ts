import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BusyBarDriver, sanitizeAsciiText } from '../src/main/hardware/busybar-driver';

describe('BusyBarDriver Unit Tests', () => {
  let driver: BusyBarDriver;

  beforeEach(async () => {
    driver = new BusyBarDriver('10.0.4.20', true); // Mock Mode
    await driver.connect();
  });

  afterEach(() => {
    driver.disconnect();
  });

  it('Connect_MockMode_ReturnsConnectedDeviceStatus', () => {
    const status = driver.getDeviceStatus();

    expect(status.connected).toBe(true);
    expect(status.ipAddress).toBe('10.0.4.20');
    expect(status.batteryPercent).toBe(98);
    expect(status.firmwareVersion).toBe('1.4.2-mock');
    expect(driver.getIsMockMode()).toBe(true);
  });

  it('BusyBarDriver_WifiOptionsAndApiToken_ConfiguresHeadersAndWifiConnectionType', () => {
    const wifiDriver = new BusyBarDriver({
      ipAddress: '192.168.1.100',
      apiToken: 'my_secret_token',
      forceMock: true
    });

    expect(wifiDriver.getApiToken()).toBe('my_secret_token');
    const status = wifiDriver.getDeviceStatus();
    expect(status.connectionType).toBe('wifi');
    expect(status.ipAddress).toBe('192.168.1.100');

    wifiDriver.setApiToken('new_token');
    expect(wifiDriver.getApiToken()).toBe('new_token');
  });

  it('BusyBarDriver_LiveMode_QueriesStatusEndpointAndParsesTelemetry', async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';

    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      if (url.includes('/api/status')) {
        return {
          ok: true,
          json: async () => ({
            power: { battery_charge: 88 },
            firmware: { version: '2.4.0' }
          })
        } as Response;
      }
      return { ok: false } as Response;
    }) as typeof fetch;

    const liveDriver = new BusyBarDriver({
      ipAddress: '10.0.4.20',
      forceMock: false
    });

    try {
      const connected = await liveDriver.connect();
      const status = liveDriver.getDeviceStatus();

      expect(connected).toBe(true);
      expect(capturedUrl).toBe('http://10.0.4.20/api/status');
      expect(status.connected).toBe(true);
      expect(status.batteryPercent).toBe(88);
      expect(status.firmwareVersion).toBe('2.4.0');
    } finally {
      liveDriver.disconnect();
      globalThis.fetch = originalFetch;
    }
  });

  it('BusyBarDriver_Disconnect_ResetsStatusToOffline', () => {
    const liveDriver = new BusyBarDriver('10.0.4.20', false);
    liveDriver.disconnect();
    const status = liveDriver.getDeviceStatus();
    expect(status.connected).toBe(false);
    expect(status.batteryPercent).toBe(0);
    expect(status.firmwareVersion).toBe('N/A');
    expect(status.webSocketPingMs).toBe(0);
  });

  it('FormatHardwarePayload_SolidRectangle_EnforcesSingleColorInFillColors', () => {
    const rawPayload = {
      application_name: 'test_app',
      elements: [
        {
          id: 'rect_1',
          type: 'rectangle',
          fill: 'solid',
          fill_colors: ['#FF0000FF', '#00FF00FF'] // Invalid 2 colors for solid
        }
      ]
    };

    const formatted = driver.formatHardwarePayload(rawPayload);
    const elements = formatted.elements as Array<Record<string, unknown>>;

    expect(elements[0].fill_colors).toEqual(['#FF0000FF']);
  });

  it('FormatHardwarePayload_GradientRectangle_EnforcesTwoColorsInFillColors', () => {
    const rawPayload = {
      application_name: 'test_app',
      elements: [
        {
          id: 'rect_grad',
          type: 'rectangle',
          fill: 'gradient_h',
          fill_colors: ['#FF0000FF'] // Single color provided
        }
      ]
    };

    const formatted = driver.formatHardwarePayload(rawPayload);
    const elements = formatted.elements as Array<Record<string, unknown>>;

    expect(elements[0].fill_colors).toEqual(['#FF0000FF', '#FF0000FF']);
  });

  it('FormatHardwarePayload_TextElement_SanitizesNonAsciiCharacters', () => {
    const rawPayload = {
      application_name: 'test_app',
      elements: [
        {
          id: 'text_1',
          type: 'text',
          text: '“Hello World”—🚀' // Smart quotes, em-dash, emoji
        }
      ]
    };

    const formatted = driver.formatHardwarePayload(rawPayload);
    const elements = formatted.elements as Array<Record<string, unknown>>;

    expect(elements[0].text).toBe('"Hello World"--');
  });

  it('FormatHardwarePayload_ImageElement_RemovesWidthHeightAndNormalizesPath', () => {
    const rawPayload = {
      application_name: 'test_app',
      elements: [
        {
          id: 'img_1',
          type: 'image',
          path: '/assets/subfolder/icon.png',
          width: 15,
          height: 15
        }
      ]
    };

    const formatted = driver.formatHardwarePayload(rawPayload);
    const elements = formatted.elements as Array<Record<string, unknown>>;

    expect(elements[0].path).toBe('icon.png');
    expect(elements[0].width).toBeUndefined();
    expect(elements[0].height).toBeUndefined();
  });

  it('UploadAsset_InvalidFilenameWithSlashes_RejectsUpload', async () => {
    const buffer = Buffer.from('fake_image');
    const result = await driver.uploadAsset('test_app', 'invalid/path/file!.png', buffer);

    expect(result).toBe(false);
  });

  it('InjectRemoteKey_ValidKeyInMockMode_EmitsInputEvent', async () => {
    let capturedEvent: any = null;
    driver.on('input', (evt) => {
      capturedEvent = evt;
    });

    const success = await driver.injectRemoteKey('ok');

    expect(success).toBe(true);
    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent.key).toBe('ok');
  });

  it('SetAudioVolume_DefaultSilentFlag_ClampsVolumeAndPassesSilentOne', async () => {
    const success = await driver.setAudioVolume(150, true);
    expect(success).toBe(true);
  });

  it('SetBrightness_ValidValue_ReturnsTrueInMockMode', async () => {
    const success = await driver.setBrightness(50);
    expect(success).toBe(true);
  });

  it('SyncRtcTime_IsoTimestamp_SyncsClockInMockMode', async () => {
    const success = await driver.syncRtcTime('2026-08-03T22:00:00Z');
    expect(success).toBe(true);
  });

  it('UpdateAccessSettings_NewKey_UpdatesApiToken', async () => {
    const success = await driver.updateAccessSettings('key', '87654321');
    expect(success).toBe(true);
    expect(driver.getApiToken()).toBe('87654321');
  });

  it('SanitizeAsciiText_Helper_ConvertsKnownUnicodeToAscii', () => {
    const input = '“Smart Quotes” & ‘Single’ — Dash… Emoji 😁';
    const clean = sanitizeAsciiText(input);

    expect(clean).toBe('"Smart Quotes" & \'Single\' -- Dash... Emoji ');
  });

  it('LiveMode_HttpEndpoints_ExecutesFetchRequests', async () => {
    const originalFetch = globalThis.fetch;
    const callLog: string[] = [];

    globalThis.fetch = (async (url: string, opts?: any) => {
      callLog.push(`${opts?.method || 'GET'} ${url}`);
      return {
        ok: true,
        json: async () => ({ value: 50, mode: 'disabled' })
      } as Response;
    }) as typeof fetch;

    const liveDriver = new BusyBarDriver({ ipAddress: '10.0.4.20', apiToken: 'token123', forceMock: false });

    try {
      await liveDriver.sendDisplayPayload({ elements: [{ id: '1', type: 'text', text: 'hi' }] });
      await liveDriver.uploadAsset('app1', 'test.png', Buffer.from('png'));
      await liveDriver.deleteAppAssets('app1');
      await liveDriver.clearDisplay('app1');
      await liveDriver.sendPixelFrame(Buffer.from('png'), '#FF0000FF', 'app1', 'frame.png');
      await liveDriver.injectRemoteKey('start');
      await liveDriver.setBrightness(80);
      await liveDriver.getBrightness();
      await liveDriver.setAudioVolume(60, true);
      await liveDriver.playAudio('app1', 'alert.snd');
      await liveDriver.stopAudio();
      await liveDriver.syncRtcTime();
      await liveDriver.getAccessSettings();
      await liveDriver.updateAccessSettings('enabled');
    } finally {
      liveDriver.disconnect();
      globalThis.fetch = originalFetch;
    }

    expect(callLog.length).toBeGreaterThan(10);
    expect(callLog.some(c => c.includes('/api/display/draw'))).toBe(true);
    expect(callLog.some(c => c.includes('/api/assets/upload'))).toBe(true);
    expect(callLog.some(c => c.includes('/api/audio/volume'))).toBe(true);
  });
});
