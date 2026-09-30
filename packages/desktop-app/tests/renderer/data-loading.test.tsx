import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorklogHistoryView } from '../../src/renderer/views/History/WorklogHistoryView';
import { CeremoniesView } from '../../src/renderer/views/Ceremonies/CeremoniesView';
import { SyncQueuePanel } from '../../src/renderer/components/SyncQueuePanel';
import { AUTO_SAVE_DELAY_MS } from '../../src/renderer/hooks/auto-save-scheduler';
import { normalizeScheduleSettings } from '../../src/shared/schedule-defaults';
import { ScheduleSettingsDTO, WorklogDTO } from '../../src/shared/dtos';
import { installElectronApi } from './electron-api-mock';

/**
 * Views that read from main on mount, and set nothing until main answers.
 * Each used to raise a loading flag, or apply defaults, synchronously in the
 * effect that started the read; these pin what the reads must still get right.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

const worklog = (taskId: string): WorklogDTO => ({
  id: `W-${taskId}`,
  sessionId: 'S-1',
  taskId,
  durationSeconds: 600,
  startedAtUtc: '2026-09-01T08:00:00Z',
  comment: '',
  createdAtUtc: '2026-09-01T08:10:00Z'
});

describe('WorklogHistoryView', () => {
  it('ChangeDate_AnswersOutOfOrder_ShowsTheDayStillSelected', async () => {
    const answers: Record<string, ReturnType<typeof deferred<WorklogDTO[]>>> = {};
    installElectronApi({
      getWorklogsByDate: vi.fn().mockImplementation((date: string) => {
        answers[date] = deferred<WorklogDTO[]>();
        return answers[date].promise;
      })
    });
    const { container } = render(<WorklogHistoryView />);
    const picker = container.querySelector('input[type="date"]') as HTMLInputElement;

    fireEvent.change(picker, { target: { value: '2026-09-01' } });
    fireEvent.change(picker, { target: { value: '2026-09-02' } });
    answers['2026-09-02'].resolve([worklog('TASK-SECOND')]);
    answers['2026-09-01'].resolve([worklog('TASK-FIRST')]);

    expect(await screen.findByText('TASK-SECOND')).toBeTruthy();
    // Let the late answer land, if anything would let it.
    await new Promise(r => setTimeout(r, 0));
    expect(screen.queryByText('TASK-FIRST')).toBeNull();
  });

  it('Render_ReadFails_StopsLoading', async () => {
    // The read had no failure path: a rejected call left the spinner up for good.
    installElectronApi({ getWorklogsByDate: vi.fn().mockRejectedValue(new Error('database locked')) });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<WorklogHistoryView />);

    await waitFor(() => expect(screen.queryByText('Loading session history...')).toBeNull());
  });
});

describe('CeremoniesView auto-save', () => {
  const STORED: ScheduleSettingsDTO = { ...normalizeScheduleSettings({}), standupTime: '09:45' };

  it('Mount_BeforeStoredSettingsArrive_WritesNothing', async () => {
    // Auto-save is gated on the read: the defaults written over the stored
    // schedule would silently move every ceremony.
    const read = deferred<ScheduleSettingsDTO>();
    const bridge = installElectronApi({ getScheduleSettings: vi.fn().mockReturnValue(read.promise) });

    render(<CeremoniesView />);
    await new Promise(r => setTimeout(r, AUTO_SAVE_DELAY_MS * 2));

    expect(bridge.api.saveScheduleSettings).not.toHaveBeenCalled();
  });

  it('EditTime_AfterLoad_SavesTheEdit', async () => {
    const bridge = installElectronApi({ getScheduleSettings: vi.fn().mockResolvedValue(STORED) });
    const { container } = render(<CeremoniesView />);
    const standup = await waitFor(() => {
      const input = container.querySelector('input[type="time"]') as HTMLInputElement;
      expect(input.value).toBe('09:45');
      return input;
    });

    fireEvent.change(standup, { target: { value: '10:15' } });

    await waitFor(
      () => expect(bridge.api.saveScheduleSettings).toHaveBeenCalledWith(expect.objectContaining({ standupTime: '10:15' })),
      { timeout: AUTO_SAVE_DELAY_MS * 3 }
    );
  });
});

describe('SyncQueuePanel', () => {
  const row = (nextAttemptAtUtc: string | null) => ({
    id: 'Q-1',
    providerId: 'jira',
    taskId: 'T-1',
    taskKey: 'SPR-9',
    durationSeconds: 45,
    startedAtUtc: '2026-09-01T08:00:00Z',
    comment: '',
    status: 'PENDING' as const,
    retryCount: 1,
    nextAttemptAtUtc,
    lastError: 'HTTP 503'
  });

  const queue = (nextAttemptAtUtc: string | null) => ({
    counts: { pending: 1, syncing: 0, synced: 0, failed: 0 },
    items: [row(nextAttemptAtUtc)],
    maxAttempts: 8
  });

  it('Render_RetryStillAhead_SaysWhenItIs', async () => {
    const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    installElectronApi({ getSyncQueue: vi.fn().mockResolvedValue(queue(later)) });

    render(<SyncQueuePanel />);

    expect(await screen.findByText(/Next attempt at/)).toBeTruthy();
  });

  it('Render_RetryAlreadyDue_SaysNothingAboutWaiting', async () => {
    const earlier = new Date(Date.now() - 60 * 1000).toISOString();
    installElectronApi({ getSyncQueue: vi.fn().mockResolvedValue(queue(earlier)) });

    render(<SyncQueuePanel />);

    await screen.findByText('SPR-9');
    expect(screen.queryByText(/Next attempt at/)).toBeNull();
  });
});
