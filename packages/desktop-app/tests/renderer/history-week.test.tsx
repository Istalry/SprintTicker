import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorklogHistoryView } from '../../src/renderer/views/History/WorklogHistoryView';
import type { WorklogDTO } from '../../src/shared/dtos';
import { addLocalDays, localDateKey } from '../../src/shared/local-date';
import { weekStartKey } from '../../src/shared/working-days';
import { installElectronApi } from './electron-api-mock';

const MONDAY = weekStartKey(localDateKey());
const TUESDAY = addLocalDays(MONDAY, 1);
const SUNDAY = addLocalDays(MONDAY, 6);
const on = (dateKey: string, h: number) => new Date(`${dateKey}T${String(h).padStart(2, '0')}:00`).toISOString();
const entry = (id: string, key: string, project: string, dateKey: string, minutes: number, extra: Partial<WorklogDTO> = {}): WorklogDTO => ({
  id, sessionId: `s-${id}`, taskId: `t-${key}`, taskKey: key, taskTitle: `Title of ${key}`, projectId: `p-${project}`, projectName: project,
  durationSeconds: minutes * 60, startedAtUtc: on(dateKey, 9), comment: '', createdAtUtc: on(dateKey, 9),
  syncState: 'sent', providerSeconds: minutes * 60, ...extra
});
const WEEK = [
  entry('1', 'PF-31', 'Pixel Forge', MONDAY, 130),
  entry('2', 'PF-2', 'Pixel Forge', TUESDAY, 40),
  entry('3', 'OPS-4', 'Studio Ops', TUESDAY, 20, { syncState: 'held-overlap', providerSeconds: undefined }),
  entry('4', 'MG-14', 'Moonlight Garden', MONDAY, 60),
  entry('5', 'DOC-1', 'Docs', MONDAY, 15),
  entry('6', 'QA-1', 'Quality', MONDAY, 10)
];

const weekOpen = async (overrides: Record<string, unknown> = {}) => {
  const bridge = installElectronApi({ getWorklogsRange: vi.fn().mockResolvedValue(WEEK), ...overrides });
  render(<WorklogHistoryView />);
  fireEvent.click(screen.getByRole('button', { name: 'Week' }));
  await screen.findByRole('region', { name: 'The week' });
  await screen.findByRole('row', { name: 'Day' });
  return bridge;
};

/** History's week (S15, P9c): a timesheet by project, the Day row and what the provider holds. */
describe("History's week", () => {
  it('Week_ReadsMondayToSunday_GroupedByProject_TheLargestOpen', async () => {
    const bridge = await weekOpen();
    const week = screen.getByRole('region', { name: 'The week' });

    expect(bridge.api.getWorklogsRange).toHaveBeenCalledWith(MONDAY, SUNDAY);
    expect(within(week).getByRole('button', { name: '▾ Pixel Forge' })).toBeTruthy();
    expect(within(week).getByText('PF-31')).toBeTruthy();
    expect(within(week).getByRole('button', { name: '▸ Moonlight Garden' })).toBeTruthy();
    expect(within(week).queryByText('MG-14')).toBeNull();
    // Five projects, three shown.
    fireEvent.click(within(week).getByRole('button', { name: '▸ 2 more projects · show all' }));
    expect(within(week).getByRole('button', { name: '▸ Quality' })).toBeTruthy();
  });

  it('Week_TheProviderRow_LeavesOutWhatIsHeld_TheDaySaysWhy', async () => {
    await weekOpen();

    const day = screen.getByRole('row', { name: 'Day' });
    const provider = screen.getByRole('row', { name: 'In OpenProject' });
    expect(day.textContent).toMatch(/^Day3h 35m1h 00m20m held/);
    expect(provider.textContent).toMatch(/^In OpenProject · what your manager sees3h 35m40m/);
    expect(screen.getByText(/All sent, except OPS-4's 20m on .*, held by an overlap\./)).toBeTruthy();
  });

  it('Week_ADayClicked_OpensThatDay', async () => {
    const bridge = await weekOpen();

    fireEvent.click(within(screen.getByRole('row', { name: 'Day' })).getAllByRole('button')[1]);

    await screen.findByRole('region', { name: "The day's entries" });
    expect(bridge.api.getWorklogsByDate).toHaveBeenCalledWith(TUESDAY);
  });

  it('Week_ATaskCellClicked_OpensThatDay', async () => {
    const bridge = await weekOpen();

    fireEvent.click(screen.getByRole('button', { name: /^PF-31 on .*: open the day$/ }));

    await waitFor(() => expect(bridge.api.getWorklogsByDate).toHaveBeenCalledWith(MONDAY));
  });

  it('Week_ExportCsv_AsksMainForTheWeek_SaysWhere', async () => {
    const bridge = await weekOpen();

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Saved to C:\\exports\\week.csv');
    expect(bridge.api.exportWorklogsCsv).toHaveBeenCalledWith(MONDAY, SUNDAY);
  });

  it('Week_ExportRefused_SaysWhy', async () => {
    await weekOpen({ exportWorklogsCsv: vi.fn().mockRejectedValue(new Error('disk full')) });

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Not exported: disk full');
  });

  it('Week_TheWeekBefore_ReadsIt', async () => {
    const bridge = await weekOpen();

    fireEvent.click(screen.getByRole('button', { name: 'The week before' }));

    await waitFor(() => expect(bridge.api.getWorklogsRange).toHaveBeenCalledWith(addLocalDays(MONDAY, -7), addLocalDays(MONDAY, -1)));
  });

  it('Week_Empty_SaysSo', async () => {
    installElectronApi();
    render(<WorklogHistoryView />);
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));

    expect(await screen.findByText('Nothing logged this week.')).toBeTruthy();
  });
});
