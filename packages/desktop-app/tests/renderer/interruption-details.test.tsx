import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InterruptionDetails } from '../../src/renderer/components/InterruptionDetails';
import type { RunningInterruptionDTO } from '../../src/shared/interruption';
import { installElectronApi } from './electron-api-mock';

const RUNNING: RunningInterruptionDTO = {
  id: 'int_1', name: null, title: 'Interruption 10:30', startedAtUtc: '2026-11-10T09:30:00.000Z', index: 1,
  source: 'window', interruptedSessionId: 's1', interruptedTaskKey: 'MG-12', interruptedTaskTitle: 'The lantern',
  interruptedWasPaused: false
};
const withProjects = {
  getPickerData: vi.fn().mockResolvedValue({
    previous: null, recent: [], starred: [],
    tasks: [{ id: 'T-9', projectId: 'P-1', key: 'SPR-9', title: 'The real task', status: 'todo' }],
    projects: [{ id: 'P-1', key: 'SPR', name: 'Sprint' }],
    projectSeconds: {}
  })
};

/** An interruption running (S9, P8e3): its name, its start, its task -- and the timer never stops for them. */
describe('the interruption running', () => {
  afterEach(() => vi.useRealTimers());

  it('Name_TypedAndEntered_NamesIt', async () => {
    const bridge = installElectronApi();
    render(<InterruptionDetails interruption={RUNNING} />);

    const field = await screen.findByLabelText('What is it about? OpenProject shows it as the note.');
    fireEvent.change(field, { target: { value: '  Call with Marc ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.blur(field);

    expect(bridge.api.renameInterruption).toHaveBeenCalledTimes(1);
    expect(bridge.api.renameInterruption).toHaveBeenCalledWith('int_1', 'Call with Marc');
  });

  it('Name_EmptyOrUnchanged_SavesNothing', () => {
    const bridge = installElectronApi();
    render(<InterruptionDetails interruption={{ ...RUNNING, name: 'Call', title: 'Call' }} />);

    const field = screen.getByLabelText(/What is it about/);
    fireEvent.blur(field);
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.blur(field);

    expect(bridge.api.renameInterruption).not.toHaveBeenCalled();
  });

  it('StartedFiveMinutesAgo_AsksMainForThatTime', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T09:40:00.000Z'));
    const bridge = installElectronApi();
    render(<InterruptionDetails interruption={RUNNING} />);

    expect(screen.getByText(/those minutes come off MG-12/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('When it started'), { target: { value: '5' } });

    expect(bridge.api.moveInterruptionStart).toHaveBeenCalledWith('2026-11-10T09:35:00.000Z');
  });

  it('TheSecondOfARun_NoStartToMove', () => {
    installElectronApi();
    render(<InterruptionDetails interruption={{ ...RUNNING, index: 2 }} />);

    expect(screen.queryByLabelText('When it started')).toBeNull();
  });

  it('ChooseATask_TheTimerRunsOn_MainIsTold', async () => {
    const bridge = installElectronApi(withProjects);
    render(<InterruptionDetails interruption={RUNNING} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose a task…' }));
    fireEvent.click(await screen.findByRole('option', { name: /^Sprint/ }));
    fireEvent.click(await screen.findByText('SPR-9'));

    await waitFor(() => expect(bridge.api.chooseInterruptionTask).toHaveBeenCalledWith('T-9'));
    expect(bridge.api.stopInterruption).not.toHaveBeenCalled();
    expect(bridge.api.backFromInterruption).not.toHaveBeenCalled();
  });

  it('Chosen_ShowsIt_LaterTakesItBack', () => {
    const bridge = installElectronApi();
    render(<InterruptionDetails interruption={{ ...RUNNING, chosenTask: { id: 'T-9', key: 'SPR-9', title: 'The real task' } }} />);

    expect(screen.getByText('Its time goes there when it ends.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));

    expect(bridge.api.chooseInterruptionTask).toHaveBeenCalledWith(null);
  });

  it('FirstInterruption_ExplainedOnce_GotItRemembers', async () => {
    const bridge = installElectronApi();
    render(<InterruptionDetails interruption={RUNNING} />);

    expect(await screen.findByText('Your first interruption.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));

    expect(screen.queryByText('Your first interruption.')).toBeNull();
    expect(bridge.api.saveFlowSetting).toHaveBeenCalledWith('first_interruption_seen', true);
  });

  it('FirstInterruption_AlreadyPutAway_NotShown', async () => {
    const bridge = installElectronApi({
      getFlowSetting: vi.fn().mockImplementation(async (key: string) => key === 'first_interruption_seen')
    });
    render(<InterruptionDetails interruption={RUNNING} />);

    await waitFor(() => expect(bridge.api.getFlowSetting).toHaveBeenCalledWith('first_interruption_seen'));
    expect(screen.queryByText('Your first interruption.')).toBeNull();
  });

  it('NothingHeld_SaysItWaitsToBePlaced', () => {
    installElectronApi();
    render(<InterruptionDetails interruption={{ ...RUNNING, interruptedSessionId: null, interruptedTaskKey: null }} />);

    expect(screen.getByText('Nothing was timing: when it ends, it waits to be placed.')).toBeTruthy();
    expect(screen.queryByText(/come off/)).toBeNull();
  });
});
