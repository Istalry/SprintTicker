import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StartSideEffectsSetting } from '../../src/renderer/components/StartSideEffectsSetting';
import { installElectronApi } from './electron-api-mock';

const CAN_DO_NOTHING = {
  providerId: 'sprintticker', canAssign: false, canTransition: false,
  canFindWorklog: false, canFetchByKey: false, hasHolidays: false
};
const menu = () => screen.getByRole('combobox', { name: 'When I start a task' }) as HTMLSelectElement;

/** "A glance moves nothing" (S20), in Settings, Account: one menu, never or after how long. */
describe('StartSideEffectsSetting', () => {
  it('Default_ReadsTwoMinutes', async () => {
    installElectronApi();
    render(<StartSideEffectsSetting />);

    expect(await screen.findByRole('group', { name: 'When I start a task' })).toBeTruthy();
    expect(menu().value).toBe('120');
  });

  it('Never_SavesItOff_KeepingTheWait', async () => {
    const bridge = installElectronApi();
    render(<StartSideEffectsSetting />);
    fireEvent.change(await screen.findByRole('combobox', { name: 'When I start a task' }), { target: { value: 'never' } });

    await waitFor(() =>
      expect(bridge.api.saveFlowSetting).toHaveBeenCalledWith('start_side_effects', { enabled: false, afterSeconds: 120 })
    );
    expect(menu().value).toBe('never');
  });

  it('AnotherWait_SavesItOn', async () => {
    const bridge = installElectronApi();
    render(<StartSideEffectsSetting />);
    fireEvent.change(await screen.findByRole('combobox', { name: 'When I start a task' }), { target: { value: '0' } });

    await waitFor(() =>
      expect(bridge.api.saveFlowSetting).toHaveBeenCalledWith('start_side_effects', { enabled: true, afterSeconds: 0 })
    );
  });

  it('AProviderThatCannotMoveOrTake_HidesIt', async () => {
    const bridge = installElectronApi({ getProviderCapabilities: async () => CAN_DO_NOTHING });
    render(<StartSideEffectsSetting />);

    // The setting is read either way; the row stays hidden once both answered.
    await waitFor(() => expect(bridge.api.getFlowSetting).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByText('When I start a task')).toBeNull();
  });
});
