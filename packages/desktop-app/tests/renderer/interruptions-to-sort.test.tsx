import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorklogHistoryView } from '../../src/renderer/views/History/WorklogHistoryView';
import { EodWrapUpModal } from '../../src/renderer/views/EOD/EodWrapUpModal';
import { WorklogDTO } from '../../src/shared/dtos';
import { localDateKey } from '../../src/shared/local-date';
import { formatDay } from '../../src/renderer/utils/formatters';
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
    expect(within(list).getByText('25m')).toBeTruthy();
    // The day it began, which the entry jumps to.
    expect(within(list).getByRole('button', { name: formatDay(localDateKey(new Date(piece.startedAtUtc))) })).toBeTruthy();
  });

  it('ToSort_TheDay_JumpsToIt', async () => {
    const earlier = { ...INTERRUPTION, startedAtUtc: '2026-11-02T09:00:00.000Z' };
    const bridge = await history([], [earlier]);
    const dateKey = localDateKey(new Date(earlier.startedAtUtc));

    fireEvent.click(screen.getByRole('button', { name: formatDay(dateKey) }));

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

describe('Work History, moving time to another task', () => {
  /** Picks project P-1, then task T-9, in the picker History opened. */
  const pick = async () => {
    const dialog = await screen.findByRole('heading', { name: /Move to a Task/ });
    expect(dialog).toBeTruthy();
    fireEvent.click(await screen.findByText('Sprint'));
    fireEvent.click(await screen.findByText('SPR-9'));
  };
  const withProjects = (overrides: Record<string, unknown>) => ({
    getProjects: vi.fn().mockResolvedValue([{ id: 'P-1', key: 'SPR', name: 'Sprint' }]),
    getTasks: vi.fn().mockResolvedValue([{ id: 'T-9', projectId: 'P-1', key: 'SPR-9', title: 'The real task', status: 'todo' }]),
    ...overrides
  });

  it('Move_ARow_SendsItToTheTaskPicked', async () => {
    const bridge = installElectronApi(withProjects({ getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]) }));
    render(<WorklogHistoryView />);

    fireEvent.click(await screen.findByRole('button', { name: /Move MG-12 at .* to another task/ }));
    await pick();

    await waitFor(() => expect(bridge.api.moveWorklog).toHaveBeenCalledWith('w3', 'T-9'));
    await waitFor(() => expect(bridge.api.getWorklogsByDate).toHaveBeenCalledTimes(2));
  });

  it('Assign_AnInterruption_MovesEveryPieceOfIt', async () => {
    const piece = { ...INTERRUPTION, id: 'w4', startedAtUtc: '2026-11-08T22:00:00.000Z' };
    const bridge = installElectronApi(withProjects({ getUnsortedWorklogs: vi.fn().mockResolvedValue([INTERRUPTION, piece]) }));
    render(<WorklogHistoryView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Assign Interruption 10:30 to a task' }));
    await pick();

    await waitFor(() => expect(bridge.api.moveWorklog).toHaveBeenCalledTimes(2));
    expect(bridge.api.moveWorklog).toHaveBeenNthCalledWith(1, 'w1', 'T-9');
    expect(bridge.api.moveWorklog).toHaveBeenNthCalledWith(2, 'w4', 'T-9');
  });

  it('Move_Refused_SaysWhy', async () => {
    installElectronApi(withProjects({
      getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]),
      moveWorklog: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'worklogs:move': Error: The provider records at least 1 minute(s).")),
    }));
    render(<WorklogHistoryView />);

    fireEvent.click(await screen.findByRole('button', { name: /Move MG-12 at .* to another task/ }));
    await pick();

    expect((await screen.findByRole('alert')).textContent).toMatch(/Not moved: .*at least 1 minute/);
  });

  it('Picker_ForAMove_OffersNoAdHocWork', async () => {
    installElectronApi(withProjects({ getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]) }));
    render(<WorklogHistoryView />);

    fireEvent.click(await screen.findByRole('button', { name: /Move MG-12 at .* to another task/ }));
    await screen.findByRole('heading', { name: /Move to a Task/ });

    expect(screen.queryByText(/Create Custom/)).toBeNull();
  });
});

describe('Work History, time in a closed week', () => {
  // START is Monday 9 November, 09:30 UTC: closed when the 9th's week is.
  const CLOSED = '2026-11-09';

  it('Move_ClosedWeekTime_AsksFirst_BackChangesNothing', async () => {
    const bridge = installElectronApi({
      getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]),
      getLastWeekClosed: vi.fn().mockResolvedValue(CLOSED)
    });
    render(<WorklogHistoryView />);
    await waitFor(() => expect(bridge.api.getLastWeekClosed).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole('button', { name: /Move MG-12 at .* to another task/ }));

    const question = screen.getByRole('alertdialog', { name: 'Move time from a closed week?' });
    expect(question.textContent).toMatch(/timesheet/);
    fireEvent.click(within(question).getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('heading', { name: /Move to a Task/ })).toBeNull();
  });

  it('Move_ClosedWeekTime_GoOn_OpensThePicker', async () => {
    installElectronApi({
      getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]),
      getLastWeekClosed: vi.fn().mockResolvedValue(CLOSED)
    });
    render(<WorklogHistoryView />);

    fireEvent.click(await screen.findByRole('button', { name: /Move MG-12 at .* to another task/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a task' }));

    expect(await screen.findByRole('heading', { name: /Move to a Task/ })).toBeTruthy();
  });

  it('Move_ThisWeeksTime_AsksNothing', async () => {
    installElectronApi({
      getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]),
      getLastWeekClosed: vi.fn().mockResolvedValue('2026-11-02')
    });
    render(<WorklogHistoryView />);

    fireEvent.click(await screen.findByRole('button', { name: /Move MG-12 at .* to another task/ }));

    expect(await screen.findByRole('heading', { name: /Move to a Task/ })).toBeTruthy();
    expect(screen.queryByRole('alertdialog', { name: 'Move time from a closed week?' })).toBeNull();
  });

  it.each([['Correct'], ['Delete']])('%s_ClosedWeekTime_SaysSoBeforeSaving', async action => {
    const bridge = installElectronApi({
      getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]),
      getLastWeekClosed: vi.fn().mockResolvedValue(CLOSED)
    });
    render(<WorklogHistoryView />);
    await waitFor(() => expect(bridge.api.getLastWeekClosed).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(`${action} MG-12`) }));

    expect(screen.getByRole('note').textContent).toMatch(/week already closed/);
  });

  it('Correct_ThisWeeksTime_NoNote', async () => {
    installElectronApi({
      getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]),
      getLastWeekClosed: vi.fn().mockResolvedValue(null)
    });
    render(<WorklogHistoryView />);

    fireEvent.click(await screen.findByRole('button', { name: /Correct MG-12/ }));

    expect(screen.queryByRole('note')).toBeNull();
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
