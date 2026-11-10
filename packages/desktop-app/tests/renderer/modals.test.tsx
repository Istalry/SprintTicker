import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EodWrapUpModal } from '../../src/renderer/views/EOD/EodWrapUpModal';
import { installElectronApi } from './electron-api-mock';

/**
 * The wrap-up mounts its content afresh on every opening. They used to stay
 * mounted and reset themselves from an effect on `isOpen`, which is what these
 * pin: what an opening must start from, and what must survive while open.
 */

describe('EodWrapUpModal', () => {
  const modal = (isOpen: boolean) => (
    <EodWrapUpModal isOpen={isOpen} onClose={vi.fn()} onConfirmEod={vi.fn().mockResolvedValue(undefined)} />
  );

  it('Reopen_AfterACompletedWrapUp_OffersTheWrapUpAgain', async () => {
    // `completed` was never reset, so the next evening's prompt -- or the
    // header button -- opened straight onto "Day Complete!".
    const { rerender } = render(modal(true));
    fireEvent.click(screen.getByText('Execute Wrap-Up Now'));
    fireEvent.click(screen.getByText('Press START (or click) to Confirm'));
    await screen.findByText('Day Complete!');

    rerender(modal(false));
    rerender(modal(true));

    expect(screen.getByText('Execute Wrap-Up Now')).toBeTruthy();
    expect(screen.queryByText('Day Complete!')).toBeNull();
  });
});

/**
 * The bar's buttons reach the dialog as main decoded them. Only the wrap-up's
 * own actions may move it: they come only while the bar shows the prompt.
 */
describe('EodWrapUpModal hardware buttons', () => {
  const open = () => {
    const bridge = installElectronApi();
    const onClose = vi.fn();
    render(<EodWrapUpModal isOpen onClose={onClose} onConfirmEod={vi.fn().mockResolvedValue(undefined)} />);
    const press = (inputKey: string, actionAssigned: string) =>
      act(() => bridge.emit('onHardwareInputEvent', { inputKey, actionAssigned }));
    return { bridge, onClose, press };
  };

  it('Start_WhileTheBarShowsTheSession_NeverWrapsUp', async () => {
    // The bar paused the session and then opened the task picker; the dialog
    // read the same two STARTs as a confirmed wrap-up.
    const { bridge, press } = open();

    press('start', 'TOGGLE_TRACK_PAUSE');
    press('start', 'UPDATE_SELECTION');

    expect(bridge.api.triggerEodWrapUp).not.toHaveBeenCalled();
    expect(screen.getByText('Execute Wrap-Up Now')).toBeTruthy();
  });

  it('Back_WhileTheBarShowsSomethingElse_KeepsTheDialogOpen', () => {
    const { onClose, press } = open();

    press('back', 'CANCEL_SELECTION');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('Start_TwiceOnThePrompt_WrapsUp', async () => {
    const { bridge, press } = open();

    press('start', 'CONFIRM_EOD_WRAP_UP_STEP_1');
    expect(screen.getByText('Press START (or click) to Confirm')).toBeTruthy();
    press('start', 'EXECUTE_EOD_WRAP_UP');

    expect(await screen.findByText('Day Complete!')).toBeTruthy();
    expect(bridge.api.triggerEodWrapUp).toHaveBeenCalledTimes(1);
  });

  it('Start_AfterAClickArmedTheDialog_IsTheConfirmation', async () => {
    // The armed button says "Press START"; main, which counts its own
    // presses, still calls that one the first.
    const { bridge, press } = open();
    fireEvent.click(screen.getByText('Execute Wrap-Up Now'));

    press('start', 'CONFIRM_EOD_WRAP_UP_STEP_1');

    expect(await screen.findByText('Day Complete!')).toBeTruthy();
    expect(bridge.api.triggerEodWrapUp).toHaveBeenCalledTimes(1);
  });

  it('Back_OnThePrompt_DismissesTheWrapUp', () => {
    const { onClose, press } = open();

    press('back', 'DISMISS_EOD_WRAP_UP');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
