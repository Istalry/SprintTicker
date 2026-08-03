import { EventEmitter } from 'events';
import { DeviceStatusDTO, AccessSettingsDTO, BrightnessDTO } from '../../shared/dtos';

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

export const DEFAULT_USB_IP = '10.0.4.20';
export const DEFAULT_DRAW_PRIORITY = 95;
export const ASSET_FILENAME_REGEX = /^[a-zA-Z0-9._-]+$/;
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
  'settings'
] as const;

/**
 * Sanitizes input string to printable ASCII characters (0x20-0x7E) to ensure
 * compatibility with BUSY Bar display fonts and prevent firmware rendering glitches.
 */
export function sanitizeAsciiText(input: string): string {
  if (!input) return '';
  return input
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u2014/g, '--')
    .replace(/\u2013/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E]/g, '');
}

/**
 * Driver managing connection, telemetry, input event streams, and REST API commands
 * for physical BUSY Bar hardware (72×16 matrix) per OpenAPI v25 and Developer Guide specs.
 */
export class BusyBarDriver extends EventEmitter {
  private isMockMode: boolean = false;
  private isConnected: boolean = false;
  private ipAddress: string = DEFAULT_USB_IP;
  private apiToken: string = '';
  private pingMs: number = 4;
  private batteryPercent: number = 98;
  private firmwareVersion: string = '1.4.2';
  private wsClient: unknown = null;
  private wsReconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;

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
  private parseTelemetryData(data: Record<string, any>): void {
    if (!data || typeof data !== 'object') return;

    const rawBattery = data.power?.battery_charge ?? data.battery_charge ?? data.battery_level ?? data.batteryPercent;
    if (rawBattery !== undefined && rawBattery !== null) {
      const parsedNum = Number(rawBattery);
      if (!isNaN(parsedNum)) {
        this.batteryPercent = parsedNum;
      }
    }

    const rawFirmware = data.firmware?.version ?? data.version ?? data.firmware_version ?? data.firmwareVersion;
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

      let response = await fetch(`http://${this.ipAddress}/api/status`, {
        method: 'GET',
        headers: this.getHeaders()
      }).catch(() => null);

      if (!response || !response.ok) {
        response = await fetch(`http://${this.ipAddress}/api/status/power`, {
          method: 'GET',
          headers: this.getHeaders()
        }).catch(() => null);
      }

      if (response && response.ok) {
        this.isConnected = true;
        const data = await response.json().catch(() => null);
        if (data) {
          this.parseTelemetryData(data);
        }
        if (this.firmwareVersion === '1.4.2') {
          const fwRes = await fetch(`http://${this.ipAddress}/api/status/firmware`, {
            method: 'GET',
            headers: this.getHeaders()
          }).catch(() => null);
          if (fwRes && fwRes.ok) {
            const fwData = await fwRes.json().catch(() => null);
            if (fwData) this.parseTelemetryData(fwData);
          }
        }
        this.startStateStreamListener();
      } else {
        this.isConnected = true;
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

    try {
      let wsUrl = `ws://${this.ipAddress}/api/status/ws`;
      if (this.apiToken) {
        wsUrl += `?x-api-token=${encodeURIComponent(this.apiToken)}`;
      }

      console.log(`[BusyBarDriver] Starting WebSocket StateStream listener on ${wsUrl}`);
      const WsCtor = (globalThis as any).WebSocket;
      if (typeof WsCtor !== 'function') {
        return;
      }

      const ws = new WsCtor(wsUrl);
      this.wsClient = ws;

      ws.onopen = () => {
        console.log('[BusyBarDriver] WebSocket connected. Sending handshake { enable: true }');
        try {
          ws.send(JSON.stringify({ enable: true }));
        } catch (err) {
          console.warn('[BusyBarDriver] WebSocket handshake send failed:', err);
        }
      };

      ws.onmessage = (event: { data: unknown }) => {
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data);
            const key = data.key || data.input || data.button || (data.input_event && data.input_event.key);
            if (key) {
              const actionType = data.type || data.action || 'press';
              this.emit('input', {
                key: String(key).toLowerCase(),
                type: actionType,
                timestamp: new Date().toISOString()
              });
            }
          } catch {
            // Ignore malformed JSON packets
          }
        }
      };

