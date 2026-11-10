import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StartSideEffectsCard } from '../../src/renderer/components/StartSideEffectsCard';
import { installElectronApi } from './electron-api-mock';

const CAN_DO_NOTHING = {
  providerId: 'sprintticker', canAssign: false, canTransition: false,
  canFindWorklog: false, canFetchByKey: false, hasHolidays: false
};

/** "A glance moves nothing" (S20), in Settings, Account. */
describe('StartSideEffectsCard', () => {
  it('Default_ReadsTwoMinutes', async () => {
    installElectronApi();
    render(<StartSideEffectsCard />);

    expect(await screen.findByText('When I start a task')).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('combobox', { name: 'When' }) as HTMLSelectElement).value).toBe('120');
  });

  it('TurnedOff_SavesItAndDisablesTheWait', async () => {
    const bridge = installElectronApi();
    render(<StartSideEffectsCard />);
    fireEvent.click(await screen.findByRole('checkbox'));

    await waitFor(() =>
      expect(bridge.api.saveFlowSetting).toHaveBeenCalledWith('start_side_effects', { enabled: false, afterSeconds: 120 })
    );
    expect((screen.getByRole('combobox', { name: 'When' }) as HTMLSelectElement).disabled).toBe(true);
  });

  it('AnotherWait_SavesIt', async () => {
    const bridge = installElectronApi();
    render(<StartSideEffectsCard />);
    fireEvent.change(await screen.findByRole('combobox', { name: 'When' }), { target: { value: '0' } });

    await waitFor(() =>
      expect(bridge.api.saveFlowSetting).toHaveBeenCalledWith('start_side_effects', { enabled: true, afterSeconds: 0 })
    );
  });

  it('AProviderThatCannotMoveOrTake_HidesIt', async () => {
    const bridge = installElectronApi({ getProviderCapabilities: async () => CAN_DO_NOTHING });
    render(<StartSideEffectsCard />);

    // The setting is read either way; the card stays hidden once both answered.
    await waitFor(() => expect(bridge.api.getFlowSetting).toHaveBeenCalled());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByText('When I start a task')).toBeNull();
  });
});
