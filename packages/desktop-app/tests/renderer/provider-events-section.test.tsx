import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SettingsView } from '../../src/renderer/views/Settings/SettingsView';
import { ProviderEventsSection } from '../../src/renderer/components/ProviderEventsSection';
import { DEFAULT_PROVIDER_EVENT_SETTINGS } from '../../src/shared/provider-events';
import { installElectronApi } from './electron-api-mock';

/**
 * Notifications from the task provider: which events, and where they go.
 * In Task Providers rather than the Notifications tab, because that tab is
 * about the bar and is hidden without one -- and toasts matter most there.
 */
describe('provider notifications', () => {
  it('SettingsView_OpenProject_OffersThem', async () => {
    installElectronApi();
    render(<SettingsView />);

    expect(await screen.findByText('Notifications from OpenProject')).toBeTruthy();
  });

  it('SettingsView_ProviderWithoutEvents_OffersNothing', async () => {
    const bridge = installElectronApi({
      getProviders: vi.fn().mockResolvedValue({ activeProviderId: 'adhoc', fallbackTicketKey: 'MISC-1' })
    });
    render(<SettingsView />);

    await waitFor(() => expect(bridge.api.getProviders).toHaveBeenCalled());
    await screen.findByDisplayValue('Ad-Hoc / Custom Local Fallback');
    expect(screen.queryByText(/Notifications from/)).toBeNull();
  });

  it('Section_NoBar_DoesNotOfferTheBar', async () => {
    installElectronApi();
    render(<ProviderEventsSection providerName="OpenProject" hasBar={false} />);

    expect(await screen.findByText('Windows notification')).toBeTruthy();
    expect(screen.queryByText('Banner on the BUSY Bar')).toBeNull();
  });

  it('Section_KindTurnedOff_IsSaved', async () => {
    const bridge = installElectronApi();
    render(<ProviderEventsSection providerName="OpenProject" hasBar />);

    fireEvent.click(await screen.findByLabelText('Comments'));

    await waitFor(() =>
      expect(bridge.api.saveProviderEventSettings).toHaveBeenCalledWith(
        expect.objectContaining({ kinds: expect.objectContaining({ commented: false, mentioned: true }) })
      ),
      { timeout: 3000 }
    );
  });

  it('Section_StoredSettings_AreWhatItShows', async () => {
    installElectronApi({
      getProviderEventSettings: vi.fn().mockResolvedValue({
        ...DEFAULT_PROVIDER_EVENT_SETTINGS,
        pollIntervalSeconds: 300,
        kinds: { ...DEFAULT_PROVIDER_EVENT_SETTINGS.kinds, date_alert: false }
      })
    });
    render(<ProviderEventsSection providerName="OpenProject" hasBar />);

    expect(await screen.findByDisplayValue('300')).toBeTruthy();
    expect((screen.getByLabelText('Date alerts') as HTMLInputElement).checked).toBe(false);
  });

  it('Section_Disabled_GreysOutTheRest', async () => {
    installElectronApi({
      getProviderEventSettings: vi.fn().mockResolvedValue({ ...DEFAULT_PROVIDER_EVENT_SETTINGS, enabled: false })
    });
    render(<ProviderEventsSection providerName="OpenProject" hasBar />);

    await waitFor(() =>
      expect((screen.getByLabelText('Tell me when something happens on my tasks') as HTMLInputElement).checked).toBe(false)
    );
    // Disabled through the fieldset, which sets no attribute on the input.
    expect(screen.getByLabelText('Mentions').matches(':disabled')).toBe(true);
  });

  it('TestButton_SaysWhereItWent', async () => {
    const bridge = installElectronApi({ testProviderEvents: vi.fn().mockResolvedValue({ toast: true, bar: true }) });
    render(<ProviderEventsSection providerName="OpenProject" hasBar />);

    fireEvent.click(await screen.findByText('Send a test notification'));

    expect(await screen.findByText('Sent as a Windows notification and to the bar.')).toBeTruthy();
    expect(bridge.api.testProviderEvents).toHaveBeenCalledTimes(1);
  });

  it('TestButton_NothingSwitchedOn_SaysSo', async () => {
    installElectronApi({ testProviderEvents: vi.fn().mockResolvedValue({ toast: false, bar: false }) });
    render(<ProviderEventsSection providerName="OpenProject" hasBar />);

    fireEvent.click(await screen.findByText('Send a test notification'));

    expect(await screen.findByText('Nothing sent: every destination is off.')).toBeTruthy();
  });

  it('TestButton_Fails_SaysSo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installElectronApi({ testProviderEvents: vi.fn().mockRejectedValue(new Error('ipc')) });
    render(<ProviderEventsSection providerName="OpenProject" hasBar />);

    fireEvent.click(await screen.findByText('Send a test notification'));

    expect(await screen.findByText('The test notification failed. See the log.')).toBeTruthy();
  });
});
