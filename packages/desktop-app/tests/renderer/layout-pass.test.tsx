import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeviceDiagnosticsView } from '../../src/renderer/views/Device/DeviceDiagnosticsView';
import { ProjectTaskManagerView } from '../../src/renderer/views/Tasks/ProjectTaskManagerView';
import { ProjectDTO, TaskDTO } from '../../src/shared/dtos';
import { END_THE_INTERRUPTION_FIRST } from '../../src/shared/interruption';
import { CONNECTED_DEVICE, TRACKING_SESSION, installElectronApi } from './electron-api-mock';

describe('the task key colour', () => {
  it('Mount_StoredColour_ListOpensOnIt', async () => {
    // The list had no value: it opened on the first entry whatever was chosen.
    installElectronApi({
      getDeviceStatus: async () => CONNECTED_DEVICE,
      getColorTheme: vi.fn().mockResolvedValue('retro_arcade')
    });
    render(<DeviceDiagnosticsView />);

    const list = await screen.findByLabelText('Task key color') as HTMLSelectElement;
    await waitFor(() => expect(list.value).toBe('retro_arcade'));
    expect(list.selectedOptions[0].textContent).toBe('Amber');
  });

  it('Change_SendsTheColourAndShowsIt', async () => {
    const bridge = installElectronApi({ getDeviceStatus: async () => CONNECTED_DEVICE });
    render(<DeviceDiagnosticsView />);

    const list = await screen.findByLabelText('Task key color') as HTMLSelectElement;
    fireEvent.change(list, { target: { value: 'nordic_cyan' } });

    expect(bridge.api.setColorTheme).toHaveBeenCalledWith('nordic_cyan');
    expect(list.value).toBe('nordic_cyan');
  });
});

describe('the task list rows', () => {
  const PROJECT: ProjectDTO = { id: 'P-1', key: 'SPR', name: 'Sprint', openTaskCount: 2 };
  const TASKS: TaskDTO[] = [
    { id: 'T-1', projectId: 'P-1', key: 'SPR-142', title: 'Rework the pause menu', status: 'in_progress' },
    { id: 'T-2', projectId: 'P-1', key: 'SPR-143', title: 'Pause menu sounds', status: 'todo' }
  ] as TaskDTO[];

  it('Rows_NoInternalProjectId', async () => {
    installElectronApi({ getProjects: vi.fn().mockResolvedValue([PROJECT]), getTasks: vi.fn().mockResolvedValue(TASKS) });
    render(<ProjectTaskManagerView />);

    await screen.findByText('Pause menu sounds');
    expect(screen.queryByText(/^Project: /)).toBeNull();
  });

  it('NothingRunning_RowsOfferStart', async () => {
    // "Switch" with nothing to switch from.
    installElectronApi({ getProjects: vi.fn().mockResolvedValue([PROJECT]), getTasks: vi.fn().mockResolvedValue(TASKS) });
    render(<ProjectTaskManagerView />);

    await screen.findByText('Pause menu sounds');
    expect(screen.getAllByRole('button', { name: 'Start' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Switch' })).toBeNull();
  });

  it('TaskRunning_OtherRowsOfferSwitch', async () => {
    installElectronApi({
      getProjects: vi.fn().mockResolvedValue([PROJECT]),
      getTasks: vi.fn().mockResolvedValue(TASKS),
      getCurrentSession: vi.fn().mockResolvedValue(TRACKING_SESSION)
    });
    render(<ProjectTaskManagerView />);

    expect(await screen.findByRole('button', { name: 'Switch' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete SPR-143' })).toBeTruthy();
  });

  it('Stop_OneClick_StopsAndLeavesTheTaskOpen_NoSecondDialog', async () => {
    // P7c: one finish flow. Done and Discard are the session card's.
    const bridge = installElectronApi({
      getProjects: vi.fn().mockResolvedValue([PROJECT]),
      getTasks: vi.fn().mockResolvedValue(TASKS),
      getCurrentSession: vi.fn().mockResolvedValue(TRACKING_SESSION)
    });
    render(<ProjectTaskManagerView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));

    await waitFor(() => expect(bridge.api.completeSession).toHaveBeenCalledWith(undefined, false));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/Mark as Done/i)).toBeNull();
  });

  it('Start_StartsTheTask', async () => {
    const bridge = installElectronApi({ getProjects: vi.fn().mockResolvedValue([PROJECT]), getTasks: vi.fn().mockResolvedValue(TASKS) });
    render(<ProjectTaskManagerView />);
    await screen.findByText('Pause menu sounds');

    fireEvent.click(screen.getAllByRole('button', { name: 'Start' })[1]);

    await waitFor(() => expect(bridge.api.startTask).toHaveBeenCalledWith('T-2', false, 'Pause menu sounds'));
  });

  it('Switch_DuringAnInterruption_Disabled_SaysEndItFirst', async () => {
    // Choosing a task does nothing during an interruption (2026-11-12).
    const during = {
      ...TRACKING_SESSION,
      sessionId: 'int_1', taskId: 'int_1', taskKey: 'ADHOC', taskTitle: 'Call with Marc', isAdHoc: true,
      interruption: {
        id: 'int_1', name: 'Call with Marc', title: 'Call with Marc', startedAtUtc: '2026-11-10T09:00:00.000Z', index: 1,
        source: 'window' as const, interruptedSessionId: 'S-1', interruptedTaskKey: 'SPR-142',
        interruptedTaskTitle: 'Rework the pause menu', interruptedWasPaused: false
      }
    };
    const bridge = installElectronApi({
      getProjects: vi.fn().mockResolvedValue([PROJECT]),
      getTasks: vi.fn().mockResolvedValue(TASKS),
      getCurrentSession: vi.fn().mockResolvedValue(during)
    });
    render(<ProjectTaskManagerView />);
    await screen.findAllByRole('button', { name: 'Switch' });

    const button = screen.getAllByRole('button', { name: 'Switch' })[1] as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(END_THE_INTERRUPTION_FIRST);
    fireEvent.click(button);

    expect(bridge.api.switchFromInterruption).not.toHaveBeenCalled();
    expect(bridge.api.startTask).not.toHaveBeenCalled();
  });
});
