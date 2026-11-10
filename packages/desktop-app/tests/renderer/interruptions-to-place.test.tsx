import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorklogHistoryView } from '../../src/renderer/views/History/WorklogHistoryView';
import { EodWrapUpModal } from '../../src/renderer/views/EOD/EodWrapUpModal';
import { WorklogDTO } from '../../src/shared/dtos';
import type { InterruptionToPlaceDTO } from '../../src/shared/interruption';
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

const history = async (day: WorklogDTO[], waiting: InterruptionToPlaceDTO[] = []) => {
  const bridge = installElectronApi({
    getWorklogsByDate: vi.fn().mockResolvedValue(day),
    getInterruptionsToPlace: vi.fn().mockResolvedValue(waiting)
  });
  render(<WorklogHistoryView />);
  await screen.findByText('Chronological Session Log (' + day.length + ')');
  return bridge;
};

/** Picks task SPR-9 in the picker History opened, through its project. */
const pick = async () => {
  await screen.findByRole('dialog', { name: /to a task|on a task/ });
  fireEvent.click(await screen.findByRole('option', { name: /^Sprint/ }));
  fireEvent.click(await screen.findByText('SPR-9'));
};
const withProjects = (overrides: Record<string, unknown>) => ({
  getPickerData: vi.fn().mockResolvedValue({
    previous: null,
    recent: [],
    starred: [],
    tasks: [{ id: 'T-9', projectId: 'P-1', key: 'SPR-9', title: 'The real task', status: 'todo' }],
    projects: [{ id: 'P-1', key: 'SPR', name: 'Sprint' }],
    projectSeconds: {}
  }),
  ...overrides
});

const WAITING: InterruptionToPlaceDTO = {
  id: 'int_1',
  name: null,
  title: 'Interruption 10:30',
  startedAtUtc: START,
  endedAtUtc: '2026-11-09T09:45:00.000Z',
  durationSeconds: 900,
  source: 'window',
  interruptedTaskKey: 'MG-12',
  index: 2,
  ofRun: 3
};
const NEXT: InterruptionToPlaceDTO = { ...WAITING, id: 'int_2', title: 'Call with Marc', name: 'Call with Marc', index: 3 };

