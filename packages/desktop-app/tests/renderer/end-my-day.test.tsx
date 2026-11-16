import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { EndMyDayDialog } from '../../src/renderer/views/EOD/EndMyDayDialog';
import type { ActiveSessionDTO, WorklogDTO } from '../../src/shared/dtos';
import { localDateKey } from '../../src/shared/local-date';
import { installElectronApi } from './electron-api-mock';

const TODAY = localDateKey();
const at = (h: number, m = 0) => new Date(`${TODAY}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`).toISOString();
const entry = (id: string, key: string, h: number, minutes: number, extra: Partial<WorklogDTO> = {}): WorklogDTO => ({
  id, sessionId: `s-${id}`, taskId: `t-${key}`, taskKey: key, taskTitle: `${key} title`, durationSeconds: minutes * 60,
  startedAtUtc: at(h), comment: '', createdAtUtc: at(h), syncState: 'sent', providerSeconds: minutes * 60, ...extra
});
const RUNNING = {
  sessionId: 'run', taskId: 't-MG-12', taskKey: 'MG-12', taskTitle: 'Fix the lantern glow at dusk', isAdHoc: false,
  status: 'TRACKING', startTimeUtc: at(9), totalPausedSeconds: 0, elapsedSeconds: 105 * 60, providerId: 'jira'
} as ActiveSessionDTO;
const WAITING = {
  id: 'int_1', name: 'Call with Marc', title: 'Call with Marc', startedAtUtc: at(10, 32), endedAtUtc: at(10, 57),
  durationSeconds: 25 * 60, source: 'window', interruptedTaskKey: 'MG-12', index: 1, ofRun: 1
};

const open = (overrides: Record<string, unknown> = {}) => {
  const bridge = installElectronApi({
    getWorklogsByDate: vi.fn().mockResolvedValue([
      entry('1', 'PF-31', 11, 100),
      entry('2', 'OPS-4', 14, 20, { syncState: 'pending', providerSeconds: undefined })
    ]),
    getCurrentSession: vi.fn().mockResolvedValue(RUNNING),
    getInterruptionsToPlace: vi.fn().mockResolvedValue([WAITING]),
    // No working hours: the gaps are their own case.
    getScheduleSettings: vi.fn().mockRejectedValue(new Error('no hours')),
    ...overrides
  });
  const props = { onClose: vi.fn(), onLater: vi.fn(), onEnded: vi.fn(), onCheckGaps: vi.fn() };
  render(<EndMyDayDialog isOpen {...props} />);
  const press = (inputKey: string, actionAssigned: string) =>
    act(() => bridge.emit('onHardwareInputEvent', { inputKey, actionAssigned }));
  return { bridge, props, press };
};
const button = () => screen.findByRole('button', { name: /^End my day/ });

