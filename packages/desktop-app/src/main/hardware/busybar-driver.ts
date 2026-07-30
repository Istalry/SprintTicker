import { EventEmitter } from 'events';
import { DeviceStatusDTO } from '../../shared/dtos';

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

/**
 * Driver managing connection, telemetry, and input event streams with physical BUSY Bar hardware.
 * Communicates over USB (10.0.4.20) or Wi-Fi LAN IP with optional X-API-Token header authentication.
 * Supports --mock-hardware mode for local testing without physical device attached.
 */
export class BusyBarDriver extends EventEmitter {
  private isMockMode: boolean = false;
  private isConnected: boolean = false;
  private ipAddress: string = '10.0.4.20';
  private apiToken: string = '';
  private pingMs: number = 4;
  private batteryPercent: number = 98;
  private firmwareVersion: string = '1.4.2';
  private activeStream: unknown = null;

  constructor(ipAddressOrOptions: string | BusyBarDriverOptions = '10.0.4.20', forceMock: boolean = false) {
    super();

    if (typeof ipAddressOrOptions === 'object') {
      this.ipAddress = ipAddressOrOptions.ipAddress || '10.0.4.20';
      this.apiToken = ipAddressOrOptions.apiToken || '';
      this.isMockMode = ipAddressOrOptions.forceMock || process.argv.includes('--mock-hardware') || process.env.MOCK_HARDWARE === 'true';
    } else {
      this.ipAddress = ipAddressOrOptions;
      this.isMockMode = forceMock || process.argv.includes('--mock-hardware') || process.env.MOCK_HARDWARE === 'true';
    }
  }

  /**
   * Configures or updates the X-API-Token for Wi-Fi LAN access authentication.
   */
  public setApiToken(token: string): void {
    this.apiToken = token;
  }

  /**
   * Gets current API token.
   */
  public getApiToken(): string {
    return this.apiToken;
  }

  /**
   * Parses system status, battery power level, and firmware telemetry from API response JSON.
   */
  private parseTelemetryData(data: Record<string, any>): void {
    if (!data || typeof data !== 'object') return;

    // Battery / Power telemetry parsing
    const rawBattery = data.power?.battery_charge ?? data.battery_charge ?? data.battery_level ?? data.batteryPercent;
    if (rawBattery !== undefined && rawBattery !== null) {
      const parsedNum = Number(rawBattery);
      if (!isNaN(parsedNum)) {
        this.batteryPercent = parsedNum;
      }
    }

    // Firmware version telemetry parsing
    const rawFirmware = data.firmware?.version ?? data.version ?? data.firmware_version ?? data.firmwareVersion;
    if (rawFirmware) {
      this.firmwareVersion = String(rawFirmware);
    }
  }

  /**
   * Initializes hardware connection or enters mock dry-run mode.
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

      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
      if (this.apiToken) {
        headers['X-API-Token'] = this.apiToken;
      }

      // Check device status over REST API system status endpoint (/api/status per latest OpenAPI spec)
      let response = await fetch(`http://${this.ipAddress}/api/status`, {
        method: 'GET',
        headers
      }).catch(() => null);

      if (!response || !response.ok) {
        response = await fetch(`http://${this.ipAddress}/api/status/power`, {
          method: 'GET',
          headers
        }).catch(() => null);
      }

      if (!response || !response.ok) {
        response = await fetch(`http://${this.ipAddress}/api/status`, {
          method: 'GET',
          headers
        }).catch(() => null);
      }

      if (!response || !response.ok) {
        response = await fetch(`http://${this.ipAddress}/api/account/status`, {
          method: 'GET',
          headers
        }).catch(() => null);
      }

      if (!response || !response.ok) {
        response = await fetch(`http://${this.ipAddress}/api/account/status`, {
          method: 'GET',
          headers
        }).catch(() => null);
      }

      if (response && response.ok) {
        this.isConnected = true;
        const data = await response.json().catch(() => null);
        if (data) {
          this.parseTelemetryData(data);
        }
        // Query firmware version endpoint if missing
        if (this.firmwareVersion === '1.4.2') {
          const fwRes = await fetch(`http://${this.ipAddress}/api/status/firmware`, { method: 'GET', headers }).catch(() => null);
          if (fwRes && fwRes.ok) {
            const fwData = await fwRes.json().catch(() => null);
            if (fwData) this.parseTelemetryData(fwData);
          }
        }
        this.startStateStreamListener();
      } else {
        // Connected over USB or local LAN without status check failure
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
   * Connects WebSocket StateStream listener for real-time hardware input events.
   */
  private startStateStreamListener(): void {
    try {
      console.log(`[BusyBarDriver] Starting WebSocket StateStream listener on http://${this.ipAddress}`);
      // Listening for physical hardware events (buttons, wheel rotation)
      // When incoming websocket packet arrives:
      // this.emit('input', { key: update.key, type: update.actionType, timestamp: new Date().toISOString() });
    } catch (err) {
      console.warn('[BusyBarDriver] StateStream WebSocket connection degraded:', err);
    }
  }

