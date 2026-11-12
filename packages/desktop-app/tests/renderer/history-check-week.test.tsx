import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WorklogHistoryView } from '../../src/renderer/views/History/WorklogHistoryView';
import type { WeekChangeDTO, WorklogDTO } from '../../src/shared/dtos';
import { addLocalDays, localDateKey } from '../../src/shared/local-date';
import { weekStartKey } from '../../src/shared/working-days';
import { normalizeScheduleSettings } from '../../src/shared/schedule-defaults';
import { installElectronApi } from './electron-api-mock';

// The week before this one: every day of it is over, whatever today is.
const MONDAY = addLocalDays(weekStartKey(localDateKey()), -7);
const TUESDAY = addLocalDays(MONDAY, 1);
const FRIDAY = addLocalDays(MONDAY, 4);
const on = (dateKey: string, h: number, m = 0) => new Date(`${dateKey}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`).toISOString();
const entry = (id: string, key: string, dateKey: string, h: number, minutes: number, extra: Partial<WorklogDTO> = {}): WorklogDTO => ({
  id, sessionId: `s-${id}`, taskId: `t-${key}`, taskKey: key, taskTitle: key, projectId: 'p', projectName: 'Pixel Forge',
  durationSeconds: minutes * 60, startedAtUtc: on(dateKey, h), comment: '', createdAtUtc: on(dateKey, h),
  syncState: 'sent', providerSeconds: minutes * 60, ...extra
});
const WEEK = [
  entry('1', 'PF-31', TUESDAY, 13, 120),
  entry('2', 'OPS-4', TUESDAY, 14, 20, { syncState: 'held-overlap', providerSeconds: undefined }),
  entry('3', 'MG-14', FRIDAY, 9, 85, { syncState: 'correction-failed', providerSeconds: 3600 })
];