/** End my day (S17, P10a). */
describe('End my day', () => {
  it('Open_EveryEntry_TheRunningOne_AndFiguresTheButtonMatches', async () => {
    open();

    // 1h 40m + 20m + 1h 45m running; sent: 1h 40m; to send: 20m + 1h 45m; to place: 25m.
    expect((await button()).textContent).toBe('End my day · send 2h 05m · 25m left to place');
    expect(screen.getByText('3h 45m logged · 1h 40m sent to OpenProject · 2h 05m to send · 25m to place')).toBeTruthy();
    const rows = within(screen.getByRole('table', { name: "Today's entries" })).getAllByRole('row');
    expect(rows.map(r => r.textContent)).toEqual([
      'TaskTimeOpenProject',
      'PF-31 PF-31 title1h 40mSent',
      'OPS-4 OPS-4 title20mWaiting to send',
      'MG-12 Fix the lantern glow at dusk1h 45mrunning · stops, stays open, and is sent'
    ]);
    expect(screen.getByRole('region', { name: 'Interruptions to place' })).toBeTruthy();
  });

  it('Open_TheShutdownIsNotTickedByDefault_Nor_By1_4sSetting', async () => {
    open({ getScheduleSettings: vi.fn().mockResolvedValue({ shutdownByDefault: true }) });

    await button();

    expect((screen.getByRole('checkbox', { name: /Then shut down the PC/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('Open_ShutdownSettingOn_TheShutdownIsTicked', async () => {
    const { bridge } = open({
      getFlowSetting: vi.fn().mockImplementation(async (key: string) => key === 'shutdown_at_end_of_day')
    });

    await vi.waitFor(() =>
      expect((screen.getByRole('checkbox', { name: /Then shut down the PC/ }) as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByRole('checkbox', { name: /Then shut down the PC/ }));
    fireEvent.click(await button());

    // Unticked for that day: the setting only chose where the box starts.
    expect(bridge.api.triggerEodWrapUp).toHaveBeenCalledWith({ shouldShutdown: false });
  });

  it('Click_EndsTheDayInOneClick_WithTheShutdownAsTicked', async () => {
    const { bridge, props } = open();
    fireEvent.click(screen.getByRole('checkbox', { name: /Then shut down the PC/ }));

    fireEvent.click(await button());

    expect(bridge.api.triggerEodWrapUp).toHaveBeenCalledWith({ shouldShutdown: true });
    await vi.waitFor(() => expect(props.onEnded).toHaveBeenCalledTimes(1));
  });

  it('Refused_SaysWhy_StaysOpen', async () => {
    const { props } = open({ triggerEodWrapUp: vi.fn().mockRejectedValue(new Error('disk full')) });

    fireEvent.click(await button());

    expect((await screen.findByRole('alert')).textContent).toBe('Not ended: disk full');
    expect(props.onEnded).not.toHaveBeenCalled();
  });

  it('Later_AsksAgainIn15Minutes', async () => {
    const { props } = open();

    fireEvent.click(screen.getByRole('button', { name: 'Remind me in 15 min' }));

    expect(props.onLater).toHaveBeenCalledWith(15);
  });

  it('NothingRunningNothingWaiting_TheButtonSaysOnlyThat', async () => {
    open({ getCurrentSession: vi.fn().mockResolvedValue(null), getInterruptionsToPlace: vi.fn().mockResolvedValue([]), getWorklogsByDate: vi.fn().mockResolvedValue([entry('1', 'PF-31', 11, 100)]) });

    expect(await screen.findByRole('button', { name: 'End my day' })).toBeTruthy();
  });

  it('UntrackedGaps_AHintWithCheckThem', async () => {
    const { props } = open({
      getCurrentSession: vi.fn().mockResolvedValue(null),
      getScheduleSettings: vi.fn().mockResolvedValue({ standupTime: '00:00', eodWrapUpTime: '23:59', lunchStartTime: '23:58', lunchEndTime: '23:59', workingDays: [0, 1, 2, 3, 4, 5, 6] })
    });

    const hint = await screen.findByRole('note');
    expect(hint.textContent).toMatch(/gaps? not timed today .*only a hint/);
    fireEvent.click(within(hint).getByRole('button', { name: 'Check them…' }));
    expect(props.onCheckGaps).toHaveBeenCalledTimes(1);
  });
});

/**
 * The bar's buttons reach the dialog as main decoded them. Only the wrap-up's
 * own actions may move it: they come only while the bar shows the prompt.
 */
describe('End my day, the bar', () => {
  it('Start_WhileTheBarShowsTheSession_NeverEndsTheDay', async () => {
    // The bar paused the session and then opened the task picker; the dialog
    // once read the same two STARTs as a confirmed wrap-up.
    const { bridge, press } = open();
    await button();

    press('start', 'TOGGLE_TRACK_PAUSE');
    press('start', 'UPDATE_SELECTION');

    expect(bridge.api.triggerEodWrapUp).not.toHaveBeenCalled();
  });

  it('Back_WhileTheBarShowsSomethingElse_KeepsTheDialogOpen', () => {
    const { props, press } = open();

    press('back', 'CANCEL_SELECTION');

    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('Start_TwiceOnThePrompt_EndsTheDay', async () => {
    const { bridge, press } = open();
    await button();

    press('start', 'CONFIRM_EOD_WRAP_UP_STEP_1');
    expect(screen.getByRole('button', { name: 'Press Pause on the bar again to end the day' })).toBeTruthy();
    press('start', 'EXECUTE_EOD_WRAP_UP');

    expect(bridge.api.triggerEodWrapUp).toHaveBeenCalledTimes(1);
  });

  it('Back_OnThePrompt_Closes', () => {
    const { props, press } = open();

    press('back', 'DISMISS_EOD_WRAP_UP');

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
