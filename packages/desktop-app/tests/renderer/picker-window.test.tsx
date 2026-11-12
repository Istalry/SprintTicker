import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PickerWindow } from '../../src/renderer/components/PickerWindow';
import type { ActiveSessionDTO, ProjectDTO, TaskDTO } from '../../src/shared/dtos';
import type { PickerDataDTO } from '../../src/shared/task-picker';
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
    await screen.findByRole('dialog', { name: 'Assign to a task' });

    await pickMG22();

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(bridge.assignSession).toHaveBeenCalledWith(MG22.id);
    expect(bridge.startTask).not.toHaveBeenCalled();
  });

  it('DuringAnInterruption_APickSwitches_WithItsTimeWhenTicked', async () => {
    const bridge = openWith(DURING_INTERRUPTION);
    await screen.findByRole('dialog', { name: 'Switch task' });

    fireEvent.click(await screen.findByRole('checkbox', { name: /Put "Call with Marc" \(12m\) on it too/ }));
    await pickMG22();

    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(bridge.switchFromInterruption).toHaveBeenCalledWith(MG22.id, true);
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
