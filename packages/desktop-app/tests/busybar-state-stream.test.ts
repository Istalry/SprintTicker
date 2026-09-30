import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Stands in for the `ws` package. Like the real one, `close()` does not fire
 * `onclose` -- the test fires it, when it chooses, which is exactly the gap
 * the driver's `wsGeneration` guard exists for.
 */
const sockets = vi.hoisted(() => {
  class FakeWebSocket {
    static instances: FakeWebSocket[] = [];
    static failNext: Error | null = null;
    readonly url: string;
    binaryType = '';
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((err: unknown) => void) | null = null;
    onclose: (() => void) | null = null;
    readonly send = vi.fn();
    readonly close = vi.fn();
    constructor(url: string) {
      if (FakeWebSocket.failNext) {
        const err = FakeWebSocket.failNext;
        FakeWebSocket.failNext = null;
        throw err;
      }
      this.url = url;
      FakeWebSocket.instances.push(this);
    }
  }
  return { FakeWebSocket };
});

vi.mock('ws', () => ({ default: sockets.FakeWebSocket }));

import { BusyBarDriver, DEVICE_PING_INTERVAL_MS, DEVICE_UNREACHABLE_REMINDER_PINGS } from '../src/main/hardware/busybar-driver';

type Answer = { ok: boolean; status: number; body?: unknown } | Error;

