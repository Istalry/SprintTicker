import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActiveTaskHeroCard } from '../../src/renderer/components/ActiveTaskHeroCard';
import { TRACKING_SESSION } from './electron-api-mock';

describe('ActiveTaskHeroCard', () => {
  const card = (session = TRACKING_SESSION, onComplete = vi.fn(), onDiscard = vi.fn()) => {
    render(
      <ActiveTaskHeroCard
        session={session}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onComplete={onComplete}
        onDiscard={onDiscard}
        onOpenTaskModal={vi.fn()}
      />
    );
    return onComplete;
  };

  it('Render_Tracking_OffersPauseNotResume', () => {
    card();

    expect(screen.getByText('Pause')).toBeTruthy();
    expect(screen.queryByText('Resume')).toBeNull();
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
});
