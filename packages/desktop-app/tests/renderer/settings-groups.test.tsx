import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/renderer/App';
import { installElectronApi } from './electron-api-mock';
import {
  SETTINGS_ENTRIES,
  SETTINGS_GROUPS,
  SHOW_DEVELOPER_KEY,
  searchSettings,
  visibleGroups
} from '../../src/renderer/views/Settings/settings-groups';

const openSettings = async (): Promise<void> => {
  render(<App />);
  fireEvent.click(within(screen.getByRole('navigation', { name: 'Places' })).getByRole('button', { name: 'Settings' }));
  await screen.findByRole('heading', { level: 2, name: 'General' });
};

const group = (label: string): HTMLElement =>
  within(screen.getByRole('navigation', { name: 'Settings groups' })).getByRole('button', { name: label });

/** Settings in six groups (S19–S24): every former setting has a home, and search finds it. */
describe('settings groups', () => {
  beforeEach(() => window.localStorage.removeItem(SHOW_DEVELOPER_KEY));

  it('Index_EveryEntry_IsInAGroupThatExists', () => {
    const ids = new Set(SETTINGS_GROUPS.map(g => g.id));
    for (const entry of SETTINGS_ENTRIES) expect(ids.has(entry.group)).toBe(true);
  });

  it.each([
    ['sync queue', 'Entries waiting to send'],
    ['priority', 'What the bar shows first'],
    ['ceremonies', 'Stand-up'],
    ['wipe', 'Erase everything on this computer'],
    ['jira token', 'Credentials'],
    ['launch at login', 'Start with Windows'],
    ['tray', 'When I close the window']
  ])('Search_TheOldName_%s_FindsItsNewHome', (query, label) => {
    expect(searchSettings(query, false).map(e => e.label)).toContain(label);
  });

  it('Search_DeveloperTool_HiddenUntilShown', () => {
    expect(searchSettings('display debugger', false)).toEqual([]);
    expect(searchSettings('display debugger', true).map(e => e.label)).toEqual(['Display debugger']);
  });

  it('Groups_DeveloperHiddenUntilShown', () => {
    expect(visibleGroups(false).map(g => g.id)).not.toContain('developer');
    expect(visibleGroups(true).map(g => g.id)).toContain('developer');
  });

  it.each([
    ['General', /Start with Windows/],
    ['Account', /Provider Selection & Credentials/],
    ['My workday', /Working Days/],
    ['Desk devices', /Task key color/],
    ['Data', /Danger Zone/]
  ])('Group_%s_MountsItsCards', async (label, card) => {
    await openSettings();

    fireEvent.click(group(label));

    expect(await screen.findByRole('heading', { level: 2, name: label })).toBeTruthy();
    expect((await screen.findAllByText(card)).length).toBeGreaterThan(0);
  });

  it('ShowDeveloperTools_On_AddsTheGroupWithItsWarning', async () => {
    await openSettings();
    expect(within(screen.getByRole('navigation', { name: 'Settings groups' })).queryByRole('button', { name: 'Developer' })).toBeNull();

    fireEvent.click(screen.getByRole('switch', { name: 'Show developer tools' }));
    fireEvent.click(group('Developer'));

    expect(await screen.findByText(/act on the real app/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'START' })).toBeTruthy();
  });

  it('SearchBox_Result_OpensItsGroup', async () => {
    await openSettings();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search settings' }), { target: { value: 'lunch' } });
    fireEvent.click(within(screen.getByRole('list', { name: 'Search results' })).getByRole('button', { name: /Lunch/ }));

    expect(await screen.findByRole('heading', { level: 2, name: 'My workday' })).toBeTruthy();
  });

  it('CloseToTray_ChooseQuit_SavesIt', async () => {
    // P12a: keep running in the tray, the default, or quit on close.
    const bridge = installElectronApi({
      getFlowSetting: vi.fn().mockImplementation(async (key: string) => (key === 'close_to_tray' ? true : null)),
      saveFlowSetting: vi.fn().mockImplementation(async (_key: string, value: unknown) => value)
    });
    await openSettings();

    const choice = await screen.findByRole('combobox', { name: 'When I close the window' });
    await vi.waitFor(() => expect((choice as HTMLSelectElement).value).toBe('keep'));
    fireEvent.change(choice, { target: { value: 'quit' } });

    expect(bridge.api.saveFlowSetting).toHaveBeenCalledWith('close_to_tray', false);
    await vi.waitFor(() => expect((choice as HTMLSelectElement).value).toBe('quit'));
  });
});
