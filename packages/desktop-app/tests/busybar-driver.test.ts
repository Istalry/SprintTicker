import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';

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
    let capturedUrl = '';

    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
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
      expect(capturedUrl).toBe('http://10.0.4.20/api/status');
      expect(status.connected).toBe(true);
      expect(status.batteryPercent).toBe(88);
      expect(status.firmwareVersion).toBe('2.4.0');
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
});