/** Rows of the day: an earlier interruption's entry still says it waits. */
describe('Work History, rows', () => {
  it('Row_Unsorted_SaysToPlace', async () => {
    await history([INTERRUPTION, NAMED]);

    expect(screen.getAllByText('To place')).toHaveLength(1);
  });

  it('Row_AdHoc_IsRenamedInPlace_AndTheDayIsReadAgain', async () => {
    const bridge = await history([INTERRUPTION]);

    fireEvent.click(screen.getByRole('button', { name: 'Rename Interruption 10:30' }));
    const field = screen.getByLabelText('Name this work');
    fireEvent.change(field, { target: { value: 'Call with Marc' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(bridge.api.renameAdHocTask).toHaveBeenCalledWith('adhoc_1_x', 'Call with Marc');
    await waitFor(() => expect(bridge.api.getWorklogsByDate).toHaveBeenCalledTimes(2));
  });

  it('Row_ProviderTask_KeepsItsName', async () => {
    // A provider's task is named by the provider.
    await history([PROVIDER]);

    expect(screen.queryByRole('button', { name: /Rename/ })).toBeNull();
    expect(screen.getByText('Rework the pause menu')).toBeTruthy();
  });
});

/** Interruptions that ended wait here to be placed on a task, kept off, or discarded (P6). */
describe('Work History, interruptions to place', () => {
  it('List_NothingWaiting_NoList', async () => {
    await history([NAMED]);

    expect(screen.queryByRole('region', { name: 'Interruptions to place' })).toBeNull();
  });

  it('List_Each_WithWhatItInterruptedAndItsPlaceInTheRun', async () => {
    await history([], [WAITING]);

    const list = await screen.findByRole('region', { name: 'Interruptions to place' });
    expect(within(list).getByText('Interruptions to place (1)')).toBeTruthy();
    expect(within(list).getByText('15m')).toBeTruthy();
    expect(list.textContent).toMatch(/during MG-12/);
    expect(list.textContent).toMatch(/2 of 3/);
  });

  it('List_AnotherDay_JumpsToIt', async () => {
    const earlier = { ...WAITING, startedAtUtc: '2026-11-02T09:00:00.000Z' };
    const bridge = await history([], [earlier]);
    const dateKey = localDateKey(new Date(earlier.startedAtUtc));

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(formatDay(dateKey)) }));

    await waitFor(() => expect(bridge.api.getWorklogsByDate).toHaveBeenLastCalledWith(dateKey));
  });

  it('Rename_NamesTheInterruption', async () => {
    const bridge = await history([], [WAITING]);
    const list = await screen.findByRole('region', { name: 'Interruptions to place' });

    fireEvent.click(within(list).getByRole('button', { name: 'Rename Interruption 10:30' }));
    const field = within(list).getByLabelText('Name this work');
    fireEvent.change(field, { target: { value: 'Printer jam' } });
    fireEvent.blur(field);

    expect(bridge.api.renameInterruption).toHaveBeenCalledWith('int_1', 'Printer jam');
  });

  it('Place_OnTheTaskPicked', async () => {
    const bridge = installElectronApi(withProjects({ getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING]) }));
    render(<WorklogHistoryView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Place Interruption 10:30 on a task' }));
    await pick();

    await waitFor(() => expect(bridge.api.placeInterruption).toHaveBeenCalledWith('int_1', 'T-9'));
  });

  it('PlaceAll_OneTaskForEveryOne', async () => {
    const bridge = installElectronApi(withProjects({ getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING, NEXT]) }));
    render(<WorklogHistoryView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Place all' }));
    await pick();

    await waitFor(() => expect(bridge.api.placeInterruptions).toHaveBeenCalledWith(['int_1', 'int_2'], 'T-9'));
  });

  it('Place_Refused_SaysWhy', async () => {
    installElectronApi(withProjects({
      getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING]),
      placeInterruption: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'interruption:place': Error: The provider records at least 1 minute(s)."))
    }));
    render(<WorklogHistoryView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Place Interruption 10:30 on a task' }));
    await pick();

    expect((await screen.findByRole('alert')).textContent).toMatch(/Not done: .*at least 1 minute/);
  });

  it('Place_ClosedWeekTime_AsksFirst', async () => {
    const bridge = installElectronApi({
      getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING]),
      getLastWeekClosed: vi.fn().mockResolvedValue('2026-11-09')
    });
    render(<WorklogHistoryView />);
    await waitFor(() => expect(bridge.api.getLastWeekClosed).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole('button', { name: 'Place Interruption 10:30 on a task' }));

    expect(screen.getByRole('alertdialog', { name: 'Place "Interruption 10:30"?' }).textContent).toMatch(/timesheet/);
    expect(screen.queryByRole('dialog', { name: /to a task|on a task/ })).toBeNull();
  });

  it('KeepOff_NamesTheProvider', async () => {
    const bridge = await history([], [WAITING]);

    fireEvent.click(await screen.findByRole('button', { name: /^Keep off .*: Interruption 10:30$/ }));

    expect(bridge.api.keepInterruptionOff).toHaveBeenCalledWith('int_1');
  });

  it('Discard_ThatOne', async () => {
    const bridge = await history([], [WAITING]);

    fireEvent.click(await screen.findByRole('button', { name: 'Discard Interruption 10:30' }));

    expect(bridge.api.discardInterruption).toHaveBeenCalledWith('int_1');
  });

  it('PlacedElsewhere_TheListFollowsMain', async () => {
    const bridge = await history([], [WAITING]);
    await screen.findByRole('region', { name: 'Interruptions to place' });

    act(() => bridge.emit('onInterruptionsUpdated', []));

    expect(screen.queryByRole('region', { name: 'Interruptions to place' })).toBeNull();
  });

  it('List_ReadFails_HistoryStillShowsTheDay', async () => {
    // If the code checks a result, there is a test where it is the bad one.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    installElectronApi({
      getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]),
      getInterruptionsToPlace: vi.fn().mockRejectedValue(new Error('database closed'))
    });
    render(<WorklogHistoryView />);

    expect(await screen.findByText('MG-12')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Interruptions to place' })).toBeNull();
  });
});

