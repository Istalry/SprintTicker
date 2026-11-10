import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActiveTaskHeroCard } from '../../src/renderer/components/ActiveTaskHeroCard';
import { TRACKING_SESSION, installElectronApi } from './electron-api-mock';

describe('ActiveTaskHeroCard', () => {
  const card = (session = TRACKING_SESSION, onComplete = vi.fn(), onDiscard = vi.fn(), onInterrupt = vi.fn()) => {
    render(
      <ActiveTaskHeroCard
        session={session}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onComplete={onComplete}
        onDiscard={onDiscard}
        onOpenTaskModal={vi.fn()}
        onInterrupt={onInterrupt}
      />
    );
    return onComplete;
  };

  const INTERRUPTION = { ...TRACKING_SESSION, taskId: 'adhoc_1_x', taskKey: 'MISC-1', taskTitle: 'Interruption 10:30', isAdHoc: true, unsorted: true as const };

  it('Rename_AdHocSession_EnterNamesIt', async () => {
    const bridge = installElectronApi();
    card(INTERRUPTION);

    fireEvent.click(screen.getByLabelText('Rename Interruption 10:30'));
    const field = screen.getByLabelText('Name this work');
    fireEvent.change(field, { target: { value: '  Call with Marc ' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(bridge.api.renameSession).toHaveBeenCalledWith('Call with Marc');
  });

  it('Rename_Escape_KeepsTheName', () => {
    const bridge = installElectronApi();
    card(INTERRUPTION);

    fireEvent.click(screen.getByLabelText('Rename Interruption 10:30'));
    fireEvent.keyDown(screen.getByLabelText('Name this work'), { key: 'Escape' });

    expect(bridge.api.renameSession).not.toHaveBeenCalled();
    expect(screen.getByText('Interruption 10:30')).toBeTruthy();
  });

  it('Render_ProviderTask_OffersNoRenameNorAssign', () => {
    card();

    expect(screen.queryByLabelText(/^Rename /)).toBeNull();
    expect(screen.queryByText('Assign to Task')).toBeNull();
  });

  it('Render_UnsortedInterruption_SaysWhatToDoWithIt', () => {
    card(INTERRUPTION);

    expect(screen.getByText(/name it, or assign it to a task/)).toBeTruthy();
  });

  it('Assign_AdHocSession_OpensThePicker', () => {
    const onAssign = vi.fn();
    render(
      <ActiveTaskHeroCard
        session={INTERRUPTION}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onComplete={vi.fn()}
        onDiscard={vi.fn()}
        onOpenTaskModal={vi.fn()}
        onInterrupt={vi.fn()}
        onAssign={onAssign}
      />
    );

    fireEvent.click(screen.getByText('Assign to Task'));

    expect(onAssign).toHaveBeenCalledTimes(1);
  });

  it('Interrupt_OneClick_AsksNothing', () => {
    // Someone is at the desk: the timer starts on the click, nothing to fill in.
    const onInterrupt = vi.fn();
    card(TRACKING_SESSION, vi.fn(), vi.fn(), onInterrupt);

    fireEvent.click(screen.getByText('Interrupt'));

    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Render_Tracking_OffersPauseNotResume', () => {
    card();

    expect(screen.getByText('Pause')).toBeTruthy();
    expect(screen.queryByText('Resume')).toBeNull();
  });

  it('Render_Idle_OffersStartAndInterruptOnly', () => {
    // Resume and Finish used to show greyed out, with nothing to act on.
    const onOpenTaskModal = vi.fn();
    render(
      <ActiveTaskHeroCard
        session={null}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onComplete={vi.fn()}
        onDiscard={vi.fn()}
        onOpenTaskModal={onOpenTaskModal}
        onInterrupt={vi.fn()}
      />
    );

    expect(screen.getByText('No task running')).toBeTruthy();
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Start a Task', 'Interrupt']);
    fireEvent.click(screen.getByText('Start a Task'));
    expect(onOpenTaskModal).toHaveBeenCalledTimes(1);
  });

  it('Render_Tracking_SwitchOpensThePicker', () => {
    card();

    expect(screen.getByText('Switch Task')).toBeTruthy();
    expect(screen.queryByText('Start a Task')).toBeNull();
  });

  it('Render_Paused_OffersResumeNotPause', () => {
    card({ ...TRACKING_SESSION, status: 'PAUSED' });

    expect(screen.getByText('Resume')).toBeTruthy();
    expect(screen.queryByText('Pause')).toBeNull();
  });

  it('FinishAsDone_Always_LeavesTheBarsSceneToTheStop', () => {
    // session:complete plays DONE! on the bar once it has stopped the
    // session. The card also asked for it, so the scene started twice: two
    // uploads of the same file, the second over the one the bar was playing.
    const onComplete = card();

    fireEvent.click(screen.getByText('Finish & Log Hours'));
    fireEvent.click(screen.getByText(/Mark Task as 'Done'/));

    expect(onComplete).toHaveBeenCalledWith(undefined, true);
    expect(window.electronAPI.triggerConfettiBurst).not.toHaveBeenCalled();
  });

  it('FinishKeepingItOpen_Always_CompletesWithoutMarkingDone', () => {
    const onComplete = card();

    fireEvent.click(screen.getByText('Finish & Log Hours'));
    fireEvent.click(screen.getByText(/Remain 'In Progress'/));

    expect(onComplete).toHaveBeenCalledWith(undefined, false);
  });

  describe('a task that is no longer the user\'s', () => {
    const UNLISTED = { ...TRACKING_SESSION, taskUnlisted: true };

    it('Render_Unlisted_SaysSoAndThatTheTimeIsStillLogged', () => {
      card(UNLISTED);

      expect(screen.getByRole('status').textContent).toMatch(/No longer assigned to you.*time is still logged/);
    });

    it('Render_Listed_SaysNothing', () => {
      card();

      expect(screen.queryByRole('status')).toBeNull();
    });

    it('MarkDone_Unlisted_AsksBeforeFinishing', () => {
      const onComplete = card(UNLISTED);

      fireEvent.click(screen.getByText('Finish & Log Hours'));
      fireEvent.click(screen.getByText(/Mark Task as 'Done'/));

      expect(onComplete).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Mark done anyway' }));
      expect(onComplete).toHaveBeenCalledWith(undefined, true);
    });

    it('MarkDone_UnlistedThenBack_FinishesNothing', () => {
      const onComplete = card(UNLISTED);

      fireEvent.click(screen.getByText('Finish & Log Hours'));
      fireEvent.click(screen.getByText(/Mark Task as 'Done'/));
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));

      expect(onComplete).not.toHaveBeenCalled();
      expect(screen.getByText(/Remain 'In Progress'/)).toBeTruthy();
    });

    it.each([
      ['closed', /Closed on the provider/],
      ['gone', /No longer on the provider/],
      ['reassigned', /No longer assigned to you/]
    ] as const)('Render_LeftBecause%s_SaysWhy', (reason, text) => {
      card({ ...UNLISTED, taskLeftBecause: reason });

      expect(screen.getByRole('status').textContent).toMatch(text);
    });

    it('MarkDone_ClosedThere_FinishesWithoutAsking', () => {
      // Nothing to move on a task already closed, so nothing to ask.
      const onComplete = card({ ...UNLISTED, taskLeftBecause: 'closed' });

      fireEvent.click(screen.getByText('Finish & Log Hours'));
      fireEvent.click(screen.getByText(/Mark Task as 'Done'/));

      expect(onComplete).toHaveBeenCalledWith(undefined, true);
    });

    it('RemainInProgress_Unlisted_DoesNotAsk', () => {
      // Logging the time and leaving the task open moves nothing remote.
      const onComplete = card(UNLISTED);

      fireEvent.click(screen.getByText('Finish & Log Hours'));
      fireEvent.click(screen.getByText(/Remain 'In Progress'/));

      expect(onComplete).toHaveBeenCalledWith(undefined, false);
    });
  });

  describe('discarding', () => {
    it('Discard_Confirmed_DiscardsAndLogsNothing', () => {
      const onDiscard = vi.fn();
      const onComplete = card(TRACKING_SESSION, vi.fn(), onDiscard);

      fireEvent.click(screen.getByText('Finish & Log Hours'));
      fireEvent.click(screen.getByText('Discard this session'));
      // The question names the task and the time it would throw away.
      expect(screen.getByRole('alertdialog', { name: 'Discard this session?' }).textContent).toMatch(/SPR-142/);
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

      expect(onDiscard).toHaveBeenCalledTimes(1);
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('Discard_Cancelled_DiscardsNothingAndOffersTheChoicesAgain', () => {
      const onDiscard = vi.fn();
      card(TRACKING_SESSION, vi.fn(), onDiscard);

      fireEvent.click(screen.getByText('Finish & Log Hours'));
      fireEvent.click(screen.getByText('Discard this session'));
      fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

      expect(onDiscard).not.toHaveBeenCalled();
      expect(screen.getByText(/Remain 'In Progress'/)).toBeTruthy();
    });

    it('Reopen_AfterStartingADiscard_OffersTheChoicesNotTheQuestion', () => {
      // The dialog mounts afresh on every opening; a question left from the
      // last one would make the next Finish look like a discard.
      card();
      fireEvent.click(screen.getByText('Finish & Log Hours'));
      fireEvent.click(screen.getByText('Discard this session'));
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      fireEvent.click(screen.getByText('Finish & Log Hours'));

      expect(screen.getByText(/Remain 'In Progress'/)).toBeTruthy();
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
  });
  it('DuringAnInterruption_BackStopAnother_NoPauseNorFinish', () => {
    const during = {
      ...INTERRUPTION,
      sessionId: 'int_1',
      taskId: 'int_1',
      interruption: {
        id: 'int_1', name: null, title: 'Interruption 10:30', startedAtUtc: '2026-11-10T09:00:00.000Z', index: 1,
        source: 'window' as const, interruptedSessionId: 's1', interruptedTaskKey: 'SPR-142',
        interruptedTaskTitle: 'The task', interruptedWasPaused: false
      }
    };
    const onBack = vi.fn();
    const onStop = vi.fn();
    const onInterrupt = vi.fn();
    render(
      <ActiveTaskHeroCard
        session={during}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onComplete={vi.fn()}
        onDiscard={vi.fn()}
        onOpenTaskModal={vi.fn()}
        onInterrupt={onInterrupt}
        onBack={onBack}
        onStopInterruption={onStop}
      />
    );

    expect(screen.getByText(/during SPR-142, which waits paused/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Finish/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to SPR-142' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Another' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });
});
