import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { DeviceStatusDTO, AccessSettingsDTO, BrightnessDTO, ArgumentException } from '../../shared/dtos';
import { DEFAULT_USB_IP, DEVICE_APPLICATION_NAME, redactTokenInUrl } from '../../shared/device-constants';
import { sanitizeAsciiText } from '../../shared/text-sanitizer';

export interface HardwareEvent {
  key: string;
  type: 'press' | 'long_press' | 'rotate_left' | 'rotate_right';
  timestamp: string;
}

export interface BusyBarDriverOptions {
  ipAddress?: string;
  apiToken?: string;
  forceMock?: boolean;
}

// Re-exported rather than redeclared: the onboarding wizard displays this and
// the renderer must not import from src/main, so the value itself lives in
// shared. Two literals would drift the moment one of them changed.
export { DEFAULT_USB_IP } from '../../shared/device-constants';
export const DEFAULT_DRAW_PRIORITY = 95;
export const ASSET_FILENAME_REGEX = /^[a-zA-Z0-9._-]+$/;

/**
 * Per-request timeout for device calls.
 *
 * The bar is on a USB link, so a healthy response is milliseconds away. Without
 * a timeout a single unresponsive socket blocks the caller indefinitely: most
 * of these run from render paths that must not stall, and `frameInFlight` gates
 * every later frame behind the one in progress.
 */
export const DEVICE_REQUEST_TIMEOUT_MS = 2000;

/** Longer, because an asset upload carries a payload rather than a few bytes. */
export const DEVICE_UPLOAD_TIMEOUT_MS = 5000;

/** How often the ping loop retries the device. */
export const DEVICE_PING_INTERVAL_MS = 3000;

/**
 * How many consecutive failed pings between "still unreachable" reminders.
 *
 * Connection loss and recovery are logged on the transition, which is the
 * useful signal -- but a log with a single line at startup does not tell a user
 * reading it hours later that the app is still trying. This is the compromise:
 * one line every ten minutes while down.
 *
 * Not every failure. The loop runs every 3s, so logging each one would put 1200
 * lines an hour into a 2000-line ring and flush every other diagnostic out of
 * the export. That exact mistake is on record: an OpenProject poll printed a
 * full stack trace every 60s and made the terminal unreadable.
 */
export const DEVICE_UNREACHABLE_REMINDER_PINGS = 200;

/**
 * Whether a "still unreachable" reminder is due after this many failed pings.
 *
 * Extracted and exported so the throttle can be tested directly: it is modulo
 * arithmetic guarding a log line, the kind of thing that silently reads
 * "every ping" or "never" if the comparison is off by one, and neither mistake
 * shows up until someone is reading a log hours later trying to work out why
 * their bar is dark.
 *
 * The `> 0` guard matters: `0 % n === 0`, so without it a driver that has never
 * failed a ping would report a reminder as due.
 */
export function isUnreachableReminderDue(consecutiveFailures: number): boolean {
  return consecutiveFailures > 0 && consecutiveFailures % DEVICE_UNREACHABLE_REMINDER_PINGS === 0;
}

/**
 * Turns a failed `fetch` into something a user can act on.
 *
 * Node's fetch reports `TypeError: fetch failed` and puts the real reason in
 * `cause` -- `ECONNREFUSED`, `EHOSTUNREACH`, `ETIMEDOUT`, or a `TimeoutError`
 * from the abort signal. The top-level message on its own names nothing, which
 * is why the driver used to discard it: it looked worthless. The cause is the
 * half worth keeping, and it is the difference between "the bar is asleep" and
 * "the USB network adapter is not there at all".
 */
export function describeTransportError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    return code ? `${cause.message} (${code})` : cause.message;
  }
  return err.name === 'TimeoutError' ? `timed out after ${DEVICE_REQUEST_TIMEOUT_MS}ms` : err.message;
}

/**
 * What the device meant by a non-2xx status, per the API guide.
 *
 * These were treated identically -- as "false" -- which conflated three
 * different situations: another application legitimately owning the display, a
 * payload this build should never have constructed, and a device asking to be
 * asked again.
 */
export type DeviceResponseKind = 'ok' | 'conflict' | 'too_large' | 'busy' | 'error' | 'unreachable';

/** Promise-based pause, for the single 503 retry. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Classifies a device response, or its absence. */
export function classifyDeviceResponse(response: Response | null): DeviceResponseKind {
  if (!response) return 'unreachable';
  if (response.ok) return 'ok';
  switch (response.status) {
    // Something with a higher draw priority owns the display. Expected, not a
    // fault: the frame is genuinely not wanted right now.
    case 409:
      return 'conflict';
    // The payload exceeded what the device accepts. Retrying sends the same
    // bytes, so it is pointless; this is a bug in whatever built the payload.
    case 413:
      return 'too_large';
    case 503:
      return 'busy';
    default:
      return 'error';
  }
}

/**
 * Formats an ISO 8601 timestamp with the local UTC offset.
 *
 * `Date.prototype.toISOString` always renders UTC with a `Z` suffix. The device
 * sets its real-time clock from what it is given and applies no conversion, so
 * a `Z` timestamp leaves the bar showing UTC -- two hours behind for a user in
 * Paris in summer.
 */
