import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StandupTaskSetting } from '../../src/renderer/components/StandupTaskSetting';
import { installElectronApi } from './electron-api-mock';

const PICKER = {
  getPickerData: vi.fn().mockResolvedValue({
    previous: null,
    recent: [],
    starred: [],
    tasks: [{ id: 'T-4', projectId: 'P-1', key: 'OPS-4', title: 'Team ceremonies', status: 'todo' }],
    projects: [{ id: 'P-1', key: 'OPS', name: 'Operations' }],
    projectSeconds: {}
  })
};

/**
 * The stand-up's task (D3, P8c2): none keeps it local and never sent; a task
 * chosen gets its time like any entry.
 */
describe('the stand-up task setting', () => {
  it('Render_NoneChosen_SaysItIsKeptHere', async () => {
    installElectronApi();
    render(<StandupTaskSetting providerName="Jira" />);

    expect(await screen.findByText('Kept on this computer, never sent.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Keep it here' })).toBeNull();
  });

  it('ChooseATask_Picked_SavesItAndSaysWhereItGoes', async () => {
    const bridge = installElectronApi(PICKER);
    render(<StandupTaskSetting providerName="Jira" />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose a task…' }));
    await screen.findByRole('dialog', { name: 'Time the stand-up on a task' });
    fireEvent.click(await screen.findByRole('option', { name: /^Operations/ }));
    fireEvent.click(await screen.findByText('OPS-4'));

    expect(bridge.api.setStandupTask).toHaveBeenCalledWith({ taskId: 'T-4', taskKey: 'OPS-4', title: 'Team ceremonies' });
    expect(await screen.findByText('Sent to Jira, like any entry.')).toBeTruthy();
  });

  it('KeepItHere_ATaskChosen_ClearsIt', async () => {
    const bridge = installElectronApi({ getStandupTask: async () => ({ taskId: 'T-4', taskKey: 'OPS-4', title: 'Team ceremonies' }) });
    render(<StandupTaskSetting providerName="Jira" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Keep it here' }));

    expect(bridge.api.setStandupTask).toHaveBeenCalledWith(null);
    expect(await screen.findByText('Kept on this computer, never sent.')).toBeTruthy();
  });
});
