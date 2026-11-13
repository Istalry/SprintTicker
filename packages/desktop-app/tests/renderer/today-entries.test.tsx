import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TodayEntries, TODAY_ENTRIES_SHOWN } from '../../src/renderer/components/TodayEntries';
import type { ActiveSessionDTO, WorklogDTO } from '../../src/shared/dtos';
import type { InterruptionToPlaceDTO } from '../../src/shared/interruption';
import { installElectronApi } from './electron-api-mock';

const at = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const entry = (id: string, key: string, h: number, minutes: number, extra: Partial<WorklogDTO> = {}): WorklogDTO => ({
  id,
  sessionId: `s-${id}`,
  taskId: `t-${key}`,
  taskKey: key,
  taskTitle: `Title of ${key}`,
  durationSeconds: minutes * 60,
  startedAtUtc: at(h, 0),
  comment: '',
  createdAtUtc: at(h, 0),
  syncState: 'sent',
  ...extra
});
const PF = entry('w1', 'PF-31', 13, 100, { comment: 'Hammer and quench sounds' });
const OPS = entry('w2', 'OPS-4', 15, 20, { fromInterruption: true, syncState: 'pending' });
const TO_PLACE: InterruptionToPlaceDTO = {
  id: 'i1', name: null, title: 'Interruption 14:02', startedAtUtc: at(14, 2), endedAtUtc: at(14, 47),
  durationSeconds: 45 * 60, source: 'bar', interruptedTaskKey: 'PF-31', index: 1, ofRun: 1
};
const RUNNING: ActiveSessionDTO = {
  sessionId: 'S', projectId: 'p', taskId: 't-MG-12', taskKey: 'MG-12', taskTitle: 'Fix the lantern glow', isAdHoc: false,
  status: 'TRACKING', startTimeUtc: at(15, 30), totalPausedSeconds: 0, elapsedSeconds: 3600
};

const withProjects = {
  getPickerData: vi.fn().mockResolvedValue({
    previous: null, recent: [], starred: [],
    tasks: [{ id: 'T-9', projectId: 'P-1', key: 'SPR-9', title: 'The real task', status: 'todo' }],
    projects: [{ id: 'P-1', key: 'SPR', name: 'Sprint' }],
    projectSeconds: {}
  })
};

