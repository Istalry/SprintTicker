import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorklogHistoryView } from '../../src/renderer/views/History/WorklogHistoryView';
import { TodayEntries } from '../../src/renderer/components/TodayEntries';
import { defaultStartFor } from '../../src/renderer/components/AddTimeDialog';
import type { WorklogDTO } from '../../src/shared/dtos';
import { addLocalDays, localDateKey } from '../../src/shared/local-date';
import { installElectronApi } from './electron-api-mock';

const YESTERDAY = addLocalDays(localDateKey(), -1);
const yesterdayAt = (h: number, m = 0) => new Date(`${YESTERDAY}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`).toISOString();
const entry = (id: string, key: string, h: number, m: number, minutes: number, extra: Partial<WorklogDTO> = {}): WorklogDTO => ({
  id, sessionId: `s-${id}`, taskId: `t-${key}`, taskKey: key, taskTitle: `Title of ${key}`,
  durationSeconds: minutes * 60, startedAtUtc: yesterdayAt(h, m), comment: `Note ${id}`, createdAtUtc: yesterdayAt(h, m),
  syncState: 'sent', ...extra
});

const withProjects = {
  getPickerData: vi.fn().mockResolvedValue({
    previous: null, recent: [], starred: [],
    tasks: [{ id: 'T-9', projectId: 'P-1', key: 'SPR-9', title: 'The real task', status: 'todo' }],
    projects: [{ id: 'P-1', key: 'SPR', name: 'Sprint' }],
    projectSeconds: {}
  })
};

/** History on yesterday, its entries read. */
const historyOnYesterday = async (day: WorklogDTO[], overrides: Record<string, unknown> = {}) => {
  const bridge = installElectronApi({ getWorklogsByDate: vi.fn().mockResolvedValue(day), ...withProjects, ...overrides });
  render(<WorklogHistoryView />);
  fireEvent.click(screen.getByRole('button', { name: 'The day before' }));
  await waitFor(() => expect(bridge.api.getWorklogsByDate).toHaveBeenCalledWith(YESTERDAY));
  await waitFor(() => expect(screen.queryByText('Loading the day…')).toBeNull());
  return bridge;
};
const openAddTime = () => {
  fireEvent.click(screen.getByRole('button', { name: '+ Add time' }));
  return screen.getByRole('dialog', { name: 'Add time' });
};
const pickSpr9 = async (dialog: HTMLElement) => {
  fireEvent.click(within(dialog).getByRole('button', { name: /Search, or pick a recent task/ }));
  fireEvent.click(await screen.findByRole('option', { name: /^Sprint/ }));
  fireEvent.click(await screen.findByText('SPR-9'));
  await within(dialog).findByText('SPR-9');
};

/** History's day (S14, P9a): the day counted, each task's share, every entry with ⋯. */
describe("History's day", () => {
  it('Day_CountedOnce_TheBreakdownNamesFourThenCounts_TheRowsInTheOrderWorked', async () => {
    await historyOnYesterday([
      entry('w6', 'OPS-4', 16, 0, 10),
      entry('w1', 'PF-31', 9, 0, 90),
      entry('w2', 'MG-14', 11, 0, 60, { syncState: 'correction-pending' }),
      entry('w3', 'PF-31', 13, 0, 40),
      entry('w4', 'SR-8', 14, 0, 30),
      entry('w5', 'DOC-2', 15, 0, 15)
    ]);
    const day = screen.getByRole('region', { name: "The day's entries" });

    expect(within(day).getByRole('heading').textContent).toBe('4h 05m · 5 tasks · 6 entries');
    expect(within(day).getByText('all sent but 1 correction')).toBeTruthy();
    expect(within(day).getByLabelText('Time by task').textContent).toBe('PF-31 2h 10m · MG-14 1h 00m · SR-8 30m · DOC-2 15m · + 1');
    const rows = within(day).getAllByRole('row').slice(1);
    expect(rows.map(row => row.textContent?.match(/^[A-Z]+-\d+/)?.[0])).toEqual(['PF-31', 'MG-14', 'PF-31', 'SR-8', 'DOC-2', 'OPS-4']);
  });

  it('Day_Empty_SaysAddTimeIsThere', async () => {
    await historyOnYesterday([]);

    expect(screen.getByText(/Nothing logged on .*\+ Add time puts in what you did/)).toBeTruthy();
  });
});

