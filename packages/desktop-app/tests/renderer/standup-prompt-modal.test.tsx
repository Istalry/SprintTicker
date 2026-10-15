import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { StandupPromptModal } from '../../src/renderer/views/Standup/StandupPromptModal';

/**
 * The stand-up's prompt in the window. Join switches the timer to the Daily
 * Standup task, which main does; the prompt used to say only that the task
 * running would "keep tracking normally", and logged the meeting against it.
 */
describe('the stand-up prompt', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const open = () => {
    const props = { onClose: vi.fn(), onSnooze: vi.fn(async () => undefined), onJoin: vi.fn(async () => undefined) };
    render(<StandupPromptModal isOpen {...props} />);
    return props;
  };

  it('Join_Clicked_JoinsAndNothingElse', () => {
    const props = open();

    fireEvent.click(screen.getByRole('button', { name: 'Join' }));

    expect(props.onJoin).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('Dismiss_Clicked_LeavesTheTaskRunning', () => {
    const props = open();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onJoin).not.toHaveBeenCalled();
  });

  it('Render_SaysWhatJoiningDoes', () => {
    open();

    expect(screen.getByText(/Join switches the timer to Daily Standup/)).toBeTruthy();
  });

  it('LeftUnanswered_ClosesWithoutJoining', () => {
    // Nobody at the desk: the task keeps running, as Dismiss would leave it.
    vi.useFakeTimers();
    const props = open();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onJoin).not.toHaveBeenCalled();
  });

  it('Closed_RendersNothing', () => {
    render(<StandupPromptModal isOpen={false} onClose={vi.fn()} onSnooze={vi.fn()} onJoin={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Join' })).toBeNull();
  });
});
