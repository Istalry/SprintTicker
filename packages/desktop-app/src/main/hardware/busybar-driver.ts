import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { DeviceStatusDTO, AccessSettingsDTO, BrightnessDTO, ArgumentException, ArgumentNullException } from '../../shared/dtos';
import { DEFAULT_USB_IP, DEVICE_APPLICATION_NAME, FRONT_ELEMENT_IDS, FRONT_LAYER_Z, redactTokenInUrl } from '../../shared/device-constants';
import { sanitizeAsciiText } from '../../shared/text-sanitizer';
import { ClearOutcome, DeviceRequestError, DrawOutcome, FrameOutcome, describeError, isElementAbsent } from './device-errors';
import { DisplayLedger } from './display-ledger';
import { DisplayHealthMonitor } from './display-health';
import { SerialQueue } from './serial-queue';
import { BLANK_ANIMATION_BYTES, BLANK_ANIMATION_FILE } from './blank-animation';

/**
 * What a display request's guard decides at the head of the display queue,
 * just before the request would go out: send it, answer without sending, or
 * wait and ask again.
 */
type DisplayGate<T> = { send: true } | { skip: T } | { waitMs: number };
const SEND = { send: true } as const;

/** No answer at all, so a draw or a clear may or may not have been carried out. */
function gotNoAnswer(err: unknown): boolean {
  return err instanceof DeviceRequestError && err.kind === 'unreachable';
}

export { DeviceRequestError } from './device-errors';
export type { ClearOutcome, DeviceFailureKind, DrawOutcome, FrameOutcome } from './device-errors';

export interface HardwareEvent {
  key: string;
  type: 'press' | 'long_press' | 'rotate_left' | 'rotate_right';
  timestamp: string;
}

export interface BusyBarDriverOptions {
  ipAddress?: string;
  apiToken?: string;
  forceMock?: boolean;
  /** False for no-bar mode: the driver never dials. Defaults to true. */
  enabled?: boolean;
  /** Overrides `ANIMATION_TEARDOWN_SETTLE_MS`; tests pass 0 or step fake timers. */
  animationTeardownSettleMs?: number;
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

/**
 * Pause between the last element leaving the panel and the screen closing, in
 * `clearDisplay` and in any removal that could empty the panel.
 *
 * Releasing the display empties the device's element set, and an empty set
 * closes its screen. Closing on an image and an animation together hung the
 * bar within three or four cycles (2026-09-30). The release that survived 100
 * rounds in a row on firmware 1.2.4 (`pnpm probe:busybar --teardown-soak
 * --park`, 2026-10-07) removes the images, waits this long, and closes on the
 * animations alone. It has not been measured without the wait; re-run that
 * soak before shortening it.
 *
 * What this pause used to follow -- removing the animations by id first -- is
 * itself what hangs the bar, now and then: see `removeDisplayElements`. The
 * 2026-09-30 soak that called this release safe ran ten rounds; the same
 * removal froze the bar on the 30th and the 59th.
 */
export const ANIMATION_TEARDOWN_SETTLE_MS = 500;

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
  /** How many times a clear takes animations down before giving up on closing; see `runClear`. */
  private static readonly CLEAR_ROUNDS = 3;
  private mockHardware: boolean = false;
  /**
   * Whether commands are answered by the mock rather than refused or sent.
   *
   * Not mocked in no-bar mode even under `--mock-hardware`: no bar means no
   * device, real or pretend. Every command branches on this, so reading it
   * here is what keeps a pretend bar from answering for one that was turned
   * off -- found by running the packaged app, where the idle screen still
   * "cleared" a mock bar the user had said they did not have.
   */
  private get isMockMode(): boolean {
    return this.mockHardware && this.enabled;
  }
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
  /**
   * Whether the empty animation is believed stored on the device, so that an
   * animation can be put to rest without uploading it again. Forgotten with
   * the device: a reboot, an asset delete, another address.
   */
  private blankAnimationStored = false;
  /**
   * A request got no answer since the last ping that did. An outage shorter
   * than the ping interval fails requests without any ping seeing it: a
   * scene's upload then fell back to streaming frames for the whole of Lunch,
   * and a clear that failed left its screen up. Found by the stress test.
   */
  private answerLost = false;
  private framesSent: number = 0;
  private framesFailed: number = 0;
  private displayVersion: number = 0;
  /**
   * The highest `displayVersion` a draw has landed under.
   *
   * Lets `clearDisplay` tell a draw that raced it -- a new screen, which must
   * not be wiped -- from a frame that was already on its way before the clear
   * began, which must.
   */
  private latestDrawVersion: number = -1;
  /** What each application is believed to have on the display; see `DisplayLedger`. */
  private readonly ledger = new DisplayLedger();
  /**
   * Every display and asset request, one at a time.
   *
   * Four components draw on the panel -- frames, the animation player, the
   * icon animator, the idle clock's clear -- each with its own ordering and
   * none aware of the others. Requests from all four used to be in flight
   * together, so a guard that read the panel's state could be stale by the
   * time its request landed: a clear checked "nothing drawn since", a scene's
   * draw answered a millisecond later, and the clear's DELETE closed the
   * screen on an image and an animation -- the close that hung the bar on
   * rounds 3 and 4 (found by `display-stress.test.ts`, 2026-10-07). In this
   * queue a guard runs at the head, after every earlier request has answered,
   * so a check and the request it guards are one step.
   *
   * Status, brightness, audio, keys and time stay outside: they do not touch
   * the panel.
   */
  private readonly displayQueue = new SerialQueue();
  /** Clears, one at a time; see `clearDisplay`. */
  private readonly clearQueue = new SerialQueue();
  /** Upload times, screen closes and skipped requests, for the diagnostics bundle; see `DisplayHealthMonitor`. */
  private readonly health = new DisplayHealthMonitor();
  private readonly animationTeardownSettleMs: number;
  private enabled: boolean = true;

