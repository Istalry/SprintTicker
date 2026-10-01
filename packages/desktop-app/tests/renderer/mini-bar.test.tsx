import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MiniBar } from '../../src/renderer/components/MiniBar';
import { App } from '../../src/renderer/App';
import { TRACKING_SESSION, installElectronApi } from './electron-api-mock';

/**
 * The always-on-top mini timer: the bar's screen, for people without one.
 * It holds no state of its own -- what it shows comes from main, so a pause
 * made anywhere else must reach it.
 */
describe('mini timer', () => {
  it('Render_NoSession_SaysSoAndOffersToStartATask', async () => {
    const bridge = installElectronApi();
    render(<MiniBar />);

    expect(await screen.findByText('No task running')).toBeTruthy();
    expect(screen.queryByLabelText('Pause')).toBeNull();
    expect(screen.queryByLabelText('Stop')).toBeNull();

    fireEvent.click(screen.getByLabelText('Start a task'));
    expect(bridge.api.openTaskPicker).toHaveBeenCalledTimes(1);
  });

  it('Render_Tracking_ShowsTheTaskAndTheElapsedTime', async () => {
    installElectronApi({ getCurrentSession: async () => TRACKING_SESSION });
    render(<MiniBar />);

    expect(await screen.findByText('SPR-142')).toBeTruthy();
    expect(screen.getByText('Rework the pause menu')).toBeTruthy();
    // 5025 s, with the seconds: on screen they cost nothing.
    expect(screen.getByLabelText('Elapsed time').textContent).toMatch(/1:23:45/);
    expect(screen.getByLabelText('Switch task')).toBeTruthy();
  });

  it('Pause_WhileTracking_PausesAndOffersResume', async () => {
    const bridge = installElectronApi({ getCurrentSession: async () => TRACKING_SESSION });
    render(<MiniBar />);

    fireEvent.click(await screen.findByLabelText('Pause'));

    expect(bridge.api.pauseSession).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText('Resume')).toBeTruthy();
  });

  it('Resume_WhilePaused_Resumes', async () => {
    const bridge = installElectronApi({
      getCurrentSession: async () => ({ ...TRACKING_SESSION, status: 'PAUSED' })
    });
    render(<MiniBar />);

    fireEvent.click(await screen.findByLabelText('Resume'));

    expect(bridge.api.resumeSession).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText('Pause')).toBeTruthy();
  });

  it('Stop_LogsTheTimeWithoutMarkingTheTaskDone', async () => {
    // Stop is "I am done for now", not "the task is finished": closing the
    // ticket is the dashboard's decision, where the comment can be written.
    const bridge = installElectronApi({ getCurrentSession: async () => TRACKING_SESSION });
    render(<MiniBar />);

    fireEvent.click(await screen.findByLabelText('Stop'));

    expect(bridge.api.completeSession).toHaveBeenCalledWith(undefined, false);
    expect(await screen.findByText('No task running')).toBeTruthy();
  });

  it('SessionUpdated_ElsewhereInTheApp_ReachesTheMiniTimer', async () => {
    const bridge = installElectronApi();
    render(<MiniBar />);
    await screen.findByText('No task running');

    act(() => bridge.emit('onSessionUpdated', { ...TRACKING_SESSION, status: 'PAUSED' }));

    expect(await screen.findByText('SPR-142')).toBeTruthy();
    expect(screen.getByLabelText('Resume')).toBeTruthy();
  });

  it('Action_Rejected_KeepsShowingWhatMainLastSaid', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installElectronApi({
      getCurrentSession: async () => TRACKING_SESSION,
      pauseSession: async () => { throw new Error('engine refused'); }
    });
    render(<MiniBar />);

    fireEvent.click(await screen.findByLabelText('Pause'));

    await waitFor(() => expect(warn).toHaveBeenCalledWith('[MiniBar] Pause failed:', expect.any(Error)));
    expect(screen.getByLabelText('Pause')).toBeTruthy();
    warn.mockRestore();
  });

  it('Close_AsksMainToCloseTheWindow', async () => {
    const bridge = installElectronApi();
    render(<MiniBar />);

    fireEvent.click(await screen.findByLabelText('Close the mini timer'));

    expect(bridge.api.toggleMiniWindow).toHaveBeenCalledTimes(1);
  });

  it('HeaderButton_FollowsTheWindowHoweverItWasOpened', async () => {
    const bridge = installElectronApi();
    render(<App />);

    const button = await screen.findByTitle(/Open the mini timer/);
    expect(button.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(button);
    expect(bridge.api.toggleMiniWindow).toHaveBeenCalledTimes(1);

    // Opened, or closed from the tray: main says so, the header follows.
    act(() => bridge.emit('onMiniWindowVisibility', true));
    expect(screen.getByTitle('Close the mini timer').getAttribute('aria-pressed')).toBe('true');
    act(() => bridge.emit('onMiniWindowVisibility', false));
    expect(screen.getByTitle(/Open the mini timer/).getAttribute('aria-pressed')).toBe('false');
  });

  it('HeaderButton_AlreadyOpenAtLaunch_StartsPressed', async () => {
    installElectronApi({ isMiniWindowOpen: async () => true });
    render(<App />);

    await waitFor(() =>
      expect(screen.getByTitle('Close the mini timer').getAttribute('aria-pressed')).toBe('true')
    );
  });
});
