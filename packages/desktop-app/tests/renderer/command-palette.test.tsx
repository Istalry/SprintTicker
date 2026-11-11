import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommandPalette, CommandPaletteProps } from '../../src/renderer/components/CommandPalette';
import { App } from '../../src/renderer/App';
import { filterPalette, paletteActions, settingsActions } from '../../src/renderer/utils/palette-actions';
import type { ActiveSessionDTO, ProjectDTO, TaskDTO } from '../../src/shared/dtos';
import type { PickerDataDTO } from '../../src/shared/task-picker';
import { installElectronApi, TRACKING_SESSION } from './electron-api-mock';

/** The command palette (P7c, S30): what each state offers, what words find, and what Enter does. */

const MG: ProjectDTO = { id: 'p-mg', key: 'MG', name: 'Moonlight Garden' };
const MG22: TaskDTO = { id: 'id-MG-22', projectId: MG.id, key: 'MG-22', title: 'Grass shader wind', status: 'in_progress' };
const PF31: TaskDTO = { id: 'id-PF-31', projectId: MG.id, key: 'PF-31', title: 'Hammer and quench sounds', status: 'todo' };

const DATA: PickerDataDTO = { previous: PF31, recent: [], starred: [], tasks: [MG22, PF31], projects: [MG], projectSeconds: {} };

const DURING_INTERRUPTION: ActiveSessionDTO = {
  ...TRACKING_SESSION,
  sessionId: 'int_1', taskId: 'int_1', taskKey: 'ADHOC', taskTitle: 'Call with Marc', isAdHoc: true,
  interruption: {
    id: 'int_1', name: 'Call with Marc', title: 'Call with Marc', startedAtUtc: '2026-11-10T09:00:00.000Z', index: 1,
    source: 'window', interruptedSessionId: 'S-1', interruptedTaskKey: 'SPR-142',
    interruptedTaskTitle: 'Rework the pause menu', interruptedWasPaused: false
  }
};

const ids = (state: Parameters<typeof paletteActions>[0]) => paletteActions(state).map(a => a.id);

describe('paletteActions', () => {
  it('Idle_StartAndInterrupt_NoSessionActions', () => {
    const offered = ids({ session: null, toPlace: 0, previousKey: 'PF-31' });

    expect(offered.slice(0, 2)).toEqual(['start', 'interrupt']);
    expect(offered).not.toContain('stop');
    expect(offered).not.toContain('previous');
  });

  it('Timing_SwitchPreviousPauseStopInterrupt', () => {
    const offered = ids({ session: TRACKING_SESSION, toPlace: 0, previousKey: 'PF-31' });

    expect(offered.slice(0, 5)).toEqual(['switch', 'previous', 'pause', 'stop', 'interrupt']);
    expect(paletteActions({ session: TRACKING_SESSION, toPlace: 0, previousKey: 'PF-31' })[1].label).toBe('Previous task: PF-31');
  });

  it('Paused_ResumeInsteadOfPause', () => {
    const offered = ids({ session: { ...TRACKING_SESSION, status: 'PAUSED' }, toPlace: 0, previousKey: null });

    expect(offered).toContain('resume');
    expect(offered).not.toContain('pause');
  });

  it('Interruption_BackStopAnother_NeverPauseOrPrevious', () => {
    const actions = paletteActions({ session: DURING_INTERRUPTION, toPlace: 0, previousKey: 'PF-31' });

    expect(actions.map(a => a.id).slice(0, 4)).toEqual(['switch', 'back', 'stop', 'another']);
    expect(actions.find(a => a.id === 'back')?.label).toBe('Back to SPR-142');
    expect(actions.map(a => a.id)).not.toContain('pause');
    expect(actions.map(a => a.id)).not.toContain('previous');
  });

  it('AdHocSession_OffersAssign', () => {
    const offered = ids({ session: { ...TRACKING_SESSION, isAdHoc: true, taskId: 'adhoc_1' }, toPlace: 0, previousKey: null });

    expect(offered).toContain('assign');
  });

  it('ToPlace_OffersPlaceWithItsCount', () => {
    const place = paletteActions({ session: null, toPlace: 3, previousKey: null }).find(a => a.id === 'place');

    expect(place?.hint).toBe('3 to place');
    expect(ids({ session: null, toPlace: 0, previousKey: null })).not.toContain('place');
  });
});

