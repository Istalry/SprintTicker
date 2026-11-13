import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DataSettings } from '../../src/renderer/views/Settings/DataSettings';
import { DeveloperSettings } from '../../src/renderer/views/Settings/DeveloperSettings';
import { BarHealth } from '../../src/renderer/components/BarHealth';
import { SETTINGS_ENTRIES } from '../../src/renderer/views/Settings/settings-groups';
import { CONNECTED_DEVICE, installElectronApi } from './electron-api-mock';

const row = (name: string) => screen.getByRole('group', { name });

/** Settings · Data as rows (P16e, S23). */
describe('Settings · Data', () => {
  it('Render_TheRowsOfS23', async () => {
    installElectronApi();
    render(<DataSettings />);

    expect(await screen.findByText(/Nothing in OpenProject is touched\. Asks twice\./)).toBeTruthy();
    expect(row('Export logs')).toBeTruthy();
    expect(row('Erase everything on this computer')).toBeTruthy();
    expect(screen.queryByText(/Danger Zone/)).toBeNull();
  });

  it('ExportLogs_Saved_SaysSo_Cancelled_SaysNothing', async () => {
    const bridge = installElectronApi({ exportDiagnosticLogs: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false) });
    render(<DataSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Export…' }));
    expect(await screen.findByText(/Saved\. Attach the file/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export…' }));

    await waitFor(() => expect(bridge.api.exportDiagnosticLogs).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/Saved\. Attach the file/)).toBeNull());
  });

  it('Erase_AsksTwiceBeforeErasing', async () => {
    const bridge = installElectronApi();
    render(<DataSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Erase…' }));
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Erase everything?' })).getByRole('button', { name: 'Erase' }));
    expect(bridge.api.wipeAllData).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'This cannot be undone' })).getByRole('button', { name: 'Erase everything now' }));

    await waitFor(() => expect(bridge.api.wipeAllData).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/^Erased\./)).toBeTruthy();
  });

  it('Erase_KeepThem_ErasesNothing', async () => {
    const bridge = installElectronApi();
    render(<DataSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Erase…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep them' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Erase…' })).toBeTruthy();
    expect(bridge.api.wipeAllData).not.toHaveBeenCalled();
  });

  it('Erase_Refused_SaysNothingWasErased', async () => {
    installElectronApi({ wipeAllData: vi.fn().mockRejectedValue(new Error('database locked')) });
    render(<DataSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Erase…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Erase' }));
    fireEvent.click(screen.getByRole('button', { name: 'Erase everything now' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Nothing was erased: database locked/);
  });
});

/** Settings · Developer as rows (P16e, S24). */
describe('Settings · Developer', () => {
  it('Render_EveryToolARow_EverySearchEntryToo', async () => {
    installElectronApi();
    render(<DeveloperSettings />);
    await screen.findByRole('group', { name: 'Bar health' });

    for (const entry of SETTINGS_ENTRIES.filter(e => e.group === 'developer')) {
      expect(row(entry.label), entry.label).toBeTruthy();
    }
    expect(screen.getByText(/act on the real app/)).toBeTruthy();
  });

  it('Open_OneToolAtATime', async () => {
    installElectronApi();
    render(<DeveloperSettings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open Bar remote' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Bar health' }));

    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.getByText('Inputs from the bar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close Bar health' }));
    expect(screen.queryByText('Inputs from the bar')).toBeNull();
  });

  it('TestNotifications_Slack_SentThroughTheListenersPath', async () => {
    const bridge = installElectronApi();
    render(<DeveloperSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Test notifications' }));

    fireEvent.click(screen.getByRole('button', { name: 'Slack' }));

    expect(bridge.api.simulateNotification).toHaveBeenCalledWith(expect.objectContaining({ appId: 'slack' }));
    expect(await screen.findByText(/Slack sent/)).toBeTruthy();
  });

  it('TestNotifications_Refused_SaysSo', async () => {
    installElectronApi({ simulateNotification: vi.fn().mockRejectedValue(new Error('listener off')) });
    render(<DeveloperSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Test notifications' }));

    fireEvent.click(screen.getByRole('button', { name: 'Discord' }));

    expect(await screen.findByText('Discord not sent: listener off')).toBeTruthy();
  });

  it('BarHealth_AnInputArrives_ShowsIt', async () => {
    const bridge = installElectronApi();
    render(<BarHealth status={CONNECTED_DEVICE} />);
    expect(screen.getByText('Nothing yet. Press a key on the bar.')).toBeTruthy();

    act(() => bridge.emit('onHardwareInputEvent', { inputKey: 'ok', actionAssigned: 'INTERRUPT' }));

    expect(within(screen.getByLabelText('Inputs from the bar')).getByText(/OK/)).toBeTruthy();
    expect(screen.getByText('→ INTERRUPT')).toBeTruthy();
  });
});
