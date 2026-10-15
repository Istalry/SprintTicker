import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorklogHistoryView } from '../../src/renderer/views/History/WorklogHistoryView';
import { SyncQueuePanel } from '../../src/renderer/components/SyncQueuePanel';
import { WorklogDTO } from '../../src/shared/dtos';
import { ipcErrorMessage } from '../../src/renderer/utils/formatters';
import { installElectronApi } from './electron-api-mock';

const START = '2026-10-13T09:00:00.123Z';
const SENT: WorklogDTO = {
  id: 'w1',
  sessionId: 's1',
  taskId: '10001',
  taskKey: 'MG-12',
  taskTitle: 'Rework the pause menu',
  // 2h 03m 17s: seconds a correction of the comment alone must keep.
  durationSeconds: 7397,
  startedAtUtc: START,
  comment: 'Pairing',
  createdAtUtc: START,
  syncState: 'sent'
};
const LOCAL: WorklogDTO = { ...SENT, id: 'w2', taskKey: 'MISC-1', syncState: 'local' };

const open = async (worklogs: WorklogDTO[] = [SENT], overrides = {}) => {
  const bridge = installElectronApi({ getWorklogsByDate: vi.fn().mockResolvedValue(worklogs), ...overrides });
  render(<WorklogHistoryView />);
  await screen.findByText('MG-12');
  return bridge;
};
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

/** Correcting and deleting a worklog from Work History. */
describe('Work History corrections', () => {
  it('Render_EachRow_SaysWhereItStands', async () => {
    await open([SENT, LOCAL]);

    expect(screen.getByText('Sent').getAttribute('title')).toMatch(/At the provider/);
    expect(screen.getByText('Local only')).toBeTruthy();
  });

  it('Correct_NewDuration_IsSentAndTheDayIsReadAgain', async () => {
    const bridge = await open();

    click(/Correct MG-12/);
    const dialog = screen.getByRole('dialog', { name: 'Correct a worklog' });
    fireEvent.change(within(dialog).getByLabelText('Minutes'), { target: { value: '30' } });
    click('Save');

    // The start is untouched to the millisecond: its field was left alone.
    expect(bridge.api.updateWorklog).toHaveBeenCalledWith('w1', { durationSeconds: 2 * 3600 + 30 * 60, startedAtUtc: START, comment: 'Pairing' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bridge.api.getWorklogsByDate).toHaveBeenCalledTimes(2);
  });

  it('Correct_CommentOnly_KeepsTheSeconds', async () => {
    const bridge = await open();

    click(/Correct MG-12/);
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'Pairing with Sam' } });
    click('Save');

    expect(bridge.api.updateWorklog).toHaveBeenCalledWith('w1', expect.objectContaining({ durationSeconds: 7397, comment: 'Pairing with Sam' }));
  });

  it('Correct_EndingInTheFuture_SaysSoAndSendsNothing', async () => {
    const bridge = await open();
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');

    click(/Correct MG-12/);
    fireEvent.change(screen.getByLabelText('Started'), {
      target: { value: `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T09:00` }
    });

    expect(screen.getByRole('alert').textContent).toMatch(/future/);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(bridge.api.updateWorklog).not.toHaveBeenCalled();
  });

  it('Correct_RefusedByMain_ShowsItsReasonAndStaysOpen', async () => {
    await open([SENT], {
      updateWorklog: vi.fn().mockRejectedValue(
        new Error("Error invoking remote method 'worklog:update': ArgumentException: The provider records at least 1 minute(s); a shorter worklog cannot be sent.")
      )
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    click(/Correct MG-12/);
    fireEvent.change(screen.getByLabelText('Hours'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '0' } });
    // Zero is refused here before main is asked; one minute is main's to judge.
    expect(screen.getByRole('alert').textContent).toMatch(/at least a second/);
    fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '1' } });
    click('Save');

    expect((await screen.findByRole('alert')).textContent).toBe('The provider records at least 1 minute(s); a shorter worklog cannot be sent.');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('Correct_Cancel_SendsNothing', async () => {
    const bridge = await open();

    click(/Correct MG-12/);
    click('Cancel');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bridge.api.updateWorklog).not.toHaveBeenCalled();
  });

  it('Delete_SentWorklog_SaysItGoesAtTheProviderToo_ThenDeletes', async () => {
    const bridge = await open();

    click(/Delete MG-12/);
    expect(screen.getByRole('alertdialog').textContent).toMatch(/also deleted in Jira or OpenProject/);
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

    expect(bridge.api.deleteWorklog).toHaveBeenCalledWith('w1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Delete_LocalWorklog_SaysItIsKeptNowhereElse', async () => {
    await open([SENT, LOCAL]);

    click(/Delete MISC-1/);

    expect(screen.getByRole('alertdialog').textContent).toMatch(/kept nowhere else/);
  });

  it('Delete_Back_DeletesNothing', async () => {
    const bridge = await open();

    click(/Delete MG-12/);
    click('Back');

    expect(bridge.api.deleteWorklog).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the sync queue shows corrections', () => {
  it('Render_ACorrectionRow_SaysItIsOne', async () => {
    installElectronApi({
      getSyncQueue: vi.fn().mockResolvedValue({
        counts: { pending: 1, syncing: 0, synced: 1, failed: 0 },
        maxAttempts: 8,
        items: [{
          id: 'Q-2', providerId: 'jira', taskId: '10001', taskKey: 'MG-12', durationSeconds: 3600,
          startedAtUtc: START, comment: '', status: 'PENDING', operation: 'UPDATE', retryCount: 0,
          nextAttemptAtUtc: null, lastError: null
        }]
      })
    });

    render(<SyncQueuePanel />);

    expect(await screen.findByText('Correction')).toBeTruthy();
  });
});

describe('ipcErrorMessage', () => {
  it.each([
    ["Error invoking remote method 'worklog:update': ArgumentException: Too short.", 'Too short.'],
    ["Error invoking remote method 'worklog:delete': Error: No worklog w9.", 'No worklog w9.'],
    ['Plain words', 'Plain words']
  ])('IpcErrorMessage_%s', (raw, expected) => {
    expect(ipcErrorMessage(new Error(raw))).toBe(expected);
  });

  it('IpcErrorMessage_NotAnError_IsItsText', () => {
    expect(ipcErrorMessage('offline')).toBe('offline');
  });
});
