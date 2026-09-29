import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BusyBarDriver, DeviceRequestError, sanitizeAsciiText, parseVarint, zigzagDecode, decodeProtobufInput, describeTransportError, isUnreachableReminderDue, DEVICE_UNREACHABLE_REMINDER_PINGS, DEVICE_PING_INTERVAL_MS } from '../src/main/hardware/busybar-driver';
import { ArgumentException, ArgumentNullException } from '../src/shared/dtos';
import { FRONT_LAYER_Z } from '../src/shared/device-constants';

/**
 * A live (non-mock) driver, connected, whose every request past the status
 * probe is answered by `respond`.
 *
 * Exists because every mock in this suite used to default to success, so the
 * failure branches were never executed by anything -- which is how the `.anim`
 * regression survived a green run. These tests are the bad-result half.
 */
async function withLiveDriver(
  respond: (url: string, init?: RequestInit) => Promise<Response> | Response,
  body: (driver: BusyBarDriver, calls: string[]) => Promise<void>
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (url.includes('/api/status') || (url.includes('/api/display/brightness') && init?.method === 'GET')) {
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    return respond(url, init);
  }) as typeof fetch;
  const logSpies = [
    vi.spyOn(console, 'log').mockImplementation(() => undefined),
    vi.spyOn(console, 'warn').mockImplementation(() => undefined),
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  ];

  const driver = new BusyBarDriver({ ipAddress: '10.0.4.20', forceMock: false });
  // The state stream is a real WebSocket; nothing here is about it.
  driver.startStateStreamListener = () => undefined;
  try {
    await driver.connect();
    await body(driver, calls);
  } finally {
    driver.disconnect();
    globalThis.fetch = originalFetch;
    logSpies.forEach(spy => spy.mockRestore());
  }
}

