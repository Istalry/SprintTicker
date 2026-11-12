import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeviceDiagnosticsView } from '../../src/renderer/views/Device/DeviceDiagnosticsView';
import { DEFAULT_DEVICE_CONFIG } from '../../src/shared/device-constants';
import { NO_BAR_DEVICE, installElectronApi } from './electron-api-mock';

/**
 * No-bar mode: SprintTicker without the hardware. What only describes the bar
 * steps aside, everything that keeps time stays -- and the choice must be
 * reversible, because a user who buys a bar later keeps their setup.
 */
describe('no-bar mode', () => {
  it('DeviceView_NoBar_OffersToAddOneAndKeepsLogsAndReset', async () => {
    const bridge = installElectronApi({
      getDeviceStatus: async () => NO_BAR_DEVICE,
      getDeviceConfig: async () => ({ ...DEFAULT_DEVICE_CONFIG, enabled: false, ipAddress: '10.0.4.21' })
    });
    render(<DeviceDiagnosticsView />);

    fireEvent.click(await screen.findByText('Add a BUSY Bar'));

    // The address set before no-bar mode comes back with the bar.
    await waitFor(() =>
      expect(bridge.api.setDeviceConfig).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, ipAddress: '10.0.4.21' })
      )
    );
    expect(screen.getByText('Export Logs')).toBeTruthy();
    expect(screen.queryByText(/Hardware Input Stream Console/)).toBeNull();
  });

  it('DeviceView_WithABar_CanSwitchToNoBarMode', async () => {
    const bridge = installElectronApi();
    render(<DeviceDiagnosticsView />);

    fireEvent.click(await screen.findByText('Use without a bar'));

    await waitFor(() =>
      expect(bridge.api.setDeviceConfig).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
    );
  });

  it('DeviceView_SaveRefused_SaysSo', async () => {
    installElectronApi({ setDeviceConfig: vi.fn().mockRejectedValue(new Error('disk full')) });
    render(<DeviceDiagnosticsView />);

    fireEvent.click(await screen.findByText('Use without a bar'));

    expect(await screen.findByText('disk full')).toBeTruthy();
  });
});
