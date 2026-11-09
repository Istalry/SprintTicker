import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorklogHistoryView } from '../../src/renderer/views/History/WorklogHistoryView';
import { EodWrapUpModal } from '../../src/renderer/views/EOD/EodWrapUpModal';
import { WorklogDTO } from '../../src/shared/dtos';
import { localDateKey } from '../../src/shared/local-date';
import { installElectronApi } from './electron-api-mock';

const START = '2026-11-09T09:30:00.000Z';
const INTERRUPTION: WorklogDTO = {
  id: 'w1',
  sessionId: 's1',
  taskId: 'adhoc_1_x',
  taskKey: 'ADHOC',
  taskTitle: 'Interruption 10:30',
  durationSeconds: 900,
  startedAtUtc: START,
  comment: '',
  createdAtUtc: START,
  syncState: 'local',
  adHoc: true,
  unsorted: true
};
const NAMED: WorklogDTO = { ...INTERRUPTION, id: 'w2', taskId: 'adhoc_2_y', taskTitle: 'Call with Marc', unsorted: undefined };
const PROVIDER: WorklogDTO = { ...INTERRUPTION, id: 'w3', taskId: '10001', taskKey: 'MG-12', taskTitle: 'Rework the pause menu', adHoc: undefined, unsorted: undefined };

const history = async (day: WorklogDTO[], unsorted: WorklogDTO[] = []) => {
  const bridge = installElectronApi({
    getWorklogsByDate: vi.fn().mockResolvedValue(day),
    getUnsortedWorklogs: vi.fn().mockResolvedValue(unsorted)
  });
  render(<WorklogHistoryView />);
  await screen.findByText('Chronological Session Log (' + day.length + ')');
  return bridge;
};

/** An interruption runs under a made-up name; History and the wrap-up are where it gets a real one. */
describe('Work History, interruptions to sort', () => {
  it('Row_Unsorted_SaysToSort', async () => {
    await history([INTERRUPTION, NAMED]);

    expect(screen.getAllByText('To sort')).toHaveLength(1);
  });

  it('Row_AdHoc_IsRenamedInPlace_AndTheDayIsReadAgain', async () => {
    const bridge = await history([INTERRUPTION]);

    fireEvent.click(screen.getByRole('button', { name: 'Rename Interruption 10:30' }));
    const field = screen.getByLabelText('Name this work');
    fireEvent.change(field, { target: { value: 'Call with Marc' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(bridge.api.renameAdHocTask).toHaveBeenCalledWith('adhoc_1_x', 'Call with Marc');
    await waitFor(() => expect(bridge.api.getWorklogsByDate).toHaveBeenCalledTimes(2));
    expect(bridge.api.getUnsortedWorklogs).toHaveBeenCalledTimes(2);
  });

  it('Row_ProviderTask_KeepsItsName', async () => {
    // A provider's task is named by the provider.
    await history([PROVIDER]);

    expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull();
    expect(screen.getByText('Rework the pause menu')).toBeTruthy();
  });

  it('ToSort_NothingWaiting_NoList', async () => {
    await history([NAMED]);

    expect(screen.queryByRole('region', { name: 'Interruptions to sort' })).toBeNull();
  });

  it('ToSort_FromAnyDay_OneEntryPerInterruptionWithItsTime', async () => {
    // Two pieces of one interruption -- split at midnight -- are one entry.
    const piece = { ...INTERRUPTION, id: 'w4', startedAtUtc: '2026-11-08T22:00:00.000Z', durationSeconds: 600 };
    await history([], [INTERRUPTION, piece]);

    const list = screen.getByRole('region', { name: 'Interruptions to sort' });
    expect(within(list).getByText('Interruptions to sort (1)')).toBeTruthy();
    expect(within(list).getByText('25m 0s')).toBeTruthy();
    // The day it began, which the entry jumps to.
    expect(within(list).getByRole('button', { name: localDateKey(new Date(piece.startedAtUtc)) })).toBeTruthy();
  });

  it('ToSort_TheDay_JumpsToIt', async () => {
    const earlier = { ...INTERRUPTION, startedAtUtc: '2026-11-02T09:00:00.000Z' };
    const bridge = await history([], [earlier]);
    const dateKey = localDateKey(new Date(earlier.startedAtUtc));

    fireEvent.click(screen.getByRole('button', { name: dateKey }));

    await waitFor(() => expect(bridge.api.getWorklogsByDate).toHaveBeenLastCalledWith(dateKey));
  });

  it('ToSort_Renamed_IsNamedLikeTheRow', async () => {
    const bridge = await history([], [INTERRUPTION]);
    const list = screen.getByRole('region', { name: 'Interruptions to sort' });

    fireEvent.click(within(list).getByRole('button', { name: 'Rename Interruption 10:30' }));
    const field = within(list).getByLabelText('Name this work');
    fireEvent.change(field, { target: { value: 'Printer jam' } });
    fireEvent.blur(field);

    expect(bridge.api.renameAdHocTask).toHaveBeenCalledWith('adhoc_1_x', 'Printer jam');
  });

  it('ToSort_ReadFails_HistoryStillShowsTheDay', async () => {
    // If the code checks a result, there is a test where it is the bad one.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installElectronApi({
      getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]),
      getUnsortedWorklogs: vi.fn().mockRejectedValue(new Error('database closed'))
    });
    render(<WorklogHistoryView />);

    expect(await screen.findByText('MG-12')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Interruptions to sort' })).toBeNull();
  });
});

describe('the wrap-up, interruptions to sort', () => {
  const summary = (items: Array<Record<string, unknown>>) => ({ date: '2026-11-09', totalSeconds: 900, tasksCount: items.length, items });

  it('WrapUp_TodaysUnsorted_ListedToName', async () => {
    const bridge = installElectronApi({
      getDailyWorklogSummary: vi.fn().mockResolvedValue(summary([
        { taskId: 'adhoc_1_x', key: 'ADHOC', title: 'Interruption 10:30', durationSeconds: 900, comment: '', unsorted: true },
        { taskId: '10001', key: 'MG-12', title: 'Rework the pause menu', durationSeconds: 3600, comment: '' }
      ]))
    });
    render(<EodWrapUpModal isOpen onClose={vi.fn()} onConfirmEod={vi.fn().mockResolvedValue(undefined)} />);

    const list = await screen.findByLabelText('Interruptions to sort');
    expect(within(list).getByText('Interruptions to sort (1)')).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: 'Rename Interruption 10:30' }));
    const field = within(list).getByLabelText('Name this work');
    fireEvent.change(field, { target: { value: 'Call with Marc' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(bridge.api.renameAdHocTask).toHaveBeenCalledWith('adhoc_1_x', 'Call with Marc');
    await waitFor(() => expect(bridge.api.getDailyWorklogSummary).toHaveBeenCalledTimes(2));
  });

  it('WrapUp_NothingToSort_NoList', async () => {
    installElectronApi({
      getDailyWorklogSummary: vi.fn().mockResolvedValue(summary([
        { taskId: '10001', key: 'MG-12', title: 'Rework the pause menu', durationSeconds: 3600, comment: '' }
      ]))
    });
    render(<EodWrapUpModal isOpen onClose={vi.fn()} onConfirmEod={vi.fn().mockResolvedValue(undefined)} />);

    await screen.findByText('MG-12:');
    expect(screen.queryByLabelText('Interruptions to sort')).toBeNull();
  });
});
