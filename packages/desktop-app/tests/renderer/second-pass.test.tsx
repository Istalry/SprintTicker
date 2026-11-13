import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ActiveTaskHeroCard } from '../../src/renderer/components/ActiveTaskHeroCard';
import { announce, LiveAnnouncer } from '../../src/renderer/components/LiveAnnouncer';
import { FirstRunDialog } from '../../src/renderer/components/FirstRun/FirstRunDialog';
import { EndMyDayDialog } from '../../src/renderer/views/EOD/EndMyDayDialog';
import { TodayView } from '../../src/renderer/views/Today/TodayView';
import { statusRows, StatusInputs } from '../../src/renderer/utils/status-summary';
import { TRACKING_SESSION, installElectronApi } from './electron-api-mock';

/** What the second pass of the design review found (P15a7, REVIEW-2026-11). */
describe('the second pass', () => {
  it('HeroCard_NoAccount_SaysTheTimeIsKeptHere_NotSent', async () => {
    installElectronApi({
      getSyncHealth: vi.fn().mockResolvedValue({ state: 'not-configured', providerId: 'openproject', sinceUtc: null, lastSyncedAtUtc: null, progress: null })
    });
    render(<ActiveTaskHeroCard session={TRACKING_SESSION} onPause={vi.fn()} onResume={vi.fn()} onComplete={vi.fn()}
      onDiscard={vi.fn()} onOpenTaskModal={vi.fn()} onInterrupt={vi.fn()} />);

    // F1: "sent to OpenProject when you stop" with no account to send to.
    expect(await screen.findByText(/kept here until .+ is set up/)).toBeTruthy();
    expect(screen.queryByText(/when you stop, after 10 s/)).toBeNull();
  });

  it('StatusRows_NoAccount_WaitingNotDanger_AndNoEverythingSent', () => {
    const inputs: StatusInputs = {
      bar: null,
      queue: { counts: { pending: 0, syncing: 0, synced: 4, failed: 0 }, items: [], maxAttempts: 8 },
      update: null,
      providerName: 'OpenProject',
      accountNotSetUp: true
    };

    // N1: red, and "Everything sent" under "Not set up".
    const rows = statusRows(inputs);
    expect(rows.map(row => row.id)).toEqual(['account']);
    expect(rows[0].severity).toBe('waiting');
  });

  it('FirstRun_ContinueWaitsOnTheTest_AndSaysSo', async () => {
    installElectronApi();
    render(<FirstRunDialog isOpen onClose={vi.fn()} onStartFirstTask={vi.fn()} />);
    fireEvent.click(await screen.findByRole('radio', { name: /^Jira/ }));
    fireEvent.change(screen.getByLabelText(/Jira site/), { target: { value: 'https://studio.atlassian.net' } });
    fireEvent.change(screen.getByLabelText(/Your email/), { target: { value: 'alex@studio.com' } });
    fireEvent.change(screen.getByLabelText(/^API token/), { target: { value: 't0ken' } });

    // F2: a disabled Continue, and nothing said why.
    const next = screen.getByRole('button', { name: 'Continue' });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    expect(next.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Test the connection to continue')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await screen.findByText(/Connected as/);
    expect(screen.queryByText('Test the connection to continue')).toBeNull();
  });

  it('EndMyDay_Opens_OnRemindMe_NotOnTheShutdownBox', async () => {
    installElectronApi({
      getWorklogsByDate: vi.fn().mockResolvedValue([]),
      getScheduleSettings: vi.fn().mockRejectedValue(new Error('no hours'))
    });
    render(<EndMyDayDialog isOpen onClose={vi.fn()} onLater={vi.fn()} onEnded={vi.fn()} onCheckGaps={vi.fn()} />);

    // F8: Enter on the opening focus ticked "Then shut down the PC".
    const later = await screen.findByRole('button', { name: /^Remind me in/ });
    expect(document.activeElement).toBe(later);
  });

  it('TodayView_StandupAndBackToTheTask_TheStandupFirst', async () => {
    installElectronApi({
      getResumePrompt: async () => ({ taskKey: 'MG-12', taskTitle: 'Lantern', after: 'interruption' as const }),
      getCeremonyPrompt: async () => ({ type: 'STANDUP', title: 'Stand-up', at: '09:30' })
    });
    render(<TodayView session={null} worklogs={[]} onPause={() => undefined} onResume={() => undefined}
      onComplete={() => undefined} onDiscard={() => undefined} onInterrupt={() => undefined} onOpenPicker={() => undefined} />);

    // N5: the stand-up will not wait; Back to MG-12? will.
    expect(await screen.findByRole('region', { name: 'The stand-up' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Back to MG-12?' })).toBeNull();
    expect(screen.getByText('1 more question after this one')).toBeTruthy();
  });

  it('Announce_BeforeTheRegionIsUp_IsSaidOnceItIs', () => {
    vi.useFakeTimers();
    try {
      // A window opening on a question waiting: the card speaks first.
      announce('Back to MG-12? 6 min not timed');
      render(<LiveAnnouncer />);
      expect(screen.getByRole('status').textContent).toBe('');

      act(() => { vi.advanceTimersByTime(100); });
      expect(screen.getByRole('status').textContent).toBe('Back to MG-12? 6 min not timed');
    } finally {
      vi.useRealTimers();
    }
  });
});
