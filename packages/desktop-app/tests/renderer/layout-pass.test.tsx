import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeviceDiagnosticsView } from '../../src/renderer/views/Device/DeviceDiagnosticsView';
import { ProjectTaskManagerView } from '../../src/renderer/views/Tasks/ProjectTaskManagerView';
import { CeremoniesView } from '../../src/renderer/views/Ceremonies/CeremoniesView';
import { ProjectDTO, TaskDTO } from '../../src/shared/dtos';
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
});

describe('Ceremonies', () => {
  it('Mount_NoPromptTimeoutCard', async () => {
    // Saved and never read: its auto-dismiss and auto-execute never happened.
    installElectronApi();
    render(<CeremoniesView />);

    await screen.findByText('Try the wrap-up');
    expect(screen.queryByText(/Dialog Prompt Timeout/)).toBeNull();
    expect(screen.queryByText(/Auto-Execute/)).toBeNull();
  });
});
