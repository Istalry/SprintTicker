import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/renderer/App';
import { installElectronApi, TRACKING_SESSION } from './electron-api-mock';

/**
 * Every tab mounts and shows its own screen.
 *
 * A smoke test, on purpose: it asserts that each view renders against the
 * real bridge contract, not what each view says. That is the failure it
 * exists to catch -- a view that throws on mount, or calls a preload method
 * the bridge no longer has, used to be found by clicking through the app.
 */
describe('App', () => {
  const tabs: Array<[string, RegExp]> = [
    ['Projects & Tasks', /Project & Task Manager/],
    ['Work History', /Work History & Reports/],
    ['Task Providers', /TASK PROVIDERS & ACCOUNT CONFIGURATION/],
    ['Unity Engine', /UNITY ENGINE INTEGRATION/],
    ['Ceremonies', /AGILE CEREMONIES/],
    ['Notifications', /WINDOWS NOTIFICATION LISTENER/],
    ['Priority Rules', /PRIORITY MATRIX/],
    ['Device Diagnostics', /DEVICE DIAGNOSTICS & TELEMETRY/]
  ];

  it('Render_FirstLaunch_OpensOnTheActiveSession', async () => {
    render(<App />);

    expect(await screen.findByText(/No worklogs recorded today yet/)).toBeTruthy();
  });

  it.each(tabs)('Navigate_%s_MountsItsView', async (label, heading) => {
    render(<App />);

    fireEvent.click(screen.getAllByText(label)[0]);

    const title = await screen.findByRole('heading', { level: 2, name: heading });
    expect(title).toBeTruthy();
  });

  it('Render_SessionRunning_ShowsItInTodaysTable', async () => {
    installElectronApi({ getCurrentSession: async () => TRACKING_SESSION });

    render(<App />);

    const row = (await screen.findByText(/\(Active Session\)/)).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText(TRACKING_SESSION.taskKey)).toBeTruthy();
  });

  it('Render_SessionUpdateFromMain_ReachesTheScreen', async () => {
    // Main pushes session changes; the view has to follow them without a
    // reload -- a start from the bar shows up here this way.
    const bridge = installElectronApi();
    render(<App />);
    await screen.findByText(/No worklogs recorded today yet/);

    act(() => bridge.emit('onSessionUpdated', TRACKING_SESSION));

    expect(await screen.findByText(/\(Active Session\)/)).toBeTruthy();
  });

  it('EodWrapUpButton_Click_PutsThePromptOnTheBarToo', async () => {
    // Opened in the window alone, the bar went on showing the session, and a
    // START there paused it instead of confirming the wrap-up.
    const bridge = installElectronApi();
    render(<App />);

    fireEvent.click(screen.getByTitle('EOD Wrap-Up'));

    expect(await screen.findByText('End-of-Day Wrap-Up Wizard')).toBeTruthy();
    expect(bridge.api.triggerEodPrompt).toHaveBeenCalledTimes(1);
  });
});
