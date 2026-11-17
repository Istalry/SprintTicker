import { describe, it, expect, vi } from 'vitest';
import { formatHoursMinutes } from '../../src/renderer/utils/formatters';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MiniBar } from '../../src/renderer/components/MiniBar';
import { App } from '../../src/renderer/App';
import { TRACKING_SESSION, installElectronApi } from './electron-api-mock';
import { getBitmapById } from '../../src/shared/pixel-bitmaps';
import type { ScreenIconDTO, TaskDTO } from '../../src/shared/dtos';
import { MiniPromptRow } from '../../src/renderer/components/MiniPromptRow';

/**
 * The always-on-top mini timer: the bar's screen, for people without one.
 * It holds no state of its own -- what it shows comes from main, so a pause
 * made anywhere else must reach it.
 */
describe('mini timer', () => {
  it('Render_NoSession_SaysSoAndOffersToStartATask', async () => {
    const bridge = installElectronApi();
    render(<MiniBar />);

    expect(await screen.findByText('Nothing timing')).toBeTruthy();
    expect(screen.queryByLabelText('Pause')).toBeNull();
    expect(screen.queryByLabelText('Stop')).toBeNull();

    fireEvent.click(screen.getByLabelText('Start a task'));
    expect(bridge.api.openTaskPicker).toHaveBeenCalledTimes(1);
  });

  it('Interrupt_OneClick_StartsAnInterruption', async () => {
    const bridge = installElectronApi({ getCurrentSession: async () => TRACKING_SESSION });
    render(<MiniBar />);
    await screen.findByText('SPR-142');

    fireEvent.click(screen.getByLabelText('Interrupt'));

    await waitFor(() => expect(bridge.api.interrupt).toHaveBeenCalledWith({ source: 'mini' }));
  });

  it('DuringAnInterruption_PauseStopAndAnother_NoBack', async () => {
    const during = {
      ...TRACKING_SESSION,
      sessionId: 'int_1',
      taskId: 'int_1',
      taskKey: 'ADHOC',
      taskTitle: 'Interruption 10:30',
      isAdHoc: true,
      interruption: {
        id: 'int_1', name: null, title: 'Interruption 10:30', startedAtUtc: '2026-11-10T09:00:00.000Z', index: 2,
        source: 'window' as const, interruptedSessionId: 's1', interruptedTaskKey: 'SPR-142',
        interruptedTaskTitle: 'The task', interruptedWasPaused: false
      }
    };
    const bridge = installElectronApi({ getCurrentSession: async () => during });
    render(<MiniBar />);
    await screen.findByText('during SPR-142');

    // Paused and stopped as a task is (2026-11-16); Stop goes back.
    expect(screen.queryByLabelText('Back to SPR-142')).toBeNull();
    fireEvent.click(screen.getByLabelText('Pause'));
    fireEvent.click(screen.getByLabelText('Stop'));
    fireEvent.click(screen.getByLabelText('Another'));

    await waitFor(() => expect(bridge.api.pauseSession).toHaveBeenCalledTimes(1));
    expect(bridge.api.stopInterruption).toHaveBeenCalledTimes(1);
    expect(bridge.api.backFromInterruption).not.toHaveBeenCalled();
    expect(bridge.api.interrupt).toHaveBeenCalledWith({ source: 'mini' });
    // Stop ends the interruption alone: no choice of done or discard.
    expect(screen.queryByRole('group', { name: 'End the session' })).toBeNull();
  });

  it('Assign_AdHocSession_OpensTheDashboardsPickerToAssign', async () => {
    const interruption = { ...TRACKING_SESSION, taskId: 'adhoc_1_x', taskKey: 'MISC-1', taskTitle: 'Interruption 10:30', isAdHoc: true };
    const bridge = installElectronApi({ getCurrentSession: async () => interruption });
    render(<MiniBar />);
    await screen.findByText('Interruption 10:30');

    fireEvent.click(screen.getByLabelText('Place on a task'));

    await waitFor(() => expect(bridge.api.openAssignPicker).toHaveBeenCalledTimes(1));
  });

  it('Render_ProviderTask_OffersNoAssign', async () => {
    installElectronApi({ getCurrentSession: async () => TRACKING_SESSION });
    render(<MiniBar />);
    await screen.findByText('SPR-142');

    expect(screen.queryByLabelText('Place on a task')).toBeNull();
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

  describe('ending a session', () => {
    // Stop offers the three ways to end a session in place of the buttons.
    // It used to log the time and nothing else, so finishing a task or
    // throwing away one started by mistake meant opening the dashboard.
    const openEndings = async () => {
      const bridge = installElectronApi({ getCurrentSession: async () => TRACKING_SESSION });
      render(<MiniBar />);
      fireEvent.click(await screen.findByLabelText('Stop'));
      return bridge;
    };

    it('Stop_Stop_LogsTheTimeWithoutMarkingTheTaskDone', async () => {
      const bridge = await openEndings();

      fireEvent.click(screen.getByText('Stop'));

      expect(bridge.api.completeSession).toHaveBeenCalledWith(undefined, false);
      expect(await screen.findByText('Nothing timing')).toBeTruthy();
    });

    it('Stop_Done_LogsAndMarksTheTaskDone', async () => {
      const bridge = await openEndings();

      fireEvent.click(screen.getByText('Done'));

      expect(bridge.api.completeSession).toHaveBeenCalledWith(undefined, true);
    });

    it('Stop_DiscardConfirmed_DiscardsAndLogsNothing', async () => {
      const bridge = await openEndings();

      fireEvent.click(screen.getByText('Discard…'));
      fireEvent.click(screen.getByText('Yes'));

      expect(bridge.api.discardSession).toHaveBeenCalledTimes(1);
      expect(bridge.api.completeSession).not.toHaveBeenCalled();
      expect(await screen.findByText('Nothing timing')).toBeTruthy();
    });

    it('Stop_DiscardRefused_KeepsTheSessionAndOffersTheChoicesAgain', async () => {
      const bridge = await openEndings();

      fireEvent.click(screen.getByText('Discard…'));
      fireEvent.click(screen.getByText('No'));

      expect(bridge.api.discardSession).not.toHaveBeenCalled();
      expect(screen.getByText('Stop')).toBeTruthy();
    });

    it('Stop_ThenKeep_GivesTheButtonsBack', async () => {
      const bridge = await openEndings();

      fireEvent.click(screen.getByLabelText('Keep timing'));

      expect(screen.getByLabelText('Pause')).toBeTruthy();
      expect(bridge.api.completeSession).not.toHaveBeenCalled();
    });

    it('Stop_DoneOnAnUnlistedTask_AsksFirst', async () => {
      const bridge = installElectronApi({ getCurrentSession: async () => ({ ...TRACKING_SESSION, taskUnlisted: true }) });
      render(<MiniBar />);
      expect(await screen.findByText('SPR-142 · No longer assigned to you')).toBeTruthy();
      fireEvent.click(screen.getByLabelText('Stop'));

      fireEvent.click(screen.getByText('Done'));
      expect(bridge.api.completeSession).not.toHaveBeenCalled();
      fireEvent.click(screen.getByText('Yes'));

      expect(bridge.api.completeSession).toHaveBeenCalledWith(undefined, true);
    });

    it('Stop_DoneOnATaskClosedThere_FinishesWithoutAsking', async () => {
      const bridge = installElectronApi({
        getCurrentSession: async () => ({ ...TRACKING_SESSION, taskUnlisted: true, taskLeftBecause: 'closed' as const })
      });
      render(<MiniBar />);
      expect(await screen.findByText('SPR-142 · Closed in your provider')).toBeTruthy();
      fireEvent.click(screen.getByLabelText('Stop'));

      fireEvent.click(screen.getByText('Done'));

      expect(bridge.api.completeSession).toHaveBeenCalledWith(undefined, true);
    });

    it('Stop_SessionEndsElsewhere_TheQuestionGoesWithIt', async () => {
      // Stopped from the bar while the choice was open: the next session
      // must not open on a question about the last one.
      const bridge = await openEndings();

      act(() => bridge.emit('onSessionUpdated', null));
      act(() => bridge.emit('onSessionUpdated', { ...TRACKING_SESSION, sessionId: 'sess-next' }));

      expect(await screen.findByLabelText('Pause')).toBeTruthy();
      expect(screen.queryByRole('group', { name: 'End the session' })).toBeNull();
    });
  });

  it('SessionUpdated_ElsewhereInTheApp_ReachesTheMiniTimer', async () => {
    const bridge = installElectronApi();
    render(<MiniBar />);
    await screen.findByText('Nothing timing');

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

/**
 * The bar's icon beside the timer: what holds the bar now, so someone
 * without one sees what it would say. It follows main, never the session.
 */
describe('mini timer: the screen icon', () => {
  const gear: ScreenIconDTO = { pixels: getBitmapById('compiling'), label: 'COMPILING' };
  const burger: ScreenIconDTO = { pixels: getBitmapById('burger'), label: 'LUNCH' };

  it('Render_BarShowsAScreen_ShowsItsIconNamedByItsText', async () => {
    installElectronApi({ getCurrentSession: async () => TRACKING_SESSION, getScreenIcon: async () => gear });
    render(<MiniBar />);

    const icon = await screen.findByRole('img', { name: 'COMPILING' });
    expect(icon.getAttribute('title')).toBe('COMPILING');
    // One square per lit LED, none for the dark ones.
    const lit = gear.pixels.flat().filter(Boolean).length;
    expect(icon.querySelectorAll('rect')).toHaveLength(lit);
    // The row is still the session's.
    expect(screen.getByText('SPR-142')).toBeTruthy();
  });

  it('Render_FirmwaresClock_ShowsNoIcon', async () => {
    installElectronApi();
    render(<MiniBar />);
    await screen.findByText('Nothing timing');

    expect(screen.queryByRole('img')).toBeNull();
  });

  it('Push_TheBarChangesScreen_FollowsIt', async () => {
    const bridge = installElectronApi({ getScreenIcon: async () => gear });
    render(<MiniBar />);
    await screen.findByRole('img', { name: 'COMPILING' });

    act(() => bridge.emit('onScreenIcon', burger));
    expect(screen.getByRole('img', { name: 'LUNCH' })).toBeTruthy();

    act(() => bridge.emit('onScreenIcon', null));
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('Read_AnsweredAfterAPush_KeepsThePush', async () => {
    // Main tells only of changes: an answer older than a push is stale.
    let answer: (icon: ScreenIconDTO | null) => void = () => undefined;
    const bridge = installElectronApi({ getScreenIcon: vi.fn().mockReturnValue(new Promise(resolve => { answer = resolve; })) });
    render(<MiniBar />);

    act(() => bridge.emit('onScreenIcon', burger));
    await act(async () => answer(gear));

    expect(screen.getByRole('img', { name: 'LUNCH' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'COMPILING' })).toBeNull();
  });

  describe('a question (P8c)', () => {
    const HELD = { taskKey: 'SPR-142', taskTitle: 'Rework the pause menu', after: 'lunch' as const, held: true as const };

    it('BackAtYourDesk_TakesTheRowUntilAnswered', async () => {
      const bridge = installElectronApi({ getCurrentSession: async () => ({ ...TRACKING_SESSION, status: 'PAUSED' as const }), getResumePrompt: async () => HELD });
      render(<MiniBar />);

      expect(await screen.findByText('Back at your desk?')).toBeTruthy();
      expect(screen.getByText('Lunch over · SPR-142')).toBeTruthy();
      expect(screen.queryByLabelText('Resume')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'I worked through it' }));

      expect(bridge.api.answerResumePrompt).toHaveBeenCalledWith(true, undefined, true);
      expect(screen.queryByText('Back at your desk?')).toBeNull();
      expect(await screen.findByLabelText('Resume')).toBeTruthy();
    });

    it('BackAtYourDesk_ResumeAndNotNow_AnswerMain', async () => {
      const bridge = installElectronApi({ getResumePrompt: async () => HELD });
      render(<MiniBar />);

      fireEvent.click(await screen.findByRole('button', { name: '▶ Resume' }));

      expect(bridge.api.answerResumePrompt).toHaveBeenCalledWith(true, undefined, undefined);
    });

    it('BackAtYourDesk_TheHeadingSaysWhenLunchEnded', async () => {
      const ended = new Date(2026, 10, 17, 13, 30).toISOString();
      installElectronApi({ getResumePrompt: async () => ({ ...HELD, breakEndedAtUtc: ended }) });
      render(<MiniBar />);
      const clock = formatHoursMinutes(new Date(ended));

      expect(await screen.findByText(`Lunch over at ${clock} · SPR-142`)).toBeTruthy();
      expect(screen.getByRole('button', { name: '▶ Resume' }).getAttribute('title')).toBe(`Resume SPR-142, timed from ${clock}`);
    });

    it('Standup_JoinFromTheRow', async () => {
      const bridge = installElectronApi({ getCeremonyPrompt: async () => ({ type: 'STANDUP' as const, title: 'Daily Stand-Up', at: '09:30' }) });
      render(<MiniBar />);

      expect(await screen.findByText('Stand-up at 09:30')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Join' }));

      expect(bridge.api.joinStandup).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Stand-up at 09:30')).toBeNull();
    });

    it('Asked_WhileTheWindowIsOpen_AppearsAndGoesWhenAnsweredElsewhere', async () => {
      const bridge = installElectronApi();
      render(<MiniBar />);
      await screen.findByText('Nothing timing');

      act(() => bridge.emit('onResumePrompt', { ...HELD, after: 'interruption' as const, held: undefined }));
      expect(screen.getByText('Back to SPR-142?')).toBeTruthy();

      act(() => bridge.emit('onResumePrompt', null));
      expect(screen.queryByText('Back to SPR-142?')).toBeNull();
    });
  });
});

/** S25's states (P12d): each with its words and its buttons, in S25's order. */
describe('mini timer: the states of S25', () => {
  const INTERRUPTION = {
    ...TRACKING_SESSION,
    sessionId: 'int_1',
    taskId: 'int_1',
    taskKey: 'ADHOC',
    taskTitle: 'Interruption 10:30',
    isAdHoc: true,
    interruption: {
      id: 'int_1', name: null, title: 'Interruption 10:30', startedAtUtc: '2026-11-10T09:00:00.000Z', index: 1,
      source: 'deck' as const, interruptedSessionId: 's1', interruptedTaskKey: 'SPR-142',
      interruptedTaskTitle: 'The task', interruptedWasPaused: false
    }
  };
  const PREVIOUS = { id: 't-31', key: 'PF-31', title: 'Lantern glow' } as TaskDTO;
  // The row's buttons; the title's own Rename is not one of them.
  const labels = () => screen.getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent).filter(l => !l?.startsWith('Rename'));

  it('Running_ButtonsInOrder_WithPreviousAndTheCount', async () => {
    const bridge = installElectronApi({
      getCurrentSession: async () => TRACKING_SESSION,
      getPreviousTask: async () => PREVIOUS,
      getInterruptionsToPlace: vi.fn().mockResolvedValue([{}, {}, {}])
    });
    render(<MiniBar />);

    await screen.findByLabelText('Previous task: PF-31');
    expect(await screen.findAllByText((_, el) => el?.textContent === '⚡3 to place')).toBeTruthy();
    expect(labels()).toEqual(['Pause', 'Stop', 'Interrupt', 'Switch task', 'Previous task: PF-31', 'Close the mini timer']);

    fireEvent.click(screen.getByLabelText('Previous task: PF-31'));
    await waitFor(() => expect(bridge.api.startTask).toHaveBeenCalledWith('t-31', false, 'Lantern glow'));
  });

  it('Paused_SaysSoWithTheKey', async () => {
    installElectronApi({ getCurrentSession: async () => ({ ...TRACKING_SESSION, status: 'PAUSED' }) });
    render(<MiniBar />);

    expect(await screen.findByText(/Paused ·/)).toBeTruthy();
    expect(screen.getByLabelText('Resume')).toBeTruthy();
  });

  it('SomeoneElsesTask_SaysWhoseItIsNow', async () => {
    installElectronApi({
      getCurrentSession: async () => ({ ...TRACKING_SESSION, taskUnlisted: true, taskLeftBecause: 'reassigned' as const, taskOwnerName: 'Rin Okada' })
    });
    render(<MiniBar />);

    expect(await screen.findByText("SPR-142 · Rin's now")).toBeTruthy();
  });

  it('NothingTiming_InWorkingHours_IsLoud_WithWhatWaitsToBePlaced', async () => {
    installElectronApi({ isWorkingNow: async () => true, getInterruptionsToPlace: vi.fn().mockResolvedValue([{}, {}, {}]) });
    render(<MiniBar />);

    expect(await screen.findByText('3 to place', { exact: false })).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Nothing timing').className).toContain('text-accent-amber'));
    expect(screen.getByLabelText('Start a task')).toBeTruthy();
  });

  it('NothingTiming_OutsideWorkingHours_IsQuiet', async () => {
    installElectronApi({ isWorkingNow: async () => false });
    render(<MiniBar />);

    expect((await screen.findByText('Nothing timing')).className).not.toContain('text-accent-amber');
  });

  it('Interruption_FromTheDeck_OffersStartedEarlierAndPlace', async () => {
    const bridge = installElectronApi({ getCurrentSession: async () => INTERRUPTION });
    render(<MiniBar />);

    expect(await screen.findByText(/from the deck/)).toBeTruthy();
    expect(labels()).toEqual(['Pause', 'Place it on a task', 'Another', 'Stop', 'Close the mini timer']);

    fireEvent.change(screen.getByLabelText('When it started'), { target: { value: '5' } });
    expect(bridge.api.moveInterruptionStart).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Place it on a task'));
    await waitFor(() => expect(bridge.api.openPlacePicker).toHaveBeenCalledTimes(1));
  });

  it('Interruption_FromThisScreen_NoStartedChoice', async () => {
    installElectronApi({ getCurrentSession: async () => ({ ...INTERRUPTION, interruption: { ...INTERRUPTION.interruption, source: 'mini' as const } }) });
    render(<MiniBar />);

    await screen.findByText('during SPR-142');
    expect(screen.queryByLabelText('When it started')).toBeNull();
  });

  it('StandupRunning_SaysWhereItGoesBack_AndEndsIt', async () => {
    const bridge = installElectronApi({
      getCurrentSession: async () => ({ ...TRACKING_SESSION, taskTitle: 'Daily Standup', isAdHoc: true }),
      getStandupRunning: async () => ({ returnsToKey: 'PF-31' })
    });
    render(<MiniBar />);

    expect(await screen.findByText('then back to PF-31, as it was')).toBeTruthy();
    fireEvent.click(screen.getByText('End stand-up'));

    expect(bridge.api.completeSession).toHaveBeenCalledWith(undefined, false);
  });

  it('Stopping_TheDevicesOrder_DoneStopDiscard', async () => {
    installElectronApi({ getCurrentSession: async () => TRACKING_SESSION });
    render(<MiniBar />);
    fireEvent.click(await screen.findByLabelText('Stop'));

    expect(screen.getByText('Stop SPR-142')).toBeTruthy();
    expect(screen.getByText(/logs 1h 23m · Discard keeps nothing/)).toBeTruthy();
    expect(labels()).toEqual(['Done', 'Stop', 'Discard…', 'Keep timing']);
  });

  it('Tour_FirstOpen_NamesTheButtons_UntilPutAway', async () => {
    const bridge = installElectronApi({
      getCurrentSession: async () => TRACKING_SESSION,
      getFlowSetting: vi.fn().mockResolvedValue(false)
    });
    render(<MiniBar />);

    expect(await screen.findByText(/pause · stop · interrupt/)).toBeTruthy();
    fireEvent.click(screen.getByText('Got it'));

    expect(bridge.api.saveFlowSetting).toHaveBeenCalledWith('mini_tour_seen', true);
    expect(await screen.findByText('Rework the pause menu')).toBeTruthy();
  });

  it('BackQuestion_SaysTheMinutesUntracked_AndBacksThemIn', () => {
    installElectronApi();
    const ended = new Date(Date.now() - 6 * 60_000).toISOString();
    render(
      <MiniPromptRow
        resume={{ taskKey: 'SPR-142', taskTitle: 'T', after: 'interruption', unlisted: false, interruptionEndedAtUtc: ended } as never}
        ceremony={null}
        onAnswered={() => undefined}
      />
    );

    expect(screen.getByText('Back to SPR-142? 6 min not timed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back, add the 6 min' }));
    expect(window.electronAPI.answerResumePrompt).toHaveBeenCalledWith(true, 6, undefined);
  });
});
