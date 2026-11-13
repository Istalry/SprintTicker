import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { TodayView } from '../../src/renderer/views/Today/TodayView';
import { minutesUntil } from '../../src/renderer/components/MorningCard';
import type { ActiveSessionDTO, MorningDTO } from '../../src/shared/dtos';
import type { InterruptionToPlaceDTO } from '../../src/shared/interruption';
import { localDateKey } from '../../src/shared/local-date';
import { installElectronApi } from './electron-api-mock';

const MORNING: MorningDTO = {
  dateKey: localDateKey(),
  lastTask: { id: 't-12', key: 'MG-12', title: 'Fix the lantern glow at dusk', stoppedAtUtc: '2026-11-09T16:31:00.000Z' },
  standupAt: '09:30',
  inProgress: [{ id: 't-22', key: 'MG-22', title: 'Grass shader wind' }, { id: 't-31', key: 'PF-31', title: 'Hammer and quench sounds' }]
};
const YESTERDAY: InterruptionToPlaceDTO = {
  id: 'i1', name: 'Call with Marc', title: 'Call with Marc', startedAtUtc: '2026-01-05T09:00:00.000Z', endedAtUtc: '2026-01-05T09:25:00.000Z',
  durationSeconds: 1500, source: 'deck', interruptedTaskKey: 'MG-12', index: 1, ofRun: 1
};
const RUNNING = { sessionId: 'S', taskId: 't-22', taskKey: 'MG-22', status: 'TRACKING' } as ActiveSessionDTO;

const today = (session: ActiveSessionDTO | null = null, onOpenPicker = vi.fn()) => {
  render(<TodayView session={session} worklogs={[]} onPause={() => undefined} onResume={() => undefined}
    onComplete={() => undefined} onDiscard={() => undefined} onInterrupt={() => undefined} onOpenPicker={onOpenPicker} />);
  return onOpenPicker;
};

/** The morning card (S4b, P8e2): what yesterday left, on the first look at Today. */
describe('the morning card', () => {
  it('FirstLook_SaysWhatYesterdayLeft', async () => {
    installElectronApi({ getMorning: async () => MORNING, getInterruptionsToPlace: async () => [YESTERDAY] });
    today();

    const card = await screen.findByRole('region', { name: 'Good morning' });
    expect(within(card).getByText(/Carry on with/).textContent).toBe('Carry on with MG-12?');
    expect(await within(card).findByText('1 interruption from before today to place')).toBeTruthy();
    expect(within(card).getByText('Call with Marc (25m)')).toBeTruthy();
    expect(within(card).getByText(/Stand-up at/).textContent).toBe('Stand-up at 09:30');
    expect(within(card).getByText('Your 2 tasks in progress')).toBeTruthy();
  });

  it('Continue_StartsTheLastTask', async () => {
    const bridge = installElectronApi({ getMorning: async () => MORNING });
    today();

    fireEvent.click(await screen.findByRole('button', { name: '▶ Continue MG-12' }));

    expect(bridge.api.startTask).toHaveBeenCalledWith('t-12');
  });

  it('ATaskInProgress_OnePressStartsIt', async () => {
    const bridge = installElectronApi({ getMorning: async () => MORNING });
    today();

    fireEvent.click(await screen.findByRole('button', { name: 'PF-31 Hammer and quench sounds' }));

    expect(bridge.api.startTask).toHaveBeenCalledWith('t-31');
  });

  it('PickAnother_OpensThePicker', async () => {
    installElectronApi({ getMorning: async () => MORNING });
    const onOpenPicker = today();

    fireEvent.click(await screen.findByRole('button', { name: 'Pick another…' }));

    expect(onOpenPicker).toHaveBeenCalledWith('start');
  });

  it('PutAway_GoesAndMainIsTold', async () => {
    const bridge = installElectronApi({ getMorning: async () => MORNING });
    today();

    fireEvent.click(await screen.findByRole('button', { name: 'Put the morning card away' }));

    expect(screen.queryByRole('region', { name: 'Good morning' })).toBeNull();
    expect(bridge.api.markMorningSeen).toHaveBeenCalledTimes(1);
  });

  it('ASessionStartsAnywhere_GoesAndMainIsToldOnce', async () => {
    const bridge = installElectronApi({ getMorning: async () => MORNING });
    today();
    await screen.findByRole('region', { name: 'Good morning' });

    act(() => bridge.emit('onSessionUpdated', RUNNING));
    act(() => bridge.emit('onSessionUpdated', RUNNING));

    expect(screen.queryByRole('region', { name: 'Good morning' })).toBeNull();
    expect(bridge.api.markMorningSeen).toHaveBeenCalledTimes(1);
  });

  it('NoMorning_NoCard_NothingMarked', async () => {
    const bridge = installElectronApi();
    today();
    await act(async () => undefined);

    act(() => bridge.emit('onSessionUpdated', RUNNING));

    expect(screen.queryByRole('region', { name: 'Good morning' })).toBeNull();
    expect(bridge.api.markMorningSeen).not.toHaveBeenCalled();
  });

  it('NothingToCarryOn_OnlyWhatThereIs', async () => {
    installElectronApi({ getMorning: async () => ({ ...MORNING, lastTask: null, standupAt: null, inProgress: [] }) });
    today();

    const card = await screen.findByRole('region', { name: 'Good morning' });
    expect(within(card).queryByText(/Carry on/)).toBeNull();
    expect(within(card).queryByText(/Stand-up/)).toBeNull();
    expect(within(card).getByText('No task in progress')).toBeTruthy();
  });

  it('MinutesUntil_CountsFromNow', () => {
    expect(minutesUntil('09:30', new Date(2026, 10, 10, 9, 8))).toBe(22);
  });
});
