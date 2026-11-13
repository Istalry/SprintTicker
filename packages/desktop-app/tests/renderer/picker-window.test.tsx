import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PickerWindow } from '../../src/renderer/components/PickerWindow';
import type { ActiveSessionDTO, ProjectDTO, TaskDTO } from '../../src/shared/dtos';
import type { PickerDataDTO } from '../../src/shared/task-picker';
import type { InterruptionToPlaceDTO } from '../../src/shared/interruption';
import type { IElectronAPI } from '../../src/preload/electron-api';
import { installElectronApi, TRACKING_SESSION } from './electron-api-mock';

/** The picker as its own window (P7b): its mode, what a pick does, and that it closes. */

const MG: ProjectDTO = { id: 'p-mg', key: 'MG', name: 'Moonlight Garden' };
const MG22: TaskDTO = { id: 'id-MG-22', projectId: MG.id, key: 'MG-22', title: 'Grass shader wind', status: 'in_progress' };

const DATA: PickerDataDTO = {
  previous: null,
  recent: [MG22],
  starred: [],
  tasks: [MG22],
  projects: [MG],
  projectSeconds: {}
};

const DURING_INTERRUPTION: ActiveSessionDTO = {
  ...TRACKING_SESSION,
  sessionId: 'int_1',
  taskId: 'int_1',
  taskKey: 'ADHOC',
  taskTitle: 'Call with Marc',
  isAdHoc: true,
  elapsedSeconds: 720,
  interruption: {
    id: 'int_1', name: 'Call with Marc', title: 'Call with Marc', startedAtUtc: '2026-11-10T09:00:00.000Z', index: 1,
    source: 'deck', interruptedSessionId: 'S-1', interruptedTaskKey: 'SPR-142',
    interruptedTaskTitle: 'Rework the pause menu', interruptedWasPaused: false
  }
};

