import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EodWrapUpModal } from '../../src/renderer/views/EOD/EodWrapUpModal';
import { TaskSelectionModal } from '../../src/renderer/components/TaskSelectionModal';
import { ProjectDTO, TaskDTO } from '../../src/shared/dtos';
import { installElectronApi } from './electron-api-mock';

/**
 * Both modals mount their content afresh on every opening. They used to stay
 * mounted and reset themselves from an effect on `isOpen`, which is what these
 * pin: what an opening must start from, and what must survive while open.
 */

const PROJECTS: ProjectDTO[] = [
  { id: 'P-1', key: 'SPR', name: 'Sprint' },
  { id: 'P-2', key: 'OPS', name: 'Operations' }
];

const task = (projectId: string, key: string): TaskDTO => ({
  id: `${projectId}-${key}`,
  projectId,
  key,
  title: `Title of ${key}`,
  status: 'todo'
});

describe('EodWrapUpModal', () => {
  const modal = (isOpen: boolean) => (
    <EodWrapUpModal isOpen={isOpen} onClose={vi.fn()} onConfirmEod={vi.fn().mockResolvedValue(undefined)} />
  );

  it('Reopen_AfterACompletedWrapUp_OffersTheWrapUpAgain', async () => {
    // `completed` was never reset, so the next evening's prompt -- or the
    // header button -- opened straight onto "Day Complete!".
    const { rerender } = render(modal(true));
    fireEvent.click(screen.getByText('Execute Wrap-Up Now'));
    fireEvent.click(screen.getByText('Press START (or click) to Confirm'));
    await screen.findByText('Day Complete!');

    rerender(modal(false));
    rerender(modal(true));

    expect(screen.getByText('Execute Wrap-Up Now')).toBeTruthy();
    expect(screen.queryByText('Day Complete!')).toBeNull();
  });
});

/**
 * The bar's buttons reach the dialog as main decoded them. Only the wrap-up's
 * own actions may move it: they come only while the bar shows the prompt.
 */
