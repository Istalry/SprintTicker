import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorklogHistoryView } from '../../src/renderer/views/History/WorklogHistoryView';
import { SyncQueuePanel } from '../../src/renderer/components/SyncQueuePanel';
import { WorklogDTO } from '../../src/shared/dtos';
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

    expect(await screen.findByRole('button', { name: /^More for TASK-SECOND at / })).toBeTruthy();
    // Let the late answer land, if anything would let it.
    await new Promise(r => setTimeout(r, 0));
    expect(screen.queryAllByText('TASK-FIRST')).toEqual([]);
  });

  it('Render_ReadFails_StopsLoading', async () => {
    // The read had no failure path: a rejected call left the spinner up for good.
    installElectronApi({ getWorklogsByDate: vi.fn().mockRejectedValue(new Error('database locked')) });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(<WorklogHistoryView />);

    await waitFor(() => expect(screen.queryByText('Loading the day…')).toBeNull());
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
    operation: 'CREATE' as const,
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

  it('RetryFailed_OneFailed_CountsItAndSaysWhatWasQueued', async () => {
    const bridge = installElectronApi({
      getSyncQueue: vi.fn().mockResolvedValue({ ...queue(null), counts: { pending: 1, syncing: 0, synced: 4, failed: 1 } }),
      retryFailedWorklogs: vi.fn().mockResolvedValue({ requeued: 1 })
    });
    render(<SyncQueuePanel />);
    await screen.findByText('SPR-9');
    expect(screen.getByText(/waiting/).textContent).toBe('1 waiting · 0 sending · 1 failed · 4 sent');

    fireEvent.click(screen.getByRole('button', { name: 'Retry failed' }));

    expect(await screen.findByText('1 entry queued again and being sent.')).toBeTruthy();
    expect(bridge.api.retryFailedWorklogs).toHaveBeenCalledTimes(1);
  });

  it('Render_RetryAlreadyDue_SaysNothingAboutWaiting', async () => {
    const earlier = new Date(Date.now() - 60 * 1000).toISOString();
    installElectronApi({ getSyncQueue: vi.fn().mockResolvedValue(queue(earlier)) });

    render(<SyncQueuePanel />);

    await screen.findByText('SPR-9');
    expect(screen.queryByText(/Next attempt at/)).toBeNull();
  });
});
