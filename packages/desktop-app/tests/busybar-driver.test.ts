import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BusyBarDriver, sanitizeAsciiText, parseVarint, zigzagDecode, decodeProtobufInput } from '../src/main/hardware/busybar-driver';

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
    // All of them: connecting queries the status endpoint and then reads the
    // display brightness, so asserting on "the last URL" would be asserting on
    // whichever happened to finish last.
    const capturedUrls: string[] = [];

    globalThis.fetch = (async (url: string) => {
      capturedUrls.push(url);
      if (url.includes('/api/display/brightness')) {
        return { ok: true, json: async () => ({ value: 62, display: 'front' }) } as Response;
      }
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
      expect(capturedUrls).toContain('http://10.0.4.20/api/status');
      expect(status.connected).toBe(true);
      expect(status.batteryPercent).toBe(88);
      expect(status.firmwareVersion).toBe('2.4.0');
    } finally {
      liveDriver.disconnect();
      globalThis.fetch = originalFetch;
    }
  });

  it('BusyBarDriver_LiveMode_ReportsTheBrightnessTheDeviceActuallySent', async () => {
    // `getDeviceStatus` returned a literal 80 for the front panel and 100 for
    // the rear, and the diagnostics panel displayed both as live readings.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (url.includes('/api/display/brightness')) {
        return { ok: true, json: async () => ({ value: 62, display: 'front' }) } as Response;
      }
      return { ok: true, json: async () => ({ power: { battery_charge: 50 } }) } as Response;
    }) as typeof fetch;

    const liveDriver = new BusyBarDriver({ ipAddress: '10.0.4.20', forceMock: false });
    try {
      await liveDriver.connect();
      // The read is fired off during connect rather than awaited by it.
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(liveDriver.getDeviceStatus().frontBrightness).toBe(62);
      // Nothing in this build drives the rear panel, so there is no brightness
      // of ours to report for it.
      expect(liveDriver.getDeviceStatus().backBrightness).toBeNull();
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
    let capturedEvent: { key: string; type: string } | null = null;
    driver.on('input', (evt) => {
      capturedEvent = evt as { key: string; type: string };
    });

    const success = await driver.injectRemoteKey('ok');

    expect(success).toBe(true);
    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent?.key).toBe('ok');
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

  /**
   * The display font is ASCII-only, so text has to be reduced -- but reducing
   * is not the same as deleting. Accented letters used to fall through to the
   * final strip, which removes rather than substitutes, and French
   * notifications reached the bar with holes inside their words.
   */
  it('SanitizeAsciiText_AccentedLatin_TransliteratesRatherThanDeletingTheLetter', () => {
    expect(sanitizeAsciiText('Réunion terminée')).toBe('Reunion terminee');
    expect(sanitizeAsciiText('ça va, à demain')).toBe('ca va, a demain');
    expect(sanitizeAsciiText('Noël où être')).toBe('Noel ou etre');
  });

  it('SanitizeAsciiText_FrenchPunctuation_KeepsWordsSeparated', () => {
    // Windows puts a non-breaking space before ':' and '?' in French. Deleting
    // it ran the surrounding words together.
    expect(sanitizeAsciiText('Fini\u00A0? Oui')).toBe('Fini ? Oui');
    expect(sanitizeAsciiText('«\u00A0Sprint\u00A0»')).toBe('" Sprint "');
  });

  it('SanitizeAsciiText_LigaturesWithNoBaseLetter_ExpandInsteadOfVanishing', () => {
    // These decompose to nothing, so the diacritic pass cannot save them.
    expect(sanitizeAsciiText('cœur')).toBe('coeur');
    expect(sanitizeAsciiText('Œuvre')).toBe('OEuvre');
    expect(sanitizeAsciiText('Straße')).toBe('Strasse');
  });

  it('SanitizeAsciiText_CharactersWithNoAsciiMeaning_AreStillDropped', () => {
    // Deliberate: an emoji has no readable equivalent, so it goes rather than
    // becoming noise. Only characters that *do* have one are transliterated.
    expect(sanitizeAsciiText('done 😁 日本')).toBe('done  ');
  });

  it('LiveMode_HttpEndpoints_ExecutesFetchRequests', async () => {
    const originalFetch = globalThis.fetch;
    const callLog: string[] = [];

    globalThis.fetch = (async (url: string, opts?: RequestInit) => {
      callLog.push(`${opts?.method || 'GET'} ${url}`);
      return {
        ok: true,
        json: async () => ({ value: 50, mode: 'disabled' })
      } as Response;
    }) as typeof fetch;

    const liveDriver = new BusyBarDriver({ ipAddress: '10.0.4.20', apiToken: 'token123', forceMock: false });

    try {
      await liveDriver.connect();
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

  it('ProtobufHelpers_ParseVarintAndZigZag_DecodesCorrectValues', () => {
    const data = new Uint8Array([0x08, 0x96, 0x01]);
    const res1 = parseVarint(data, 0);
    expect(res1.value).toBe(8);

    const res2 = parseVarint(data, 1);
    expect(res2.value).toBe(150);

    expect(zigzagDecode(0)).toBe(0);
    expect(zigzagDecode(1)).toBe(-1);
    expect(zigzagDecode(2)).toBe(1);
    expect(zigzagDecode(3)).toBe(-2);
  });

  it('ProtobufHelpers_ParseFieldsAndDecodeInput_ParsesButtonAndEncoderPayloads', () => {
    // Encoded button payload: BTN_START (2) -> key 'start'
    const btnPayload = new Uint8Array([
      0x12, 0x08, // Field 2 (update) len 8
      0x5a, 0x06, // Field 11 (input_event) len 6
      0x0a, 0x04, // Subfield 1 (button) len 4
      0x08, 0x02, // field 1 (button id) = 2 (BTN_START)
      0x10, 0x01  // field 2 (action) = 1 (ACT_RELEASE)
    ]);

    const decodedBtn = decodeProtobufInput(btnPayload);
    expect(decodedBtn).not.toBeNull();
    expect(decodedBtn?.key).toBe('start');
    expect(decodedBtn?.type).toBe('press');

    // Encoded encoder payload: rotate right (delta > 0)
    const encoderPayload = new Uint8Array([
      0x5a, 0x05, // Field 11 (input_event) len 5
      0x1a, 0x03, // Subfield 3 (encoder) len 3
      0x08, 0x02  // zigzag value 2 -> delta +1
    ]);

    const decodedEncoder = decodeProtobufInput(encoderPayload);
    expect(decodedEncoder).not.toBeNull();
    expect(decodedEncoder?.key).toBe('rotate_right');

    // Encoded encoder payload: rotate left (delta < 0)
    const encoderLeftPayload = new Uint8Array([
      0x5a, 0x05,
      0x1a, 0x03,
      0x08, 0x01 // zigzag value 1 -> delta -1
    ]);

    const decodedLeft = decodeProtobufInput(encoderLeftPayload);
    expect(decodedLeft?.key).toBe('rotate_left');

    // Switch payload (SW_APPS = 3)
    const switchPayload = new Uint8Array([
      0x5a, 0x05, // Field 11
      0x12, 0x03, // Subfield 2 (switch) len 3
      0x08, 0x03  // pos = 3
    ]);

    const decodedSwitch = decodeProtobufInput(switchPayload);
    expect(decodedSwitch?.key).toBe('apps');

    // Invalid / empty payloads return null
    expect(decodeProtobufInput(new Uint8Array([]))).toBeNull();
  });

  it('BusyBarDriver_PingLoopMockMode_FiresStatusChangedEvent', async () => {
    vi.useFakeTimers();
    await driver.connect();
    let statusFired = false;
    driver.on('statusChanged', () => { statusFired = true; });

    vi.advanceTimersByTime(3500);

    expect(statusFired).toBe(true);
    vi.useRealTimers();
  });

  it('BusyBarDriver_Reconnect_RestartsStateStreamAndSendsPendingFrame', async () => {
    vi.useFakeTimers();
    const liveDriver = new BusyBarDriver({ ipAddress: '10.0.4.20', forceMock: false });
    
    let fetchOk = false;
    const originalFetch = globalThis.fetch;
    
    globalThis.fetch = (async (url: string) => {
      if (!fetchOk && url.includes('/api/status')) {
        throw new Error('Network offline');
      }
      if (url.includes('/api/status')) {
        return { ok: fetchOk, json: async () => ({ power: { battery_charge: 100 } }) } as Response;
      }
      if (url.includes('/api/assets/upload') || url.includes('/api/display/draw')) {
        return { ok: true } as Response;
      }
      return { ok: false } as Response;
    }) as typeof fetch;

    try {
      await liveDriver.connect();
      
      // Let ping loop run once while network is "offline"
      await vi.advanceTimersByTimeAsync(3500);
      expect(liveDriver.getDeviceStatus().connected).toBe(false);

      await liveDriver.sendPixelFrame(Buffer.from('test'), '#FFF', 'app', 'frame.png');
      expect((liveDriver as unknown as { pendingFrameArgs: unknown }).pendingFrameArgs).not.toBeNull();

      fetchOk = true;
      let stateStreamRestarted = false;
      liveDriver.startStateStreamListener = () => { stateStreamRestarted = true; };

      await vi.advanceTimersByTimeAsync(3500);

      expect(liveDriver.getDeviceStatus().connected).toBe(true);
      expect(stateStreamRestarted).toBe(true);
      expect((liveDriver as unknown as { pendingFrameArgs: unknown }).pendingFrameArgs).toBeNull();
    } finally {
      liveDriver.disconnect();
      globalThis.fetch = originalFetch;
      vi.useRealTimers();
    }
  });
});