describe('BusyBarDriver state stream and ping loop', () => {
  const { FakeWebSocket } = sockets;
  let statusAnswer: Answer;
  let logs: { log: ReturnType<typeof vi.spyOn>; warn: ReturnType<typeof vi.spyOn> };
  let driver: BusyBarDriver;
  let inputs: Array<{ key: string; type: string }>;

  const socket = (i = -1) => FakeWebSocket.instances.at(i)!;
  const said = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map(c => String(c[0])).join('\n');
  const ping = () => vi.advanceTimersByTimeAsync(DEVICE_PING_INTERVAL_MS);

  const connected = async (options: { apiToken?: string } = {}) => {
    driver = new BusyBarDriver({ ipAddress: '10.0.4.20', forceMock: false, ...options });
    driver.on('input', e => inputs.push({ key: e.key, type: e.type }));
    await driver.connect();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances.length = 0;
    FakeWebSocket.failNext = null;
    inputs = [];
    statusAnswer = { ok: true, status: 200, body: { firmware: { version: '1.2.4' } } };
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const answer: Answer = url.includes('/api/status') ? statusAnswer : { ok: true, status: 200, body: {} };
      if (answer instanceof Error) throw answer;
      return { ok: answer.ok, status: answer.status, json: async () => answer.body ?? {} } as Response;
    }));
    logs = {
      log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    };
  });

  afterEach(() => {
    driver?.disconnect();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('opening', () => {
    it('Connect_WithAToken_DialsWithItButNeverLogsIt', async () => {
      // The log is copied into the diagnostics bundle users attach to reports.
      await connected({ apiToken: 's3cret' });

      expect(socket().url).toBe('ws://10.0.4.20/api/status/ws?x-api-token=s3cret');
      expect(said(logs.log)).not.toContain('s3cret');
    });

    it('Open_Live_SendsTheEnableHandshake', async () => {
      await connected();

      socket().onopen!();

      expect(socket().send).toHaveBeenCalledWith(JSON.stringify({ enable: true }));
    });

    it('Open_AfterTheAddressChanged_ClosesInsteadOfHandshaking', async () => {
      // Otherwise it stays open against the previous address.
      await connected();
      const stale = socket();
      await driver.reconfigure({ ipAddress: '10.0.4.21', apiToken: '' });

      stale.onopen!();

      expect(stale.send).not.toHaveBeenCalled();
      expect(stale.close).toHaveBeenCalled();
      expect(socket().url).toBe('ws://10.0.4.21/api/status/ws');
    });

    it('Open_HandshakeSendFails_DoesNotThrow', async () => {
      await connected();
      socket().send.mockImplementation(() => { throw new Error('socket not open'); });

      expect(() => socket().onopen!()).not.toThrow();
    });

    it('Start_SocketCannotBeCreated_LeavesTheDriverUsable', async () => {
      FakeWebSocket.failNext = new Error('invalid URL');

      await connected();

      expect(driver.getDeviceStatus().connected).toBe(true);
      expect(FakeWebSocket.instances).toHaveLength(0);
    });
  });

  describe('input', () => {
    beforeEach(() => connected());

    it('JsonMessage_KeyEvent_EmitsItLowercased', () => {
      socket().onmessage!({ data: JSON.stringify({ key: 'START', type: 'long_press' }) });
      socket().onmessage!({ data: JSON.stringify({ input_event: { key: 'Back' } }) });

      expect(inputs).toEqual([
        { key: 'start', type: 'long_press' },
        { key: 'back', type: 'press' }
      ]);
    });

    it('JsonMessage_NoKeyOrMalformed_EmitsNothing', () => {
      socket().onmessage!({ data: JSON.stringify({ battery: 90 }) });
      socket().onmessage!({ data: '{ nope' });

      expect(inputs).toEqual([]);
    });

    it.each([
      ['an ArrayBuffer', (b: Uint8Array) => b.buffer.slice(0)],
      ['a Buffer', (b: Uint8Array) => Buffer.from(b)],
      ['a Uint8Array', (b: Uint8Array) => b]
    ])('BinaryMessage_As%s_DecodesTheButton', (_label, wrap) => {
      // START released, as the firmware's protobuf StateStream sends it.
      const frame = new Uint8Array([0x12, 0x08, 0x5a, 0x06, 0x0a, 0x04, 0x08, 0x02, 0x10, 0x01]);

      socket().onmessage!({ data: wrap(frame) });

      expect(inputs).toEqual([{ key: 'start', type: 'press' }]);
    });

    it('BinaryMessage_ButtonGoingDown_EmitsNothing', () => {
      // Only release and long press count; the down edge would double every press.
      socket().onmessage!({ data: new Uint8Array([0x5a, 0x06, 0x0a, 0x04, 0x08, 0x02, 0x10, 0x00]) });

      expect(inputs).toEqual([]);
    });

    it('Message_FromASupersededSocket_IsIgnored', async () => {
      // Input from the old socket is input from the wrong device.
      const stale = socket();
      await driver.reconfigure({ ipAddress: '10.0.4.21', apiToken: '' });

      stale.onmessage!({ data: JSON.stringify({ key: 'start' }) });

      expect(inputs).toEqual([]);
    });
  });

  describe('closing', () => {
    beforeEach(() => connected());

    it('Close_Live_ReconnectsAfterASecond', async () => {
      socket().onclose!();

      await vi.advanceTimersByTimeAsync(999);
      expect(FakeWebSocket.instances).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('Close_OfASupersededSocket_LeavesTheLiveOneInCharge', async () => {
      // The load-bearing guard: without it the old socket's late close nulls
      // the live client and schedules a reconnect on top of it, orphaning a
      // socket that nothing can close any more.
      const stale = socket();
      await driver.reconfigure({ ipAddress: '10.0.4.21', apiToken: '' });
      const live = socket();

      stale.onclose!();
      await vi.advanceTimersByTimeAsync(2000);
      driver.disconnect();

      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(live.close).toHaveBeenCalled();
    });

    it('Close_AfterDisconnect_DoesNotReconnect', async () => {
      const closed = socket();
      driver.disconnect();

      closed.onclose!();
      await vi.advanceTimersByTimeAsync(5000);

      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    it('Error_OnASupersededSocket_IsNotReported', async () => {
      const stale = socket();
      await driver.reconfigure({ ipAddress: '10.0.4.21', apiToken: '' });
      logs.warn.mockClear();

      stale.onerror!(new Error('ECONNRESET'));
      socket().onerror!(new Error('ECONNRESET'));

      expect(logs.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('ping loop', () => {
    it('Ping_BarStopsAnswering_SaysSoOnceAndGoesDisconnected', async () => {
      await connected();
      statusAnswer = new TypeError('fetch failed');

      await ping();
      await ping();
      await ping();

      expect(driver.getDeviceStatus().connected).toBe(false);
      expect(logs.warn.mock.calls.filter(c => String(c[0]).includes('Lost connection'))).toHaveLength(1);
    });

    it('Ping_HttpError_CountsAsLost', async () => {
      await connected();
      statusAnswer = { ok: false, status: 503 };

      await ping();

      expect(driver.getDeviceStatus().connected).toBe(false);
      expect(said(logs.warn)).toContain('HTTP 503');
    });

    it('Ping_BarComesBack_SaysSoAndReopensTheStateStream', async () => {
      await connected();
      statusAnswer = new TypeError('fetch failed');
      await ping();
      statusAnswer = { ok: true, status: 200, body: {} };

      await ping();

      expect(driver.getDeviceStatus().connected).toBe(true);
      expect(said(logs.log)).toContain('recovered after 1 failed ping(s)');
      expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('Ping_Answered_RefreshesTheTelemetry', async () => {
      await connected();
      statusAnswer = { ok: true, status: 200, body: { power: { battery_charge: 42 } } };

      await ping();

      expect(driver.getDeviceStatus().batteryPercent).toBe(42);
    });

    it('Ping_NeverReachable_RemindsPeriodicallyNotEveryTime', async () => {
      // One line per failed ping would bury everything else in an exported log.
      statusAnswer = new TypeError('fetch failed');
      await connected();
      logs.warn.mockClear();

      await vi.advanceTimersByTimeAsync(DEVICE_PING_INTERVAL_MS * DEVICE_UNREACHABLE_REMINDER_PINGS);

      expect(logs.warn.mock.calls.filter(c => String(c[0]).includes('Still cannot reach'))).toHaveLength(1);
      expect(logs.warn).toHaveBeenCalledTimes(1);
    });
  });
});