describe('Work History, moving time to another task', () => {
  it('Move_ARow_SendsItToTheTaskPicked', async () => {
    const bridge = installElectronApi(withProjects({ getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]) }));
    render(<WorklogHistoryView />);

    fireEvent.click(await screen.findByRole('button', { name: /Move MG-12 at .* to another task/ }));
    await pick();

    await waitFor(() => expect(bridge.api.moveWorklog).toHaveBeenCalledWith('w3', 'T-9'));
    await waitFor(() => expect(bridge.api.getWorklogsByDate).toHaveBeenCalledTimes(2));
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
    await screen.findByRole('dialog', { name: 'Move to a task' });

    expect(screen.queryByText(/A task of my own/)).toBeNull();
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
    expect(screen.queryByRole('dialog', { name: /to a task|on a task/ })).toBeNull();
  });

  it('Move_ClosedWeekTime_GoOn_OpensThePicker', async () => {
    installElectronApi({
      getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]),
      getLastWeekClosed: vi.fn().mockResolvedValue(CLOSED)
    });
    render(<WorklogHistoryView />);

    fireEvent.click(await screen.findByRole('button', { name: /Move MG-12 at .* to another task/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a task' }));

    expect(await screen.findByRole('dialog', { name: 'Move to a task' })).toBeTruthy();
  });

  it('Move_ThisWeeksTime_AsksNothing', async () => {
    installElectronApi({
      getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]),
      getLastWeekClosed: vi.fn().mockResolvedValue('2026-11-02')
    });
    render(<WorklogHistoryView />);

    fireEvent.click(await screen.findByRole('button', { name: /Move MG-12 at .* to another task/ }));

    expect(await screen.findByRole('dialog', { name: 'Move to a task' })).toBeTruthy();
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

describe('the wrap-up, interruptions to place', () => {
  const summary = (items: Array<Record<string, unknown>>) => ({ date: '2026-11-09', totalSeconds: 900, tasksCount: items.length, items });
  const wrapUp = () => render(<EodWrapUpModal isOpen onClose={vi.fn()} onConfirmEod={vi.fn().mockResolvedValue(undefined)} />);

  it('WrapUp_Waiting_ListedToPlace', async () => {
    const bridge = installElectronApi({
      getDailyWorklogSummary: vi.fn().mockResolvedValue(summary([
        { taskId: '10001', key: 'MG-12', title: 'Rework the pause menu', durationSeconds: 3600, comment: '' }
      ])),
      getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING])
    });
    wrapUp();

    const list = await screen.findByRole('region', { name: 'Interruptions to place' });
    expect(within(list).getByText('Interruptions to place (1)')).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: /^Keep off .*: Interruption 10:30$/ }));
    expect(bridge.api.keepInterruptionOff).toHaveBeenCalledWith('int_1');
  });

  it('WrapUp_OnePlaced_TheDayIsReadAgain', async () => {
    // Placed, its time joins the day's summary.
    const bridge = installElectronApi({
      getDailyWorklogSummary: vi.fn().mockResolvedValue(summary([])),
      getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING])
    });
    wrapUp();
    await screen.findByRole('region', { name: 'Interruptions to place' });

    act(() => bridge.emit('onInterruptionsUpdated', []));

    await waitFor(() => expect(bridge.api.getDailyWorklogSummary).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region', { name: 'Interruptions to place' })).toBeNull();
  });

  it('WrapUp_NothingWaiting_NoList', async () => {
    installElectronApi({
      getDailyWorklogSummary: vi.fn().mockResolvedValue(summary([
        { taskId: '10001', key: 'MG-12', title: 'Rework the pause menu', durationSeconds: 3600, comment: '' }
      ]))
    });
    wrapUp();

    await screen.findByText('MG-12:');
    expect(screen.queryByRole('region', { name: 'Interruptions to place' })).toBeNull();
  });
});
