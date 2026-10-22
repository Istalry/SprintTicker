import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WeekEndedNotice } from '../../src/renderer/components/WeekEndedNotice';
import { installElectronApi } from './electron-api-mock';

const WEEK = { weekStart: '2026-10-12', weekEnd: '2026-10-16', loggedSeconds: 38 * 3600 + 20 * 60 };

/**
 * The week just over, shown once main has closed it. Main keeps it until it
 * is dismissed, so the notice follows main rather than owning it.
 */
describe('the week-over notice', () => {
  it('Render_NothingClosed_ShowsNothing', async () => {
    installElectronApi();
    render(<WeekEndedNotice onOpenHistory={vi.fn()} />);

    await act(async () => undefined);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Render_ClosedBeforeTheWindowOpened_ShowsTheWeekAndItsHours', async () => {
    installElectronApi({ getWeekEnded: async () => WEEK });
    render(<WeekEndedNotice onOpenHistory={vi.fn()} />);

    const notice = await screen.findByRole('status');

    expect(notice.textContent).toMatch(/Mon 12 Oct to Fri 16 Oct/);
    expect(notice.textContent).toMatch(/38h 20m/);
  });

  it('Render_ClosedWhileOpen_ShowsIt', async () => {
    const bridge = installElectronApi();
    render(<WeekEndedNotice onOpenHistory={vi.fn()} />);
    await act(async () => undefined);

    act(() => bridge.emit('onWeekEnded', WEEK));

    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('Dismiss_Clicked_TellsMainAndGoes', async () => {
    const bridge = installElectronApi({ getWeekEnded: async () => WEEK });
    render(<WeekEndedNotice onOpenHistory={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));

    expect(bridge.api.dismissWeekEnded).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('OpenWorkHistory_Clicked_OpensItAndDismisses', async () => {
    const bridge = installElectronApi({ getWeekEnded: async () => WEEK });
    const onOpenHistory = vi.fn();
    render(<WeekEndedNotice onOpenHistory={onOpenHistory} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open Work History' }));

    expect(onOpenHistory).toHaveBeenCalledTimes(1);
    expect(bridge.api.dismissWeekEnded).toHaveBeenCalledTimes(1);
  });

  it('DismissedInAnotherWindow_Goes', async () => {
    const bridge = installElectronApi({ getWeekEnded: async () => WEEK });
    render(<WeekEndedNotice onOpenHistory={vi.fn()} />);
    await screen.findByRole('status');

    act(() => bridge.emit('onWeekEnded', null));

    expect(screen.queryByRole('status')).toBeNull();
  });
});