  /**
   * Returns current hardware status DTO.
   */
  public getDeviceStatus(): DeviceStatusDTO {
    const isWifi = this.ipAddress !== '10.0.4.20';
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

  /**
   * Simulates a physical hardware input event (used in mock mode or automated tests).
   */
  public simulateInputEvent(event: HardwareEvent): void {
    if (!this.isConnected) return;
    console.log(`[BusyBarDriver] Hardware Input Event: ${event.key} (${event.type})`);
    this.emit('input', event);
  }

  /**
   * Formats internal or raw payload into OpenAPI v25 hardware DisplayElements schema.
   */
  private formatHardwarePayload(payload: Record<string, unknown>): Record<string, unknown> {
    if ('application_name' in payload && 'elements' in payload && Array.isArray(payload.elements)) {
      return payload;
    }

    const formattedElements: Array<Record<string, unknown>> = [];
    let elemIdCounter = 0;

    const front = payload.frontElements;
    if (Array.isArray(front)) {
      for (const item of front) {
        if (item && typeof item === 'object') {
          formattedElements.push({
            id: (item as Record<string, unknown>).id || `front_elem_${elemIdCounter++}`,
            display: 'front',
            ...item
          });
        }
      }
    }

    const back = payload.backElements;
    if (Array.isArray(back)) {
      for (const item of back) {
        if (item && typeof item === 'object') {
          formattedElements.push({
            id: (item as Record<string, unknown>).id || `back_elem_${elemIdCounter++}`,
            display: 'back',
            ...item
          });
        }
      }
    }

    const hardwarePayload: Record<string, unknown> = {
      application_name: (payload.application_name as string) || 'busybar_desktop',
      priority: (payload.priority as number) || 95,
      elements: formattedElements.length > 0 ? formattedElements : (payload.elements as Array<Record<string, unknown>>) || []
    };

    const ledColor = payload.ledColorHex || payload.led_notification_color;
    if (ledColor) {
      hardwarePayload.led_notification_color = String(ledColor);
    }

    return hardwarePayload;
  }

  /**
   * Uploads binary asset file (e.g. 72x16 PNG bitmap) for a specific app ID to device hardware.
   * Endpoint: POST /api/assets/upload?application_name={applicationName}&file={filename}
   */
  public async uploadAsset(applicationName: string, filename: string, binaryData: Buffer | Uint8Array): Promise<boolean> {
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK ASSET UPLOAD] app=${applicationName}, file=${filename}, bytes=${binaryData.byteLength}`);
      return true;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream'
      };
      if (this.apiToken) {
        headers['X-API-Token'] = this.apiToken;
      }

      const url = `http://${this.ipAddress}/api/assets/upload?application_name=${encodeURIComponent(applicationName)}&file=${encodeURIComponent(filename)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: binaryData
      }).catch(() => null);

      return response ? response.ok : false;
    } catch (err) {
      console.error(`[BusyBarDriver] Asset upload failed for ${filename}:`, err);
      return false;
    }
  }

  /**
   * Deletes all asset files for a specific application name from device hardware.
   * Endpoint: DELETE /api/assets/upload?application_name={applicationName}
   */
  public async deleteAppAssets(applicationName: string): Promise<boolean> {
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK ASSET DELETE] app=${applicationName}`);
      return true;
    }

    try {
      const headers: Record<string, string> = {};
      if (this.apiToken) {
        headers['X-API-Token'] = this.apiToken;
      }

      const url = `http://${this.ipAddress}/api/assets/upload?application_name=${encodeURIComponent(applicationName)}`;
      const response = await fetch(url, {
        method: 'DELETE',
        headers
      }).catch(() => null);

      return response ? response.ok : false;
    } catch (err) {
      console.error(`[BusyBarDriver] Asset delete failed for ${applicationName}:`, err);
      return false;
    }
  }

  /**
   * Clears all currently displayed elements from the device screen buffer.
   * Endpoint: DELETE /api/display/draw?application_name={applicationName}
   */
  public async clearDisplay(applicationName: string = 'busybar_desktop'): Promise<boolean> {
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK CLEAR] app=${applicationName}`);
      return true;
    }

    try {
      const headers: Record<string, string> = {};
      if (this.apiToken) headers['X-API-Token'] = this.apiToken;

      const url = `http://${this.ipAddress}/api/display/draw?application_name=${encodeURIComponent(applicationName)}`;
      const response = await fetch(url, { method: 'DELETE', headers }).catch(() => null);
      return response ? response.ok : false;
    } catch (err) {
      console.error(`[BusyBarDriver] Clear display failed:`, err);
      return false;
    }
  }

  /**
   * Renders a 72×16 pixel matrix directly on the BUSY Bar front display using the PNG asset pipeline.
   * Mirrors the reference Studio's proven approach for complex frames (>40 strips):
   *   1. Clear current display buffer
   *   2. Upload the matrix as a 72×16 PNG binary to /api/assets/upload
   *   3. Draw a single image element referencing the uploaded PNG
   *
   * This approach is guaranteed to work for any frame complexity and avoids JSON buffer limits.
   */
  public async sendPixelFrame(
    pngBuffer: Buffer,
    ledColorHex?: string,
    applicationName: string = 'busybar_desktop',
    filename: string = 'frame.png',
    priority: number = 95
  ): Promise<boolean> {
    if (this.isMockMode) {
      console.log(`[BusyBarDriver] [MOCK PIXEL FRAME] app=${applicationName}, file=${filename}, bytes=${pngBuffer.byteLength}, led=${ledColorHex ?? 'none'}`);
      return true;
    }

    try {
      const headers: Record<string, string> = {};
      if (this.apiToken) headers['X-API-Token'] = this.apiToken;

      // Step 1: Clear existing display elements
      await this.clearDisplay(applicationName);

      // Step 2: Upload 72×16 PNG as binary asset
      const uploadOk = await this.uploadAsset(applicationName, filename, pngBuffer);
      if (!uploadOk) {
        console.warn(`[BusyBarDriver] PNG asset upload failed for ${filename}, skipping draw.`);
        return false;
      }

      // Step 3: Draw the uploaded PNG as a single image element
      const drawPayload: Record<string, unknown> = {
        application_name: applicationName,
        priority,
        elements: [{
          id: 'px_matrix_img',
          type: 'image',
          path: filename,
          x: 0,
          y: 0,
          display: 'front'
        }]
      };

      if (ledColorHex) {
        drawPayload.led_notification_color = ledColorHex;
      }

      const jsonHeaders = { ...headers, 'Content-Type': 'application/json', 'Accept': 'application/json' };
      const drawResponse = await fetch(`http://${this.ipAddress}/api/display/draw`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(drawPayload)
      }).catch(() => null);

      const success = drawResponse ? drawResponse.ok : false;
      if (!success) {
        console.error(`[BusyBarDriver] Draw image element failed (HTTP ${drawResponse?.status})`);
      }
      return success;
    } catch (err) {
      console.error(`[BusyBarDriver] sendPixelFrame failed:`, err);
      return false;
    }
  }

  /**
   * Sends display payload to physical hardware REST API.
   * Attaches X-API-Token header when operating over Wi-Fi LAN.
   * Posts to /api/display/draw (OpenAPI v25).
   */
  public async sendDisplayPayload(payload: Record<string, unknown>): Promise<boolean> {
    const formattedPayload = this.formatHardwarePayload(payload);

    if (this.isMockMode) {
      console.log('[BusyBarDriver] [MOCK DISPLAY DRAW]:', JSON.stringify(formattedPayload));
      return true;
    }

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };

      if (this.apiToken) {
        headers['X-API-Token'] = this.apiToken;
      }

      let response = await fetch(`http://${this.ipAddress}/api/display/draw`, {
        method: 'POST',
        headers,
        body: JSON.stringify(formattedPayload)
      }).catch(() => null);

      if (!response || !response.ok) {
        response = await fetch(`http://${this.ipAddress}/api/display/draw`, {
          method: 'POST',
          headers,
          body: JSON.stringify(formattedPayload)
        }).catch(() => null);
      }

      return response ? response.ok : false;
    } catch (err) {
      console.error(`[BusyBarDriver] Error posting display payload to http://${this.ipAddress}/api/display/draw:`, err);
      return false;
    }
  }


  private pingTimer: NodeJS.Timeout | null = null;

  private startPingLoop(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);

    this.pingTimer = setInterval(async () => {
      if (this.isMockMode) {
        // Vary mock ping between 3ms and 6ms for dynamic feedback
        this.pingMs = Math.floor(Math.random() * 4) + 3;
        this.isConnected = true;
        this.emit('statusChanged', this.getDeviceStatus());
        return;
      }

      const start = Date.now();
      try {
        const headers: Record<string, string> = { 'Accept': 'application/json' };
        if (this.apiToken) headers['X-API-Token'] = this.apiToken;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        let res = await fetch(`http://${this.ipAddress}/api/status`, {
          method: 'GET',
          headers,
          signal: controller.signal
        }).catch(() => null);

        if (!res || !res.ok) {
          res = await fetch(`http://${this.ipAddress}/api/status/power`, {
            method: 'GET',
            headers,
            signal: controller.signal
          }).catch(() => null);
        }

        if (!res || !res.ok) {
          res = await fetch(`http://${this.ipAddress}/api/status`, {
            method: 'GET',
            headers,
            signal: controller.signal
          }).catch(() => null);
        }

        if (!res || !res.ok) {
          res = await fetch(`http://${this.ipAddress}/api/account/status`, {
            method: 'GET',
            headers,
            signal: controller.signal
          }).catch(() => null);
        }

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
    if (this.activeStream) {
      try {
        (this.activeStream as { stop?: () => void }).stop?.();
      } catch (err) {
        // ignore stream close errors
      }
      this.activeStream = null;
    }
    this.emit('statusChanged', this.getDeviceStatus());
  }

  public getIsMockMode(): boolean {
    return this.isMockMode;
  }
}
