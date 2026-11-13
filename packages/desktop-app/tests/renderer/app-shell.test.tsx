import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/renderer/App';
import { windowPickerWanted } from '../../src/renderer/hooks/useModals';
import { CONNECTED_DEVICE, NO_BAR_DEVICE, TRACKING_SESSION, installElectronApi } from './electron-api-mock';
import type { InterruptionToPlaceDTO } from '../../src/shared/interruption';

const placeNames = () =>
  within(screen.getByRole('navigation', { name: 'Places' }))
    .getAllByRole('button')
    .map(button => button.textContent?.replace(/\d+$/, '').trim());

/** The shell (S4, S5): four places, the header, nothing hidden for want of a bar. */
describe('the app shell', () => {
  it.each([
    ['WithABar', CONNECTED_DEVICE],
    ['NoBar', NO_BAR_DEVICE]
  ])('Render_%s_ShowsTheSameFourPlaces', async (_label, device) => {
    installElectronApi({ getDeviceStatus: async () => device });
    render(<App />);

    await screen.findByText(/Nothing logged today yet/);
    expect(placeNames()).toEqual(['Today', 'Tasks', 'History', 'Settings']);
  });

  it('Render_NoBar_HasNoLedPreview_AndKeepsTheHeader', async () => {
    installElectronApi({ getDeviceStatus: async () => NO_BAR_DEVICE });
    render(<App />);

    await waitFor(() => expect(screen.queryByTitle(/72x16 RGB LED Matrix/)).toBeNull());
    expect(screen.getByRole('button', { name: /End my day/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Mode:/ })).toBeTruthy();
  });

  it('Render_BarAddedLater_BringsTheLedPreviewBack', async () => {
    const bridge = installElectronApi({ getDeviceStatus: async () => NO_BAR_DEVICE });
    render(<App />);
    await screen.findByText(/Nothing logged today yet/);

    act(() => bridge.emit('onDeviceStatusChanged', CONNECTED_DEVICE));

    expect(await screen.findByTitle(/72x16 RGB LED Matrix/)).toBeTruthy();
  });

  it('Today_InterruptionsToPlace_AreCountedBesideIt', async () => {
    const one = { id: 'int_1' } as unknown as InterruptionToPlaceDTO;
    const bridge = installElectronApi({ getInterruptionsToPlace: async () => [one, { ...one, id: 'int_2' }] });
    render(<App />);

    const places = screen.getByRole('navigation', { name: 'Places' });
    expect(await within(places).findByRole('button', { name: 'Today, 2 to place' })).toBeTruthy();
    // One more ends on the bar: main sends the list.
    act(() => bridge.emit('onInterruptionsUpdated', [one, { ...one, id: 'int_2' }, { ...one, id: 'int_3' }]));
    expect(await within(places).findByRole('button', { name: 'Today, 3 to place' })).toBeTruthy();
  });

  it('ModeChip_Choose_WritesTheModeMainKeeps', async () => {
    const bridge = installElectronApi();
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /Mode:/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Lunch/ }));

    expect(bridge.api.setUserMode).toHaveBeenCalledWith('LUNCH');
    expect(screen.getByRole('button', { name: /Mode: Lunch/ })).toBeTruthy();
  });

  it('ModeChip_ModeChangedElsewhere_Follows', async () => {
    const bridge = installElectronApi();
    render(<App />);
    await screen.findByRole('button', { name: /Mode: Work/ });

    act(() => bridge.emit('onUserModeUpdated', 'AWAY'));

    expect(await screen.findByRole('button', { name: /Mode: Away/ })).toBeTruthy();
  });

  it('BarWheelClick_NothingRunning_DoesNotOpenASecondPicker', async () => {
    // The bar opens its own picker then; the window's on top took the same choice.
    const bridge = installElectronApi({ getCurrentSession: async () => null });
    render(<App />);
    await screen.findByText(/Nothing logged today yet/);

    act(() => bridge.emit('onHardwareInputEvent', { inputKey: 'ok', actionAssigned: 'TRIGGER_TASK_SELECTOR_MODAL' }));

    expect(screen.queryByRole('dialog', { name: 'Start a task' })).toBeNull();
  });

  it('PickerRequestFromTheApp_NothingRunning_OpensTheWindowsPicker', async () => {
    const bridge = installElectronApi({ getCurrentSession: async () => null });
    render(<App />);
    await screen.findByText(/Nothing logged today yet/);

    act(() => bridge.emit('onHardwareInputEvent', { inputKey: 'app', actionAssigned: 'TRIGGER_TASK_SELECTOR_MODAL' }));

    expect(await screen.findByRole('dialog', { name: 'Start a task' })).toBeTruthy();
  });

  it.each([
    ['app', false, true],
    ['app', true, true],
    ['ok', true, true],
    ['ok', false, false]
  ])('WindowPickerWanted_From%s_Running%s_Is%s', (inputKey, running, expected) => {
    expect(windowPickerWanted(inputKey, running)).toBe(expected);
  });

  it('StatusEntry_BarOffline_OpensSettingsAtDeskDevices', async () => {
    installElectronApi({ getDeviceStatus: async () => ({ ...CONNECTED_DEVICE, connected: false }) });
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /Bar offline/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Status' })).getByRole('button', { name: 'Open' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Desk devices' })).toBeTruthy();
  });

  it('Render_SessionRunning_StillShowsTheTodayTable', async () => {
    installElectronApi({ getCurrentSession: vi.fn().mockResolvedValue(TRACKING_SESSION) });
    render(<App />);

    expect(await screen.findByText('running')).toBeTruthy();
  });
});
