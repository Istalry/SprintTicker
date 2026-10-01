import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/renderer/App';
import { DeviceDiagnosticsView } from '../../src/renderer/views/Device/DeviceDiagnosticsView';
import { OnboardingWizardModal } from '../../src/renderer/components/OnboardingWizardModal';
import { DEFAULT_DEVICE_CONFIG } from '../../src/shared/device-constants';
import { CONNECTED_DEVICE, NO_BAR_DEVICE, installElectronApi } from './electron-api-mock';

/**
 * No-bar mode: SprintTicker without the hardware. What only describes the bar
 * steps aside, everything that keeps time stays -- and the choice must be
 * reversible, because a user who buys a bar later keeps their setup.
 */
describe('no-bar mode', () => {
  it('Render_NoBar_HidesWhatOnlyDescribesTheBar', async () => {
    installElectronApi({ getDeviceStatus: async () => NO_BAR_DEVICE });
    render(<App />);

    expect(await screen.findByText('Device & Logs')).toBeTruthy();
    expect(screen.queryByText('Priority Rules')).toBeNull();
    expect(screen.queryByText('Unity Engine')).toBeNull();
    expect(screen.queryByText('Notifications')).toBeNull();
    expect(screen.queryByTitle('WebSocket round trip to the bar')).toBeNull();
    // Time keeping is untouched.
    expect(screen.getByText('Active Session')).toBeTruthy();
  });

  it('Render_BarAddedLater_BringsItsScreensBack', async () => {
    const bridge = installElectronApi({ getDeviceStatus: async () => NO_BAR_DEVICE });
    render(<App />);
    await screen.findByText('Device & Logs');

    act(() => bridge.emit('onDeviceStatusChanged', CONNECTED_DEVICE));

    expect(await screen.findByText('Priority Rules')).toBeTruthy();
    expect(screen.getByText('Unity Engine')).toBeTruthy();
    expect(screen.getByText('Notifications')).toBeTruthy();
    expect(screen.getByText('Device Diagnostics')).toBeTruthy();
  });

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

  describe('onboarding', () => {
    /** Steps forward until the wizard offers to finish, then finishes. */
    const finish = async (): Promise<void> => {
      while (screen.queryByText('Next')) fireEvent.click(screen.getByText('Next'));
      fireEvent.click(screen.getByText('Complete Setup & Open Dashboard'));
    };

    it('Onboarding_NotNow_SavesNoBarMode', async () => {
      const bridge = installElectronApi();
      const onClose = vi.fn();
      render(<OnboardingWizardModal isOpen onClose={onClose} />);

      fireEvent.click(screen.getByText('Not now -- use it without one'));
      expect(screen.queryByText('Test Ping')).toBeNull();
      // The Unity plugin step goes with the bar.
      expect(screen.queryByText(/Unity Plugin/)).toBeNull();
      await finish();

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(bridge.api.setDeviceConfig).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });

    it('Onboarding_KeepsTheBar_DoesNotRedialIt', async () => {
      const bridge = installElectronApi();
      const onClose = vi.fn();
      render(<OnboardingWizardModal isOpen onClose={onClose} />);

      await finish();

      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(bridge.api.setDeviceConfig).not.toHaveBeenCalled();
    });
  });
});