describe('PickerWindow', () => {
  let close: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });

  afterEach(() => {
    close.mockRestore();
  });

  const openWith = (
    session: ActiveSessionDTO | null,
    mode: 'start' | 'assign' | 'place' = 'start',
    overrides: Partial<IElectronAPI> = {}
  ) => {
    const { api } = installElectronApi({
      getCurrentSession: vi.fn().mockResolvedValue(session),
      getPickerData: vi.fn().mockResolvedValue(DATA),
      ...overrides
    });
    render(<PickerWindow mode={mode} />);
    return api;
  };

  /** MG-22 is in Recent and in Assigned to me; either row picks it. */
  const pickMG22 = async () => fireEvent.click((await screen.findAllByText('Grass shader wind'))[0]);

  it('Idle_IsStartATask_AndAPickStartsItThenClosesTheWindow', async () => {
    const bridge = openWith(null);
    await screen.findByRole('dialog', { name: 'Start a task' });

    await pickMG22();

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(bridge.startTask).toHaveBeenCalledWith(MG22.id, false, MG22.title);
  });

  it('WhileATaskRuns_IsSwitchTask', async () => {
    openWith(TRACKING_SESSION);

    expect(await screen.findByRole('dialog', { name: 'Switch task' })).toBeTruthy();
  });

  it('AssignMode_AssignsTheSession', async () => {
    const bridge = openWith({ ...TRACKING_SESSION, isAdHoc: true }, 'assign');
    await screen.findByRole('dialog', { name: 'Place on a task' });

    await pickMG22();

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(bridge.assignSession).toHaveBeenCalledWith(MG22.id);
    expect(bridge.startTask).not.toHaveBeenCalled();
  });

  it('DuringAnInterruption_APickStartsNothing', async () => {
    // Main refuses to open it then (2026-11-12); this is a picker opened before.
    const bridge = openWith(DURING_INTERRUPTION);
    await screen.findByRole('dialog', { name: 'Switch task' });
    expect(screen.queryByRole('checkbox', { name: /on it too/ })).toBeNull();

    await pickMG22();

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(bridge.switchFromInterruption).not.toHaveBeenCalled();
    expect(bridge.startTask).not.toHaveBeenCalled();
  });

  it('PlaceMode_ChoosesTheInterruptionsTask_AndTheTimerRunsOn', async () => {
    // The mini timer's ↳ (P12d): which task its time goes to, nothing started.
    const bridge = openWith(DURING_INTERRUPTION, 'place');
    await screen.findByRole('dialog', { name: 'Which task is "Call with Marc" for?' });

    await pickMG22();

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(bridge.chooseInterruptionTask).toHaveBeenCalledWith(MG22.id);
    expect(bridge.switchFromInterruption).not.toHaveBeenCalled();
    expect(bridge.startTask).not.toHaveBeenCalled();
  });

  it('APick_ClosesOnlyOnceMainHasAnswered', async () => {
    let answer: (value: ActiveSessionDTO) => void = () => undefined;
    const bridge = openWith(null, 'start', {
      startTask: vi.fn(() => new Promise<ActiveSessionDTO>(resolve => { answer = resolve; }))
    });
    await screen.findByRole('dialog', { name: 'Start a task' });

    await pickMG22();
    await waitFor(() => expect(bridge.startTask).toHaveBeenCalled());
    expect(close).not.toHaveBeenCalled();

    answer(TRACKING_SESSION);
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('APickThatFails_StillClosesTheWindow', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    openWith(null, 'start', { startTask: vi.fn().mockRejectedValue(new Error('database closed')) });
    await screen.findByRole('dialog', { name: 'Start a task' });

    await pickMG22();

    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('CloseButton_ClosesTheWindow', async () => {
    openWith(null);
    await screen.findByRole('dialog', { name: 'Start a task' });

    fireEvent.click(screen.getByRole('button', { name: 'Close the picker' }));

    expect(close).toHaveBeenCalled();
  });
});

describe('the Place window after a Stop (2026-11-12)', () => {
  let close: ReturnType<typeof vi.spyOn>;
  const MG23: TaskDTO = { id: 'id-MG-23', projectId: MG.id, key: 'MG-23', title: 'Wind audio', status: 'todo' };
  const fragment = (id: string, name: string | null, title: string, minutes: number, index: number, ofRun: number): InterruptionToPlaceDTO => ({
    id, name, title, startedAtUtc: '2026-11-10T09:00:00.000Z', endedAtUtc: '2026-11-10T09:20:00.000Z',
    durationSeconds: minutes * 60, source: 'deck', interruptedTaskKey: 'SPR-142', index, ofRun
  });
  const EARLIER = fragment('int_0', 'Printer jam', 'Printer jam', 3, 1, 1);
  const MARC = fragment('int_1', 'Call with Marc', 'Call with Marc', 12, 1, 2);
  const ANA = fragment('int_2', null, 'Interruption 10:12', 5, 2, 2);

  const openPlace = (overrides: Partial<IElectronAPI> = {}) => {
    const mock = installElectronApi({
      getInterruptionsToPlace: vi.fn().mockResolvedValue([EARLIER, MARC, ANA]),
      getPickerData: vi.fn().mockResolvedValue({ ...DATA, recent: [MG22, MG23], tasks: [MG22, MG23] }),
      ...overrides
    });
    render(<PickerWindow mode="place-ended" ids={['int_1', 'int_2']} />);
    return mock;
  };
  const chooseFor = async (row: string, title: string) => {
    fireEvent.click(screen.getByRole('button', { name: `Choose a task for ${row}` }));
    await screen.findByRole('dialog', { name: `Place "${row}" on a task` });
    fireEvent.click((await screen.findAllByText(title))[0]);
  };

  beforeEach(() => {
    close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
  });

  afterEach(() => {
    close.mockRestore();
  });

  it('ListsThatRunOnly_EachWithItsName', async () => {
    openPlace();

    await screen.findByRole('dialog', { name: 'Place 2 interruptions' });
    expect((screen.getByRole('textbox', { name: 'Name Call with Marc' }) as HTMLInputElement).value).toBe('Call with Marc');
    expect((screen.getByRole('textbox', { name: 'Name Interruption 10:12' }) as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('textbox', { name: 'Name Printer jam' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Later' })).toBeTruthy();
  });

  it('TwoInterruptions_EachNamedAndPlacedOnItsOwnTask', async () => {
    const { api } = openPlace();
    await screen.findByRole('dialog', { name: 'Place 2 interruptions' });

    await chooseFor('Call with Marc', 'Grass shader wind');
    fireEvent.change(screen.getByRole('textbox', { name: 'Name Interruption 10:12' }), { target: { value: 'Ana question' } });
    await chooseFor('Ana question', 'Wind audio');
    fireEvent.click(screen.getByRole('button', { name: /^Place 2 · / }));

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(api.placeInterruption).toHaveBeenCalledWith('int_1', MG22.id);
    expect(api.placeInterruption).toHaveBeenCalledWith('int_2', MG23.id);
    expect(api.placeInterruptions).not.toHaveBeenCalled();
    expect(api.renameInterruption).toHaveBeenCalledWith('int_2', 'Ana question');
  });

  it('OnePlaced_TheOtherWaitsOnToday', async () => {
    const { api } = openPlace();
    await screen.findByRole('dialog', { name: 'Place 2 interruptions' });

    await chooseFor('Call with Marc', 'Grass shader wind');
    fireEvent.click(screen.getByRole('button', { name: /^Place 1 · / }));

    await waitFor(() => expect(api.placeInterruption).toHaveBeenCalledWith('int_1', MG22.id));
    expect(api.placeInterruption).toHaveBeenCalledTimes(1);
    expect(api.keepInterruptionOff).not.toHaveBeenCalled();
  });

  it('Later_KeepsTheNameTyped_PlacesNothing', async () => {
    const { api } = openPlace();
    await screen.findByRole('dialog', { name: 'Place 2 interruptions' });

    fireEvent.change(screen.getByRole('textbox', { name: 'Name Interruption 10:12' }), { target: { value: 'Ana question' } });
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(api.renameInterruption).toHaveBeenCalledWith('int_2', 'Ana question');
    expect(api.placeInterruption).not.toHaveBeenCalled();
  });

  it('PlacedElsewhereMeanwhile_TheWindowCloses', async () => {
    const { emit } = openPlace();
    await screen.findByRole('dialog', { name: 'Place 2 interruptions' });

    act(() => emit('onInterruptionsUpdated', [EARLIER]));

    await waitFor(() => expect(close).toHaveBeenCalled());
  });
});
