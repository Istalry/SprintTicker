import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorklogHistoryView } from '../../src/renderer/views/History/WorklogHistoryView';
import { EndMyDayDialog } from '../../src/renderer/views/EOD/EndMyDayDialog';
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
  await screen.findByRole('region', { name: "The day's entries" });
  await waitFor(() => expect(screen.queryByText('Loading the day…')).toBeNull());
  return bridge;
};

/** ⋯ on an entry's row in History, then one of its items. */
const entryMenu = async (key: string, item: string) => {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^More for ${key} at `) }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
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
    expect(within(list).getByRole('heading').textContent).toBe('Interruptions to place · 1 · 15m');
    expect(list.textContent).toMatch(/during MG-12 · from the window · 2 of 3/);
  });

  it.each([
    ['deck', 'from the Stream Deck'],
    ['shortcut', 'from the shortcut'],
    ['bar', 'from the bar']
  ] as const)('List_StartedFrom_%s_SaysWhere', async (source, words) => {
    await history([], [{ ...WAITING, source }]);

    const list = await screen.findByRole('region', { name: 'Interruptions to place' });
    expect(list.textContent).toContain(words);
  });

  it('List_Legacy_NothingTiming_SaysNoSource', async () => {
    await history([], [{ ...WAITING, source: 'legacy', interruptedTaskKey: null }]);

    const list = await screen.findByRole('region', { name: 'Interruptions to place' });
    expect(list.textContent).toMatch(/with nothing timing · 2 of 3/);
    expect(list.textContent).not.toMatch(/from the/);
  });

  it('Ticked_PlaceN_PutsTheTickedOnOneTask', async () => {
    const bridge = installElectronApi(withProjects({ getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING, NEXT, { ...NEXT, id: 'int_3', title: 'Third' }]) }));
    render(<WorklogHistoryView />);
    const list = await screen.findByRole('region', { name: 'Interruptions to place' });
    expect(within(list).queryByRole('button', { name: /^Place \d…$/ })).toBeNull();

    fireEvent.click(within(list).getByRole('checkbox', { name: 'Tick Interruption 10:30' }));
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Tick Third' }));
    fireEvent.click(within(list).getByRole('button', { name: 'Place 2…' }));
    await pick();

    expect(bridge.api.placeInterruptions).toHaveBeenCalledWith(['int_1', 'int_3'], 'T-9');
  });

  it('Ticked_PlacedElsewhere_LeavesTheCount', async () => {
    const bridge = installElectronApi({ getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING, NEXT]) });
    render(<WorklogHistoryView />);
    const list = await screen.findByRole('region', { name: 'Interruptions to place' });
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Tick Interruption 10:30' }));
    fireEvent.click(within(list).getByRole('checkbox', { name: 'Tick Call with Marc' }));

    act(() => bridge.emit('onInterruptionsUpdated', [NEXT]));

    expect(within(list).getByRole('button', { name: 'Place 1…' })).toBeTruthy();
  });

  it('MenuRename_OpensTheField', async () => {
    const bridge = await history([], [WAITING]);
    const list = await screen.findByRole('region', { name: 'Interruptions to place' });

    fireEvent.click(within(list).getByRole('button', { name: 'More for Interruption 10:30' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }));
    const field = within(list).getByLabelText('Name this work');
    fireEvent.change(field, { target: { value: 'Printer jam' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(bridge.api.renameInterruption).toHaveBeenCalledWith('int_1', 'Printer jam');
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

  /** A row's ↳ Place… opens the Place dialog on that row alone (2026-11-12), where it is named and placed. */
  const placeOne = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Place Interruption 10:30 on a task' }));
    await screen.findByRole('dialog', { name: 'Place Interruption 10:30' });
    fireEvent.click(screen.getByRole('button', { name: 'Choose a task for Interruption 10:30' }));
    await pick();
    fireEvent.click(screen.getByRole('button', { name: /^Place 1 · / }));
  };

  it('Place_OnTheTaskPicked', async () => {
    const bridge = installElectronApi(withProjects({ getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING]) }));
    render(<WorklogHistoryView />);

    await placeOne();

    await waitFor(() => expect(bridge.api.placeInterruption).toHaveBeenCalledWith('int_1', 'T-9'));
  });

  it('Place_NamedInTheDialog_NamedBeforePlaced', async () => {
    // Naming was the dashboard's alone, and placing read as the only way.
    const bridge = installElectronApi(withProjects({ getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING]) }));
    render(<WorklogHistoryView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Place Interruption 10:30 on a task' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name Interruption 10:30' }), { target: { value: 'Printer jam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose a task for Printer jam' }));
    await pick();
    fireEvent.click(screen.getByRole('button', { name: /^Place 1 · / }));

    await waitFor(() => expect(bridge.api.placeInterruption).toHaveBeenCalledWith('int_1', 'T-9'));
    expect(bridge.api.renameInterruption).toHaveBeenCalledWith('int_1', 'Printer jam');
  });

  it('Close_KeepsTheNameTyped_PlacesNothing', async () => {
    const bridge = installElectronApi(withProjects({ getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING]) }));
    render(<WorklogHistoryView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Place Interruption 10:30 on a task' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Name Interruption 10:30' }), { target: { value: 'Printer jam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Place / })).toBeNull());
    expect(bridge.api.renameInterruption).toHaveBeenCalledWith('int_1', 'Printer jam');
    expect(bridge.api.placeInterruption).not.toHaveBeenCalled();
  });

  describe('Place all (S12b)', () => {
    const placeAll = async (overrides: Record<string, unknown> = {}) => {
      const bridge = installElectronApi(withProjects({ getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING, NEXT]), ...overrides }));
      render(<WorklogHistoryView />);
      fireEvent.click(await screen.findByRole('button', { name: 'Place all 2…' }));
      return { bridge, dialog: await screen.findByRole('dialog', { name: 'Place 2 interruptions' }) };
    };
    const chooseFor = async (name: string) => {
      fireEvent.click(screen.getByRole('button', { name: `Choose a task for ${name}` }));
      await pick();
    };
    const placeButton = () => screen.getByRole('button', { name: /^Place(:| \d+ ·)/ });

    it('Opens_ARowEach_NothingChosen', async () => {
      const { dialog } = await placeAll();

      expect(within(dialog).getByText('0 chosen · 2 left')).toBeTruthy();
      expect(within(dialog).getAllByText('Choose a task ▾')).toHaveLength(2);
      expect((placeButton() as HTMLButtonElement).disabled).toBe(true);
    });

    it('OneRowChosen_PlacesItAlone_TheOtherWaits', async () => {
      const { bridge } = await placeAll();

      await chooseFor('Call with Marc');
      expect(screen.getByText('1 chosen · 1 left')).toBeTruthy();
      fireEvent.click(placeButton());

      await waitFor(() => expect(bridge.api.placeInterruption).toHaveBeenCalledWith('int_2', 'T-9'));
      expect(bridge.api.placeInterruptions).not.toHaveBeenCalled();
      expect(bridge.api.renameInterruption).not.toHaveBeenCalled();
    });

    it('UnnamedOne_AsksANameOnceItsTaskIsChosen_NamedBeforePlaced', async () => {
      const { bridge } = await placeAll();

      await chooseFor('Interruption 10:30');
      const name = await screen.findByRole('textbox', { name: 'Name Interruption 10:30' });
      fireEvent.change(name, { target: { value: 'Ana question' } });
      fireEvent.click(placeButton());

      await waitFor(() => expect(bridge.api.placeInterruption).toHaveBeenCalledWith('int_1', 'T-9'));
      expect(bridge.api.renameInterruption).toHaveBeenCalledWith('int_1', 'Ana question');
      const renamed = vi.mocked(bridge.api.renameInterruption).mock.invocationCallOrder[0];
      const placed = vi.mocked(bridge.api.placeInterruption).mock.invocationCallOrder[0];
      expect(renamed).toBeLessThan(placed);
    });

    it('TwoRowsOnOneTask_PlacedTogether_TheJustChosenListedFirst', async () => {
      const { bridge } = await placeAll();

      await chooseFor('Call with Marc');
      fireEvent.click(screen.getByRole('button', { name: 'Choose a task for Interruption 10:30' }));
      const picker = await screen.findByRole('dialog', { name: /on a task/ });
      expect(await within(picker).findByText('just chosen first')).toBeTruthy();
      fireEvent.click(await within(picker).findByText('SPR-9'));
      fireEvent.click(placeButton());

      await waitFor(() => expect(bridge.api.placeInterruptions).toHaveBeenCalledWith(['int_1', 'int_2'], 'T-9'));
    });

    it('KeepOff_ARow_KeptOffWhenPlaced', async () => {
      const { bridge } = await placeAll();

      fireEvent.click(screen.getByRole('button', { name: 'Choose a task for Call with Marc' }));
      const picker = await screen.findByRole('dialog', { name: /on a task/ });
      fireEvent.click(await within(picker).findByRole('button', { name: 'Keep as its own entry' }));
      expect(screen.getByText('1 chosen · 1 left')).toBeTruthy();
      fireEvent.click(placeButton());

      await waitFor(() => expect(bridge.api.keepInterruptionOff).toHaveBeenCalledWith('int_2'));
      expect(bridge.api.placeInterruption).not.toHaveBeenCalled();
    });

    it('Close_PlacesNothing', async () => {
      const { bridge } = await placeAll();

      await chooseFor('Call with Marc');
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Place 2 interruptions' })).toBeNull());
      expect(bridge.api.placeInterruption).not.toHaveBeenCalled();
    });

    it('Refused_SaysWhyUnderTheList', async () => {
      await placeAll({ placeInterruption: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'interruption:place': Error: The provider records at least 1 minute(s).")) });

      await chooseFor('Call with Marc');
      fireEvent.click(placeButton());

      expect((await screen.findByRole('alert')).textContent).toMatch(/Not done: .*at least 1 minute/);
    });

    it('ClosedWeekTime_AsksFirst', async () => {
      const { bridge } = await placeAll({ getLastWeekClosed: vi.fn().mockResolvedValue('2026-11-09') });

      await chooseFor('Call with Marc');
      fireEvent.click(placeButton());

      expect(screen.getByRole('alertdialog', { name: 'Place "Call with Marc"?' }).textContent).toMatch(/timesheet/);
      expect(bridge.api.placeInterruption).not.toHaveBeenCalled();
    });
  });

  it('Place_Refused_SaysWhy', async () => {
    installElectronApi(withProjects({
      getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING]),
      placeInterruption: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'interruption:place': Error: The provider records at least 1 minute(s)."))
    }));
    render(<WorklogHistoryView />);

    await placeOne();

    expect((await screen.findByRole('alert')).textContent).toMatch(/Not done: .*at least 1 minute/);
  });

  it('Place_ClosedWeekTime_AsksFirst', async () => {
    const bridge = installElectronApi(withProjects({
      getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING]),
      getLastWeekClosed: vi.fn().mockResolvedValue('2026-11-09')
    }));
    render(<WorklogHistoryView />);
    await waitFor(() => expect(bridge.api.getLastWeekClosed).toHaveBeenCalled());

    await placeOne();

    expect(screen.getByRole('alertdialog', { name: 'Place "Interruption 10:30"?' }).textContent).toMatch(/timesheet/);
    expect(bridge.api.placeInterruption).not.toHaveBeenCalled();
  });

  it('KeepAsOwnEntry_SaysItIsNeverSent_NamingTheProvider', async () => {
    // "Keep off Jira" read as a deletion (2026-11-12).
    const bridge = await history([], [WAITING]);

    fireEvent.click(await screen.findByRole('button', { name: 'More for Interruption 10:30' }));
    const keep = screen.getByRole('menuitem', { name: 'Keep as its own entry' });
    expect(keep.getAttribute('title')).toMatch(/stays in your history as its own entry, never sent to \w+/);
    fireEvent.click(keep);

    expect(bridge.api.keepInterruptionOff).toHaveBeenCalledWith('int_1');
  });

  it('Discard_ThatOne', async () => {
    const bridge = await history([], [WAITING]);

    fireEvent.click(await screen.findByRole('button', { name: 'More for Interruption 10:30' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Discard' }));

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

    expect(await screen.findByRole('button', { name: /^More for MG-12 at / })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Interruptions to place' })).toBeNull();
  });
});

describe('Work History, moving time to another task', () => {
  it('Move_ARow_SendsItToTheTaskPicked', async () => {
    const bridge = installElectronApi(withProjects({ getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]) }));
    render(<WorklogHistoryView />);

    await entryMenu('MG-12', '↳ Move…');
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

    await entryMenu('MG-12', '↳ Move…');
    await pick();

    expect((await screen.findByRole('alert')).textContent).toMatch(/Not moved: .*at least 1 minute/);
  });

  it('Picker_ForAMove_OffersNoAdHocWork', async () => {
    installElectronApi(withProjects({ getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]) }));
    render(<WorklogHistoryView />);

    await entryMenu('MG-12', '↳ Move…');
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

    await entryMenu('MG-12', '↳ Move…');

    const question = screen.getByRole('alertdialog', { name: 'Move time from a closed week?' });
    expect(question.textContent).toMatch(/timesheet/);
    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('dialog', { name: /to a task|on a task/ })).toBeNull();
  });

  it('Move_ClosedWeekTime_GoOn_OpensThePicker', async () => {
    installElectronApi({
      getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]),
      getLastWeekClosed: vi.fn().mockResolvedValue(CLOSED)
    });
    render(<WorklogHistoryView />);

    await entryMenu('MG-12', '↳ Move…');
    fireEvent.click(await screen.findByRole('button', { name: 'Choose a task' }));

    expect(await screen.findByRole('dialog', { name: 'Move to a task' })).toBeTruthy();
  });

  it('Move_ThisWeeksTime_AsksNothing', async () => {
    installElectronApi({
      getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]),
      getLastWeekClosed: vi.fn().mockResolvedValue('2026-11-02')
    });
    render(<WorklogHistoryView />);

    await entryMenu('MG-12', '↳ Move…');

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

    await entryMenu('MG-12', `${action}…`);

    expect(screen.getByRole('note').textContent).toMatch(/week already closed/);
  });

  it('Correct_ThisWeeksTime_NoNote', async () => {
    installElectronApi({
      getWorklogsByDate: vi.fn().mockResolvedValue([PROVIDER]),
      getLastWeekClosed: vi.fn().mockResolvedValue(null)
    });
    render(<WorklogHistoryView />);

    await entryMenu('MG-12', 'Correct…');

    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('the wrap-up, interruptions to place', () => {
  const wrapUp = () => render(<EndMyDayDialog isOpen onClose={vi.fn()} onLater={vi.fn()} onEnded={vi.fn()} onCheckGaps={vi.fn()} />);

  it('WrapUp_Waiting_ListedToPlace', async () => {
    const bridge = installElectronApi({
      getWorklogsByDate: vi.fn().mockResolvedValue([]),
      getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING])
    });
    wrapUp();

    const list = await screen.findByRole('region', { name: 'Interruptions to place' });
    expect(within(list).getByRole('heading').textContent).toBe('Interruptions to place · 1 · 15m');
    fireEvent.click(within(list).getByRole('button', { name: 'More for Interruption 10:30' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Keep as its own entry' }));
    expect(bridge.api.keepInterruptionOff).toHaveBeenCalledWith('int_1');
  });

  it('WrapUp_OnePlaced_TheDayIsReadAgain', async () => {
    // Placed, its time joins the day's summary.
    const bridge = installElectronApi({
      getWorklogsByDate: vi.fn().mockResolvedValue([]),
      getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING])
    });
    wrapUp();
    await screen.findByRole('region', { name: 'Interruptions to place' });

    act(() => bridge.emit('onInterruptionsUpdated', []));

    await waitFor(() => expect(bridge.api.getWorklogsByDate).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region', { name: 'Interruptions to place' })).toBeNull();
  });

  it('WrapUp_NothingWaiting_NoList', async () => {
    installElectronApi({
      getWorklogsByDate: vi.fn().mockResolvedValue([])
    });
    wrapUp();

    await screen.findByText('Nothing logged today.');
    expect(screen.queryByRole('region', { name: 'Interruptions to place' })).toBeNull();
  });
});