const status = (code: number): Response => ({ ok: code >= 200 && code < 300, status: code, json: async () => ({}) }) as Response;

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


  it('DescribeTransportError_FetchFailureWithCause_NamesTheUnderlyingReason', () => {
    // Node's fetch says only "fetch failed"; the actionable half is in `cause`.
    const cause = Object.assign(new Error('connect ECONNREFUSED 10.0.4.20:80'), { code: 'ECONNREFUSED' });
    const err = Object.assign(new TypeError('fetch failed'), { cause });

    const described = describeTransportError(err);

    expect(described).toContain('ECONNREFUSED');
    expect(described).not.toBe('fetch failed');
  });

  it('DescribeTransportError_AbortTimeout_SaysItTimedOut', () => {
    const err = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
    expect(describeTransportError(err)).toContain('timed out');
  });

  it('Connect_DeviceUnreachable_ReportsDisconnectedRatherThanConnected', async () => {
    // The regression this test exists for: both status probes returned null and
    // `connect()` set `isConnected = true` anyway, so an unplugged bar reported
    // itself connected until the ping loop quietly flipped it back. A user who
    // exported diagnostics to ask why it would not connect got a bundle with no
    // evidence of any failure anywhere in it.
    const originalFetch = globalThis.fetch;
    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
    globalThis.fetch = (async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('connect EHOSTUNREACH 10.0.4.20:80'), { code: 'EHOSTUNREACH' })
      });
    }) as typeof fetch;

    const liveDriver = new BusyBarDriver({ ipAddress: '10.0.4.20', forceMock: false });
    try {
      const connected = await liveDriver.connect();

      expect(connected).toBe(false);
      expect(liveDriver.getDeviceStatus().connected).toBe(false);
      // And it must say why, naming the address and the transport cause.
      const complaint = warnings.find(w => w.includes('No response from'));
      expect(complaint).toBeDefined();
      expect(complaint).toContain('10.0.4.20');
      expect(complaint).toContain('EHOSTUNREACH');
    } finally {
      liveDriver.disconnect();
      globalThis.fetch = originalFetch;
      warnSpy.mockRestore();
    }
  });

  it('Connect_DeviceAnswersNonOk_StaysOptimisticButWarns', async () => {
    // Something is listening, it just does not serve these endpoints. A
    // firmware without /api/status is still a usable bar, so refusing to talk
    // to it would be a regression -- but the missing telemetry has to be said
    // out loud rather than shown as a confident 0% battery.
    const originalFetch = globalThis.fetch;
    const warnings: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    });
    globalThis.fetch = (async () => ({ ok: false, status: 404 }) as Response) as typeof fetch;

    const liveDriver = new BusyBarDriver({ ipAddress: '10.0.4.20', forceMock: false });
    try {
      const connected = await liveDriver.connect();

      expect(connected).toBe(true);
      expect(warnings.some(w => w.includes('404') && w.includes('telemetry'))).toBe(true);
    } finally {
      liveDriver.disconnect();
      globalThis.fetch = originalFetch;
      warnSpy.mockRestore();
    }
  });


  it('IsUnreachableReminderDue_NoFailuresYet_IsNotDue', () => {
    // `0 % n === 0`, so a missing guard reports a reminder due before anything
    // has actually failed.
    expect(isUnreachableReminderDue(0)).toBe(false);
  });

  it('IsUnreachableReminderDue_BelowTheInterval_StaysQuiet', () => {
    for (let failures = 1; failures < DEVICE_UNREACHABLE_REMINDER_PINGS; failures++) {
      expect(isUnreachableReminderDue(failures)).toBe(false);
    }
  });

  it('IsUnreachableReminderDue_AtEachInterval_IsDueExactlyOnce', () => {
    // The whole point is that a 3s loop cannot flood the 2000-line diagnostics
    // ring: over an hour of outage this must fire a handful of times, not 1200.
    const anHourOfPings = Math.floor((60 * 60 * 1000) / DEVICE_PING_INTERVAL_MS);
    let fired = 0;
    for (let failures = 1; failures <= anHourOfPings; failures++) {
      if (isUnreachableReminderDue(failures)) fired++;
    }

    expect(fired).toBe(Math.floor(anHourOfPings / DEVICE_UNREACHABLE_REMINDER_PINGS));
    expect(fired).toBeLessThan(10);
    expect(isUnreachableReminderDue(DEVICE_UNREACHABLE_REMINDER_PINGS)).toBe(true);
    expect(isUnreachableReminderDue(DEVICE_UNREACHABLE_REMINDER_PINGS + 1)).toBe(false);
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

  it('UploadAsset_InvalidFilenameWithSlashes_ThrowsArgumentException', async () => {
    const buffer = Buffer.from('fake_image');

    await expect(driver.uploadAsset('test_app', 'invalid/path/file!.png', buffer)).rejects.toBeInstanceOf(
      ArgumentException
    );
  });

  it('InjectRemoteKey_ValidKeyInMockMode_EmitsInputEvent', async () => {
    let capturedEvent: { key: string; type: string } | null = null;
    driver.on('input', (evt) => {
      capturedEvent = evt as { key: string; type: string };
    });

    await expect(driver.injectRemoteKey('ok')).resolves.toBeUndefined();

    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent?.key).toBe('ok');
  });

  it('MockMode_DeviceCommands_ResolveWithoutThrowing', async () => {
    await expect(driver.setAudioVolume(150, true)).resolves.toBeUndefined();
    await expect(driver.setBrightness(50)).resolves.toBeUndefined();
    await expect(driver.syncRtcTime('2026-08-03T22:00:00Z')).resolves.toBeUndefined();
    await expect(driver.sendDisplayPayload({ elements: [] })).resolves.toBe('drawn');
    await expect(driver.sendPixelFrame(Buffer.from('png'))).resolves.toBe('sent');
  });

  it('UpdateAccessSettings_NewKey_UpdatesApiToken', async () => {
    await driver.updateAccessSettings('key', '87654321');
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

describe('BusyBarDriver failure reporting', () => {
  /** Every command that answers `void`, with a call that exercises it. */
  const commands: Array<[string, (d: BusyBarDriver) => Promise<unknown>]> = [
    ['uploadAsset', d => d.uploadAsset('app1', 'file.png', Buffer.from('png'))],
    ['deleteAppAssets', d => d.deleteAppAssets('app1')],
    ['clearDisplay', d => d.clearDisplay('app1')],
    ['sendDisplayPayload', d => d.sendDisplayPayload({ elements: [] })],
    ['injectRemoteKey', d => d.injectRemoteKey('ok')],
    ['setBrightness', d => d.setBrightness(40)],
    ['setAudioVolume', d => d.setAudioVolume(40)],
    ['playAudio', d => d.playAudio('app1', 'a.snd')],
    ['stopAudio', d => d.stopAudio()],
    ['syncRtcTime', d => d.syncRtcTime()],
    ['updateAccessSettings', d => d.updateAccessSettings('enabled')]
  ];

  it.each(commands)('%s_DeviceRefuses_ThrowsRejectedWithTheStatus', async (_name, call) => {
    await withLiveDriver(() => status(400), async driver => {
      const error = await call(driver).then(
        () => null,
        (err: unknown) => err
      );

      expect(error).toBeInstanceOf(DeviceRequestError);
      expect((error as DeviceRequestError).kind).toBe('rejected');
      expect((error as DeviceRequestError).status).toBe(400);
    });
  });

  it('Command_NoAnswer_ThrowsUnreachableNamingTheTransportCause', async () => {
    await withLiveDriver(
      () => {
        throw Object.assign(new TypeError('fetch failed'), {
          cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
        });
      },
      async driver => {
        const error = (await driver.clearDisplay().catch((err: unknown) => err)) as DeviceRequestError;

        expect(error).toBeInstanceOf(DeviceRequestError);
        expect(error.kind).toBe('unreachable');
        expect(error.status).toBeNull();
        expect(error.message).toContain('ECONNREFUSED');
      }
    );
  });

  it('UploadAsset_PayloadTooLarge_ThrowsTooLarge', async () => {
    await withLiveDriver(() => status(413), async driver => {
      await expect(driver.uploadAsset('app1', 'big.anim', Buffer.alloc(8))).rejects.toMatchObject({
        kind: 'too_large',
        status: 413
      });
    });
  });

  it('SendDisplayPayload_DisplayOwnedElsewhere_ResolvesConflictRatherThanThrowing', async () => {
    // A 409 is the device working as designed, so it is an answer, not an error.
    await withLiveDriver(() => status(409), async driver => {
      await expect(driver.sendDisplayPayload({ elements: [] })).resolves.toBe('conflict');
    });
  });

  it('NonDrawCommand_409_ThrowsConflict', async () => {
    // Display ownership means nothing to a brightness change, so here a 409 is
    // just another refusal.
    await withLiveDriver(() => status(409), async driver => {
      await expect(driver.setBrightness(10)).rejects.toMatchObject({ kind: 'conflict' });
    });
  });

  it('Command_WhileDisconnected_ThrowsDisconnectedWithoutSendingAnything', async () => {
    await withLiveDriver(() => status(200), async (driver, calls) => {
      driver.disconnect();

      await expect(driver.sendDisplayPayload({ elements: [] })).rejects.toMatchObject({ kind: 'disconnected' });
      await expect(driver.uploadAsset('app1', 'f.png', Buffer.from('x'))).rejects.toMatchObject({
        kind: 'disconnected'
      });
      expect(calls).toHaveLength(0);
    });
  });

  it('InjectRemoteKey_WhileDisconnected_StillEmitsTheLocalEventAndResolves', async () => {
    await withLiveDriver(() => status(500), async (driver, calls) => {
      driver.disconnect();
      const keys: string[] = [];
      driver.on('input', (evt: { key: string }) => keys.push(evt.key));

      await expect(driver.injectRemoteKey('start')).resolves.toBeUndefined();

      expect(keys).toEqual(['start']);
      expect(calls).toHaveLength(0);
    });
  });

  it('UpdateAccessSettings_DeviceRefusesNewKey_KeepsTheOldToken', async () => {
    // Adopting a key the device never accepted would lock the driver out of a
    // bar that still has the old one.
    await withLiveDriver(() => status(400), async driver => {
      driver.setApiToken('old-token');

      await expect(driver.updateAccessSettings('key', 'new-token')).rejects.toBeInstanceOf(DeviceRequestError);

      expect(driver.getApiToken()).toBe('old-token');
    });
  });

  describe('sendPixelFrame', () => {
    const frame = Buffer.from('png');

    it('SendPixelFrame_UploadRefused_ThrowsAndCountsTheFailure', async () => {
      await withLiveDriver(
        url => (url.includes('/api/assets/upload') ? status(500) : status(200)),
        async (driver, calls) => {
          await expect(driver.sendPixelFrame(frame)).rejects.toMatchObject({ kind: 'rejected', status: 500 });

          // The draw must not be attempted for an image the device never stored.
          expect(calls.some(c => c.startsWith('POST') && c.includes('/api/display/draw'))).toBe(false);
          expect(driver.getDeviceStatus().framesFailed).toBe(1);
        }
      );
    });

    it('SendPixelFrame_DrawRefused_ThrowsAndCountsTheFailure', async () => {
      await withLiveDriver(
        url => (url.includes('/api/display/draw') ? status(400) : status(200)),
        async driver => {
          await expect(driver.sendPixelFrame(frame)).rejects.toMatchObject({ kind: 'rejected', status: 400 });
          expect(driver.getDeviceStatus().framesFailed).toBe(1);
          expect(driver.getDeviceStatus().framesSent).toBe(0);
        }
      );
    });

    it('SendPixelFrame_DrawConflict_ResolvesConflictWithoutCountingAFailure', async () => {
      await withLiveDriver(
        url => (url.includes('/api/display/draw') ? status(409) : status(200)),
        async driver => {
          await expect(driver.sendPixelFrame(frame)).resolves.toBe('conflict');
          expect(driver.getDeviceStatus().framesFailed).toBe(0);
        }
      );
    });

    it('SendPixelFrame_Success_ResolvesSent', async () => {
      await withLiveDriver(() => status(200), async driver => {
        await expect(driver.sendPixelFrame(frame)).resolves.toBe('sent');
        expect(driver.getDeviceStatus().framesSent).toBe(1);
      });
    });

    it('SendPixelFrame_WhileAnotherIsInFlight_ResolvesQueued', async () => {
      let releaseUpload: () => void = () => undefined;
      await withLiveDriver(
        url =>
          url.includes('/api/assets/upload')
            ? new Promise<Response>(resolve => {
                releaseUpload = () => resolve(status(200));
              })
            : status(200),
        async driver => {
          const first = driver.sendPixelFrame(frame);
          await expect(driver.sendPixelFrame(frame)).resolves.toBe('queued');
          releaseUpload();
          await expect(first).resolves.toBe('sent');
        }
      );
    });

    it('SendPixelFrame_ClearedDuringUpload_ResolvesSupersededAndSkipsTheDraw', async () => {
      let releaseUpload: () => void = () => undefined;
      await withLiveDriver(
        url =>
          url.includes('/api/assets/upload')
            ? new Promise<Response>(resolve => {
                releaseUpload = () => resolve(status(200));
              })
            : status(200),
        async (driver, calls) => {
          const pending = driver.sendPixelFrame(frame);
          await driver.clearDisplay();
          releaseUpload();

          await expect(pending).resolves.toBe('superseded');
          expect(calls.some(c => c.startsWith('POST') && c.includes('/api/display/draw'))).toBe(false);
        }
      );
    });

    it('SendPixelFrame_WhileDisconnected_ResolvesQueued', async () => {
      await withLiveDriver(() => status(200), async driver => {
        driver.disconnect();
        await expect(driver.sendPixelFrame(frame)).resolves.toBe('queued');
      });
    });

    it('SendPixelFrame_Draw_PutsTheFrameOnTheLayerBelowAnimatedIcons', async () => {
      const draws: Array<Record<string, unknown>> = [];
      await withLiveDriver(
        (url, init) => {
          if (url.includes('/api/display/draw') && init?.method === 'POST') draws.push(JSON.parse(String(init.body)));
          return status(200);
        },
        async driver => {
          await driver.sendPixelFrame(frame);
        }
      );

      // Without a z_index the frame composites above an animation whichever
      // arrived first, and an animated icon would never be seen.
      const element = (draws[0].elements as Array<Record<string, unknown>>)[0];
      expect(element.id).toBe('px_matrix_img');
      expect(element.z_index).toBe(FRONT_LAYER_Z.FRAME);
      expect(FRONT_LAYER_Z.ICON).toBeGreaterThan(FRONT_LAYER_Z.FRAME);
    });
  });

  describe('drawOverlay', () => {
    const icon = [{ id: 'icon_anim', type: 'animation', path: 'icon_gear_16x16.anim', x: 0, y: 0, z_index: 2 }];

    it('DrawOverlay_WhileAFrameUploads_DoesNotSupersedeTheFrame', async () => {
      let releaseUpload: () => void = () => undefined;
      await withLiveDriver(
        url =>
          url.includes('/api/assets/upload')
            ? new Promise<Response>(resolve => {
                releaseUpload = () => resolve(status(200));
              })
            : status(200),
        async driver => {
          const pending = driver.sendPixelFrame(Buffer.from('png'));
          await expect(driver.drawOverlay('sprintticker', icon)).resolves.toBe('drawn');
          releaseUpload();

          // The icon belongs to the frame under it; abandoning that frame's draw
          // would leave the icon over the previous screen's text.
          await expect(pending).resolves.toBe('sent');
        }
      );
    });

    it('DrawOverlay_Success_SendsTheElementsWithTheirZIndex', async () => {
      const bodies: Array<Record<string, unknown>> = [];
      await withLiveDriver(
        (_url, init) => {
          if (init?.method === 'POST') bodies.push(JSON.parse(String(init.body)));
          return status(200);
        },
        async driver => {
          await driver.drawOverlay('sprintticker', icon, 95);
        }
      );

      expect(bodies[0]).toMatchObject({ application_name: 'sprintticker', priority: 95 });
      expect((bodies[0].elements as Array<Record<string, unknown>>)[0]).toMatchObject({ id: 'icon_anim', z_index: 2 });
    });

    it('DrawOverlay_DisplayHeldElsewhere_ResolvesConflict', async () => {
      await withLiveDriver(() => status(409), async driver => {
        await expect(driver.drawOverlay('sprintticker', icon)).resolves.toBe('conflict');
      });
    });

    it('DrawOverlay_Refused_ThrowsRejected', async () => {
      await withLiveDriver(() => status(400), async driver => {
        await expect(driver.drawOverlay('sprintticker', icon)).rejects.toMatchObject({ kind: 'rejected', status: 400 });
      });
    });

    it('DrawOverlay_NoElements_ThrowsArgumentNullException', async () => {
      await withLiveDriver(() => status(200), async driver => {
        await expect(driver.drawOverlay('sprintticker', [])).rejects.toBeInstanceOf(ArgumentNullException);
      });
    });
  });

  describe('removeDisplayElements', () => {
    it('RemoveDisplayElements_Success_DeletesOnlyTheNamedElements', async () => {
      const requests: Array<{ method?: string; body: Record<string, unknown> }> = [];
      await withLiveDriver(
        (_url, init) => {
          requests.push({ method: init?.method, body: JSON.parse(String(init?.body)) });
          return status(200);
        },
        async driver => {
          await driver.removeDisplayElements('sprintticker', ['icon_anim']);
        }
      );

      expect(requests).toEqual([
        { method: 'DELETE', body: { application_name: 'sprintticker', element_ids: ['icon_anim'] } }
      ]);
    });

    it('RemoveDisplayElements_ElementNotThere_ThrowsRejected', async () => {
      // What firmware 1.2.4 answers for an id it does not hold.
      await withLiveDriver(() => status(400), async driver => {
        await expect(driver.removeDisplayElements('sprintticker', ['icon_anim'])).rejects.toMatchObject({
          kind: 'rejected',
          status: 400
        });
      });
    });

    it('RemoveDisplayElements_NoIds_ThrowsArgumentNullException', async () => {
      await withLiveDriver(() => status(200), async driver => {
        await expect(driver.removeDisplayElements('sprintticker', [])).rejects.toBeInstanceOf(ArgumentNullException);
      });
    });
  });
});