/** Add time you didn't time (S16b, P9a). */
describe('Add time', () => {
  it('Add_ATaskPicked_SentToMainWithItsTimes_TheDayIsReadAgain', async () => {
    const bridge = await historyOnYesterday([]);
    const dialog = openAddTime();
    const add = within(dialog).getByRole('button', { name: 'Add 30m' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);

    await pickSpr9(dialog);
    fireEvent.change(within(dialog).getByPlaceholderText('What you did'), { target: { value: 'Review' } });
    fireEvent.click(add);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add time' })).toBeNull());
    expect(bridge.api.addWorklog).toHaveBeenCalledWith({
      taskId: 'T-9', durationSeconds: 1800, startedAtUtc: yesterdayAt(9, 0), comment: 'Review'
    });
    const reads = vi.mocked(bridge.api.getWorklogsByDate).mock.calls;
    await waitFor(() => expect(reads.filter(([d]) => d === YESTERDAY).length).toBeGreaterThan(2));
  });

  it('Add_OverlapsAnEntry_SaysSo_EndItThereShortensIt', async () => {
    await historyOnYesterday([entry('w1', 'PF-31', 9, 15, 60)]);
    const dialog = openAddTime();

    const note = await within(dialog).findByText(/Overlaps/);
    expect(note.textContent).toMatch(/Overlaps PF-31, which starts at .*the later one waits/);
    fireEvent.click(within(dialog).getByRole('button', { name: /End it at .* \(15m\)/ }));

    expect((within(dialog).getByLabelText('Minutes') as HTMLInputElement).value).toBe('15');
    expect(within(dialog).queryByText(/Overlaps/)).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Add 15m' })).toBeTruthy();
  });

  it('Add_StartsInsideAnEntry_OffersToStartAfterIt', async () => {
    await historyOnYesterday([entry('w1', 'PF-31', 8, 30, 45)]);
    const dialog = openAddTime();

    fireEvent.click(await within(dialog).findByRole('button', { name: /^Start it at / }));

    expect(within(dialog).queryByText(/Overlaps/)).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Add 15m' })).toBeTruthy();
  });

  it('Add_InAClosedWeek_WarnsAndStillAdds', async () => {
    await historyOnYesterday([], { getLastWeekClosed: vi.fn().mockResolvedValue('2999-01-01') });
    const dialog = openAddTime();

    expect((await within(dialog).findByRole('note')).textContent).toMatch(/week already closed/);
    await pickSpr9(dialog);
    expect((within(dialog).getByRole('button', { name: 'Add 30m' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Add_RefusedByMain_SaysWhyAndStaysOpen', async () => {
    await historyOnYesterday([], {
      addWorklog: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'worklog:create-manual': ArgumentException: The provider records at least 1 minute(s); a shorter worklog cannot be sent."))
    });
    const dialog = openAddTime();
    await pickSpr9(dialog);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 30m' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe('The provider records at least 1 minute(s); a shorter worklog cannot be sent.');
    expect(screen.getByRole('dialog', { name: 'Add time' })).toBeTruthy();
  });

  it('Add_AcrossMidnight_RefusedBeforeMain', async () => {
    const bridge = await historyOnYesterday([]);
    const dialog = openAddTime();
    await pickSpr9(dialog);

    fireEvent.change(within(dialog).getByLabelText('Started'), { target: { value: `${YESTERDAY}T23:45` } });

    expect(within(dialog).getByRole('alert').textContent).toMatch(/ends on the day it starts/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add 30m' }));
    expect(bridge.api.addWorklog).not.toHaveBeenCalled();
  });

  it('Today_AddTime_OpensOnToday', () => {
    installElectronApi();
    render(<TodayEntries session={null} worklogs={[]} />);

    const dialog = openAddTime();

    expect((within(dialog).getByLabelText('Started') as HTMLInputElement).value.startsWith(localDateKey())).toBe(true);
  });

  it('DefaultStart_TodayEndsNowRoundedDown_AnotherDayTheMorning', () => {
    const now = new Date(2026, 10, 11, 14, 47, 30).getTime();

    expect(defaultStartFor('2026-11-11', now)).toBe('2026-11-11T14:15');
    expect(defaultStartFor('2026-11-10', now)).toBe('2026-11-10T09:00');
  });
});
