import { useState, useEffect } from 'react';
import { DeviceStatusDTO } from '../../shared/dtos';

/**
 * Custom React hook subscribing to physical BUSY Bar connection status and telemetry updates.
 */
export function useDeviceStatus() {
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatusDTO>({
    connected: true,
    ipAddress: '10.0.4.20',
    connectionType: 'usb',
    frontBrightness: 80,
    backBrightness: 100,
    batteryPercent: 98,
    firmwareVersion: '1.4.2',
    webSocketPingMs: 4
  });

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getDeviceStatus().then(status => {
        if (status) setDeviceStatus(status);
      }).catch(err => {
        console.error('[useDeviceStatus] Failed to fetch device status:', err);
      });

      const unsubscribe = window.electronAPI.onDeviceStatusChanged((status) => {
        setDeviceStatus(status);
      });

      return () => unsubscribe();
    }
  }, []);

  return deviceStatus;
}
