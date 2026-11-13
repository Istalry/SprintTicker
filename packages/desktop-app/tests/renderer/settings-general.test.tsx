import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsPage } from '../../src/renderer/views/Settings/SettingsPage';
import { SETTINGS_ENTRIES } from '../../src/renderer/views/Settings/settings-groups';
import { FlowSettingKey } from '../../src/shared/flow-settings';
import { installElectronApi } from './electron-api-mock';

/** Settings · General as rows (P16a, S19): every row there, each saving through the bridge. */
describe('Settings · General', () => {
  const show = (onRunSetup = vi.fn()) => {
    render(<SettingsPage group="general" onGroupChange={vi.fn()} hasBar onRunSetup={onRunSetup} />);
    return onRunSetup;
  };
  const row = (name: string) => screen.getByRole('group', { name });

  it('Render_EveryRowOfS19_InItsOrder', async () => {
    installElectronApi();
    show();

    const names = [
      'Start with Windows', 'When I close the window',
      'Interrupt shortcut', 'Switch task shortcut', 'Previous task shortcut', 'Back shortcut',
      'Check for updates', 'Set up again', 'Show developer tools'
    ];
    await vi.waitFor(() => expect(row('Interrupt shortcut')).toBeTruthy());
    const shown = screen.getAllByRole('group').map(group => group.getAttribute('aria-labelledby'))
      .map(id => document.getElementById(id!)?.textContent);
    expect(shown).toEqual(names);
  });

  it('Render_EverySearchEntryOfTheGroup_HasItsRow', () => {
    // The search sends the user here by these names: each must be on the page.
    installElectronApi();
    show();

    for (const entry of SETTINGS_ENTRIES.filter(e => e.group === 'general')) {
      const name = entry.label === 'Shortcuts' ? 'Interrupt shortcut' : entry.label;
      expect(row(name)).toBeTruthy();
    }
  });

  it('Render_NoOldCardTitles', () => {
    installElectronApi();
    show();

    expect(screen.queryByText('Updates')).toBeNull();
    expect(screen.queryByText(/Changes save automatically/)).toBeNull();
  });

  it('CloseWindow_Quit_SavedThroughTheBridge', async () => {
    const bridge = installElectronApi();
    show();
    const choice = await screen.findByRole('combobox', { name: 'When I close the window' });
    await vi.waitFor(() => expect((choice as HTMLSelectElement).disabled).toBe(false));

    fireEvent.change(choice, { target: { value: 'quit' } });

    expect(bridge.api.saveFlowSetting).toHaveBeenCalledWith(FlowSettingKey.CLOSE_TO_TRAY, false);
  });

  it('CheckForUpdates_SwitchedOff_SavedAndCheckNowStays', async () => {
    const bridge = installElectronApi();
    show();
    const toggle = screen.getByRole('switch', { name: 'Check for updates automatically' });
    await vi.waitFor(() => expect((toggle as HTMLInputElement).checked).toBe(true));

    fireEvent.click(toggle);

    await vi.waitFor(() => expect(bridge.api.setUpdateCheckEnabled).toHaveBeenCalledWith(false));
    fireEvent.click(screen.getByRole('button', { name: /Check now/ }));
    await vi.waitFor(() => expect(bridge.api.checkForUpdate).toHaveBeenCalledTimes(1));
  });

  it('SetUpAgain_RunsSetup', () => {
    installElectronApi();
    const onRunSetup = show();

    fireEvent.click(screen.getByRole('button', { name: 'Run setup' }));

    expect(onRunSetup).toHaveBeenCalledTimes(1);
  });

  it('ShowDeveloperTools_On_TheGroupAppears', () => {
    installElectronApi();
    show();
    expect(screen.queryByRole('button', { name: 'Developer' })).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: 'Show developer tools' }));

    expect(screen.getByRole('button', { name: 'Developer' })).toBeTruthy();
  });
});