  constructor(ipAddressOrOptions: string | BusyBarDriverOptions = DEFAULT_USB_IP, forceMock: boolean = false) {
    super();

    if (typeof ipAddressOrOptions === 'object') {
      this.ipAddress = ipAddressOrOptions.ipAddress || DEFAULT_USB_IP;
      this.apiToken = ipAddressOrOptions.apiToken || '';
      this.mockHardware = ipAddressOrOptions.forceMock || process.argv.includes('--mock-hardware') || process.env.MOCK_HARDWARE === 'true';
      this.animationTeardownSettleMs = ipAddressOrOptions.animationTeardownSettleMs ?? ANIMATION_TEARDOWN_SETTLE_MS;
      this.enabled = ipAddressOrOptions.enabled ?? true;
    } else {
      this.ipAddress = ipAddressOrOptions;
      this.mockHardware = forceMock || process.argv.includes('--mock-hardware') || process.env.MOCK_HARDWARE === 'true';
      this.animationTeardownSettleMs = ANIMATION_TEARDOWN_SETTLE_MS;
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
   *
   * Answers a boolean and does not throw, unlike the commands below. This is a
   * probe, not a command: "the bar is not there" is a normal answer here, the
   * ping loop keeps retrying in the background either way, and nothing a
   * caller could do with an exception would differ from reading the result.
   * `reconfigure` answers the same way for the same reason.
   */
  public async connect(): Promise<boolean> {
    // Before mock mode too: no-bar mode means no device, real or pretend.
    // No ping loop either -- a bar the user said they do not have is not one
    // to keep looking for, and its "still cannot reach" reminders would fill
    // the diagnostics bundle of everyone without the hardware.
    if (!this.enabled) {
      console.log('[BusyBarDriver] No BUSY Bar on this machine (no-bar mode); not connecting.');
      this.isConnected = false;
      this.emit('statusChanged', this.getDeviceStatus());
      return false;
    }

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
    if (!this.enabled || (!this.isConnected && !this.isMockMode)) {
      return {
        enabled: this.enabled,
        connected: false,
        ipAddress: this.ipAddress,
        connectionType: isWifi ? 'wifi' : 'usb',
        frontBrightness: null,
        backBrightness: null,
        batteryPercent: 0,
        firmwareVersion: 'N/A',
        webSocketPingMs: 0,
        framesSent: this.framesSent,
        framesFailed: this.framesFailed,
        displayHealth: this.health.snapshot()
      };
    }

    return {
      enabled: true,
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
      framesFailed: this.framesFailed,
      displayHealth: this.health.snapshot()
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
   * Throws unless the driver is connected (or mocked).
   *
   * A request to a device we know is absent would only time out, two seconds
   * later, with a less useful message.
   */
  private requireConnected(operation: string): void {
    if (!this.isConnected && !this.isMockMode) {
      throw new DeviceRequestError('disconnected', operation, null, `not connected to ${this.ipAddress}`);
    }
  }

  /**
   * Sends one request and throws unless the device carried it out.
   *
   * With `allowConflict`, a `409` comes back as `'conflict'` rather than
   * throwing: for a draw it means another application owns the display, which
   * is the device working as designed. For anything else it is thrown like any
   * other refusal.
   */
  private async deviceRequest(
    operation: string,
    url: string,
    init: RequestInit,
    options: { allowConflict?: boolean; timeoutMs?: number; absentIsExpected?: boolean } = {}
  ): Promise<'ok' | 'conflict'> {
    const response = await this.deviceFetch(url, init, options.timeoutMs);
    const kind = this.reportDeviceResponse(operation, response, options.absentIsExpected);
    if (kind === 'ok') return 'ok';
    if (kind === 'conflict' && options.allowConflict) return 'conflict';
    throw DeviceRequestError.fromResponseKind(kind, operation, response, this.lastTransportError);
  }

  /**
   * Uploads binary asset file to POST /api/assets/upload?application_name={app}&file={filename}
   * Validates filename strictly against regex ^[a-zA-Z0-9._-]+$.
   *
   * @throws ArgumentException for a filename the firmware would reject.
   * @throws DeviceRequestError when the device did not store the file.
   */
  public async uploadAsset(applicationName: string, filename: string, binaryData: Buffer | Uint8Array): Promise<void> {
    const cleanFilename = filename.replace(/^.*[\\/]/, '');
    if (!ASSET_FILENAME_REGEX.test(cleanFilename)) {
      throw new ArgumentException(`Invalid asset filename '${filename}'. Must match ${ASSET_FILENAME_REGEX}.`, 'filename');
    }
    const operation = `asset upload ${cleanFilename}`;
    this.requireConnected(operation);

    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK ASSET UPLOAD] app=${applicationName}, file=${cleanFilename}, bytes=${binaryData.byteLength}`);
      return;
    }

    const url = `http://${this.ipAddress}/api/assets/upload?application_name=${encodeURIComponent(applicationName)}&file=${encodeURIComponent(cleanFilename)}`;
    await this.queued(
      () => {
        if (!this.ledger.isPlaying(applicationName, cleanFilename)) return SEND;
        // The device answers 508 to an upload over an `.anim` an element is
        // playing, and holds the file already. Two starts of one scene in a
        // tick did this, and the second fell back to streaming frames.
        console.log(`[BusyBarDriver] ${operation}: already on the device and playing; not uploading over it.`);
        return { skip: undefined };
      },
      async () => {
        await this.uploadRequest(operation, url, binaryData);
      }
    );
  }

  private async uploadRequest(operation: string, url: string, binaryData: Buffer | Uint8Array): Promise<void> {
    const started = Date.now();
    try {
      await this.uploadRequestUntimed(operation, url, binaryData);
    } finally {
      // Answered or not: a timeout is the slowest upload of all.
      this.health.recordUpload(Date.now() - started);
    }
  }

  private async uploadRequestUntimed(operation: string, url: string, binaryData: Buffer | Uint8Array): Promise<void> {
    await this.deviceRequest(
      operation,
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
      { timeoutMs: DEVICE_UPLOAD_TIMEOUT_MS }
    );
  }

  /**
   * Deletes all asset files for application: DELETE /api/assets/upload?application_name={app}
   *
   * @throws DeviceRequestError when the device did not delete them.
   */
  public async deleteAppAssets(applicationName: string): Promise<void> {
    const operation = `asset delete ${applicationName}`;
    this.requireConnected(operation);
    this.blankAnimationStored = false;

    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK ASSET DELETE] app=${applicationName}`);
      return;
    }

    const url = `http://${this.ipAddress}/api/assets/upload?application_name=${encodeURIComponent(applicationName)}`;
    await this.queued(
      () => SEND,
      async () => {
        await this.deviceRequest(operation, url, { method: 'DELETE', headers: this.getHeaders() });
      }
    );
  }

  /**
   * Removes everything this application drew and releases the display:
   * DELETE /api/display/draw?application_name={app}.
   *
   * The DELETE empties the device's element set, which closes its screen, and
   * on firmware 1.2.4 two ways of doing that hang the bar: closing with an
   * image and an animation both on it (2026-09-30), and removing an animation
   * by id beforehand (2026-10-07, see `removeDisplayElements`). So when an
   * animation is on the panel the images go first, one request per id, the
   * device gets `ANIMATION_TEARDOWN_SETTLE_MS`, and the screen closes on the
   * animations alone -- the release measured safe 100 times in a row. On a
   * panel the driver cannot vouch for, the app's frame is removed whatever
   * the ledger lists, in case a previous run left it beside an animation.
   *
   * Changing screens never needs this -- see `AnimationPlayer`, which switches
   * to and from full-panel scenes without emptying the screen. This is for
   * releasing the display on purpose: the idle clock, and quit.
   *
   * **Clears run one at a time.** Two at once defeat the settle: the first
   * removes the animation and waits, the second finds no animation left to
   * remove, skips the wait, and empties the panel straight away -- the
   * remove-then-close-immediately sequence measured hanging the bar. That is
   * what hung it twice on 2026-10-05, three clears sent in one millisecond by
   * a single Unity compile end. A clear asked for while another runs waits
   * for it, and one that finds the panel known to be empty sends nothing.
   *
   * **The DELETE's guards run at the head of the display queue**: nothing
   * drawn since the clear began, no image listed beside an animation, and the
   * settle elapsed since the last removal -- whoever made it, since a scene
   * put to rest during this wait counts as much as this clear's own removals.
   *
   * @returns `'superseded'` when something was drawn during the teardown, in
   *   which case the display is left to the newer screen and not released.
   * @throws DeviceRequestError when the device did not remove an image or did
   *   not clear. A failed removal stops the clear: closing on an image and an
   *   animation together is the pattern that hangs the bar.
   */
  public async clearDisplay(applicationName: string = DEVICE_APPLICATION_NAME): Promise<ClearOutcome> {
    const operation = 'clear display';
    this.requireConnected(operation);
    // Taken now rather than when its turn comes, so that a frame already on
    // its way is superseded at once and a draw made while this waits counts
    // as newer than the clear.
    const clearVersion = ++this.displayVersion;
    this.pendingFrameArgs = null;

    return this.clearQueue.run(() => this.runClear(applicationName, clearVersion, operation));
  }

  /** The body of {@link clearDisplay}, run once the clears before it are done. */
  private async runClear(applicationName: string, clearVersion: number, operation: string): Promise<ClearOutcome> {
    // Rounds, because an image could in principle be drawn again between the
    // removals and the DELETE; it never closes on an image and an animation.
    // Three is far more than a draw under this clear's version, which
    // supersedes it, leaves.
    for (let round = 0; round < BusyBarDriver.CLEAR_ROUNDS; round++) {
      if (this.latestDrawVersion >= clearVersion) {
        console.log('[BusyBarDriver] Clear abandoned: a newer screen was drawn while it waited its turn.');
        return 'superseded';
      }
      if (this.ledger.isKnownEmpty(applicationName)) return 'cleared';

      // Each removal is abandoned once a newer screen has landed: it would
      // take down that screen's frame or bury its icon.
      const abandonIf = (): boolean => this.latestDrawVersion >= clearVersion;
      if (!this.ledger.isKnown(applicationName)) {
        // A previous run, a crash or an outage may have left the app's frame
        // beside an icon or a scene this driver never listed. The frame goes
        // either way, and the close finds animations alone at worst.
        await this.removeElementIfPresent(applicationName, FRONT_ELEMENT_IDS.FRAME, abandonIf);
      }
      for (const id of this.imagesBesideAnimations(applicationName)) {
        await this.removeElementIfPresent(applicationName, id, abandonIf);
      }

      const outcome = await this.queued<ClearOutcome | 'image listed'>(
        () => {
          if (this.latestDrawVersion >= clearVersion) return { skip: 'superseded' };
          if (this.ledger.isKnownEmpty(applicationName)) return { skip: 'cleared' };
          if (this.imagesBesideAnimations(applicationName).length > 0) return { skip: 'image listed' };
          const waitMs = this.ledger.settleRemainingMs(this.animationTeardownSettleMs);
          return waitMs > 0 ? { waitMs } : SEND;
        },
        async () => {
          if (this.isMockMode) {
            console.log(`[BusyBarDriver] [MOCK CLEAR] app=${applicationName}`);
          } else {
            const url = `http://${this.ipAddress}/api/display/draw?application_name=${encodeURIComponent(applicationName)}`;
            try {
              await this.deviceRequest(operation, url, { method: 'DELETE', headers: this.getHeaders() });
            } catch (err) {
              if (gotNoAnswer(err)) this.ledger.noteClearUncertain(applicationName);
              throw err;
            }
          }
          this.ledger.noteCleared(applicationName);
          this.health.recordScreenClose();
          return 'cleared';
        }
      );
      if (outcome === 'superseded') {
        console.log('[BusyBarDriver] Clear abandoned: a newer screen was drawn while its images came down.');
      }
      if (outcome !== 'image listed') return outcome;
    }
    console.warn('[BusyBarDriver] Clear abandoned: an image kept reappearing beside an animation, and the screen must not close on both.');
    return 'superseded';
  }

  private hasAnimation(applicationName: string): boolean {
    return this.ledger.ids(applicationName, 'animation').length > 0;
  }

  /** The elements that are not animations, when an animation is listed too: what a close must not take down with it. */
  private imagesBesideAnimations(applicationName: string): string[] {
    if (!this.hasAnimation(applicationName)) return [];
    const animations = new Set(this.ledger.ids(applicationName, 'animation'));
    return this.ledger.ids(applicationName).filter(id => !animations.has(id));
  }

  /**
   * Removes one element, reading the device's 400 for a missing id as success.
   * One id per request, because a request naming several is all or nothing.
   *
   * @throws DeviceRequestError for any other failure.
   */
  private async removeElementIfPresent(
    applicationName: string,
    elementId: string,
    abandonIf: () => boolean = () => false
  ): Promise<void> {
    try {
      await this.removeElements(applicationName, [elementId], abandonIf);
    } catch (err) {
      if (isElementAbsent(err)) return;
      throw err;
    }
  }

  /**
   * The ids this application is believed to show, optionally only those of
   * one element type.
   *
   * What the driver has drawn and not yet removed, not what the device
   * reports: there is no endpoint that lists the elements on the display.
   */
  public shownElementIds(applicationName: string, type?: string): string[] {
    return this.ledger.ids(applicationName, type);
  }

  /** Records the elements a draw put on the display, and the version it was sent under. */
  private noteDrawn(applicationName: string, elements: unknown, version: number): void {
    this.latestDrawVersion = Math.max(this.latestDrawVersion, version);
    this.ledger.noteDrawn(applicationName, elements);
  }

  /**
   * Sends one display or asset request through the display queue.
   *
   * `gate` runs at the head of the queue, after every earlier request has
   * answered, and decides from the state as it then is. Waiting happens
   * outside the queue, so a settle does not hold up the frames behind it, and
   * the gate is asked again afterwards: the state may have moved meanwhile.
   * `send` must record what its request changed before it returns, so the
   * next gate sees it.
   */
  private async queued<T>(gate: () => DisplayGate<T>, send: () => Promise<T>): Promise<T> {
    for (;;) {
      this.health.recordQueueLength(this.displayQueue.length + 1);
      const decision = await this.displayQueue.run(async (): Promise<{ value: T } | { waitMs: number }> => {
        const verdict = gate();
        if ('send' in verdict) return { value: await send() };
        if ('skip' in verdict) {
          this.health.recordSkipped();
          return { value: verdict.skip };
        }
        return verdict;
      });
      if ('value' in decision) return decision.value;
      await delay(decision.waitMs);
    }
  }

  /**
   * Renders pixel art matrix PNG to physical display via uploadAsset + single ImageElement draw.
   *
   * Only one frame is ever in flight. A frame requested while another is being
   * sent, or while the device is disconnected, replaces whatever was waiting and
   * is sent next -- so the latest state always lands and nothing floods the
   * device. See `FrameOutcome` for what each answer means.
   *
   * @throws ArgumentException for a filename the firmware would reject.
   * @throws DeviceRequestError when the upload or the draw was refused.
   */
  public async sendPixelFrame(
    pngBuffer: Buffer,
    ledColorHex?: string,
    applicationName: string = DEVICE_APPLICATION_NAME,
    filename: string = 'frame.png',
    priority: number = DEFAULT_DRAW_PRIORITY
  ): Promise<FrameOutcome> {
    if (!this.isConnected && !this.isMockMode) {
      // Sent by the ping loop's recovery path once the device answers again.
      this.pendingFrameArgs = [pngBuffer, ledColorHex, applicationName, filename, priority];
      return 'queued';
    }
    const cleanFilename = filename.replace(/^.*[\\/]/, '');
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK PIXEL FRAME] app=${applicationName}, file=${cleanFilename}, bytes=${pngBuffer.byteLength}, led=${ledColorHex ?? 'none'}`);
      this.noteDrawn(applicationName, [{ id: FRONT_ELEMENT_IDS.FRAME, type: 'image' }], this.displayVersion);
      return 'sent';
    }

    if (this.frameInFlight) {
      // Store the latest requested frame so it gets drawn after the current one finishes.
      // This guarantees we don't drop critical static state changes (like task finishing)
      this.pendingFrameArgs = [pngBuffer, ledColorHex, applicationName, filename, priority];
      return 'queued';
    }

    const currentVersion = this.displayVersion;
    this.frameInFlight = true;
    try {
      try {
        await this.uploadAsset(applicationName, cleanFilename, pngBuffer);
      } catch (err) {
        // A clear that landed mid-upload makes the outcome moot either way.
        if (this.displayVersion !== currentVersion) return 'superseded';
        this.framesFailed++;
        throw err;
      }

      // If a clearDisplay or sendDisplayPayload was called during the asset
      // upload, abort the draw. Checked again at the head of the queue.
      if (this.displayVersion !== currentVersion) {
        return 'superseded';
      }

      const drawPayload: Record<string, unknown> = {
        application_name: applicationName,
        priority,
        elements: [{
          id: FRONT_ELEMENT_IDS.FRAME,
          type: 'image',
          path: cleanFilename,
          x: 0,
          y: 0,
          display: 'front',
          z_index: FRONT_LAYER_Z.FRAME
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

      const drawn = await this.queued<{ kind: DeviceResponseKind; response: Response | null } | 'superseded'>(
        () => (this.displayVersion !== currentVersion ? { skip: 'superseded' } : SEND),
        async () => {
          let response = await this.deviceFetch(drawUrl, drawInit);
          let kind = this.reportDeviceResponse('draw', response);
          // 503 means "ask again", and it is the one status where a retry is
          // both correct and cheap. Once only: a device that is still busy
          // after a throttle interval will be sent the next frame anyway.
          if (kind === 'busy') {
            await delay(BusyBarDriver.NETWORK_THROTTLE_MS);
            response = await this.deviceFetch(drawUrl, drawInit);
            kind = this.reportDeviceResponse('draw retry', response);
          }
          if (kind === 'ok') this.noteDrawn(applicationName, drawPayload.elements, currentVersion);
          else if (response === null) this.ledger.noteDrawUncertain(applicationName, drawPayload.elements);
          return { kind, response };
        }
      );
      if (drawn === 'superseded') return 'superseded';
      const { kind, response: drawResponse } = drawn;

      if (kind === 'ok') {
        this.framesSent++;
        return 'sent';
      }
      if (kind === 'conflict') {
        // A 409 is the display legitimately belonging to something else, not a
        // transmission that went wrong, so it does not count against the frame
        // statistics the diagnostics panel reports.
        return 'conflict';
      }
      this.framesFailed++;
      throw DeviceRequestError.fromResponseKind(kind, 'draw', drawResponse, this.lastTransportError);
    } finally {
      this.frameInFlight = false;
      this.checkPendingFrame();
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
      this.answerLost = true;
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
  private reportDeviceResponse(
    operation: string,
    response: Response | null,
    absentIsExpected: boolean = false
  ): DeviceResponseKind {
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
        if (absentIsExpected && response?.status === 400) {
          // The device's answer for an id it does not hold: already gone,
          // which every caller of a single-id removal reads as success. As a
          // warning it filled the log on every idle transition.
          console.log(`[BusyBarDriver] ${operation}: not on the display (400), already gone.`);
          this.health.recordAlreadyGone();
          break;
        }
        console.warn(`[BusyBarDriver] ${operation}: device returned ${response?.status}.`);
    }
    return kind;
  }

  /**
   * After the bar comes back from an outage, which may have been a reboot:
   * nothing this driver believed about the panel or the stored assets holds,
   * and the frame left pending is a screen from before the outage. Replaying
   * it put BUILDING 40% back on a bar whose build had long finished, the
   * clear that followed having failed while the bar was away (2026-10-07).
   * The renderer, told by `reconnected`, redraws what is current instead.
   */
  private forgetDevice(): void {
    this.answerLost = false;
    this.ledger.forgetAll();
    this.blankAnimationStored = false;
    this.pendingFrameArgs = null;
    this.emit('reconnected');
  }

  private checkPendingFrame() {
    if (this.pendingFrameArgs) {
      const args = this.pendingFrameArgs;
      this.pendingFrameArgs = null;
      // Fire next frame asynchronously without blocking, with a 35ms network throttle
      setTimeout(() => {
        // Nobody awaits a deferred frame, so this is where its failure is
        // reported. The next render sends a fresh one anyway.
        this.sendPixelFrame(...args).catch(err => {
          console.warn(`[BusyBarDriver] Throttled frame dropped: ${err}`);
        });
      }, BusyBarDriver.NETWORK_THROTTLE_MS);
    }
  }

  /**
   * Posts draw payload to POST /api/display/draw.
   *
   * @returns `'conflict'` when another application owns the display (409).
   * @throws DeviceRequestError when the device refused the draw.
   */
  public async sendDisplayPayload(payload: Record<string, unknown>): Promise<DrawOutcome> {
    const operation = 'display payload';
    this.requireConnected(operation);
    const version = ++this.displayVersion;
    this.pendingFrameArgs = null;

    const formattedPayload = this.formatHardwarePayload(payload);
    const applicationName = String(formattedPayload.application_name ?? DEVICE_APPLICATION_NAME);

    if (this.isMockMode) {
      console.log('[BusyBarDriver] [MOCK DISPLAY DRAW]:', JSON.stringify(formattedPayload));
      this.noteDrawn(applicationName, formattedPayload.elements, version);
      return 'drawn';
    }

    return this.queuedDraw(operation, applicationName, formattedPayload, version);
  }

  /** The request half of `sendDisplayPayload` and `drawOverlay`. */
  private async queuedDraw(
    operation: string,
    applicationName: string,
    formattedPayload: Record<string, unknown>,
    version: number
  ): Promise<DrawOutcome> {
    return this.queued<DrawOutcome>(
      () => SEND,
      async () => {
        let result: 'ok' | 'conflict';
        try {
          result = await this.deviceRequest(
            operation,
            `http://${this.ipAddress}/api/display/draw`,
            {
              method: 'POST',
              headers: this.getHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(formattedPayload)
            },
            { allowConflict: true }
          );
        } catch (err) {
          if (gotNoAnswer(err)) this.ledger.noteDrawUncertain(applicationName, formattedPayload.elements);
          throw err;
        }
        if (result === 'conflict') return 'conflict';
        this.noteDrawn(applicationName, formattedPayload.elements, version);
        return 'drawn';
      }
    );
  }

  /**
   * Draws elements over whatever is on the front panel, leaving it in place.
   *
   * Unlike `sendDisplayPayload`, this does not supersede a frame in flight.
   * That method bumps `displayVersion`, which makes a `sendPixelFrame` whose
   * upload is still running abandon its draw -- right for a payload that
   * replaces the screen, wrong for an animated icon laid over it, where the
   * frame underneath is the very thing the icon belongs to. A draw merges by
   * element id, so the frame stays.
   *
   * @returns `'conflict'` when another application owns the display (409).
   * @throws DeviceRequestError when the device refused the draw.
   */
  public async drawOverlay(
    applicationName: string,
    elements: Array<Record<string, unknown>>,
    priority: number = DEFAULT_DRAW_PRIORITY
  ): Promise<DrawOutcome> {
    if (!elements || elements.length === 0) throw new ArgumentNullException('elements');
    const operation = 'overlay draw';
    this.requireConnected(operation);
    const version = this.displayVersion;

    const formattedPayload = this.formatHardwarePayload({ application_name: applicationName, priority, elements });

    if (this.isMockMode) {
      console.log('[BusyBarDriver] [MOCK OVERLAY DRAW]:', JSON.stringify(formattedPayload));
      this.noteDrawn(applicationName, formattedPayload.elements, version);
      return 'drawn';
    }

    return this.queuedDraw(operation, applicationName, formattedPayload, version);
  }

  /**
   * Removes named elements and nothing else: DELETE /api/display/draw with
   * `element_ids` in the body.
   *
   * `clearDisplay` removes everything the application drew, which would take
   * the screen down with an icon. Measured on firmware 1.2.4: this removes only
   * the named element and the frame beside it stays. An element that is not
   * there answers **400**, not 404 -- so a caller removing something that may
   * already be gone has to read a `rejected` error as "already gone".
   *
   * **All or nothing.** The firmware checks every id before removing any
   * (`canvas_element_destroy_multi`), so one missing id fails the whole request
   * with 400 and removes *nothing* -- the ids that were there stay. Pass one id
   * per call wherever an id may already be gone.
   *
   * **An animation is never removed: it is put to rest.** On firmware 1.2.4,
   * removing a playing animation by id hangs the bar now and then -- the probe
   * froze it on the 30th and the 59th removal of the gear icon, the app on the
   * 13th, with uploads flat at 23 ms right up to it, so nothing warns
   * (2026-10-07). Drawing another animation under the same id survived 200
   * swaps. So an id the ledger lists as an animation -- or the app's icon or
   * scene id on a panel it cannot vouch for -- is redrawn with the empty
   * animation (`blank-animation.ts`), which shows nothing and leaves only when
   * the screen closes. The caller sees it gone either way.
   *
   * Removing the last element closes the device's screen exactly as
   * `clearDisplay` does; see there for why that matters. So a removal that
   * could empty the panel waits, like the clear, for the settle after the
   * last removal.
   *
   * **A single id known to be absent resolves without a request** -- the
   * driver has seen the panel emptied and the element not drawn since. Every
   * caller read the device's 400 for it as "already gone" anyway.
   *
   * @throws DeviceRequestError when the device did not remove them.
   */
  public async removeDisplayElements(applicationName: string, elementIds: string[]): Promise<void> {
    if (!elementIds || elementIds.length === 0) throw new ArgumentNullException('elementIds');
    this.requireConnected(`remove ${elementIds.join(', ')}`);

    const animations = elementIds.filter(id => this.isAnimationElement(applicationName, id));
    for (const id of animations) await this.parkAnimation(applicationName, id);
    const others = elementIds.filter(id => !animations.includes(id));
    if (others.length > 0) await this.removeElements(applicationName, others);
  }

  /**
   * Whether `elementId` is, or may be, an animation. Listed as one; or, on a
   * panel the driver cannot vouch for, the app's own icon or scene id.
   */
  private isAnimationElement(applicationName: string, elementId: string): boolean {
    const listed = this.ledger.element(applicationName, elementId);
    if (listed) return listed.type === 'animation';
    return (
      !this.ledger.isKnown(applicationName) &&
      (elementId === FRONT_ELEMENT_IDS.ICON || elementId === FRONT_ELEMENT_IDS.SCENE)
    );
  }

  /**
   * Replaces an animation with the empty one, under the same id: the merge by
   * id measured safe, where a removal hangs the bar now and then. Nothing to
   * do for an element known to be absent, or already at rest.
   *
   * @throws DeviceRequestError when the device refused the empty animation's
   *   upload or draw; the animation then stays as it was.
   */
  private async parkAnimation(
    applicationName: string,
    elementId: string,
    abandonIf: () => boolean = () => false
  ): Promise<void> {
    const operation = `put ${elementId} to rest`;
    // At rest only for certain: after a draw that got no answer the element
    // may still be playing what it played before.
    const atRest = (): boolean => {
      if (this.ledger.isKnownAbsent(applicationName, elementId)) return true;
      const element = this.ledger.element(applicationName, elementId);
      return element?.path === BLANK_ANIMATION_FILE && !element.maybePaths?.length;
    };
    if (atRest()) return;

    if (!this.blankAnimationStored) {
      // Skipped by the upload's own guard when an element already plays it.
      await this.uploadAsset(applicationName, BLANK_ANIMATION_FILE, BLANK_ANIMATION_BYTES);
      this.blankAnimationStored = true;
    }
    const zIndex = this.ledger.element(applicationName, elementId)?.zIndex ?? FRONT_LAYER_Z.ICON;
    const payload = this.formatHardwarePayload({
      application_name: applicationName,
      priority: DEFAULT_DRAW_PRIORITY,
      elements: [
        {
          id: elementId,
          type: 'animation',
          path: BLANK_ANIMATION_FILE,
          x: 0,
          y: 0,
          display: 'front',
          loop: true,
          section: 'default',
          z_index: zIndex
        }
      ]
    });

    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK PARK] app=${applicationName}, id=${elementId}`);
      this.ledger.noteParked(applicationName, elementId, BLANK_ANIMATION_FILE);
      return;
    }

    await this.queued<void>(
      () => (atRest() || abandonIf() ? { skip: undefined } : SEND),
      async () => {
        let result: 'ok' | 'conflict';
        try {
          result = await this.deviceRequest(
            operation,
            `http://${this.ipAddress}/api/display/draw`,
            {
              method: 'POST',
              headers: this.getHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(payload)
            },
            { allowConflict: true }
          );
        } catch (err) {
          if (gotNoAnswer(err)) this.ledger.noteDrawUncertain(applicationName, payload.elements);
          throw err;
        }
        if (result === 'conflict') {
          // Another application holds the display, and so the panel this
          // element is on. Left as it is: it goes when that screen closes.
          console.log(`[BusyBarDriver] ${operation}: the display is held at a higher priority; left as it is.`);
          return;
        }
        this.ledger.noteParked(applicationName, elementId, BLANK_ANIMATION_FILE);
      }
    );
  }

  /**
   * The removal request proper, for elements that are not animations.
   * `abandonIf` is asked at the head of the queue; true sends nothing.
   */
  private async removeElements(
    applicationName: string,
    elementIds: string[],
    abandonIf: () => boolean = () => false
  ): Promise<void> {
    const operation = `remove ${elementIds.join(', ')}`;

    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK REMOVE] app=${applicationName}, ids=${elementIds.join(',')}`);
      this.ledger.noteRemoved(applicationName, elementIds);
      return;
    }

    let couldEmpty = false;
    await this.queued<void>(
      () => {
        if (abandonIf()) return { skip: undefined };
        if (elementIds.length === 1 && this.ledger.isKnownAbsent(applicationName, elementIds[0])) return { skip: undefined };
        couldEmpty = this.ledger.couldEmpty(applicationName, elementIds);
        const waitMs = couldEmpty ? this.ledger.settleRemainingMs(this.animationTeardownSettleMs) : 0;
        return waitMs > 0 ? { waitMs } : SEND;
      },
      async () => {
        try {
          await this.deviceRequest(
            operation,
            `http://${this.ipAddress}/api/display/draw`,
            {
              method: 'DELETE',
              headers: this.getHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ application_name: applicationName, element_ids: elementIds })
            },
            // Only for one id: on several, a 400 means one of them was missing
            // and none were removed, which is not "already gone".
            { absentIsExpected: elementIds.length === 1 }
          );
        } catch (err) {
          // A 400 on a single id is the device saying it does not hold it. On
          // several ids it says only that one of them is missing, and that
          // nothing was removed, so the others stay listed.
          if (elementIds.length === 1 && isElementAbsent(err)) {
            this.ledger.noteRemoved(applicationName, elementIds);
          }
          throw err;
        }
        this.ledger.noteRemoved(applicationName, elementIds, true);
        // Counted when nothing listed is left. On a panel the ledger cannot
        // vouch for the screen may have stayed open; a close counted that did
        // not happen is the safer error in a figure read for hang risk.
        if (couldEmpty) this.health.recordScreenClose();
      }
    );
  }

  /**
   * Remote key event injection: POST /api/input?key={key}
   *
   * The local input event is emitted first and always: the app's own handlers
   * react to the key whether or not a device is attached. Only the forwarding
   * to the device can fail, and while disconnected it is skipped rather than
   * reported, since there is no device for the key to reach.
   *
   * @throws DeviceRequestError when a connected device refused the key.
   */
  public async injectRemoteKey(key: string): Promise<void> {
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
      return;
    }

    // Previously `res ? res.ok : true`, and `true` again from a catch, so a
    // device that never answered was reported as having accepted the key.
    const url = `http://${this.ipAddress}/api/input?key=${encodeURIComponent(lowerKey)}`;
    await this.deviceRequest('input injection', url, { method: 'POST', headers: this.getHeaders() });
  }

  /**
   * Controls matrix brightness: POST /api/display/brightness?value={val}
   *
   * @throws DeviceRequestError when the device did not apply it.
   */
  public async setBrightness(value: number | 'auto'): Promise<void> {
    const operation = 'set brightness';
    this.requireConnected(operation);
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK BRIGHTNESS SET] value=${value}`);
      return;
    }

    const url = `http://${this.ipAddress}/api/display/brightness?value=${encodeURIComponent(String(value))}`;
    await this.deviceRequest(operation, url, { method: 'POST', headers: this.getHeaders() });
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
   *
   * @throws DeviceRequestError when the device did not apply it.
   */
  public async setAudioVolume(volume: number, silent: boolean = true): Promise<void> {
    const operation = 'set audio volume';
    this.requireConnected(operation);
    const clampedVolume = Math.max(0, Math.min(100, volume));
    const silentParam = silent ? 1 : 0;

    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK AUDIO VOLUME] volume=${clampedVolume}, silent=${silentParam}`);
      return;
    }

    const url = `http://${this.ipAddress}/api/audio/volume?volume=${clampedVolume}&silent=${silentParam}`;
    await this.deviceRequest(operation, url, { method: 'POST', headers: this.getHeaders() });
  }

  /**
   * Triggers audio playback (.snd): POST /api/audio/play
   *
   * @throws DeviceRequestError when the device did not start playback.
   */
  public async playAudio(applicationName: string, soundPath: string): Promise<void> {
    const operation = 'play audio';
    this.requireConnected(operation);
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK AUDIO PLAY] app=${applicationName}, path=${soundPath}`);
      return;
    }

    await this.deviceRequest(operation, `http://${this.ipAddress}/api/audio/play`, {
      method: 'POST',
      headers: this.getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ application_name: applicationName, path: soundPath })
    });
  }

  /**
   * Stops active audio playback: DELETE /api/audio/play
   *
   * @throws DeviceRequestError when the device did not stop playback.
   */
  public async stopAudio(): Promise<void> {
    const operation = 'stop audio';
    this.requireConnected(operation);
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK AUDIO STOP]`);
      return;
    }

    await this.deviceRequest(operation, `http://${this.ipAddress}/api/audio/play`, {
      method: 'DELETE',
      headers: this.getHeaders()
    });
  }

  /**
   * Synchronizes system RTC clock: POST /api/time/timestamp?timestamp={iso}
   *
   * @throws DeviceRequestError when the device did not set its clock.
   */
  public async syncRtcTime(timestampIso?: string): Promise<void> {
    const operation = 'RTC sync';
    this.requireConnected(operation);
    // Local offset, not `Z`. See `toIsoWithLocalOffset`.
    const ts = timestampIso || toIsoWithLocalOffset();

    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK RTC TIME SYNC] timestamp=${ts}`);
      return;
    }

    const url = `http://${this.ipAddress}/api/time/timestamp?timestamp=${encodeURIComponent(ts)}`;
    await this.deviceRequest(operation, url, { method: 'POST', headers: this.getHeaders() });
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
   *
   * @throws DeviceRequestError when the device did not apply it.
   */
  public async updateAccessSettings(mode: 'disabled' | 'enabled' | 'key', key?: string): Promise<void> {
    const operation = 'update access settings';
    this.requireConnected(operation);
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK ACCESS SETTINGS UPDATE] mode=${mode}, key=${key ? '****' : 'none'}`);
      if (mode === 'key' && key) {
        this.setApiToken(key);
      }
      return;
    }

    let url = `http://${this.ipAddress}/api/access?mode=${encodeURIComponent(mode)}`;
    if (key) {
      url += `&key=${encodeURIComponent(key)}`;
    }

    // Throws before the token is adopted: switching to a key the device never
    // accepted would lock this driver out of a bar that still has the old one.
    await this.deviceRequest(operation, url, { method: 'POST', headers: this.getHeaders() });
    if (mode === 'key' && key) {
      this.setApiToken(key);
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
              this.forgetDevice();
            } else if (this.answerLost) {
              console.log(`[BusyBarDriver] ${this.ipAddress} answers again after requests that got no answer; redrawing.`);
              this.forgetDevice();
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
    // Another address may be another bar, with a screen of its own.
    this.ledger.forgetAll();
    this.blankAnimationStored = false;

    return this.connect();
  }

  public getIsMockMode(): boolean {
    return this.isMockMode;
  }

  /** False in no-bar mode. */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Turns no-bar mode off or on, in place.
   *
   * Off hands the display back first, then disconnects -- ping loop, socket
   * and all -- and `connect()` then declines to dial. Disconnecting alone left
   * the last frame on the bar for good, with nothing left that would ever
   * clear it. `clearDisplay` is the safe release: the frame removed, the
   * settle wait, then the close. On dials the configured address and says
   * `reconnected`, so the renderer draws the current screen rather than
   * nothing until the picture next changes -- its deduplication recorded the
   * last frame as sent the moment the driver queued it. The queued frame is
   * not replayed: a clear asked for while the bar was off is lost, and the
   * frame would put back a screen that clear had ended.
   *
   * Answers whether the bar is connected afterwards, like `connect()`.
   */
  public async setEnabled(enabled: boolean): Promise<boolean> {
    if (enabled === this.enabled) return this.isConnected;

    if (!enabled) {
      if (this.isConnected || this.isMockMode) {
        try {
          await this.clearDisplay(DEVICE_APPLICATION_NAME);
        } catch (err) {
          // The bar may already be gone; turning it off must not depend on it.
          console.warn(`[BusyBarDriver] Could not hand the display back before turning the bar off: ${describeError(err)}`);
        }
      }
      this.enabled = false;
      this.disconnect();
      console.log('[BusyBarDriver] BUSY Bar turned off (no-bar mode).');
      return false;
    }

    this.enabled = true;
    console.log('[BusyBarDriver] BUSY Bar turned on.');
    const connected = await this.connect();
    if (connected) this.forgetDevice();
    return connected;
  }
}
