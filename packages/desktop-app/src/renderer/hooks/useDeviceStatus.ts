import { useState, useEffect } from 'react';
import { DeviceStatusDTO } from '../../shared/dtos';
import { DEFAULT_USB_IP } from '../../shared/device-constants';

/**
 * Custom React hook subscribing to physical BUSY Bar connection status and telemetry updates.
 */
export function useDeviceStatus() {
  // Disconnected until main says otherwise. This used to open on a connected
  // bar at 98% battery and 4 ms -- invented figures that every user saw for
  // the first moment, including users with no bar at all. `enabled` starts
  // true, the default for a config that predates no-bar mode.
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatusDTO>({
    enabled: true,
    connected: false,
    ipAddress: DEFAULT_USB_IP,
    connectionType: 'usb',
    frontBrightness: null,
    backBrightness: null,
    batteryPercent: 0,
    firmwareVersion: 'N/A',
    framesSent: 0,
    framesFailed: 0,
    webSocketPingMs: 0
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
    return undefined;
  }, []);

  return deviceStatus;
}