describe('EodWrapUpModal hardware buttons', () => {
  const open = () => {
    const bridge = installElectronApi();
    const onClose = vi.fn();
    render(<EodWrapUpModal isOpen onClose={onClose} onConfirmEod={vi.fn().mockResolvedValue(undefined)} />);
    const press = (inputKey: string, actionAssigned: string) =>
      act(() => bridge.emit('onHardwareInputEvent', { inputKey, actionAssigned }));
    return { bridge, onClose, press };
  };

  it('Start_WhileTheBarShowsTheSession_NeverWrapsUp', async () => {
    // The bar paused the session and then opened the task picker; the dialog
    // read the same two STARTs as a confirmed wrap-up.
    const { bridge, press } = open();

    press('start', 'TOGGLE_TRACK_PAUSE');
    press('start', 'UPDATE_SELECTION');

    expect(bridge.api.triggerEodWrapUp).not.toHaveBeenCalled();
    expect(screen.getByText('Execute Wrap-Up Now')).toBeTruthy();
  });

  it('Back_WhileTheBarShowsSomethingElse_KeepsTheDialogOpen', () => {
    const { onClose, press } = open();

    press('back', 'CANCEL_SELECTION');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('Start_TwiceOnThePrompt_WrapsUp', async () => {
    const { bridge, press } = open();

    press('start', 'CONFIRM_EOD_WRAP_UP_STEP_1');
    expect(screen.getByText('Press START (or click) to Confirm')).toBeTruthy();
    press('start', 'EXECUTE_EOD_WRAP_UP');

    expect(await screen.findByText('Day Complete!')).toBeTruthy();
    expect(bridge.api.triggerEodWrapUp).toHaveBeenCalledTimes(1);
  });

  it('Start_AfterAClickArmedTheDialog_IsTheConfirmation', async () => {
    // The armed button says "Press START"; main, which counts its own
    // presses, still calls that one the first.
    const { bridge, press } = open();
    fireEvent.click(screen.getByText('Execute Wrap-Up Now'));

    press('start', 'CONFIRM_EOD_WRAP_UP_STEP_1');

    expect(await screen.findByText('Day Complete!')).toBeTruthy();
    expect(bridge.api.triggerEodWrapUp).toHaveBeenCalledTimes(1);
  });

  it('Back_OnThePrompt_DismissesTheWrapUp', () => {
    const { onClose, press } = open();

    press('back', 'DISMISS_EOD_WRAP_UP');

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('TaskSelectionModal', () => {
  const modal = (isOpen: boolean, projects: ProjectDTO[] = PROJECTS) => (
    <TaskSelectionModal isOpen={isOpen} onClose={vi.fn()} projects={projects} onSelectTask={vi.fn()} />
  );

  it('Reopen_AfterChoosingAProject_StartsAgainOnStepOne', async () => {
    installElectronApi({ getProjects: vi.fn().mockResolvedValue(PROJECTS) });
    const { rerender } = render(modal(true));
    fireEvent.click(await screen.findByText('Operations'));
    expect(screen.getByText('Step 2: Select Task under [OPS]')).toBeTruthy();

    rerender(modal(false));
    rerender(modal(true));

    expect(screen.getByText('Step 1: Select Target Project')).toBeTruthy();
  });

  it('ProjectsUpdate_WhileChoosingATask_KeepsTheChoice', async () => {
    // The reset listened to the projects prop as well, so a sync landing
    // while the user was on step 2 threw them back to step 1.
    installElectronApi({ getProjects: vi.fn().mockResolvedValue(PROJECTS) });
    const { rerender } = render(modal(true));
    fireEvent.click(await screen.findByText('Operations'));

    rerender(modal(true, [...PROJECTS, { id: 'P-3', key: 'NEW', name: 'Synced' }]));

    expect(screen.getByText('Step 2: Select Task under [OPS]')).toBeTruthy();
  });

  it('ChooseProject_Always_ListsThatProjectsTasks', async () => {
    installElectronApi({
      getProjects: vi.fn().mockResolvedValue(PROJECTS),
      getTasks: vi.fn().mockImplementation(async (projectId: string) =>
        projectId === 'P-2' ? [task('P-2', 'OPS-7')] : [task('P-1', 'SPR-1')])
    });
    render(modal(true));

    fireEvent.click(await screen.findByText('Operations'));

    expect(await screen.findByText('OPS-7')).toBeTruthy();
    expect(screen.queryByText('SPR-1')).toBeNull();
  });

  it('Search_MatchingOnlyTheDescription_FindsTheTask', async () => {
    // The description is shown under the title, so it is searched too.
    installElectronApi({
      getProjects: vi.fn().mockResolvedValue(PROJECTS),
      getTasks: vi.fn().mockResolvedValue([
        { ...task('P-1', 'SPR-1'), description: 'Login fails on Safari' },
        task('P-1', 'SPR-2')
      ])
    });
    render(modal(true));
    fireEvent.click(await screen.findByText('Sprint'));
    await screen.findByText('SPR-2');

    fireEvent.change(screen.getByPlaceholderText(/Search task key/), { target: { value: 'safari' } });

    expect(screen.getByText('SPR-1')).toBeTruthy();
    expect(screen.getByText('Login fails on Safari')).toBeTruthy();
    expect(screen.queryByText('SPR-2')).toBeNull();
  });

  it('ChooseProject_TasksReadFails_SaysThereAreNone', async () => {
    installElectronApi({
      getProjects: vi.fn().mockResolvedValue(PROJECTS),
      getTasks: vi.fn().mockRejectedValue(new Error('database locked'))
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(modal(true));

    fireEvent.click(await screen.findByText('Sprint'));

    expect(await screen.findByText(/No matching tasks under \[SPR\]/)).toBeTruthy();
  });
});
