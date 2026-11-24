import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DataSettings } from '../../src/renderer/views/Settings/DataSettings';
import { DeveloperSettings } from '../../src/renderer/views/Settings/DeveloperSettings';
import { SETTINGS_ENTRIES } from '../../src/renderer/views/Settings/settings-groups';
import { installElectronApi } from './electron-api-mock';

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

  it('AiAgents_OffAtFirst_OnShowsTheToken_ANewOneReplacesIt', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const bridge = installElectronApi();
    render(<DataSettings />);

    const agents = row('AI agents');
    const toggle = within(agents).getByRole('switch', { name: 'Let AI agents use SprintTicker' }) as HTMLInputElement;
    await waitFor(() => expect(toggle.disabled).toBe(false));
    expect(toggle.checked).toBe(false);
    expect(within(agents).queryByLabelText('Token')).toBeNull();

    fireEvent.click(toggle);
    await waitFor(() => expect((within(agents).getByLabelText('Token') as HTMLInputElement).value).toBe('token-1'));
    expect(bridge.api.setAgentAccess).toHaveBeenCalledWith(true);

    const [copyToken, copyClaudeCode] = within(agents).getAllByRole('button', { name: 'Copy' });
    fireEvent.click(copyToken);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('token-1'));
    expect(within(agents).getByText('claude mcp add sprintticker -- run mcp')).toBeTruthy();
    fireEvent.click(copyClaudeCode);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('claude mcp add sprintticker -- run mcp'));
    expect(within(agents).getByText('C:\\SprintTicker\\resources\\agent\\sprintticker.cmd')).toBeTruthy();
    fireEvent.click(within(agents).getByRole('button', { name: 'Make a new one' }));
    await waitFor(() => expect((within(agents).getByLabelText('Token') as HTMLInputElement).value).toBe('token-2'));
    expect(within(agents).getByText(/Give it to your agents again/)).toBeTruthy();
    expect(within(agents).getByText(/pnpm agent:build/)).toBeTruthy();
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
    await screen.findByRole('group', { name: 'Notification listener' });

    for (const entry of SETTINGS_ENTRIES.filter(e => e.group === 'developer')) {
      expect(row(entry.label), entry.label).toBeTruthy();
    }
    expect(screen.getByText(/act on the real app/)).toBeTruthy();
    // Bar health is Desk devices' since the 2.0 candidate: a user's, not a developer's.
    expect(screen.queryByRole('group', { name: 'Bar health' })).toBeNull();
  });

  it('Open_OneToolAtATime', async () => {
    installElectronApi();
    render(<DeveloperSettings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open Bar remote' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Test notifications' }));

    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Slack' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close Test notifications' }));
    expect(screen.queryByRole('button', { name: 'Slack' })).toBeNull();
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

});
