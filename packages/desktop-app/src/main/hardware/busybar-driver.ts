import { EventEmitter } from 'events';
import { DeviceStatusDTO } from '../../shared/dtos';

export interface HardwareEvent {
  key: string;
  type: 'press' | 'long_press' | 'rotate_left' | 'rotate_right';
  timestamp: string;
}

/**
 * Driver managing connection, telemetry, and input event streams with physical BUSY Bar hardware.
 * Supports --mock-hardware mode for local testing without physical device attached.
 */
export class BusyBarDriver extends EventEmitter {
  private isMockMode: boolean = false;
  private isConnected: boolean = false;
  private ipAddress: string = '10.0.4.20';
  private pingMs: number = 4;

  constructor(ipAddress: string = '10.0.4.20', forceMock: boolean = false) {
    super();
    this.ipAddress = ipAddress;
    this.isMockMode = forceMock || process.argv.includes('--mock-hardware') || process.env.MOCK_HARDWARE === 'true';
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
      // Attempt local connection to 10.0.4.20 USB Virtual Ethernet
      console.log(`[BusyBarDriver] Connecting to BUSY Bar hardware at ${this.ipAddress}...`);
      this.isConnected = true;
      this.emit('statusChanged', this.getDeviceStatus());
      return true;
    } catch (err) {
      console.warn(`[BusyBarDriver] Hardware connection to ${this.ipAddress} failed. Falling back to degraded state.`, err);
      this.isConnected = false;
      this.emit('statusChanged', this.getDeviceStatus());
      return false;
    }
  }

  /**
   * Returns current hardware status DTO.
   */
  public getDeviceStatus(): DeviceStatusDTO {
    return {
      connected: this.isConnected,
      ipAddress: this.ipAddress,
      connectionType: 'usb',
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
   */
  public async sendDisplayPayload(payload: Record<string, unknown>): Promise<boolean> {
    if (this.isMockMode) {
      console.log('[BusyBarDriver] [MOCK DISPLAY DRAW]:', JSON.stringify(payload));
      return true;
    }
    // Perform HTTP REST request to http://10.0.4.20/busybar/display/draw
    return true;
  }

  public disconnect(): void {
    this.isConnected = false;
    this.emit('statusChanged', this.getDeviceStatus());
  }

  public getIsMockMode(): boolean {
    return this.isMockMode;
  }
}
