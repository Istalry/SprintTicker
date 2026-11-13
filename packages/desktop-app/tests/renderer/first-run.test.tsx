import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FirstRunDialog } from '../../src/renderer/components/FirstRun/FirstRunDialog';
import { App } from '../../src/renderer/App';
import { FlowSettingKey } from '../../src/shared/flow-settings';
import { installElectronApi } from './electron-api-mock';

const open = (overrides: Record<string, unknown> = {}) => {
  const bridge = installElectronApi(overrides);
  const props = { onClose: vi.fn(), onStartFirstTask: vi.fn() };
  render(<FirstRunDialog isOpen {...props} />);
  return { bridge, props };
};
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const type = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const chooseJira = async () => {
  fireEvent.click(await screen.findByRole('radio', { name: /^Jira/ }));
  type(/Jira site/, 'https://studio.atlassian.net');
  type(/Your email/, 'alex@studio.com');
  type(/^API token/, 't0ken');
};
const continueButton = () => screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;

/** The first run (S1–S3, P11a). */
describe('First run', () => {
  describe('S1, your tasks', () => {
    it('Jira_TestConnection_SaysWhoAndAsksTheStartQuestion', async () => {
      const { bridge } = open();
      await chooseJira();
      expect(continueButton().disabled).toBe(true);

      click('Test connection');

      expect((await screen.findByRole('status')).textContent).toBe('Connected as Alex Moreau · 15 projects');
      expect(bridge.api.testProviderConnection).toHaveBeenCalledWith({
        providerId: 'jira', site: 'https://studio.atlassian.net', email: 'alex@studio.com', token: 't0ken'
      });
      expect(screen.getByText('When you start a task, should SprintTicker change it in Jira?')).toBeTruthy();
      expect(continueButton().disabled).toBe(false);
    });

    it('Continue_SavesTheAccount_AndTheStartAnswer', async () => {
      const { bridge } = open();
      await chooseJira();
      click('Test connection');
      fireEvent.click(await screen.findByRole('button', { name: 'No, only time it' }));

      fireEvent.click(continueButton());

      await screen.findByRole('dialog', { name: "What's on your desk?" });
      expect(bridge.api.setActiveProvider).toHaveBeenCalledWith({
        providerId: 'jira', jiraSite: 'https://studio.atlassian.net', jiraEmail: 'alex@studio.com', jiraApiToken: 't0ken'
      });
      expect(bridge.api.saveFlowSetting).toHaveBeenCalledWith(FlowSettingKey.START_SIDE_EFFECTS, { enabled: false, afterSeconds: 120 });
    });

    it('EditingAfterATest_TestsAgain', async () => {
      open();
      await chooseJira();
      click('Test connection');
      await screen.findByRole('status');

      type(/^API token/, 'another');

      expect(continueButton().disabled).toBe(true);
      expect(screen.queryByRole('status')).toBeNull();
    });

    it.each([
      [{ ok: false, reason: 'not-found', host: 'studio.atlasian.net', detail: '' }, 'studio.atlasian.net was not found', /it is the one in your browser when you open Jira/],
      [{ ok: false, reason: 'refused', host: 'studio.atlassian.net', detail: '' }, 'Jira refused this token', /Make a new one ↗/],
      [{ ok: false, reason: 'network', host: 'studio.atlassian.net', detail: '' }, 'studio.atlassian.net did not answer', /Check your network connection/]
    ])('TestFailed_%#_IsWrittenOut', async (result, headline, hint) => {
      open({ testProviderConnection: vi.fn().mockResolvedValue(result) });
      await chooseJira();

      click('Test connection');

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(headline);
      expect(alert.textContent).toMatch(hint);
      expect(continueButton().disabled).toBe(true);
    });

    it('MakeOne_AsksMainForTheTokenPage', async () => {
      const { bridge } = open();
      await chooseJira();

      click('make one ↗');

      expect(bridge.api.openTokenPage).toHaveBeenCalledWith('jira', 'https://studio.atlassian.net');
    });

    it('NoAccount_ContinuesWithoutATest', async () => {
      const { bridge } = open();
      fireEvent.click(await screen.findByRole('radio', { name: /No account/ }));

      fireEvent.click(continueButton());

      await screen.findByRole('dialog', { name: "What's on your desk?" });
      expect(bridge.api.setActiveProvider).toHaveBeenCalledWith({ providerId: 'adhoc' });
      expect(bridge.api.saveFlowSetting).not.toHaveBeenCalled();
    });

    it('SetUpLater_ClosesAndIsNotAskedAgain', async () => {
      const { bridge, props } = open();

      click('Set up later');

      expect(bridge.api.finishFirstRun).toHaveBeenCalledTimes(1);
      expect(props.onClose).toHaveBeenCalledTimes(1);
      expect(bridge.api.setActiveProvider).not.toHaveBeenCalled();
    });
  });

  describe('S2, your desk', () => {
    const toDesk = async (overrides: Record<string, unknown> = {}) => {
      const opened = open(overrides);
      fireEvent.click(await screen.findByRole('radio', { name: /No account/ }));
      fireEvent.click(continueButton());
      await screen.findByRole('dialog', { name: "What's on your desk?" });
      return opened;
    };
    const box = (name: RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement;

    it('OnlyWhatWasFound_StartsTicked', async () => {
      await toDesk();

      await waitFor(() => expect(box(/A BUSY Bar/).checked).toBe(true));
      expect(box(/A Stream Deck/).checked).toBe(false);
      expect(screen.getByText(/One was found on USB, so it is ticked/)).toBeTruthy();
    });

    it('BarFound_Continue_DoesNotRedialIt', async () => {
      const { bridge } = await toDesk();
      await waitFor(() => expect(box(/A BUSY Bar/).checked).toBe(true));

      fireEvent.click(continueButton());

      await screen.findByRole('dialog', { name: 'Your day' });
      expect(bridge.api.setDeviceConfig).not.toHaveBeenCalled();
    });

    it('Neither_SavesTheNoBarMode', async () => {
      const { bridge } = await toDesk();
      await waitFor(() => expect(box(/A BUSY Bar/).checked).toBe(true));

      fireEvent.click(box(/I have neither/));
      fireEvent.click(continueButton());

      await waitFor(() => expect(bridge.api.setDeviceConfig).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })));
    });

    it('BarOnWifi_SavesItsAddress', async () => {
      const { bridge } = await toDesk({
        detectDesk: vi.fn().mockResolvedValue({ bar: { found: false, address: '10.0.4.20', connectionType: null }, deck: { installed: false, connected: false, count: 0 } })
      });
      fireEvent.click(box(/A BUSY Bar/));
      click('Mine is on Wi-Fi');
      type(/Its address on your network/, '192.168.1.42');

      fireEvent.click(continueButton());

      await waitFor(() => expect(bridge.api.setDeviceConfig).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, ipAddress: '192.168.1.42' })));
    });

    it('Deck_InstallThePlugin_OpensIt', async () => {
      const { bridge } = await toDesk();
      fireEvent.click(box(/A Stream Deck/));

      click('Install the plugin');

      expect(bridge.api.installDeckPlugin).toHaveBeenCalledTimes(1);
      expect(await screen.findByText(/Stream Deck asks to install it/)).toBeTruthy();
    });
  });

  describe('S3, your day', () => {
    it('StartMyFirstTask_SavesTheDay_AndEndsOnThePicker', async () => {
      const { bridge, props } = open();
      fireEvent.click(await screen.findByRole('radio', { name: /No account/ }));
      fireEvent.click(continueButton());
      await screen.findByRole('dialog', { name: "What's on your desk?" });
      fireEvent.click(continueButton());
      await screen.findByRole('dialog', { name: 'Your day' });

      fireEvent.change(screen.getByLabelText('Lunch starts'), { target: { value: '12:00' } });
      fireEvent.click(within(screen.getByRole('group', { name: 'Working days' })).getByRole('button', { name: /Fri/ }));
      click('Start my first task');

      await waitFor(() => expect(props.onStartFirstTask).toHaveBeenCalledTimes(1));
      expect(bridge.api.saveScheduleSettings).toHaveBeenCalledWith(expect.objectContaining({
        lunchStartTime: '12:00', workingDays: [1, 2, 3, 4]
      }));
      expect(bridge.api.finishFirstRun).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('region', { name: 'How it works' }).textContent).toMatch(/keep as its own entry/);
    });
  });

  it('App_FirstLaunch_OpensItOnItsOwn', async () => {
    installElectronApi({ shouldShowFirstRun: vi.fn().mockResolvedValue(true) });

    render(<App />);

    expect(await screen.findByRole('dialog', { name: 'Where are your tasks?' })).toBeTruthy();
  });

  it('App_SetUpBefore_DoesNotOpenIt', async () => {
    installElectronApi();

    render(<App />);
    await act(async () => undefined);

    expect(screen.queryByRole('dialog', { name: 'Where are your tasks?' })).toBeNull();
  });
});
