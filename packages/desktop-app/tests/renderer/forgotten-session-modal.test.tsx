import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ForgottenSessionModal } from '../../src/renderer/components/ForgottenSessionModal';
import { ForgottenSessionReviewDTO } from '../../src/shared/dtos';
import { installElectronApi } from './electron-api-mock';

const HOUR = 3600_000;
// Relative to the real clock: the dialog refuses ends in the future.
const START = Date.now() - 72 * HOUR;
const REVIEW: ForgottenSessionReviewDTO = {
  sessionId: 's1',
  taskKey: 'MG-12',
  taskTitle: 'Rework the pause menu',
  startTimeUtc: new Date(START).toISOString(),
  lastPresenceUtc: new Date(START + 8 * HOUR).toISOString(),
  endOfDayUtc: new Date(START + 7 * HOUR).toISOString(),
  pauses: [{ fromUtc: new Date(START + 3 * HOUR).toISOString(), toUtc: new Date(START + 4 * HOUR).toISOString() }],
  taskUnlisted: false
};

const open = async (review: ForgottenSessionReviewDTO = REVIEW) => {
  const bridge = installElectronApi({ getForgottenReview: async () => review });
  render(<ForgottenSessionModal />);
  await screen.findByRole('dialog', { name: 'A session was left running' });
  return bridge;
};
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

/**
 * A session left running overnight. Main paused it at the last activity and
 * logged nothing; this asks when the work stopped. Main owns the question --
 * the bar's STOP answers it too -- so the dialog follows it.
 */
describe('a session left running', () => {
  it('Render_NothingAsked_ShowsNothing', async () => {
    installElectronApi();
    render(<ForgottenSessionModal />);
    await act(async () => undefined);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  describe('across midnight', () => {
    /** Three days ago at that local hour, tomorrow when `nextDay`. */
    const local = (hours: number, nextDay = false) => {
      const d = new Date();
      d.setDate(d.getDate() - 3 + (nextDay ? 1 : 0));
      d.setHours(hours, 0, 0, 0);
      return d.toISOString();
    };
    const review = (lastPresenceUtc: string): ForgottenSessionReviewDTO => ({
      ...REVIEW, startTimeUtc: local(22), lastPresenceUtc, endOfDayUtc: null, pauses: []
    });

    it('Render_AnEndAfterMidnight_SaysWhichDaysTheTimeIsFiledUnder', async () => {
      await open(review(local(1, true)));

      expect(screen.getByText(/filed as/).textContent).toMatch(/filed as 2h 00m on \S+, 1h 00m on \S+\./);
    });

    it('Render_AnEndBeforeMidnight_SaysNothingOfDays', async () => {
      await open(review(local(23)));

      expect(screen.queryByText(/filed as/)).toBeNull();
    });
  });

  it('Render_Asked_ShowsEachEndWithWhatItWouldLog', async () => {
    await open();

    // 8 hours to the last activity, less the hour paused.
    expect(screen.getByLabelText(/At my last activity/).closest('label')?.textContent).toMatch(/logs 7h 00m/);
    expect(screen.getByLabelText(/At the end of that day/).closest('label')?.textContent).toMatch(/logs 6h 00m/);
  });

  it('LogAndStop_Default_EndsAtTheLastActivity', async () => {
    const bridge = await open();

    click('Log and stop');

    expect(bridge.api.resolveForgottenSession).toHaveBeenCalledWith({ action: 'stop', endUtc: REVIEW.lastPresenceUtc });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('LogAndStop_EndOfThatDay_EndsThere', async () => {
    const bridge = await open();

    fireEvent.click(screen.getByLabelText(/At the end of that day/));
    click('Log and stop');

    expect(bridge.api.resolveForgottenSession).toHaveBeenCalledWith({ action: 'stop', endUtc: REVIEW.endOfDayUtc });
  });

  it('Render_NoEndOfDayThatFits_DoesNotOfferIt', async () => {
    await open({ ...REVIEW, endOfDayUtc: null });

    expect(screen.queryByLabelText(/At the end of that day/)).toBeNull();
  });

  it('CustomEnd_BeforeTheStart_SaysSoAndLogsNothing', async () => {
    const bridge = await open();

    fireEvent.click(screen.getByLabelText(/At another time/));
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '2000-01-01T09:00' } });

    expect(screen.getByRole('alert').textContent).toMatch(/after the session started/);
    expect((screen.getByRole('button', { name: 'Log and stop' }) as HTMLButtonElement).disabled).toBe(true);
    click('Log and stop');
    expect(bridge.api.resolveForgottenSession).not.toHaveBeenCalled();
  });

  it('CustomEnd_Valid_IsSent', async () => {
    const bridge = await open();
    const end = new Date(START + 10 * HOUR);
    const pad = (n: number) => String(n).padStart(2, '0');
    const value = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}`;

    fireEvent.click(screen.getByLabelText(/At another time/));
    fireEvent.change(screen.getByLabelText('End time'), { target: { value } });
    click('Log and stop');

    expect(bridge.api.resolveForgottenSession).toHaveBeenCalledWith({ action: 'stop', endUtc: new Date(value).toISOString() });
  });

  it('Restart_TaskStillYours_RestartsWithoutAsking', async () => {
    const bridge = await open();

    click('Log and restart it now');

    expect(bridge.api.resolveForgottenSession).toHaveBeenCalledWith({ action: 'restart', endUtc: REVIEW.lastPresenceUtc });
  });

  it.each([
    ['Restart it', 'restart'],
    ['Just stop', 'stop']
  ])('Restart_TaskNoLongerYours_AsksFirst_%s', async (label, action) => {
    const bridge = await open({ ...REVIEW, taskUnlisted: true });

    click('Log and restart it now');
    expect(bridge.api.resolveForgottenSession).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog', { name: 'No longer assigned to you' })).toBeTruthy();
    click(label);

    expect(bridge.api.resolveForgottenSession).toHaveBeenCalledWith({ action, endUtc: REVIEW.lastPresenceUtc });
  });

  it('Discard_AsksFirst_ThenDiscards', async () => {
    const bridge = await open();

    click('Discard');
    expect(bridge.api.resolveForgottenSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Discard' }).at(-1)!);

    expect(bridge.api.resolveForgottenSession).toHaveBeenCalledWith(expect.objectContaining({ action: 'discard' }));
  });

  it('Discard_Back_ReturnsToTheQuestion', async () => {
    const bridge = await open();

    click('Discard');
    click('Back');

    expect(bridge.api.resolveForgottenSession).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Log and stop' })).toBeTruthy();
  });

  it('WorkingAllAlong_AsksFirst_ThenKeeps', async () => {
    const bridge = await open();

    click('I was working all along');
    expect(screen.getByRole('alertdialog').textContent).toMatch(/keeps running/);
    click('I was working');

    expect(bridge.api.resolveForgottenSession).toHaveBeenCalledWith(expect.objectContaining({ action: 'keep' }));
  });

  it('AnsweredElsewhere_TheDialogCloses', async () => {
    // The bar's STOP, or a resume: main says the question is gone.
    const bridge = await open();

    act(() => bridge.emit('onForgottenReview', null));

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Answer_Refused_SaysSoAndStaysOpen', async () => {
    installElectronApi({
      getForgottenReview: async () => REVIEW,
      resolveForgottenSession: async () => {
        throw new Error('A session can be stopped only between its start and now');
      }
    });
    render(<ForgottenSessionModal />);
    await screen.findByRole('dialog');

    click('Log and stop');

    expect((await screen.findByRole('alert')).textContent).toMatch(/did not work/);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
