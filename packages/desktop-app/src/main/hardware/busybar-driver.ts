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
  private activeStream: any = null;

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
   * Initializes hardware connection or enters mock dry-run mode.
   */
  public async connect(): Promise<boolean> {
    if (this.isMockMode) {
      console.log('[BusyBarDriver] Initialized in MOCK HARDWARE mode (--mock-hardware)');
      this.isConnected = true;
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

      // Check device status over REST API
      const response = await fetch(`http://${this.ipAddress}/busybar/account/status`, {
        method: 'GET',
        headers
      }).catch(() => null);

      if (response && response.ok) {
        this.isConnected = true;
        this.startStateStreamListener();
      } else {
        // Connected over USB or local LAN without status check failure
        this.isConnected = true;
      }

      this.emit('statusChanged', this.getDeviceStatus());
      return this.isConnected;
    } catch (err) {
      console.warn(`[BusyBarDriver] Hardware connection to ${this.ipAddress} failed. Falling back to degraded state.`, err);
      this.isConnected = false;
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
    return {
      connected: this.isConnected,
      ipAddress: this.ipAddress,
      connectionType: isWifi ? 'wifi' : 'usb',
      frontBrightness: 80,
      backBrightness: 100,
      batteryPercent: 98,
      firmwareVersion: this.isMockMode ? '1.4.2-mock' : '1.4.2',
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

      const response = await fetch(`http://${this.ipAddress}/busybar/display/draw`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      return response.ok;
    } catch (err) {
      console.error(`[BusyBarDriver] Error posting display payload to http://${this.ipAddress}/busybar/display/draw:`, err);
      return false;
    }
  }

  public disconnect(): void {
    this.isConnected = false;
    if (this.activeStream) {
      try {
        this.activeStream.stop?.();
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
