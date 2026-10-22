import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LaunchAtLoginCard } from '../../src/renderer/components/LaunchAtLoginCard';
import { installElectronApi } from './electron-api-mock';

const checkbox = () => screen.getByRole('checkbox', { name: /Start at sign-in/ }) as HTMLInputElement;

describe('LaunchAtLoginCard', () => {
  it('Mount_ShowsWhatWindowsReports', async () => {
    installElectronApi({ getLaunchAtLogin: vi.fn().mockResolvedValue({ enabled: true, available: true, reason: null }) });
    render(<LaunchAtLoginCard />);

    await vi.waitFor(() => expect(checkbox().checked).toBe(true));
    expect(checkbox().disabled).toBe(false);
  });

  it('Toggle_ShowsTheStateWindowsAnswers', async () => {
    // Not the state asked for: a write the machine refused must not read
    // as done.
    const bridge = installElectronApi({
      setLaunchAtLogin: vi.fn().mockResolvedValue({ enabled: false, available: true, reason: null })
    });
    render(<LaunchAtLoginCard />);
    await vi.waitFor(() => expect(checkbox().disabled).toBe(false));

    fireEvent.click(checkbox());

    await vi.waitFor(() => expect(bridge.api.setLaunchAtLogin).toHaveBeenCalledWith(true));
    expect(checkbox().checked).toBe(false);
  });

  it('Focus_ReadsWindowsAgain', async () => {
    // Switched off in Windows' Startup apps, or from the tray, while the
    // window was in the background.
    const get = vi.fn().mockResolvedValue({ enabled: true, available: true, reason: null });
    installElectronApi({ getLaunchAtLogin: get });
    render(<LaunchAtLoginCard />);
    await vi.waitFor(() => expect(checkbox().checked).toBe(true));

    get.mockResolvedValue({ enabled: false, available: true, reason: null });
    act(() => { window.dispatchEvent(new Event('focus')); });

    await vi.waitFor(() => expect(checkbox().checked).toBe(false));
  });

  it('NotPackaged_DisablesTheSwitchAndSaysWhy', async () => {
    installElectronApi({ getLaunchAtLogin: vi.fn().mockResolvedValue({ enabled: false, available: false, reason: 'not-packaged' }) });
    render(<LaunchAtLoginCard />);

    expect(await screen.findByText(/not in development/)).toBeTruthy();
    expect(checkbox().disabled).toBe(true);
  });

  it('SetFails_SaysSo', async () => {
    installElectronApi({ setLaunchAtLogin: vi.fn().mockRejectedValue(new Error('Access denied')) });
    render(<LaunchAtLoginCard />);
    await vi.waitFor(() => expect(checkbox().disabled).toBe(false));

    fireEvent.click(checkbox());

    expect(await screen.findByText(/Could not change it: Error: Access denied/)).toBeTruthy();
    expect(checkbox().checked).toBe(false);
  });
});
