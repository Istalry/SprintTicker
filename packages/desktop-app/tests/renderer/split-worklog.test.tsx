import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorklogHistoryView } from '../../src/renderer/views/History/WorklogHistoryView';
import { WorklogDTO } from '../../src/shared/dtos';
import { addLocalDays, localDateKey } from '../../src/shared/local-date';
import { weekStartKey } from '../../src/shared/working-days';
import { installElectronApi } from './electron-api-mock';

// Yesterday 10:00 to 12:00, sent.
const DAY = addLocalDays(localDateKey(), -1);
const START = new Date(`${DAY}T10:00`).toISOString();
const ENTRY: WorklogDTO = {
  id: 'w1', sessionId: 's1', taskId: 'T-1', taskKey: 'MG-12', taskTitle: 'Fix the lantern glow at dusk',
  durationSeconds: 7200, startedAtUtc: START, comment: 'Lantern', createdAtUtc: START, syncState: 'sent'
};
const PICKER = {
  getPickerData: vi.fn().mockResolvedValue({
    previous: null, recent: [], starred: [],
    tasks: [{ id: 'T-9', projectId: 'P-1', key: 'SPR-9', title: 'The real task', status: 'todo' }],
    projects: [{ id: 'P-1', key: 'SPR', name: 'Sprint' }],
    projectSeconds: {}
  })
};

const openSplit = async (worklog: WorklogDTO = ENTRY, overrides: Record<string, unknown> = {}) => {
  const bridge = installElectronApi({ getWorklogsByDate: vi.fn().mockResolvedValue([worklog]), ...PICKER, ...overrides });
  render(<WorklogHistoryView />);
  fireEvent.click(screen.getByRole('button', { name: 'The day before' }));
  fireEvent.click(await screen.findByRole('button', { name: /^More for MG-12 at / }));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Correct…' }));
  return bridge;
};

