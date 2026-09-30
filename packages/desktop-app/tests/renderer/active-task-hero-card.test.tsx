import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActiveTaskHeroCard } from '../../src/renderer/components/ActiveTaskHeroCard';
import { TRACKING_SESSION } from './electron-api-mock';

describe('ActiveTaskHeroCard', () => {
  const card = (session = TRACKING_SESSION, onComplete = vi.fn()) => {
    render(
      <ActiveTaskHeroCard
        session={session}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onComplete={onComplete}
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
});