/** History with no working hours read, so the gaps stay out of the cases that are not about them. */
const open = (overrides: Record<string, unknown> = {}, props: { checkWeekOf?: string } = {}) => {
  const bridge = installElectronApi({
    getWorklogsRange: vi.fn().mockResolvedValue(WEEK),
    getScheduleSettings: vi.fn().mockRejectedValue(new Error('no hours')),
    ...overrides
  });
  render(<WorklogHistoryView {...props} />);
  return bridge;
};
const checkFromTheWeek = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Week' }));
  fireEvent.click(screen.getByRole('button', { name: 'The week before' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Check my week…' }));
  const dialog = await screen.findByRole('dialog', { name: 'Check my week' });
  await within(dialog).findByText(/things? to look at\.|Nothing to look at\./);
  return dialog;
};

/** Check my week (S15b, P9d). */
describe('Check my week', () => {
  it('FromTheWeek_ListsEachProblemWithItsFix', async () => {
    const bridge = open();
    const dialog = await checkFromTheWeek();

    expect(bridge.api.getWorklogsRange).toHaveBeenCalledWith(MONDAY, addLocalDays(MONDAY, 6));
    expect(bridge.api.getWeekChanges).toHaveBeenCalledWith(MONDAY);
    expect(within(dialog).getByText('3h 45m logged. 2 things to look at.')).toBeTruthy();
    expect(within(dialog).getByText('1 correction not sent')).toBeTruthy();
    expect(within(dialog).getByText(/^MG-14 · .* · \+25m · OpenProject did not answer$/)).toBeTruthy();
    expect(within(dialog).getByText("2 entries overlap · OPS-4's 20m waits")).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Send now' })).toBeTruthy();
    // The week is open: nothing about a closed one.
    expect(within(dialog).queryByText('✓ No change to a closed week')).toBeNull();
  });

  it('SendNow_SendsTheRefusedAgain_AndReadsTheWeekAgain', async () => {
    const bridge = open({ retryFailedWorklogs: vi.fn().mockResolvedValue({ requeued: 1 }) });
    const dialog = await checkFromTheWeek();
    const reads = vi.mocked(bridge.api.getWeekChanges).mock.calls.length;

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send now' }));

    expect((await within(dialog).findByRole('status')).textContent).toBe('Sent again: 1 entry.');
    expect(bridge.api.retryFailedWorklogs).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(vi.mocked(bridge.api.getWeekChanges).mock.calls.length).toBe(reads + 1));
  });

  it('Fix_OpensTheDayOfTheOverlap', async () => {
    const bridge = open();
    const dialog = await checkFromTheWeek();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Fix…' }));

    await screen.findByRole('region', { name: "The day's entries" });
    expect(screen.queryByRole('dialog', { name: 'Check my week' })).toBeNull();
    expect(bridge.api.getWorklogsByDate).toHaveBeenCalledWith(TUESDAY);
  });

  it('UntrackedTime_EachDay_OpenItGoesThere', async () => {
    const bridge = open({ getScheduleSettings: vi.fn().mockResolvedValue(normalizeScheduleSettings({})), getWorklogsRange: vi.fn().mockResolvedValue([]) });
    const dialog = await checkFromTheWeek();

    // Nothing logged on any weekday of a week over: five days to look at.
    expect(within(dialog).getAllByText(/^Nothing logged on /)).toHaveLength(5);
    fireEvent.click(within(dialog).getAllByRole('button', { name: /^Open / })[1]);

    await waitFor(() => expect(bridge.api.getWorklogsByDate).toHaveBeenCalledWith(TUESDAY));
  });

  it('AClosedWeek_NoChange_SaysSo_ElseListsThem', async () => {
    open({ getWeekChanges: vi.fn().mockResolvedValue([]), getWorklogsRange: vi.fn().mockResolvedValue([WEEK[0]]) });
    const dialog = await checkFromTheWeek();

    expect(within(dialog).getByText('Nothing to look at.', { exact: false })).toBeTruthy();
    expect(within(dialog).getByText('✓ No change to a closed week')).toBeTruthy();
  });

  it('AClosedWeek_Changed_ListsWhatMoved', async () => {
    const change: WeekChangeDTO = { id: 'q', operation: 'DELETE', taskKey: 'OPS-4', startedAtUtc: on(TUESDAY, 14), durationSeconds: 1200, queuedAtUtc: on(addLocalDays(MONDAY, 8), 9), state: 'sent' };
    open({ getWeekChanges: vi.fn().mockResolvedValue([change]), getWorklogsRange: vi.fn().mockResolvedValue([WEEK[0]]) });
    const dialog = await checkFromTheWeek();

    expect(within(dialog).getByText('1 change to a closed week')).toBeTruthy();
    expect(within(dialog).getByText(/^OPS-4 · .* · 20m deleted · OpenProject has it$/)).toBeTruthy();
    expect(within(dialog).queryByText('✓ No change to a closed week')).toBeNull();
  });

  it('AFragmentToPlace_PlaceOpensPlaceInterruptions', async () => {
    const fragment = {
      id: 'f1', name: null, title: 'Interruption at 16:20', startedAtUtc: on(TUESDAY, 16, 20), endedAtUtc: on(TUESDAY, 16, 38),
      durationSeconds: 18 * 60, source: 'mini', interruptedTaskKey: 'SR-8', index: 1, ofRun: 1
    };
    open({ getInterruptionsToPlace: vi.fn().mockResolvedValue([fragment]) });
    const dialog = await checkFromTheWeek();

    expect(within(dialog).getByText('18m to place')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Place…' }));

    expect(await screen.findByRole('dialog', { name: 'Place Interruption at 16:20' })).toBeTruthy();
  });

  it('Done_Closes', async () => {
    open();
    const dialog = await checkFromTheWeek();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('dialog', { name: 'Check my week' })).toBeNull();
  });

  it('OpenedForAWeek_ByTheWeeksNotice_ShowsItsWeek', async () => {
    const bridge = open({}, { checkWeekOf: MONDAY });

    expect(await screen.findByRole('dialog', { name: 'Check my week' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe('true');
    expect(bridge.api.getWeekChanges).toHaveBeenCalledWith(MONDAY);
  });
});