/** Today's entries (S5, P8e): one row per entry, its send state, ⋯, and the day counted. */
describe('Today entries', () => {
  it('Rows_NewestFirst_WithTheirSendState', async () => {
    installElectronApi();
    render(<TodayEntries session={null} worklogs={[PF, OPS]} />);

    const rows = within(screen.getByRole('region', { name: "Today's entries" })).getAllByRole('row').slice(1);
    expect(rows[0].textContent).toMatch(/^⚡Started as an interruption:OPS-4/);
    expect(within(rows[0]).getByText('Waiting to send')).toBeTruthy();
    expect(rows[1].textContent).toMatch(/^PF-31Hammer and quench sounds1h 40m/);
    expect(within(rows[1]).getByText('Sent')).toBeTruthy();
    expect(await screen.findByRole('columnheader', { name: 'OpenProject' })).toBeTruthy();
  });

  it('Interruption_MarkedAndExplained_OnlyWhenThereIsOne', () => {
    installElectronApi();
    const { unmount } = render(<TodayEntries session={null} worklogs={[PF, OPS]} />);
    expect(screen.getByText('⚡ marks time that started as an interruption')).toBeTruthy();
    unmount();

    render(<TodayEntries session={null} worklogs={[PF]} />);
    expect(screen.queryByText(/marks time that started/)).toBeNull();
  });

  it('Header_CountsTheDay_RunningAndToPlaceIncluded', async () => {
    installElectronApi({ getInterruptionsToPlace: vi.fn().mockResolvedValue([TO_PLACE]) });
    render(<TodayEntries session={RUNNING} worklogs={[PF, OPS]} />);

    // 1h 40m + 20m logged, 1h running, 45m to place; only PF-31 is at the provider.
    expect(await screen.findByText('3h 45m · 1h 40m sent · 45m to place')).toBeTruthy();
    expect(screen.getByText(', running')).toBeTruthy();
  });

  it('Header_AnotherDaysToPlace_NotCountedToday', async () => {
    installElectronApi({
      getInterruptionsToPlace: vi.fn().mockResolvedValue([{ ...TO_PLACE, startedAtUtc: '2026-01-05T09:00:00.000Z' }])
    });
    render(<TodayEntries session={null} worklogs={[PF]} />);

    await waitFor(() => expect(screen.getByText('1h 40m · 1h 40m sent')).toBeTruthy());
  });

  it('Many_ShowsTheNewest_ShowAllShowsTheRest', () => {
    installElectronApi();
    const day = Array.from({ length: TODAY_ENTRIES_SHOWN + 2 }, (_, i) => entry(`w${i}`, `K-${i}`, 8 + i, 10));
    render(<TodayEntries session={null} worklogs={day} />);

    expect(screen.queryByText('K-0')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'show all' }));

    expect(screen.getByText('K-0')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'show all' })).toBeNull();
  });

  it('Menu_Correct_OpensTheCorrection', () => {
    installElectronApi();
    render(<TodayEntries session={null} worklogs={[PF]} />);

    fireEvent.click(screen.getByRole('button', { name: /^More for PF-31 at / }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Correct…' }));

    expect(screen.getByRole('dialog', { name: 'Correct an entry' })).toBeTruthy();
  });

  it('Menu_Delete_AsksFirst', () => {
    installElectronApi();
    render(<TodayEntries session={null} worklogs={[PF]} />);

    fireEvent.click(screen.getByRole('button', { name: /^More for PF-31 at / }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));

    expect(screen.getByRole('dialog', { name: 'Delete an entry' })).toBeTruthy();
  });

  it('Menu_Move_SendsItToTheTaskPicked', async () => {
    const bridge = installElectronApi(withProjects);
    render(<TodayEntries session={null} worklogs={[PF]} />);

    fireEvent.click(screen.getByRole('button', { name: /^More for PF-31 at / }));
    fireEvent.click(screen.getByRole('menuitem', { name: '↳ Move…' }));
    await screen.findByRole('dialog', { name: /to a task|on a task/ });
    fireEvent.click(await screen.findByRole('option', { name: /^Sprint/ }));
    fireEvent.click(await screen.findByText('SPR-9'));

    await waitFor(() => expect(bridge.api.moveWorklog).toHaveBeenCalledWith('w1', 'T-9'));
  });

  it('Move_Refused_SaysWhy', async () => {
    installElectronApi({ ...withProjects, moveWorklog: vi.fn().mockRejectedValue(new Error('The provider records at least 1 minute(s).')) });
    render(<TodayEntries session={null} worklogs={[PF]} />);

    fireEvent.click(screen.getByRole('button', { name: /^More for PF-31 at / }));
    fireEvent.click(screen.getByRole('menuitem', { name: '↳ Move…' }));
    fireEvent.click(await screen.findByRole('option', { name: /^Sprint/ }));
    fireEvent.click(await screen.findByText('SPR-9'));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Not moved: .*at least 1 minute/);
  });

  it('Menu_KeepOff_OnlyOnAnEntryTheProviderRefused', async () => {
    // P11c: Keep off ends a refusal; on any other entry it would be a deletion.
    const refused = entry('w3', 'PF-44', 11, 30, { syncState: 'refused', refusal: 'Logging time failed: HTTP 400 - Time tracking is off.' });
    const bridge = installElectronApi();
    render(<TodayEntries session={null} worklogs={[PF, refused]} />);
    await screen.findByRole('columnheader', { name: 'OpenProject' });

    const badge = screen.getByText('Refused');
    expect(badge.getAttribute('title')).toMatch(/^Refused: Time tracking is off\./);
    fireEvent.click(screen.getByRole('button', { name: /^More for PF-31 at / }));
    expect(screen.queryByRole('menuitem', { name: /^Keep off/ })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: /^More for PF-44 at / }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Keep off OpenProject' }));

    await waitFor(() => expect(bridge.api.keepWorklogOff).toHaveBeenCalledWith('w3'));
  });

  it('Empty_SaysSo', () => {
    installElectronApi();
    render(<TodayEntries session={null} worklogs={[]} />);

    expect(screen.getByText(/Nothing logged today yet/)).toBeTruthy();
  });
});