/** Split in two (S16c, P9e), from the entry's menu and from Correct. */
describe('Split in two', () => {
  // Only a quiet link inside Correct, it went unfound (2.0.1, a user's report).
  it('FromTheEntrysMenu_OpensIt_ShortEntriesOfferNone', async () => {
    const short = { ...ENTRY, id: 'w2', durationSeconds: 90 };
    installElectronApi({ getWorklogsByDate: vi.fn().mockResolvedValue([ENTRY, { ...short, startedAtUtc: new Date(`${DAY}T13:00`).toISOString() }]), ...PICKER });
    render(<WorklogHistoryView />);
    fireEvent.click(screen.getByRole('button', { name: 'The day before' }));

    const [long, brief] = await screen.findAllByRole('button', { name: /^More for MG-12 at / });
    fireEvent.click(brief);
    expect(screen.queryByRole('menuitem', { name: 'Split in two…' })).toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.click(long);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Split in two…' }));

    expect(screen.getByRole('dialog', { name: 'Split in two' })).toBeTruthy();
  });

  it('FromCorrect_TheMiddle_NoTaskChosen_SplitWaitsForOne', async () => {
    await openSplit();
    fireEvent.click(screen.getByRole('button', { name: 'Split in two…' }));

    const dialog = screen.getByRole('dialog', { name: 'Split in two' });
    expect(within(dialog).getByRole('heading').textContent).toMatch(/MG-12 · .* · 2h 00m$/);
    expect(within(dialog).getByText('stays')).toBeTruthy();
    // Nothing preselected: the button asks for the task.
    expect(within(dialog).getByRole('button', { name: 'Choose a task' }).hasAttribute('disabled')).toBe(true);
    expect(within(dialog).getAllByText('1h 00m')).toHaveLength(2);
  });

  it('MovedAndATaskPicked_SplitsThere', async () => {
    const bridge = await openSplit();
    fireEvent.click(screen.getByRole('button', { name: 'Split in two…' }));
    const dialog = screen.getByRole('dialog', { name: 'Split in two' });

    fireEvent.change(within(dialog).getByLabelText('Split at'), { target: { value: String(80 * 60) } });
    expect(within(dialog).getByText('1h 20m')).toBeTruthy();
    expect(within(dialog).getByText('40m')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose a task ▾' }));
    await screen.findByRole('dialog', { name: /a task/ });
    fireEvent.click(await screen.findByRole('option', { name: /^Sprint/ }));
    fireEvent.click(await screen.findByText('SPR-9'));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Split' }));

    await waitFor(() => expect(bridge.api.splitWorklog).toHaveBeenCalledWith('w1', new Date(Date.parse(START) + 80 * 60_000).toISOString(), 'T-9'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Split in two' })).toBeNull());
    // Today, the day before, then the day before again.
    await waitFor(() => expect(bridge.api.getWorklogsByDate).toHaveBeenCalledTimes(3));
  });

  it('WorkOfMyOwn_Found_SplitsThere_TheRestStaysHere', async () => {
    const own = { id: 'adhoc_7', projectId: 'ADHOC', key: 'ADHOC', title: 'Code review', status: 'todo' };
    const bridge = await openSplit(ENTRY, {
      getPickerData: vi.fn().mockResolvedValue({ previous: null, recent: [], starred: [], tasks: [], own: [own], projects: [], projectSeconds: {} })
    });
    fireEvent.click(screen.getByRole('button', { name: 'Split in two…' }));
    const dialog = screen.getByRole('dialog', { name: 'Split in two' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose a task ▾' }));

    fireEvent.change(await screen.findByLabelText('Search tasks'), { target: { value: 'code' } });
    fireEvent.click(await screen.findByText('Code review'));
    expect(within(dialog).getByText(/the second is kept in SprintTicker only/)).toBeTruthy();
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Split' }));

    await waitFor(() => expect(bridge.api.splitWorklog).toHaveBeenCalledWith('w1', expect.any(String), 'adhoc_7'));
  });

  it('NewWorkOfMyOwn_Named_SplitsOntoIt', async () => {
    const bridge = await openSplit();
    fireEvent.click(screen.getByRole('button', { name: 'Split in two…' }));
    const dialog = screen.getByRole('dialog', { name: 'Split in two' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose a task ▾' }));

    fireEvent.change(await screen.findByLabelText('Search tasks'), { target: { value: 'Team sync' } });
    fireEvent.click(await screen.findByText(/A task of my own named/));
    expect(within(dialog).getByRole('button', { name: /Team sync \(new, your own\)/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Split' }));

    await waitFor(() => expect(bridge.api.splitWorklog).toHaveBeenCalledWith('w1', expect.any(String), { ownTitle: 'Team sync' }));
  });

  it('NewWorkOfMyOwn_InAProject_SplitsOntoIt', async () => {
    const bridge = await openSplit();
    fireEvent.click(screen.getByRole('button', { name: 'Split in two…' }));
    const dialog = screen.getByRole('dialog', { name: 'Split in two' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose a task ▾' }));

    fireEvent.change(await screen.findByLabelText('Search tasks'), { target: { value: 'Dash: Backup files' } });
    fireEvent.click(await screen.findByText(/A task of my own: "Backup files" in Dash/));
    expect(within(dialog).getByRole('button', { name: /Backup files \(new, in Dash\)/ })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Split' }));

    await waitFor(() => expect(bridge.api.splitWorklog).toHaveBeenCalledWith('w1', expect.any(String), { ownTitle: 'Backup files', ownProject: 'Dash' }));
  });

  it('Refused_SaysWhy_AndStays', async () => {
    await openSplit(ENTRY, { splitWorklog: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'worklog:split': Error: The provider records at least 1 minute(s).")) });
    fireEvent.click(screen.getByRole('button', { name: 'Split in two…' }));
    const dialog = screen.getByRole('dialog', { name: 'Split in two' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose a task ▾' }));
    fireEvent.click(await screen.findByRole('option', { name: /^Sprint/ }));
    fireEvent.click(await screen.findByText('SPR-9'));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Split' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe('The provider records at least 1 minute(s).');
  });

  it('AClosedWeek_Warned', async () => {
    await openSplit(ENTRY, { getLastWeekClosed: vi.fn().mockResolvedValue(weekStartKey(DAY)) });
    fireEvent.click(screen.getByRole('button', { name: 'Split in two…' }));

    expect(within(screen.getByRole('dialog', { name: 'Split in two' })).getByRole('note').textContent).toMatch(/week already closed/);
  });

  it('AnEntryUnderTwoMinutes_CannotBeSplit', async () => {
    await openSplit({ ...ENTRY, durationSeconds: 90 });

    expect(screen.queryByRole('button', { name: 'Split in two…' })).toBeNull();
  });
});