describe('filterPalette', () => {
  const all = [...paletteActions({ session: TRACKING_SESSION, toPlace: 2, previousKey: null }), ...settingsActions(false)];

  it.each([['sort'], ['assign']])('%s_FindsPlace', word => {
    expect(filterPalette(all, word).map(a => a.id)).toContain('place');
  });

  it.each([['finish'], ['log']])('%s_FindsStop', word => {
    expect(filterPalette(all, word).map(a => a.id)).toContain('stop');
  });

  it('ALabelStartingWithIt_ComesFirst', () => {
    expect(filterPalette(all, 'pa')[0].id).toBe('pause');
  });

  it('ASetting_FoundByName_OpensItsGroup', () => {
    const found = filterPalette(all, 'lunch').find(a => a.label === 'Lunch');

    expect(found?.id).toBe('settings:workday');
    expect(found?.hint).toBe('My workday');
  });

  it('DeveloperSettings_HiddenUntilShown', () => {
    expect(settingsActions(false).some(a => a.id === 'settings:developer')).toBe(false);
    expect(settingsActions(true).some(a => a.id === 'settings:developer')).toBe(true);
  });

  it('Nothing_AnswersEmpty', () => {
    expect(filterPalette(all, 'zzzz')).toEqual([]);
  });
});

describe('CommandPalette', () => {
  const open = (props: Partial<CommandPaletteProps> = {}) => {
    installElectronApi({ getPickerData: vi.fn().mockResolvedValue(DATA) });
    const onAction = vi.fn();
    const onPickTask = vi.fn();
    const onClose = vi.fn();
    render(
      <CommandPalette isOpen session={TRACKING_SESSION} toPlace={3} onAction={onAction} onPickTask={onPickTask} onClose={onClose} {...props} />
    );
    return { onAction, onPickTask, onClose };
  };
  const type = (text: string) => fireEvent.change(screen.getByLabelText('Command'), { target: { value: text } });
  const key = (k: string) => fireEvent.keyDown(screen.getByLabelText('Command'), { key: k });

  it('Sort_Enter_PlacesInterruptions', async () => {
    const { onAction, onClose } = open();

    type('sort');
    key('Enter');

    expect(onAction).toHaveBeenCalledWith('place');
    expect(onClose).toHaveBeenCalled();
  });

  it('ATaskByTitle_SaysSwitchToIt_AndEnterPicksIt', async () => {
    const { onPickTask } = open();
    await waitFor(() => expect(window.electronAPI.getPickerData).toHaveBeenCalled());

    type('grass');
    expect(await screen.findByText('switch to it')).toBeTruthy();
    key('Enter');

    expect(onPickTask).toHaveBeenCalledWith(MG22);
  });

  it('Idle_ATask_SaysStartIt', async () => {
    open({ session: null });

    type('MG-22');

    expect(await screen.findByText('start it')).toBeTruthy();
  });

  it('ArrowDown_MovesTheSelection', () => {
    const { onAction } = open();

    key('ArrowDown');
    key('Enter');

    // Switch first, then Previous once the snapshot says there is one; Pause otherwise.
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0]).not.toBe('switch');
  });

  it('Escape_Closes', () => {
    const { onClose, onAction } = open();

    key('Escape');

    expect(onClose).toHaveBeenCalled();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('NothingMatches_SaysSo', () => {
    open();

    type('zzzz');

    expect(screen.getByText('Nothing by that name.')).toBeTruthy();
  });
});

describe('Ctrl+K in the window', () => {
  it('CtrlK_OpensThePalette_AndAgainClosesIt', async () => {
    installElectronApi();
    render(<App />);
    await screen.findByText(/No worklogs recorded today yet/);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeTruthy();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull());
  });

  it('PaletteStart_OpensThePicker', async () => {
    installElectronApi();
    render(<App />);
    await screen.findByText(/No worklogs recorded today yet/);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(await screen.findByLabelText('Command'), { target: { value: 'start' } });
    fireEvent.keyDown(screen.getByLabelText('Command'), { key: 'Enter' });

    expect(await screen.findByRole('dialog', { name: 'Start a task' })).toBeTruthy();
  });
});
