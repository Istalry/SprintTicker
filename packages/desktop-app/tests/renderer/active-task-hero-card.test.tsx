import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ActiveTaskHeroCard } from '../../src/renderer/components/ActiveTaskHeroCard';
import { TRACKING_SESSION, installElectronApi } from './electron-api-mock';
import type { TaskDTO } from '../../src/shared/dtos';

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
    expect(screen.queryByText('Place…')).toBeNull();
  });

  it('Render_UnsortedInterruption_SaysWhatToDoWithIt', () => {
    card(INTERRUPTION);

    expect(screen.getByText(/name it, or place it on a task/)).toBeTruthy();
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

    fireEvent.click(screen.getByText('Place…'));

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

    expect(screen.getByText('What are you working on?')).toBeTruthy();
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Start a task', 'Interrupt']);
    fireEvent.click(screen.getByText('Start a task'));
    expect(onOpenTaskModal).toHaveBeenCalledTimes(1);
  });

  it('Render_Tracking_SwitchOpensThePicker', () => {
    card();

    expect(screen.getByText('Switch task')).toBeTruthy();
    expect(screen.queryByText('Start a task')).toBeNull();
  });

  it('Render_Paused_OffersResumeNotPause', () => {
    card({ ...TRACKING_SESSION, status: 'PAUSED' });

    expect(screen.getByText('Resume')).toBeTruthy();
    expect(screen.queryByText('Pause')).toBeNull();
  });

  const more = () => fireEvent.click(screen.getByRole('button', { name: 'More ways to stop' }));
  const done = () => fireEvent.click(screen.getByRole('menuitem', { name: /^✓ Done/ }));

  it('Stop_OneClick_LogsAndLeavesTheTaskOpen', () => {
    const onComplete = card();

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    expect(onComplete).toHaveBeenCalledWith(undefined, false);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Done_FromTheMenu_LeavesTheBarsSceneToTheStop', () => {
    // session:complete plays DONE! on the bar once it has stopped the
    // session. The card also asked for it, so the scene started twice: two
    // uploads of the same file, the second over the one the bar was playing.
    const onComplete = card();

    more();
    done();

    expect(onComplete).toHaveBeenCalledWith(undefined, true);
    expect(window.electronAPI.triggerConfettiBurst).not.toHaveBeenCalled();
  });

  it('Render_SaysWhenTheTimeIsSent', () => {
    card();

    expect(screen.getByText(/when you stop, after 10 s to undo/)).toBeTruthy();
  });

  it('Render_AdHoc_SaysItStaysHere', () => {
    card(INTERRUPTION);

    expect(screen.getByText('kept on this computer, never sent')).toBeTruthy();
  });

  it('Done_ProviderCannotMoveTasks_NotOffered', async () => {
    installElectronApi({
      getProviderCapabilities: vi.fn().mockResolvedValue({
        providerId: 'custom', canAssign: false, canTransition: false, canFindWorklog: false, canFetchByKey: false, hasHolidays: false
      })
    });
    card();
    await act(async () => undefined);

    more();

    expect(screen.queryByRole('menuitem', { name: /Done/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Discard/ })).toBeTruthy();
  });

  it('Previous_OnePress_SwitchesBack', async () => {
    const pf31 = { id: 'T-31', projectId: 'P', key: 'PF-31', title: 'Hammer and quench sounds', status: 'todo' } as TaskDTO;
    installElectronApi({ getPreviousTask: vi.fn().mockResolvedValue(pf31) });
    const onPrevious = vi.fn();
    render(
      <ActiveTaskHeroCard
        session={TRACKING_SESSION}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onComplete={vi.fn()}
        onDiscard={vi.fn()}
        onOpenTaskModal={vi.fn()}
        onInterrupt={vi.fn()}
        onPrevious={onPrevious}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Previous task: PF-31' }));

    expect(onPrevious).toHaveBeenCalledWith(pf31);
  });

  it('Previous_None_NoButton', async () => {
    installElectronApi({ getPreviousTask: vi.fn().mockResolvedValue(null) });
    card();
    await waitFor(() => expect(window.electronAPI.getPreviousTask).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: /Previous task/ })).toBeNull();
  });

  describe('across midnight', () => {
    it('Menu_SaysWhichDaysTheTimeIsFiledUnder', async () => {
      installElectronApi({
        getSessionDays: vi.fn().mockResolvedValue([
          { dateKey: '2026-10-16', seconds: 3600 },
          { dateKey: '2026-10-17', seconds: 3600 }
        ])
      });
      card();
      more();

      expect((await screen.findByText(/filed as/)).textContent).toMatch(/filed as 1h 00m on \S+, 1h 00m on \S+\./);
    });

    it('Menu_DaysCannotBeRead_TheChoicesStillWork', async () => {
      installElectronApi({ getSessionDays: vi.fn().mockRejectedValue(new Error('gone')) });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      card();
      more();
      await act(async () => undefined);

      expect(screen.queryByText(/filed as/)).toBeNull();
      expect(screen.getByRole('menuitem', { name: /Discard/ })).toBeTruthy();
      warn.mockRestore();
    });
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

      more();
      done();

      expect(onComplete).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Mark it done anyway' }));
      expect(onComplete).toHaveBeenCalledWith(undefined, true);
    });

    it('MarkDone_UnlistedThenCancel_FinishesNothing', () => {
      const onComplete = card(UNLISTED);

      more();
      done();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onComplete).not.toHaveBeenCalled();
      expect(screen.getByRole('menuitem', { name: /^✓ Done/ })).toBeTruthy();
    });

    it('MarkDone_UnlistedThenStopInstead_LeavesItOpen', () => {
      const onComplete = card(UNLISTED);

      more();
      done();
      fireEvent.click(screen.getByRole('button', { name: /Stop instead/ }));

      expect(onComplete).toHaveBeenCalledWith(undefined, false);
    });

    it.each([
      ['closed', /Closed in your provider/],
      ['gone', /No longer in your provider/],
      ['reassigned', /No longer assigned to you/]
    ] as const)('Render_LeftBecause%s_SaysWhy', (reason, text) => {
      card({ ...UNLISTED, taskLeftBecause: reason });

      expect(screen.getByRole('status').textContent).toMatch(text);
    });

    it('MarkDone_ClosedThere_FinishesWithoutAsking', () => {
      // Nothing to move on a task already closed, so nothing to ask.
      const onComplete = card({ ...UNLISTED, taskLeftBecause: 'closed' });

      more();
      done();

      expect(onComplete).toHaveBeenCalledWith(undefined, true);
    });

    it('Stop_Unlisted_DoesNotAsk', () => {
      // Logging the time and leaving the task open moves nothing remote.
      const onComplete = card(UNLISTED);

      fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

      expect(onComplete).toHaveBeenCalledWith(undefined, false);
    });
  });

  describe('discarding', () => {
    it('Discard_Confirmed_DiscardsAndLogsNothing', () => {
      const onDiscard = vi.fn();
      const onComplete = card(TRACKING_SESSION, vi.fn(), onDiscard);

      more();
      fireEvent.click(screen.getByRole('menuitem', { name: /Discard/ }));
      // The question names the time and the task it would throw away.
      expect(screen.getByRole('alertdialog', { name: 'Discard 1h 23m?' }).textContent).toMatch(/SPR-142/);
      fireEvent.click(screen.getByRole('button', { name: 'Discard 1h 23m' }));

      expect(onDiscard).toHaveBeenCalledTimes(1);
      expect(onComplete).not.toHaveBeenCalled();
    });

    it('Discard_KeepIt_DiscardsNothingAndOffersTheChoicesAgain', () => {
      const onDiscard = vi.fn();
      card(TRACKING_SESSION, vi.fn(), onDiscard);

      more();
      fireEvent.click(screen.getByRole('menuitem', { name: /Discard/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));

      expect(onDiscard).not.toHaveBeenCalled();
      expect(screen.getByRole('menuitem', { name: /Discard/ })).toBeTruthy();
    });

    it('Reopen_AfterStartingADiscard_OffersTheChoicesNotTheQuestion', () => {
      // The menu mounts afresh on every opening; a question left from the
      // last one would make the next Stop ▾ look like a discard.
      card();
      more();
      fireEvent.click(screen.getByRole('menuitem', { name: /Discard/ }));
      more();
      more();

      expect(screen.getByRole('menuitem', { name: /Discard/ })).toBeTruthy();
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

    expect(screen.getByText(/SPR-142 waits, (running|paused) as it was; nothing is sent/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More ways to stop' })).toBeNull();
    // Choosing a task does nothing during an interruption (2026-11-12).
    expect(screen.queryByRole('button', { name: 'Switch task…' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to SPR-142' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Another' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onInterrupt).toHaveBeenCalledTimes(1);
  });
});
