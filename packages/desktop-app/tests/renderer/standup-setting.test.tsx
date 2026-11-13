import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StandupSetting } from '../../src/renderer/components/StandupSetting';
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
const props = { providerName: 'Jira', time: '09:30', onTimeChange: () => undefined, onShowMe: () => undefined };

/** The stand-up's row in Settings › My workday (P16c, S21). */
describe('the stand-up row', () => {
  it('Render_NoneChosen_SaysItStaysHere', async () => {
    installElectronApi();
    render(<StandupSetting {...props} />);

    expect(await screen.findByText(/Join times it on Daily Standup, kept on this computer and never sent/)).toBeTruthy();
    expect(screen.getByRole('button', { name: "Choose the stand-up's task" }).textContent).toBe('on Daily Standup ▾');
    expect(screen.queryByRole('button', { name: 'Keep it here' })).toBeNull();
  });

  it('ChooseATask_Picked_SavesItAndSaysWhereItGoes', async () => {
    const bridge = installElectronApi(PICKER);
    render(<StandupSetting {...props} />);

    fireEvent.click(screen.getByRole('button', { name: "Choose the stand-up's task" }));
    await screen.findByRole('dialog', { name: 'Time the stand-up on a task' });
    fireEvent.click(await screen.findByRole('option', { name: /^Operations/ }));
    fireEvent.click(await screen.findByText('OPS-4'));

    expect(bridge.api.setStandupTask).toHaveBeenCalledWith({ taskId: 'T-4', taskKey: 'OPS-4', title: 'Team ceremonies' });
    expect(await screen.findByText(/Join times it on OPS-4 Team ceremonies, sent to Jira like any entry/)).toBeTruthy();
  });

  it('KeepItHere_ATaskChosen_ClearsIt', async () => {
    const bridge = installElectronApi({ getStandupTask: async () => ({ taskId: 'T-4', taskKey: 'OPS-4', title: 'Team ceremonies' }) });
    render(<StandupSetting {...props} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Keep it here' }));

    expect(bridge.api.setStandupTask).toHaveBeenCalledWith(null);
    expect(await screen.findByText(/on Daily Standup, kept on this computer/)).toBeTruthy();
  });

  it('Choose_Refused_TakesTheChoiceBack', async () => {
    installElectronApi({
      getStandupTask: async () => ({ taskId: 'T-4', taskKey: 'OPS-4', title: 'Team ceremonies' }),
      setStandupTask: vi.fn().mockRejectedValue(new Error('locked'))
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<StandupSetting {...props} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Keep it here' }));

    expect(await screen.findByText(/on OPS-4 Team ceremonies/)).toBeTruthy();
  });

  it('TimeAndShowMe_ReachThePage', async () => {
    installElectronApi();
    const onTimeChange = vi.fn();
    const onShowMe = vi.fn();
    render(<StandupSetting {...props} onTimeChange={onTimeChange} onShowMe={onShowMe} />);

    fireEvent.change(screen.getByLabelText('Stand-up time'), { target: { value: '10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show me' }));

    expect(onTimeChange).toHaveBeenCalledWith('10:00');
    expect(onShowMe).toHaveBeenCalledTimes(1);
  });
});
