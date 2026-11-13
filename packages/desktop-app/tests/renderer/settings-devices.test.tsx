import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DeviceSettings } from '../../src/renderer/views/Settings/DeviceSettings';
import { SETTINGS_ENTRIES } from '../../src/renderer/views/Settings/settings-groups';
import { AUTO_SAVE_DELAY_MS } from '../../src/renderer/hooks/auto-save-scheduler';
import { DEFAULT_DEVICE_CONFIG } from '../../src/shared/device-constants';
import { CONNECTED_DEVICE, installElectronApi } from './electron-api-mock';

const row = (name: string | RegExp) => screen.getByRole('group', { name });
const ready = async (name: string) => {
  const control = await screen.findByRole('button', { name });
  await waitFor(() => expect((control as HTMLButtonElement).disabled).toBe(false));
  return control;
};
const listener = (isListening: boolean) => vi.fn().mockResolvedValue({
  status: { isListening, strategy: isListening ? 'DB_POLLING' : 'NONE', hasSqlite3: true, hasNotifDb: isListening, totalCaptured: 0, totalSuppressed: 0 },
  logs: []
});

/** Settings · Desk devices as rows (P16d, S22). */
describe('Settings · Desk devices', () => {
  it('Render_TheRowsOfS22_ForAConnectedBar', async () => {
    installElectronApi({ getDeviceStatus: async () => ({ ...CONNECTED_DEVICE, frontBrightness: 80, batteryPercent: 82 }) });
    render(<DeviceSettings />);

    expect(await screen.findByRole('group', { name: 'Connected on USB' })).toBeTruthy();
    expect(screen.getByText('Firmware 1.2.4 · battery 82 % · brightness 80 %')).toBeTruthy();
    for (const name of ['Task key color', 'When nothing runs', 'Windows notifications on the bar', 'What the bar shows first', 'Connection']) {
      expect(row(name)).toBeTruthy();
    }
    expect(screen.getByRole('heading', { name: 'Stream Deck' })).toBeTruthy();
    expect(screen.queryByText(/DIAGNOSTICS & TELEMETRY/)).toBeNull();
  });

  it('BarLine_NotAnswering_SaysWhereItIsLooked For', async () => {
    installElectronApi({ getDeviceStatus: async () => ({ ...CONNECTED_DEVICE, connected: false, ipAddress: '10.0.4.21' }) });
    render(<DeviceSettings />);

    expect(await screen.findByRole('group', { name: 'Not answering at 10.0.4.21' })).toBeTruthy();
  });

  it('TaskKeyColor_StoredColour_ListOpensOnIt', async () => {
    // The list had no value: it opened on the first entry whatever was chosen.
    installElectronApi({ getColorTheme: vi.fn().mockResolvedValue('retro_arcade') });
    render(<DeviceSettings />);

    const list = await screen.findByRole('combobox', { name: 'Task key color' }) as HTMLSelectElement;
    await waitFor(() => expect(list.value).toBe('retro_arcade'));
    expect(list.selectedOptions[0].textContent).toBe('Amber');
  });

  it('TaskKeyColor_Changed_SendsIt', async () => {
    const bridge = installElectronApi();
    render(<DeviceSettings />);
    const list = await screen.findByRole('combobox', { name: 'Task key color' }) as HTMLSelectElement;

    fireEvent.change(list, { target: { value: 'nordic_cyan' } });

    expect(bridge.api.setColorTheme).toHaveBeenCalledWith('nordic_cyan');
    expect(list.value).toBe('nordic_cyan');
  });

  it('TaskKeyColor_Refused_TakesItBackAndSaysSo', async () => {
    installElectronApi({ setColorTheme: vi.fn().mockRejectedValue(new Error('bar away')) });
    render(<DeviceSettings />);
    const list = await screen.findByRole('combobox', { name: 'Task key color' }) as HTMLSelectElement;
    await waitFor(() => expect(list.value).toBe('emerald'));

    fireEvent.change(list, { target: { value: 'nordic_cyan' } });

    expect((await within(row('Task key color')).findByRole('alert')).textContent).toMatch(/bar away/);
    expect(list.value).toBe('emerald');
  });

  it('WhenNothingRuns_TurnedOff_SavesTheBarSetting', async () => {
    const bridge = installElectronApi();
    render(<DeviceSettings />);
    const toggle = await screen.findByRole('switch', { name: "Show the bar's own clock when nothing runs" }) as HTMLInputElement;
    await waitFor(() => expect(toggle.disabled).toBe(false));

    fireEvent.click(toggle);

    await waitFor(() => expect(bridge.api.setDeviceConfig).toHaveBeenCalledWith(expect.objectContaining({ showIdleClockFallback: false })));
    expect(screen.getByText('SprintTicker keeps its own idle screen on the bar.')).toBeTruthy();
  });

  it('Notifications_NotListening_AsksForWindowsAccess', async () => {
    const bridge = installElectronApi({ getNotificationListenerStatus: listener(false) });
    render(<DeviceSettings />);

    fireEvent.click(await ready('Grant access'));

    expect(bridge.api.openNotificationSettings).toHaveBeenCalledTimes(1);
    expect(within(row('Windows notifications on the bar')).getByText(/^Windows access needed, then choose which apps show: \d+ apps known\.$/)).toBeTruthy();
  });

  it('Notifications_Listening_NoAccessButton', async () => {
    installElectronApi({ getNotificationListenerStatus: listener(true) });
    render(<DeviceSettings />);

    expect(await screen.findByText(/^Choose which apps show: \d+ apps known\.$/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Grant access' })).toBeNull();
  });

  it('Notifications_ChooseApps_AppChoiceSavesTheWholeSettings', async () => {
    const bridge = installElectronApi();
    render(<DeviceSettings />);
    fireEvent.click(await ready('Choose apps…'));
    const discord = await screen.findByRole('group', { name: 'Discord' });

    fireEvent.click(within(discord).getByRole('button', { name: 'High priority' }));

    await waitFor(() => expect(bridge.api.saveNotificationSettings).toHaveBeenCalledWith(expect.objectContaining({
      enableListener: true,
      sourceRules: expect.arrayContaining([expect.objectContaining({ appId: 'discord', priorityMode: 'HIGH_PRIORITY' })])
    })), { timeout: AUTO_SAVE_DELAY_MS * 3 });
  });

  it('Notifications_HideTextAndForget_EachSaved', async () => {
    const bridge = installElectronApi();
    render(<DeviceSettings />);
    fireEvent.click(await ready('Choose apps…'));
    const slack = await screen.findByRole('group', { name: 'Slack' });

    fireEvent.click(within(slack).getByRole('checkbox', { name: /Hide the message text/ }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Discord' })).getByRole('button', { name: 'Forget Discord' }));

    await waitFor(() => {
      const saved = vi.mocked(bridge.api.saveNotificationSettings).mock.calls.at(-1)?.[0];
      // Slack's text is hidden by default: the box shows it again.
      expect(saved?.sourceRules?.find(r => r.appId === 'slack')?.hideMessageBody).toBe(false);
      expect(saved?.sourceRules?.some(r => r.appId === 'discord')).toBe(false);
    }, { timeout: AUTO_SAVE_DELAY_MS * 3 });
  });

  it('Notifications_TestAnApp_SendsATestNotification', async () => {
    const bridge = installElectronApi();
    render(<DeviceSettings />);
    fireEvent.click(await ready('Choose apps…'));

    fireEvent.click(within(await screen.findByRole('group', { name: 'Slack' })).getByRole('button', { name: 'Test Slack' }));

    expect(bridge.api.simulateNotification).toHaveBeenCalledWith(expect.objectContaining({ appId: 'slack', appName: 'Slack' }));
  });

  it('Notifications_TurnedOff_SavesAndHidesTheApps', async () => {
    const bridge = installElectronApi();
    render(<DeviceSettings />);
    await ready('Choose apps…');

    fireEvent.click(screen.getByRole('switch', { name: 'Show Windows notifications on the bar' }));

    expect(screen.getByText('Off: nothing from Windows reaches the bar.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Choose apps…' })).toBeNull();
    await waitFor(() => expect(bridge.api.saveNotificationSettings).toHaveBeenCalledWith(expect.objectContaining({ enableListener: false })),
      { timeout: AUTO_SAVE_DELAY_MS * 3 });
  });

  it('WhatTheBarShowsFirst_Open_ShowsTheRules', async () => {
    installElectronApi();
    render(<DeviceSettings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open…' }));

    expect(await screen.findByText(/The list is the order the display goes by/)).toBeTruthy();
  });

  it('Connection_SaveAndReconnect_SendsTheDraftOnce', async () => {
    const bridge = installElectronApi();
    render(<DeviceSettings />);
    fireEvent.click(await ready('Change…'));
    const address = within(row('Connection')).getByLabelText('Address');
    const save = screen.getByRole('button', { name: 'Save and reconnect' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(address, { target: { value: '10.0.4.21' } });
    fireEvent.click(save);

    await waitFor(() => expect(bridge.api.setDeviceConfig).toHaveBeenCalledWith(expect.objectContaining({ ipAddress: '10.0.4.21' })));
    expect(bridge.api.setDeviceConfig).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Now dialling 10\.0\.4\.21/)).toBeTruthy();
  });

  it('Connection_AddressWithAPath_RefusedBeforeSaving', async () => {
    installElectronApi();
    render(<DeviceSettings />);
    fireEvent.click(await ready('Change…'));

    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'http://10.0.4.21/api' } });

    expect(screen.getByRole('alert').textContent).toMatch(/no http:\/\/, port or path/);
    expect((screen.getByRole('button', { name: 'Save and reconnect' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Connection_BackToUsbDefault_PutsTheDefaultBack', async () => {
    installElectronApi({ getDeviceConfig: vi.fn().mockResolvedValue({ ...DEFAULT_DEVICE_CONFIG, ipAddress: '192.168.1.40' }) });
    render(<DeviceSettings />);
    fireEvent.click(await ready('Change…'));

    fireEvent.click(screen.getByRole('button', { name: 'Back to USB default' }));

    expect((screen.getByLabelText('Address') as HTMLInputElement).value).toBe(DEFAULT_DEVICE_CONFIG.ipAddress);
  });

  it('Connection_NotificationTiming_SavedWithTheNotificationSettings', async () => {
    const bridge = installElectronApi();
    render(<DeviceSettings />);
    fireEvent.click(await ready('Change…'));

    fireEvent.change(screen.getByRole('combobox', { name: 'How long a notification stays' }), { target: { value: '20' } });

    await waitFor(() => expect(bridge.api.saveNotificationSettings).toHaveBeenCalledWith(expect.objectContaining({ notificationTimeoutSeconds: 20 })),
      { timeout: AUTO_SAVE_DELAY_MS * 3 });
  });

  it('Deck_Connected_SaysHowManyAndOffersToInstallAgain', async () => {
    const bridge = installElectronApi({
      detectDesk: vi.fn().mockResolvedValue({ bar: { found: true, address: '10.0.4.20', connectionType: 'usb' }, deck: { installed: true, connected: true, count: 2 } })
    });
    render(<DeviceSettings />);

    expect(await screen.findByRole('group', { name: 'Connected · 2 decks' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Install the plugin again' }));

    expect(await screen.findByText(/Stream Deck asks to install it/)).toBeTruthy();
    expect(bridge.api.installDeckPlugin).toHaveBeenCalledTimes(1);
  });

  it('Deck_None_OneLineWithAdd_PluginMissingSaysSo', async () => {
    installElectronApi({ installDeckPlugin: vi.fn().mockResolvedValue(false) });
    render(<DeviceSettings />);

    const line = await screen.findByRole('group', { name: 'No Stream Deck on this computer' });
    fireEvent.click(within(line).getByRole('button', { name: 'Add' }));

    expect(await screen.findByText(/The plugin is not in this build/)).toBeTruthy();
  });

  it('EverySearchEntryOfTheGroup_IsOnThePage', async () => {
    // The search sends the user here by these names: each must be findable.
    installElectronApi();
    render(<DeviceSettings />);
    await ready('Use without a bar');
    const text = document.body.textContent ?? '';

    const shownAs: Record<string, RegExp> = {
      'BUSY Bar': /BUSY Bar/,
      'Task key color': /Task key color/,
      Connection: /Connection/,
      'When nothing runs': /When nothing runs/,
      'Use without a bar': /Use without a bar/,
      'Windows notifications on the bar': /Windows notifications on the bar/,
      'What the bar shows first': /What the bar shows first/,
      'Stream Deck': /Stream Deck/
    };
    for (const entry of SETTINGS_ENTRIES.filter(e => e.group === 'devices')) {
      expect(shownAs[entry.label], entry.label).toBeDefined();
      expect(text).toMatch(shownAs[entry.label]);
    }
  });
});
