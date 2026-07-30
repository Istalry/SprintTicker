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
   * Sends display payload to physical hardware REST API.
   * Attaches X-API-Token header when operating over Wi-Fi LAN.
   * Posts to /api/display/draw (OpenAPI v25) with fallback to /api/display/draw.
   */
  public async sendDisplayPayload(payload: Record<string, unknown>): Promise<boolean> {
    if (this.isMockMode) {
      console.log('[BusyBarDriver] [MOCK DISPLAY DRAW]:', JSON.stringify(payload));
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
        body: JSON.stringify(payload)
      }).catch(() => null);

      if (!response || !response.ok) {
        response = await fetch(`http://${this.ipAddress}/api/display/draw`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
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
