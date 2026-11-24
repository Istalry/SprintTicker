import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CALENDAR_HOUR_PX, WeekCalendar } from '../../src/renderer/views/History/WeekCalendar';
import type { WorklogDTO } from '../../src/shared/dtos';
import { installElectronApi } from './electron-api-mock';

/** History's calendar (LOCAL-WORK-AND-CALENDAR.md §5, T3): every gesture through the shared commands. */

const MONDAY = '2026-11-16';
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).toISOString();
const entry = (id: string, key: string, day: number, h: number, m: number, minutes: number, extra: Partial<WorklogDTO> = {}): WorklogDTO => ({
  id, sessionId: `s-${id}`, taskId: `t-${key}`, taskKey: key, taskTitle: `Title of ${key}`, durationSeconds: minutes * 60,
  startedAtUtc: at(day, h, m), comment: '', createdAtUtc: at(day, h, m), syncState: 'sent', ...extra
});
const PF = entry('w1', 'PF-31', 16, 9, 0, 60, { comment: 'Hammer' });
const MG = entry('w2', 'MG-12', 16, 9, 45, 45);
const OPS = entry('w3', 'OPS-4', 17, 14, 0, 30);

/** No schedule read: the grid is 08:00 to 19:00, so y is (hour - 8) hours of pixels. */
const y = (h: number, m = 0) => (h - 8 + m / 60) * CALENDAR_HOUR_PX;

const open = async (worklogs: WorklogDTO[] = [PF, OPS], overrides: Record<string, unknown> = {}) => {
  const bridge = installElectronApi({
    getWorklogsRange: vi.fn().mockResolvedValue(worklogs),
    getScheduleSettings: vi.fn().mockResolvedValue(null),
    getLastWeekClosed: vi.fn().mockResolvedValue(null),
    updateWorklog: vi.fn().mockResolvedValue(PF),
    ...overrides
  });
  const onAdd = vi.fn();
  const onChanged = vi.fn();
  render(<WeekCalendar monday={MONDAY} revision={0} onChanged={onChanged} onAdd={onAdd} />);
  await screen.findByRole('region', { name: 'The week as a calendar' });
  return { bridge, onAdd, onChanged };
};

const block = (key: string) => screen.getByRole('button', { name: new RegExp(`^${key} `) });
const day = (name: RegExp) => screen.getByRole('group', { name });

describe('WeekCalendar', () => {
  it('Render_EachEntryABlockInItsDay_WithItsTimes', async () => {
    await open();

    expect(within(day(/^Monday 16/)).getByRole('button', { name: /^PF-31 Title of PF-31, 0?9:00.*–10:00/ })).toBeTruthy();
    expect(within(day(/^Tuesday 17/)).getByRole('button', { name: /^OPS-4 / })).toBeTruthy();
  });

  it('ClickAnEmptySlot_AddsHalfAnHourThere', async () => {
    const { onAdd } = await open();

    fireEvent.pointerDown(day(/^Wednesday 18/), { button: 0, pointerId: 1, clientX: 10, clientY: y(10, 10) });
    fireEvent.pointerUp(day(/^Wednesday 18/), { button: 0, pointerId: 1, clientX: 10, clientY: y(10, 10) });

    expect(onAdd).toHaveBeenCalledWith({ dateKey: '2026-11-18', start: '2026-11-18T10:00', durationSeconds: 30 * 60 });
  });

  it('DragOverAnEmptySlot_SetsTheLength', async () => {
    const { onAdd } = await open();
    const wednesday = day(/^Wednesday 18/);

    fireEvent.pointerDown(wednesday, { button: 0, pointerId: 1, clientX: 10, clientY: y(13) });
    fireEvent.pointerMove(wednesday, { button: 0, pointerId: 1, clientX: 10, clientY: y(14, 30) });
    fireEvent.pointerUp(wednesday, { button: 0, pointerId: 1, clientX: 10, clientY: y(14, 30) });

    expect(onAdd).toHaveBeenCalledWith({ dateKey: '2026-11-18', start: '2026-11-18T13:00', durationSeconds: 90 * 60 });
  });

  it('ClickSelects_WithHandles_ThenAgainOpensItsActions', async () => {
    const { bridge } = await open();

    fireEvent.click(block('PF-31'));
    expect(block('PF-31').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('[data-handle]')).toHaveLength(2);

    fireEvent.click(block('PF-31'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/Delete/).length).toBeGreaterThan(0);
    expect(bridge.api.deleteWorklog).not.toHaveBeenCalled();
  });

  it('DeleteKey_OnTheSelectedEntry_AsksToDeleteIt', async () => {
    await open();
    fireEvent.click(block('PF-31'));

    fireEvent.keyDown(block('PF-31'), { key: 'Delete' });

    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('DragABlock_MovesIt_AnHourLater', async () => {
    const { bridge, onChanged } = await open();

    fireEvent.pointerDown(block('PF-31'), { button: 0, pointerId: 1, clientX: 10, clientY: 100 });
    fireEvent.pointerMove(block('PF-31'), { button: 0, pointerId: 1, clientX: 10, clientY: 100 + CALENDAR_HOUR_PX });
    fireEvent.pointerUp(block('PF-31'), { button: 0, pointerId: 1, clientX: 10, clientY: 100 + CALENDAR_HOUR_PX });

    await waitFor(() => expect(bridge.api.updateWorklog).toHaveBeenCalledWith('w1', { startedAtUtc: at(16, 10), durationSeconds: 3600, comment: 'Hammer' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('DragTheBottomHandle_EndsItLater', async () => {
    const { bridge } = await open();
    fireEvent.click(block('PF-31'));
    const handle = document.querySelector('[data-handle="end"]') as HTMLElement;

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 10, clientY: 200 });
    fireEvent.pointerUp(handle, { button: 0, pointerId: 1, clientX: 10, clientY: 200 + CALENDAR_HOUR_PX / 2 });

    await waitFor(() => expect(bridge.api.updateWorklog).toHaveBeenCalledWith('w1', { startedAtUtc: at(16, 9), durationSeconds: 90 * 60, comment: 'Hammer' }));
  });

  it('ClosedWeek_AGestureAsksFirst', async () => {
    const { bridge } = await open([PF], { getLastWeekClosed: vi.fn().mockResolvedValue(MONDAY) });

    fireEvent.pointerDown(block('PF-31'), { button: 0, pointerId: 1, clientX: 10, clientY: 100 });
    fireEvent.pointerUp(block('PF-31'), { button: 0, pointerId: 1, clientX: 10, clientY: 100 + CALENDAR_HOUR_PX });
    expect(bridge.api.updateWorklog).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Change it' }));

    await waitFor(() => expect(bridge.api.updateWorklog).toHaveBeenCalled());
  });

  it('Overlaps_Listed_EachFixAShortening', async () => {
    const { bridge } = await open([PF, MG]);

    const list = screen.getByRole('region', { name: 'Overlaps this week' });
    expect(list.textContent).toContain('share 15m');
    fireEvent.click(within(list).getByRole('button', { name: /^End PF-31 at / }));

    await waitFor(() => expect(bridge.api.updateWorklog).toHaveBeenCalledWith('w1', { startedAtUtc: at(16, 9), durationSeconds: 45 * 60, comment: 'Hammer' }));
    fireEvent.click(within(list).getByRole('button', { name: /^Start MG-12 at / }));
    await waitFor(() => expect(bridge.api.updateWorklog).toHaveBeenCalledWith('w2', { startedAtUtc: at(16, 10), durationSeconds: 30 * 60, comment: '' }));
  });
});
