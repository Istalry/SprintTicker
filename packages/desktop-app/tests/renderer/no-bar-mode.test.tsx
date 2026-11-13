import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DeveloperSettings } from '../../src/renderer/views/Settings/DeveloperSettings';
import { DeviceSettings } from '../../src/renderer/views/Settings/DeviceSettings';
import { DEFAULT_DEVICE_CONFIG } from '../../src/shared/device-constants';
import { NO_BAR_DEVICE, installElectronApi } from './electron-api-mock';

/**
 * No-bar mode: SprintTicker without the hardware. What only describes the bar
 * steps aside, everything that keeps time stays -- and the choice must be
 * reversible, because a user who buys a bar later keeps their setup.
 */
describe('no-bar mode', () => {
  it('DeskDevices_NoBar_OneLineThatAddsItBack', async () => {
    const bridge = installElectronApi({
      getDeviceStatus: async () => NO_BAR_DEVICE,
      getDeviceConfig: async () => ({ ...DEFAULT_DEVICE_CONFIG, enabled: false, ipAddress: '10.0.4.21' })
    });
    render(<DeviceSettings />);
    const line = await screen.findByRole('group', { name: 'No bar on this computer' });
    const add = within(line).getByRole('button', { name: 'Add' });
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('group', { name: 'Task key color' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Windows notifications on the bar' })).toBeNull();
    // Bar health is there once a bar is: nothing to chart without one.
    expect(screen.queryByRole('group', { name: 'Bar health' })).toBeNull();

    fireEvent.click(add);

    // The address set before no-bar mode comes back with the bar.
    await waitFor(() =>
      expect(bridge.api.setDeviceConfig).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true, ipAddress: '10.0.4.21' })
      )
    );
  });

  it('Developer_NoBar_OnlyTheToolsThatNeedNone', async () => {
    installElectronApi({ getDeviceStatus: async () => NO_BAR_DEVICE });
    render(<DeveloperSettings />);

    await waitFor(() => expect(screen.queryByRole('group', { name: 'Bar health' })).toBeNull());
    expect(screen.getByRole('group', { name: 'Bar remote' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Notification listener' })).toBeNull();
  });

  it('DeskDevices_WithABar_CanSwitchToNoBarMode', async () => {
    const bridge = installElectronApi();
    render(<DeviceSettings />);
    const button = await screen.findByRole('button', { name: 'Use without a bar' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(button);

    await waitFor(() =>
      expect(bridge.api.setDeviceConfig).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
    );
  });

  it('DeskDevices_SaveRefused_SaysSo', async () => {
    installElectronApi({ setDeviceConfig: vi.fn().mockRejectedValue(new Error('disk full')) });
    render(<DeviceSettings />);
    const button = await screen.findByRole('button', { name: 'Use without a bar' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(button);

    expect((await screen.findByRole('alert')).textContent).toMatch(/disk full/);
  });
});