export function toIsoWithLocalOffset(date: Date = new Date()): string {
  const pad = (value: number): string => String(Math.floor(Math.abs(value))).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(offsetMinutes / 60)}:${pad(offsetMinutes % 60)}`
  );
}
export const VALID_HARDWARE_KEYS = [
  'up',
  'down',
  'ok',
  'back',
  'start',
  'busy',
  'custom',
  'off',
  'apps',
  'settings',
  'rotate_left',
  'rotate_right'
] as const;

// Re-exported, not redeclared: the notification text composer in src/shared
// must sanitise before it measures a string against a field width, and the
// renderer cannot import from src/main. Importers here are unaffected.
export { sanitizeAsciiText };

export function parseVarint(data: Uint8Array, offset: number): { value: number; nextOffset: number } {
  let value = 0;
  let shift = 0;
  let curr = offset;
  while (curr < data.length) {
    const byte = data[curr++];
    value |= (byte & 0x7f) << shift;
    if (!(byte & 0x80)) {
      return { value: value >>> 0, nextOffset: curr };
    }
    shift += 7;
    if (shift > 35) break;
  }
  return { value: 0, nextOffset: data.length };
}

export function parseFields(data: Uint8Array): Array<{ number: number; wireType: number; value: number | Uint8Array }> {
  const fields: Array<{ number: number; wireType: number; value: number | Uint8Array }> = [];
  let offset = 0;
  while (offset < data.length) {
    const keyRes = parseVarint(data, offset);
    if (keyRes.nextOffset === offset) break;
    offset = keyRes.nextOffset;
    const key = keyRes.value;
    const number = key >> 3;
    const wireType = key & 7;

    if (wireType === 0) {
      const valRes = parseVarint(data, offset);
      offset = valRes.nextOffset;
      fields.push({ number, wireType, value: valRes.value });
    } else if (wireType === 2) {
      const lenRes = parseVarint(data, offset);
      offset = lenRes.nextOffset;
      const len = lenRes.value;
      const sub = data.subarray(offset, offset + len);
      offset += len;
      fields.push({ number, wireType, value: sub });
    } else if (wireType === 1) {
      offset += 8;
    } else if (wireType === 5) {
      offset += 4;
    } else {
      break;
    }
  }
  return fields;
}

export function zigzagDecode(val: number): number {
  return (val >> 1) ^ -(val & 1);
}

export function decodeProtobufInput(data: Uint8Array): { key: string; type: 'press' | 'long_press' | 'rotate_left' | 'rotate_right' } | null {
  const rootFields = parseFields(data);

  const processInputEventBytes = (inputBytes: Uint8Array): { key: string; type: 'press' | 'long_press' | 'rotate_left' | 'rotate_right' } | null => {
    const fields = parseFields(inputBytes);
    for (const f of fields) {
      if (f.number === 1 && f.value instanceof Uint8Array) {
        let button = 0;
        let action = 0;
        const subFields = parseFields(f.value);
        for (const sf of subFields) {
          if (sf.number === 1 && typeof sf.value === 'number') button = sf.value;
          if (sf.number === 2 && typeof sf.value === 'number') action = sf.value;
        }
        const keyMap: Record<number, string> = { 0: 'ok', 1: 'back', 2: 'start' };
        if (action === 0) return null; // Ignore down press (0). Only process release (1) and long press (2).
        const key = keyMap[button] || 'ok';
        const type = action === 2 ? 'long_press' : 'press';
        return { key, type };
      }
      if (f.number === 2 && f.value instanceof Uint8Array) {
        let pos = 0;
        const subFields = parseFields(f.value);
        for (const sf of subFields) {
          if (sf.number === 1 && typeof sf.value === 'number') pos = sf.value;
        }
        return { key: pos === 3 ? 'apps' : 'mode', type: 'press' };
      }
      if (f.number === 3 && f.value instanceof Uint8Array) {
        let delta = 0;
        const subFields = parseFields(f.value);
        for (const sf of subFields) {
          if (sf.number === 1 && typeof sf.value === 'number') delta = zigzagDecode(sf.value);
        }
        if (delta < 0) return { key: 'rotate_left', type: 'rotate_left' };
        if (delta > 0) return { key: 'rotate_right', type: 'rotate_right' };
      }
    }
    return null;
  };

  let lastValidInput: { key: string; type: 'press' | 'long_press' | 'rotate_left' | 'rotate_right' } | null = null;
  for (const rf of rootFields) {
    if (rf.number === 2 && rf.value instanceof Uint8Array) {
      const updateFields = parseFields(rf.value);
      for (const uf of updateFields) {
        if (uf.number === 11 && uf.value instanceof Uint8Array) {
          const res = processInputEventBytes(uf.value);
          if (res) lastValidInput = res;
        }
      }
    } else if (rf.number === 11 && rf.value instanceof Uint8Array) {
      const res = processInputEventBytes(rf.value);
      if (res) lastValidInput = res;
    }
  }

  return lastValidInput;
}

/**
 * Driver managing connection, telemetry, input event streams, and REST API commands
 * for physical BUSY Bar hardware (72×16 matrix) per OpenAPI v25 and Developer Guide specs.
 */
export class BusyBarDriver extends EventEmitter {
  private static readonly NETWORK_THROTTLE_MS = 35;
  private isMockMode: boolean = false;
  private isConnected: boolean = false;
  private ipAddress: string = DEFAULT_USB_IP;
  private apiToken: string = '';
  private pingMs: number = 4;
  private batteryPercent: number = 98;
  private firmwareVersion: string = '1.4.2';
  private wsClient: unknown | null = null;
  private wsReconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  /**
   * Bumped every time a socket is opened or torn down, so a dead socket's
   * handlers can tell they are dead.
   *
   * `close()` does not fire `onclose` synchronously. Without this, closing a
   * socket and immediately opening another races: the *old* socket's `onclose`
   * lands after the new one is assigned, sets `this.wsClient = null`, and the
   * live socket is orphaned -- still open, still receiving, with nothing left
   * holding a handle to close it. Changing the device address is exactly that
   * sequence, so a stale socket would keep talking to the previous address
   * forever. Every handler compares its captured generation against this and
   * returns if they differ.
   */
  private wsGeneration: number = 0;
  /** Why the last `deviceFetch` got no answer, so callers can report the cause rather than "it failed". */
  private lastTransportError: string | null = null;
  /** Consecutive failed pings, for the throttled "still unreachable" reminder. */
  private consecutivePingFailures: number = 0;
  private frameInFlight: boolean = false;
  private pendingFrameArgs: Parameters<BusyBarDriver['sendPixelFrame']> | null = null;
  private framesSent: number = 0;
  private framesFailed: number = 0;
  private displayVersion: number = 0;

  constructor(ipAddressOrOptions: string | BusyBarDriverOptions = DEFAULT_USB_IP, forceMock: boolean = false) {
    super();

    if (typeof ipAddressOrOptions === 'object') {
      this.ipAddress = ipAddressOrOptions.ipAddress || DEFAULT_USB_IP;
      this.apiToken = ipAddressOrOptions.apiToken || '';
      this.isMockMode = ipAddressOrOptions.forceMock || process.argv.includes('--mock-hardware') || process.env.MOCK_HARDWARE === 'true';
    } else {
      this.ipAddress = ipAddressOrOptions;
      this.isMockMode = forceMock || process.argv.includes('--mock-hardware') || process.env.MOCK_HARDWARE === 'true';
    }
  }

  public setApiToken(token: string): void {
    this.apiToken = token;
  }

  public getApiToken(): string {
    return this.apiToken;
  }

  /**
   * Helper constructing standard request headers with X-API-Token if configured.
   */
  private getHeaders(additionalHeaders: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...additionalHeaders
    };
    if (this.apiToken) {
      headers['X-API-Token'] = this.apiToken;
    }
    return headers;
  }

  /**
   * Parses telemetry fields from device status API payloads.
   */
  private parseTelemetryData(data: Record<string, unknown>): void {
    if (!data || typeof data !== 'object') return;

    // The device nests some fields (power.battery_charge, firmware.version) and
    // reports others flat, depending on firmware. Optional chaining through an
    // `unknown` value silently produced `{}` rather than reading the field, so
    // the nested forms were never picked up.
    const nested = (key: string): Record<string, unknown> =>
      (typeof data[key] === 'object' && data[key] !== null ? data[key] : {}) as Record<string, unknown>;

    const rawBattery =
      nested('power').battery_charge ?? data.battery_charge ?? data.battery_level ?? data.batteryPercent;
    if (rawBattery !== undefined && rawBattery !== null) {
      const parsedNum = Number(rawBattery);
      if (!isNaN(parsedNum)) {
        this.batteryPercent = parsedNum;
      }
    }

    const rawFirmware =
      nested('firmware').version ?? data.version ?? data.firmware_version ?? data.firmwareVersion;
    if (rawFirmware) {
      this.firmwareVersion = String(rawFirmware);
    }
  }

  /**
   * Initializes hardware connection and starts ping loop & WebSocket listener.
   */
  public async connect(): Promise<boolean> {
    if (this.isMockMode) {
      console.log('[BusyBarDriver] Initialized in MOCK HARDWARE mode (--mock-hardware)');
      this.isConnected = true;
      this.startPingLoop();
      this.emit('statusChanged', this.getDeviceStatus());
      return true;
    }

    try {
      console.log(`[BusyBarDriver] Connecting to BUSY Bar hardware at ${this.ipAddress}...`);

      let response = await this.deviceFetch(`http://${this.ipAddress}/api/status`, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (!response || !response.ok) {
        response = await this.deviceFetch(`http://${this.ipAddress}/api/status/power`, {
          method: 'GET',
          headers: this.getHeaders()
        });
      }

      if (response && response.ok) {
        this.isConnected = true;
        const data = await response.json().catch(() => null);
        if (data) {
          this.parseTelemetryData(data);
        }
        if (this.firmwareVersion === '1.4.2') {
          const fwRes = await this.deviceFetch(`http://${this.ipAddress}/api/status/firmware`, {
            method: 'GET',
            headers: this.getHeaders()
          });
          if (fwRes && fwRes.ok) {
            const fwData = await fwRes.json().catch(() => null);
            if (fwData) this.parseTelemetryData(fwData);
          }
        }
        this.startStateStreamListener();
        void this.refreshBrightness();
        console.log(
          `[BusyBarDriver] Connected to ${this.ipAddress} (firmware ${this.firmwareVersion}, battery ${this.batteryPercent}%).`
        );
      } else if (response) {
        // Something *is* listening, it just did not like these two endpoints.
        // Stay optimistic here on purpose: a firmware that does not serve
        // /api/status is still a usable bar, and refusing to talk to it would
        // be a regression. Telemetry will be missing, so say that much.
        this.isConnected = true;
        console.warn(
          `[BusyBarDriver] ${this.ipAddress} answered HTTP ${response.status} for both status endpoints. ` +
            `Treating the device as present, but telemetry (firmware, battery) will be unavailable.`
        );
      } else {
        // Nothing answered at all. This used to set `isConnected = true`
        // regardless, so a bar that was unplugged reported itself connected
        // until the ping loop quietly flipped it back seconds later -- and
        // nothing anywhere logged why.
        this.isConnected = false;
        console.warn(
          `[BusyBarDriver] No response from ${this.ipAddress}: ${this.lastTransportError ?? 'no answer'}. ` +
            `The bar is not reachable -- check that it is plugged in with a data-capable USB cable and awake. ` +
            `Retrying every ${DEVICE_PING_INTERVAL_MS / 1000}s in the background.`
        );
      }

      this.startPingLoop();
      this.emit('statusChanged', this.getDeviceStatus());
      return this.isConnected;
    } catch (err) {
      console.warn(`[BusyBarDriver] Hardware connection to ${this.ipAddress} failed. Falling back to degraded state.`, err);
      this.isConnected = false;
      this.startPingLoop();
      this.emit('statusChanged', this.getDeviceStatus());
      return false;
    }
  }

  /**
   * Connects WebSocket StateStream to ws://{host}/api/status/ws with automatic 3s reconnection.
   * Sends mandatory handshake payload `{ enable: true }` upon connection.
   */
  public startStateStreamListener(): void {
    if (this.isMockMode) return;
    if (this.wsClient) {
      try {
        (this.wsClient as { close?: () => void }).close?.();
      } catch {
        // ignore close errors
      }
      this.wsClient = null;
    }

    const generation = ++this.wsGeneration;

    try {
      let wsUrl = `ws://${this.ipAddress}/api/status/ws`;
      if (this.apiToken) {
        wsUrl += `?x-api-token=${encodeURIComponent(this.apiToken)}`;
      }

      // Redacted, because this line is captured verbatim into the diagnostics
      // bundle users attach to bug reports and the token rides in the query
      // string. Logging the raw URL would mail the secret to whoever reads it.
      console.log(
        `[BusyBarDriver] Starting WebSocket StateStream listener on ${redactTokenInUrl(wsUrl)}`
      );

      // Previously `eval('require("ws")')`, which defeated bundler analysis to
      // work around a resolution problem that no longer exists: 'ws' is listed
      // in ELECTRON_EXTERNALS, so a plain import is left external anyway.
      const ws = new WebSocket(wsUrl);
      this.wsClient = ws;

      ws.onopen = () => {
        // A socket superseded while it was still opening: close it rather than
        // handshaking, or it stays open against the previous address.
        if (generation !== this.wsGeneration) {
          try {
            ws.close();
          } catch {
            // ignore close errors
          }
          return;
        }
        console.log('[BusyBarDriver] WebSocket connected. Sending handshake { enable: true }');
        try {
          ws.send(JSON.stringify({ enable: true }));
        } catch (err) {
          console.warn('[BusyBarDriver] WebSocket handshake send failed:', err);
        }
      };

      ws.binaryType = 'arraybuffer';

      ws.onmessage = (event: { data: unknown }) => {
        // Input from a superseded socket is input from the wrong device.
        if (generation !== this.wsGeneration) return;
        const rawData = event.data;
        if (typeof rawData === 'string') {
          try {
            const data = JSON.parse(rawData);
            const key = data.key || data.input || data.button || (data.input_event && data.input_event.key);
            if (key) {
              const actionType = data.type || data.action || 'press';
              this.emit('input', {
                key: String(key).toLowerCase(),
                type: actionType as 'press' | 'long_press' | 'rotate_left' | 'rotate_right',
                timestamp: new Date().toISOString()
              });
            }
          } catch {
            // Ignore malformed JSON packets
          }
          return;
        }

        // Binary Protobuf StateStream frame decoding
        let u8: Uint8Array | null = null;
        if (rawData instanceof ArrayBuffer) {
          u8 = new Uint8Array(rawData);
        } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(rawData)) {
          u8 = new Uint8Array(rawData as Buffer);
        } else if (rawData instanceof Uint8Array) {
          u8 = rawData;
        }

        if (u8) {
          const parsed = decodeProtobufInput(u8);
          if (parsed) {
            this.emit('input', {
              key: parsed.key,
              type: parsed.type,
              timestamp: new Date().toISOString()
            });
          }
        }
      };

      ws.onerror = (err: unknown) => {
        if (generation !== this.wsGeneration) return;
        console.warn('[BusyBarDriver] WebSocket error:', err);
      };

      ws.onclose = () => {
        // The load-bearing guard. `close()` does not fire this synchronously,
        // so without the check a superseded socket's close would null out the
        // *live* `wsClient` and schedule a reconnect on top of it -- leaving an
        // orphaned socket on the old address that nothing can close.
        if (generation !== this.wsGeneration) return;
        console.log('[BusyBarDriver] WebSocket closed. Scheduling reconnection in 1s...');
        this.wsClient = null;
        if (!this.wsReconnectTimer) {
          this.wsReconnectTimer = setTimeout(() => {
            this.wsReconnectTimer = null;
            if (generation !== this.wsGeneration) return;
            if (this.isConnected && !this.isMockMode) {
              this.startStateStreamListener();
            }
          }, 1000);
        }
      };
    } catch (err) {
      console.warn('[BusyBarDriver] StateStream WebSocket connection failed:', err);
    }
  }

  /**
   * Last brightness read from the device, or null before the first successful
   * read. Cached because `getDeviceStatus` is synchronous.
   */
  private frontBrightness: number | null = null;

  /**
   * Refreshes the cached brightness from the device.
   *
   * `getBrightness` existed and worked, and nothing ever called it: the status
   * object returned a literal 80 instead, which the diagnostics panel displayed
   * as a live reading.
   */
  private async refreshBrightness(): Promise<void> {
    if (this.isMockMode) return;
    const reading = await this.getBrightness();
    if (reading && typeof reading.value === 'number') {
      this.frontBrightness = reading.value;
    }
  }

  public getDeviceStatus(): DeviceStatusDTO {
    // "Not the default USB address" -- which is genuinely all this can know.
    // HTTP over USB Ethernet and HTTP over Wi-Fi are indistinguishable from
    // here, so a bar reached through a local proxy (the recovery when a host's
    // CDC-NCM driver will not start) reports `wifi` while physically being on
    // USB. Reporting the address itself, which the UI does alongside this, is
    // the part that is always true.
    const isWifi = this.ipAddress !== DEFAULT_USB_IP;
    if (!this.isConnected && !this.isMockMode) {
      return {
        connected: false,
        ipAddress: this.ipAddress,
        connectionType: isWifi ? 'wifi' : 'usb',
        frontBrightness: null,
        backBrightness: null,
        batteryPercent: 0,
        firmwareVersion: 'N/A',
        webSocketPingMs: 0,
        framesSent: this.framesSent,
        framesFailed: this.framesFailed
      };
    }

    return {
      connected: this.isConnected,
      ipAddress: this.ipAddress,
      connectionType: isWifi ? 'wifi' : 'usb',
      frontBrightness: this.isMockMode ? 80 : this.frontBrightness,
      // Nothing in this build draws to the rear panel, so we have no brightness
      // to report for it. It was reported as 100 regardless.
      backBrightness: null,
      batteryPercent: this.batteryPercent,
      firmwareVersion: this.isMockMode ? `${this.firmwareVersion}-mock` : this.firmwareVersion,
      webSocketPingMs: this.pingMs,
      framesSent: this.framesSent,
      framesFailed: this.framesFailed
    };
  }

  public simulateInputEvent(event: HardwareEvent): void {
    console.log(`[BusyBarDriver] Hardware Input Event: ${event.key} (${event.type})`);
    this.emit('input', event);
  }

  /**
   * Formats raw element arrays and enforces firmware validation rules:
   *  - Solid fills MUST contain strictly 1 color string in fill_colors.
   *  - Gradient fills MUST contain strictly 2 color strings in fill_colors.
   *  - Text elements MUST have text strings sanitized to ASCII.
   *  - Image elements MUST use filename-only path and exclude width/height keys.
   */
  public formatHardwarePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const rawElements = (payload.elements as Array<Record<string, unknown>>) || [];
    let elemIdCounter = 0;

    const formattedElements: Array<Record<string, unknown>> = [];

    const processElement = (item: Record<string, unknown>, defaultDisplay: string): Record<string, unknown> => {
      const elem: Record<string, unknown> = {
        id: item.id || `elem_${elemIdCounter++}`,
        display: item.display || defaultDisplay,
        ...item
      };

      if (elem.type === 'text' && typeof elem.text === 'string') {
        elem.text = sanitizeAsciiText(elem.text);
      }

      if (elem.type === 'rectangle') {
        const fillMode = String(elem.fill || 'solid').toLowerCase();
        let colors = Array.isArray(elem.fill_colors) ? elem.fill_colors.map(String) : [];

        if (fillMode === 'solid' || fillMode === 'none') {
          if (colors.length === 0) colors = ['#FFFFFFFF'];
          else if (colors.length > 1) colors = [colors[0]];
        } else if (fillMode === 'gradient_h' || fillMode === 'gradient_v') {
          if (colors.length === 0) colors = ['#FFFFFFFF', '#000000FF'];
          else if (colors.length === 1) colors = [colors[0], colors[0]];
          else if (colors.length > 2) colors = colors.slice(0, 2);
        }
        elem.fill_colors = colors;
      }

      if (elem.type === 'image' || elem.type === 'animation') {
        if (typeof elem.path === 'string') {
          elem.path = elem.path.replace(/^.*[\\/]/, '');
        }
        delete elem.width;
        delete elem.height;
      }

      return elem;
    };

    if (Array.isArray(payload.frontElements)) {
      for (const item of payload.frontElements as Array<Record<string, unknown>>) {
        if (item && typeof item === 'object') {
          formattedElements.push(processElement(item, 'front'));
        }
      }
    }

    if (Array.isArray(payload.backElements)) {
      for (const item of payload.backElements as Array<Record<string, unknown>>) {
        if (item && typeof item === 'object') {
          formattedElements.push(processElement(item, 'back'));
        }
      }
    }

    if (formattedElements.length === 0 && rawElements.length > 0) {
      for (const item of rawElements) {
        if (item && typeof item === 'object') {
          formattedElements.push(processElement(item, String(item.display || 'front')));
        }
      }
    }

    const hardwarePayload: Record<string, unknown> = {
      application_name: (payload.application_name as string) || DEVICE_APPLICATION_NAME,
      priority: typeof payload.priority === 'number' ? payload.priority : DEFAULT_DRAW_PRIORITY,
      elements: formattedElements
    };

    const ledColor = payload.ledColorHex || payload.led_notification_color;
    if (ledColor) {
      hardwarePayload.led_notification_color = String(ledColor);
    }

    return hardwarePayload;
  }

  /**
   * Uploads binary asset file to POST /api/assets/upload?application_name={app}&file={filename}
   * Validates filename strictly against regex ^[a-zA-Z0-9._-]+$.
   */
  public async uploadAsset(applicationName: string, filename: string, binaryData: Buffer | Uint8Array): Promise<boolean> {
    if (!this.isConnected && !this.isMockMode) {
      return false;
    }
    const cleanFilename = filename.replace(/^.*[\\/]/, '');
    if (!ASSET_FILENAME_REGEX.test(cleanFilename)) {
      console.error(`[BusyBarDriver] Invalid asset filename '${filename}'. Must match ${ASSET_FILENAME_REGEX}`);
      return false;
    }

    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK ASSET UPLOAD] app=${applicationName}, file=${cleanFilename}, bytes=${binaryData.byteLength}`);
      return true;
    }

    try {
      const url = `http://${this.ipAddress}/api/assets/upload?application_name=${encodeURIComponent(applicationName)}&file=${encodeURIComponent(cleanFilename)}`;
      const response = await this.deviceFetch(
        url,
        {
          method: 'POST',
          headers: this.getHeaders({ 'Content-Type': 'application/octet-stream' }),
          // Buffer is not part of the DOM BodyInit union TypeScript models for
          // fetch. A Uint8Array view over the same bytes is, with no copy. The
          // ArrayBuffer assertion is needed because TypedArrays became generic
          // over their backing buffer in TS 5.7, and the default ArrayBufferLike
          // admits SharedArrayBuffer, which BodyInit excludes.
          body: new Uint8Array(
            binaryData.buffer as ArrayBuffer,
            binaryData.byteOffset,
            binaryData.byteLength
          )
        },
        // An upload carries a payload rather than a few bytes of JSON.
        DEVICE_UPLOAD_TIMEOUT_MS
      );

      return this.reportDeviceResponse(`asset upload ${cleanFilename}`, response) === 'ok';
    } catch (err) {
      console.error(`[BusyBarDriver] Asset upload failed for ${cleanFilename}:`, err);
      return false;
    }
  }

  /**
   * Deletes all asset files for application: DELETE /api/assets/upload?application_name={app}
   */
  public async deleteAppAssets(applicationName: string): Promise<boolean> {
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK ASSET DELETE] app=${applicationName}`);
      return true;
    }

    try {
      const url = `http://${this.ipAddress}/api/assets/upload?application_name=${encodeURIComponent(applicationName)}`;
      const response = await this.deviceFetch(url, {
        method: 'DELETE',
        headers: this.getHeaders()
      });

      return response ? response.ok : false;
    } catch (err) {
      console.error(`[BusyBarDriver] Asset delete failed for ${applicationName}:`, err);
      return false;
    }
  }

  /**
   * Clears display elements for application: DELETE /api/display/draw?application_name={app}
   */
  public async clearDisplay(applicationName: string = DEVICE_APPLICATION_NAME): Promise<boolean> {
    if (!this.isConnected && !this.isMockMode) {
      return false;
    }
    this.displayVersion++;
    this.pendingFrameArgs = null;

    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK CLEAR] app=${applicationName}`);
      return true;
    }

    try {
      const url = `http://${this.ipAddress}/api/display/draw?application_name=${encodeURIComponent(applicationName)}`;
      const response = await this.deviceFetch(url, {
        method: 'DELETE',
        headers: this.getHeaders()
      });
      return response ? response.ok : false;
    } catch (err) {
      console.error(`[BusyBarDriver] Clear display failed:`, err);
      return false;
    }
  }

  /**
   * Renders pixel art matrix PNG to physical display via uploadAsset + single ImageElement draw.
   */
  public async sendPixelFrame(
    pngBuffer: Buffer,
    ledColorHex?: string,
    applicationName: string = DEVICE_APPLICATION_NAME,
    filename: string = 'frame.png',
    priority: number = DEFAULT_DRAW_PRIORITY
  ): Promise<boolean> {
    if (!this.isConnected && !this.isMockMode) {
      this.pendingFrameArgs = [pngBuffer, ledColorHex, applicationName, filename, priority];
      return false;
    }
    const cleanFilename = filename.replace(/^.*[\\/]/, '');
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK PIXEL FRAME] app=${applicationName}, file=${cleanFilename}, bytes=${pngBuffer.byteLength}, led=${ledColorHex ?? 'none'}`);
      return true;
    }

    if (this.frameInFlight) {
      // Store the latest requested frame so it gets drawn after the current one finishes.
      // This guarantees we don't drop critical static state changes (like task finishing)
      this.pendingFrameArgs = [pngBuffer, ledColorHex, applicationName, filename, priority];
      return false; // Skip this hardware transmission to avoid queue flooding
    }

    const currentVersion = this.displayVersion;
    this.frameInFlight = true;
    try {
      const uploadOk = await this.uploadAsset(applicationName, cleanFilename, pngBuffer);
      
      // If a clearDisplay or sendDisplayPayload was called during the asset upload, abort the draw
      if (this.displayVersion !== currentVersion) {
        this.frameInFlight = false;
        this.checkPendingFrame();
        return false;
      }

      if (!uploadOk) {
        console.warn(`[BusyBarDriver] PNG asset upload failed for ${cleanFilename}, skipping draw.`);
        this.framesFailed++;
        this.frameInFlight = false;
        this.checkPendingFrame();
        return false;
      }

      const drawPayload: Record<string, unknown> = {
        application_name: applicationName,
        priority,
        elements: [{
          id: 'px_matrix_img',
          type: 'image',
          path: cleanFilename,
          x: 0,
          y: 0,
          display: 'front'
        }]
      };

      if (ledColorHex) {
        drawPayload.led_notification_color = ledColorHex;
      }

      const drawUrl = `http://${this.ipAddress}/api/display/draw`;
      const drawInit: RequestInit = {
        method: 'POST',
        headers: this.getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(drawPayload)
      };

      let drawResponse = await this.deviceFetch(drawUrl, drawInit);
      let kind = this.reportDeviceResponse('draw', drawResponse);

      // 503 means "ask again", and it is the one status where a retry is both
      // correct and cheap. Once only: a device that is still busy after a
      // throttle interval will be sent the next frame anyway.
      if (kind === 'busy') {
        await delay(BusyBarDriver.NETWORK_THROTTLE_MS);
        drawResponse = await this.deviceFetch(drawUrl, drawInit);
        kind = this.reportDeviceResponse('draw retry', drawResponse);
      }

      if (kind === 'ok') {
        this.framesSent++;
      } else if (kind !== 'conflict') {
        // A 409 is the display legitimately belonging to something else, not a
        // transmission that went wrong, so it does not count against the frame
        // statistics the diagnostics panel reports.
        this.framesFailed++;
      }

      this.frameInFlight = false;
      this.checkPendingFrame();
      return kind === 'ok';
    } catch (err) {
      console.error(`[BusyBarDriver] sendPixelFrame failed:`, err);
      this.framesFailed++;
      this.frameInFlight = false;
      this.checkPendingFrame();
      return false;
    }
  }

  /**
   * Performs a device request with a timeout, returning null if it did not
   * complete.
   *
   * Centralised so a new call site cannot forget the timeout, which is how ten
   * of the eighteen ended up without one.
   */
  private async deviceFetch(
    url: string,
    init: RequestInit = {},
    timeoutMs: number = DEVICE_REQUEST_TIMEOUT_MS
  ): Promise<Response | null> {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      this.lastTransportError = null;
      return response;
    } catch (err) {
      // Timeout, abort, DNS, refused connection: from the caller's point of
      // view these are the same event -- no answer from the device -- so the
      // null return stays. What changed is that the *reason* is kept rather
      // than dropped on the floor. Callers report it; a user who exported
      // diagnostics to ask why the bar would not connect used to receive a
      // bundle with no evidence of the failure anywhere in it.
      this.lastTransportError = describeTransportError(err);
      return null;
    }
  }

  /**
   * Logs a device response and says whether the caller should treat it as a
   * failure worth counting.
   */
  private reportDeviceResponse(operation: string, response: Response | null): DeviceResponseKind {
    const kind = classifyDeviceResponse(response);
    switch (kind) {
      case 'ok':
        break;
      case 'conflict':
        // Another application holds the display at a higher priority.
        console.log(`[BusyBarDriver] ${operation}: display owned by a higher priority (409).`);
        break;
      case 'too_large':
        console.error(
          `[BusyBarDriver] ${operation}: device rejected the payload as too large (413). ` +
            'This is a payload construction bug; retrying sends the same bytes.'
        );
        break;
      case 'busy':
        console.warn(`[BusyBarDriver] ${operation}: device busy (503), will retry.`);
        break;
      case 'unreachable':
        console.warn(`[BusyBarDriver] ${operation}: no response from ${this.ipAddress}.`);
        break;
      default:
        console.warn(`[BusyBarDriver] ${operation}: device returned ${response?.status}.`);
    }
    return kind;
  }

  private checkPendingFrame() {
    if (this.pendingFrameArgs) {
      const args = this.pendingFrameArgs;
      this.pendingFrameArgs = null;
      // Fire next frame asynchronously without blocking, with a 35ms network throttle
      setTimeout(() => {
        this.sendPixelFrame(...args).catch(err => {
          console.warn(`[BusyBarDriver] Throttled frame dropped: ${err}`);
        });
      }, BusyBarDriver.NETWORK_THROTTLE_MS);
    }
  }

  /**
   * Posts draw payload to POST /api/display/draw.
   */
  public async sendDisplayPayload(payload: Record<string, unknown>): Promise<boolean> {
    if (!this.isConnected && !this.isMockMode) {
      return false;
    }
    this.displayVersion++;
    this.pendingFrameArgs = null;
    
    const formattedPayload = this.formatHardwarePayload(payload);

    if (this.isMockMode) {
      console.log('[BusyBarDriver] [MOCK DISPLAY DRAW]:', JSON.stringify(formattedPayload));
      return true;
    }

    try {
      const response = await this.deviceFetch(`http://${this.ipAddress}/api/display/draw`, {
        method: 'POST',
        headers: this.getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(formattedPayload)
      });

      return this.reportDeviceResponse('display payload', response) === 'ok';
    } catch (err) {
      console.error(`[BusyBarDriver] Error posting display payload to http://${this.ipAddress}/api/display/draw:`, err);
      return false;
    }
  }

  /**
   * Remote key event injection: POST /api/input?key={key}
   */
  public async injectRemoteKey(key: string): Promise<boolean> {
    const lowerKey = key.toLowerCase();
    if (!(VALID_HARDWARE_KEYS as readonly string[]).includes(lowerKey)) {
      console.warn(`[BusyBarDriver] Unknown hardware key '${key}' injected.`);
    }

    // Always emit local input event for desktop app & matrix display handlers
    this.simulateInputEvent({
      key: lowerKey,
      type: lowerKey === 'rotate_left' ? 'rotate_left' : lowerKey === 'rotate_right' ? 'rotate_right' : 'press',
      timestamp: new Date().toISOString()
    });

    if (this.isMockMode || !this.isConnected) {
      return true;
    }

    try {
      const url = `http://${this.ipAddress}/api/input?key=${encodeURIComponent(lowerKey)}`;
      const res = await this.deviceFetch(url, {
        method: 'POST',
        headers: this.getHeaders()
      });

      // Previously `res ? res.ok : true`, and `true` again from the catch, so a
      // device that never answered was reported as having accepted the key.
      // The local event above was still emitted -- that part did happen -- but
      // callers asking whether the hardware took it were told yes regardless.
      return this.reportDeviceResponse('input injection', res) === 'ok';
    } catch (err) {
      console.warn('[BusyBarDriver] Input injection failed:', err);
      return false;
    }
  }

  /**
   * Controls matrix brightness: POST /api/display/brightness?value={val}
   */
  public async setBrightness(value: number | 'auto'): Promise<boolean> {
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK BRIGHTNESS SET] value=${value}`);
      return true;
    }

    try {
      const url = `http://${this.ipAddress}/api/display/brightness?value=${encodeURIComponent(String(value))}`;
      const res = await this.deviceFetch(url, {
        method: 'POST',
        headers: this.getHeaders()
      });

      return res ? res.ok : false;
    } catch (err) {
      console.error(`[BusyBarDriver] Set brightness failed:`, err);
      return false;
    }
  }

  /**
   * Queries matrix brightness: GET /api/display/brightness
   */
  public async getBrightness(): Promise<BrightnessDTO | null> {
    if (this.isMockMode) {
      return { value: 80, display: 'front' };
    }

    try {
      const res = await this.deviceFetch(`http://${this.ipAddress}/api/display/brightness`, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (res && res.ok) {
        return (await res.json()) as BrightnessDTO;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Configures device audio volume: POST /api/audio/volume?volume={0-100}&silent={0|1}
   * Default silent=1 suppresses hardware volume change chime during updates per user preference.
   */
  public async setAudioVolume(volume: number, silent: boolean = true): Promise<boolean> {
    const clampedVolume = Math.max(0, Math.min(100, volume));
    const silentParam = silent ? 1 : 0;

    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK AUDIO VOLUME] volume=${clampedVolume}, silent=${silentParam}`);
      return true;
    }

    try {
      const url = `http://${this.ipAddress}/api/audio/volume?volume=${clampedVolume}&silent=${silentParam}`;
      const res = await this.deviceFetch(url, {
        method: 'POST',
        headers: this.getHeaders()
      });

      return res ? res.ok : false;
    } catch (err) {
      console.error(`[BusyBarDriver] Set audio volume failed:`, err);
      return false;
    }
  }

  /**
   * Triggers audio playback (.snd): POST /api/audio/play
   */
  public async playAudio(applicationName: string, soundPath: string): Promise<boolean> {
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK AUDIO PLAY] app=${applicationName}, path=${soundPath}`);
      return true;
    }

    try {
      const res = await this.deviceFetch(`http://${this.ipAddress}/api/audio/play`, {
        method: 'POST',
        headers: this.getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ application_name: applicationName, path: soundPath })
      });

      return res ? res.ok : false;
    } catch (err) {
      console.error(`[BusyBarDriver] Play audio failed:`, err);
      return false;
    }
  }

  /**
   * Stops active audio playback: DELETE /api/audio/play
   */
  public async stopAudio(): Promise<boolean> {
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK AUDIO STOP]`);
      return true;
    }

    try {
      const res = await this.deviceFetch(`http://${this.ipAddress}/api/audio/play`, {
        method: 'DELETE',
        headers: this.getHeaders()
      });

      return res ? res.ok : false;
    } catch (err) {
      console.error(`[BusyBarDriver] Stop audio failed:`, err);
      return false;
    }
  }

  /**
   * Synchronizes system RTC clock: POST /api/time/timestamp?timestamp={iso}
   */
  public async syncRtcTime(timestampIso?: string): Promise<boolean> {
    // Local offset, not `Z`. See `toIsoWithLocalOffset`.
    const ts = timestampIso || toIsoWithLocalOffset();

    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK RTC TIME SYNC] timestamp=${ts}`);
      return true;
    }

    try {
      const url = `http://${this.ipAddress}/api/time/timestamp?timestamp=${encodeURIComponent(ts)}`;
      const res = await this.deviceFetch(url, {
        method: 'POST',
        headers: this.getHeaders()
      });

      return res ? res.ok : false;
    } catch (err) {
      console.error(`[BusyBarDriver] RTC sync failed:`, err);
      return false;
    }
  }

  /**
   * Queries access settings: GET /api/access
   */
  public async getAccessSettings(): Promise<AccessSettingsDTO | null> {
    if (this.isMockMode) {
      return { mode: this.apiToken ? 'key' : 'disabled', has_key: Boolean(this.apiToken) };
    }

    try {
      const res = await this.deviceFetch(`http://${this.ipAddress}/api/access`, {
        method: 'GET',
        headers: this.getHeaders()
      });

      if (res && res.ok) {
        return (await res.json()) as AccessSettingsDTO;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Updates API access protection mode & key: POST /api/access?mode={mode}&key={key}
   */
  public async updateAccessSettings(mode: 'disabled' | 'enabled' | 'key', key?: string): Promise<boolean> {
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK ACCESS SETTINGS UPDATE] mode=${mode}, key=${key ? '****' : 'none'}`);
      if (mode === 'key' && key) {
        this.setApiToken(key);
      }
      return true;
    }

    try {
      let url = `http://${this.ipAddress}/api/access?mode=${encodeURIComponent(mode)}`;
      if (key) {
        url += `&key=${encodeURIComponent(key)}`;
      }

      const res = await this.deviceFetch(url, {
        method: 'POST',
        headers: this.getHeaders()
      });

      if (res && res.ok && mode === 'key' && key) {
        this.setApiToken(key);
      }
      return res ? res.ok : false;
    } catch (err) {
      console.error(`[BusyBarDriver] Update access settings failed:`, err);
      return false;
    }
  }

  /**
   * Records a failed ping and logs it without flooding the diagnostics ring.
   *
   * Two lines get written and no others: one when the connection is *lost*
   * (paired with the recovery line, so a reader sees both edges of every
   * outage), and one every `DEVICE_UNREACHABLE_REMINDER_PINGS` failures after
   * that, so a log read hours later still shows the app trying rather than
   * having gone quiet.
   */
  private notePingFailure(wasConnected: boolean, reason: string | null): void {
    this.consecutivePingFailures++;
    const detail = reason ?? 'no answer';

    if (wasConnected) {
      console.warn(
        `[BusyBarDriver] Lost connection to ${this.ipAddress}: ${detail}. Retrying every ${DEVICE_PING_INTERVAL_MS / 1000}s.`
      );
      return;
    }

    if (isUnreachableReminderDue(this.consecutivePingFailures)) {
      const minutes = Math.round((this.consecutivePingFailures * DEVICE_PING_INTERVAL_MS) / 60000);
      console.warn(
        `[BusyBarDriver] Still cannot reach ${this.ipAddress} after ${minutes} minute(s): ${detail}.`
      );
    }
  }

  private startPingLoop(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);

    this.pingTimer = setInterval(() => {
      void (async () => {
        if (this.isMockMode) {
          this.pingMs = Math.floor(Math.random() * 4) + 3;
          this.isConnected = true;
          this.emit('statusChanged', this.getDeviceStatus());
          return;
        }

        const start = Date.now();
        // Hoisted out of the try: the catch below needs it too, and both paths
        // report loss only on the transition.
        const wasConnected = this.isConnected;
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);

          const res = await this.deviceFetch(`http://${this.ipAddress}/api/status`, {
            method: 'GET',
            headers: this.getHeaders(),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          const elapsed = Date.now() - start;
          this.pingMs = Math.max(1, elapsed);

          this.isConnected = res ? res.ok : false;

          if (res && res.ok) {
            const data = await res.json().catch(() => null);
            if (data) {
              this.parseTelemetryData(data);
            }
            if (!wasConnected) {
              console.log(
                `[BusyBarDriver] Connection to ${this.ipAddress} recovered after ${this.consecutivePingFailures} failed ping(s). Restarting StateStream...`
              );
              this.startStateStreamListener();
              this.checkPendingFrame();
            }
            this.consecutivePingFailures = 0;
          } else {
            this.notePingFailure(wasConnected, res ? `HTTP ${res.status}` : this.lastTransportError);
          }
        } catch (err) {
          // Not an empty catch: the driver degrades to disconnected on purpose,
          // but silently doing so is what made an unreachable bar impossible to
          // diagnose from an exported log.
          this.isConnected = false;
          this.notePingFailure(wasConnected, describeTransportError(err));
        }

        this.emit('statusChanged', this.getDeviceStatus());
      })().catch(err => console.error('[BusyBarDriver] Ping loop error:', err));
    }, DEVICE_PING_INTERVAL_MS);
  }

  public disconnect(): void {
    this.isConnected = false;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer);
      this.wsReconnectTimer = null;
    }
    if (this.wsClient) {
      try {
        (this.wsClient as { close?: () => void }).close?.();
      } catch {
        // ignore close errors
      }
      this.wsClient = null;
    }
    // After the close, so any handler still queued from the socket we just
    // closed finds a generation it does not match and does nothing.
    this.wsGeneration++;
    this.emit('statusChanged', this.getDeviceStatus());
  }

  /** The host currently being dialled, so callers can report it without guessing. */
  public getIpAddress(): string {
    return this.ipAddress;
  }

  /**
   * Points the driver at a different device and reconnects in place.
   *
   * Needed because the address is not fixed in practice: over Wi-Fi the bar
   * holds a DHCP lease, and a bar reached through a proxy (the recovery when a
   * host's CDC-NCM driver will not start the interface) answers somewhere else
   * entirely. Restarting the app to change it would be a poor trade when the
   * user is trying addresses to find the one that answers.
   *
   * Tears down before re-pointing, deliberately. Mutating `ipAddress` under a
   * live socket and ping loop leaves both talking to the previous host, and the
   * socket in particular would keep reconnecting there forever; `disconnect()`
   * bumps the generation that makes those handlers inert.
   *
   * Returns whether the *new* target answered. A false here is a real answer --
   * the address was saved and did not respond -- not a failure to apply it.
   */
  public async reconfigure(options: { ipAddress: string; apiToken: string }): Promise<boolean> {
    const nextIp = options.ipAddress.trim();
    if (!nextIp) {
      throw new ArgumentException('ipAddress must not be empty.');
    }

    const unchanged = nextIp === this.ipAddress && options.apiToken === this.apiToken;
    if (unchanged && this.isConnected) return true;

    this.disconnect();
    this.ipAddress = nextIp;
    this.apiToken = options.apiToken;
    // Cleared with the target: a transport error and a failure count describing
    // the previous host would be reported against the new one.
    this.lastTransportError = null;
    this.consecutivePingFailures = 0;

    return this.connect();
  }

  public getIsMockMode(): boolean {
    return this.isMockMode;
  }
}