      ws.onerror = (err: unknown) => {
        console.warn('[BusyBarDriver] WebSocket error:', err);
      };

      ws.onclose = () => {
        console.log('[BusyBarDriver] WebSocket closed. Scheduling reconnection in 3s...');
        this.wsClient = null;
        if (!this.wsReconnectTimer) {
          this.wsReconnectTimer = setTimeout(() => {
            this.wsReconnectTimer = null;
            if (this.isConnected && !this.isMockMode) {
              this.startStateStreamListener();
            }
          }, 3000);
        }
      };
    } catch (err) {
      console.warn('[BusyBarDriver] StateStream WebSocket connection failed:', err);
    }
  }

  public getDeviceStatus(): DeviceStatusDTO {
    const isWifi = this.ipAddress !== DEFAULT_USB_IP;
    if (!this.isConnected && !this.isMockMode) {
      return {
        connected: false,
        ipAddress: this.ipAddress,
        connectionType: isWifi ? 'wifi' : 'usb',
        frontBrightness: 0,
        backBrightness: 0,
        batteryPercent: 0,
        firmwareVersion: 'N/A',
        webSocketPingMs: 0
      };
    }

    return {
      connected: this.isConnected,
      ipAddress: this.ipAddress,
      connectionType: isWifi ? 'wifi' : 'usb',
      frontBrightness: 80,
      backBrightness: 100,
      batteryPercent: this.batteryPercent,
      firmwareVersion: this.isMockMode ? `${this.firmwareVersion}-mock` : this.firmwareVersion,
      webSocketPingMs: this.pingMs
    };
  }

  public simulateInputEvent(event: HardwareEvent): void {
    if (!this.isConnected) return;
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

      if (elem.type === 'image') {
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
      application_name: (payload.application_name as string) || 'busybar_desktop',
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
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders({ 'Content-Type': 'application/octet-stream' }),
        body: binaryData
      }).catch(() => null);

      return response ? response.ok : false;
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
      const response = await fetch(url, {
        method: 'DELETE',
        headers: this.getHeaders()
      }).catch(() => null);

      return response ? response.ok : false;
    } catch (err) {
      console.error(`[BusyBarDriver] Asset delete failed for ${applicationName}:`, err);
      return false;
    }
  }

  /**
   * Clears display elements for application: DELETE /api/display/draw?application_name={app}
   */
  public async clearDisplay(applicationName: string = 'busybar_desktop'): Promise<boolean> {
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK CLEAR] app=${applicationName}`);
      return true;
    }

    try {
      const url = `http://${this.ipAddress}/api/display/draw?application_name=${encodeURIComponent(applicationName)}`;
      const response = await fetch(url, {
        method: 'DELETE',
        headers: this.getHeaders()
      }).catch(() => null);
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
    applicationName: string = 'busybar_desktop',
    filename: string = 'frame.png',
    priority: number = DEFAULT_DRAW_PRIORITY
  ): Promise<boolean> {
    const cleanFilename = filename.replace(/^.*[\\/]/, '');
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK PIXEL FRAME] app=${applicationName}, file=${cleanFilename}, bytes=${pngBuffer.byteLength}, led=${ledColorHex ?? 'none'}`);
      return true;
    }

    try {
      await this.clearDisplay(applicationName);

      const uploadOk = await this.uploadAsset(applicationName, cleanFilename, pngBuffer);
      if (!uploadOk) {
        console.warn(`[BusyBarDriver] PNG asset upload failed for ${cleanFilename}, skipping draw.`);
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

      const drawResponse = await fetch(`http://${this.ipAddress}/api/display/draw`, {
        method: 'POST',
        headers: this.getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(drawPayload)
      }).catch(() => null);

      return drawResponse ? drawResponse.ok : false;
    } catch (err) {
      console.error(`[BusyBarDriver] sendPixelFrame failed:`, err);
      return false;
    }
  }

  /**
   * Posts draw payload to POST /api/display/draw.
   */
  public async sendDisplayPayload(payload: Record<string, unknown>): Promise<boolean> {
    const formattedPayload = this.formatHardwarePayload(payload);

    if (this.isMockMode) {
      console.log('[BusyBarDriver] [MOCK DISPLAY DRAW]:', JSON.stringify(formattedPayload));
      return true;
    }

    try {
      const response = await fetch(`http://${this.ipAddress}/api/display/draw`, {
        method: 'POST',
        headers: this.getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(formattedPayload)
      }).catch(() => null);

      return response ? response.ok : false;
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
    if (!VALID_HARDWARE_KEYS.includes(lowerKey as any)) {
      console.warn(`[BusyBarDriver] Unknown hardware key '${key}' injected.`);
    }

    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK REMOTE KEY INJECTION] key=${lowerKey}`);
      this.simulateInputEvent({
        key: lowerKey,
        type: 'press',
        timestamp: new Date().toISOString()
      });
      return true;
    }

    try {
      const url = `http://${this.ipAddress}/api/input?key=${encodeURIComponent(lowerKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders()
      }).catch(() => null);

      return res ? res.ok : false;
    } catch (err) {
      console.error(`[BusyBarDriver] Remote key injection failed for '${key}':`, err);
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
      const res = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders()
      }).catch(() => null);

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
      const res = await fetch(`http://${this.ipAddress}/api/display/brightness`, {
        method: 'GET',
        headers: this.getHeaders()
      }).catch(() => null);

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
      const res = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders()
      }).catch(() => null);

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
      const res = await fetch(`http://${this.ipAddress}/api/audio/play`, {
        method: 'POST',
        headers: this.getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ application_name: applicationName, path: soundPath })
      }).catch(() => null);

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
      const res = await fetch(`http://${this.ipAddress}/api/audio/play`, {
        method: 'DELETE',
        headers: this.getHeaders()
      }).catch(() => null);

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
    const ts = timestampIso || new Date().toISOString();

    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK RTC TIME SYNC] timestamp=${ts}`);
      return true;
    }

    try {
      const url = `http://${this.ipAddress}/api/time/timestamp?timestamp=${encodeURIComponent(ts)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders()
      }).catch(() => null);

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
      const res = await fetch(`http://${this.ipAddress}/api/access`, {
        method: 'GET',
        headers: this.getHeaders()
      }).catch(() => null);

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

      const res = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders()
      }).catch(() => null);

      if (res && res.ok && mode === 'key' && key) {
        this.setApiToken(key);
      }
      return res ? res.ok : false;
    } catch (err) {
      console.error(`[BusyBarDriver] Update access settings failed:`, err);
      return false;
    }
  }

  private startPingLoop(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);

    this.pingTimer = setInterval(async () => {
      if (this.isMockMode) {
        this.pingMs = Math.floor(Math.random() * 4) + 3;
        this.isConnected = true;
        this.emit('statusChanged', this.getDeviceStatus());
        return;
      }

      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const res = await fetch(`http://${this.ipAddress}/api/status`, {
          method: 'GET',
          headers: this.getHeaders(),
          signal: controller.signal
        }).catch(() => null);

        clearTimeout(timeoutId);

        const elapsed = Date.now() - start;
        this.pingMs = Math.max(1, elapsed);
        this.isConnected = res ? res.ok : false;

        if (res && res.ok) {
          const data = await res.json().catch(() => null);
          if (data) {
            this.parseTelemetryData(data);
          }
        }
      } catch {
        this.isConnected = false;
      }

      this.emit('statusChanged', this.getDeviceStatus());
    }, 3000);
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
    this.emit('statusChanged', this.getDeviceStatus());
  }

  public getIsMockMode(): boolean {
    return this.isMockMode;
  }
}
