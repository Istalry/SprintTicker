import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TaskSelectionModal } from '../../src/renderer/components/TaskSelectionModal';
import { ProjectTaskManagerView } from '../../src/renderer/views/Tasks/ProjectTaskManagerView';
import { ProjectDTO } from '../../src/shared/dtos';
import { installElectronApi } from './electron-api-mock';

/**
 * The "only projects with tasks" switch, in the two window lists that show
 * it. The rule itself is pinned in tests/project-filter.test.ts; these pin
 * what each view does with it, and that the views follow one stored setting.
 */

const PROJECTS: ProjectDTO[] = [
  { id: 'P-1', key: 'EMP', name: 'Empty', openTaskCount: 0 },
  { id: 'P-2', key: 'SPR', name: 'Sprint', openTaskCount: 3 },
  { id: 'P-3', key: 'OLD', name: 'Finished', openTaskCount: 0 }
];

const toggle = () => screen.getByRole('checkbox', { name: /Only projects with tasks/ });

describe('TaskSelectionModal project filter', () => {
  const modal = () => (
    <TaskSelectionModal isOpen onClose={vi.fn()} projects={PROJECTS} onSelectTask={vi.fn()} />
  );

  it('Open_SwitchOnByDefault_ListsOnlyProjectsWithTasksAndSaysHowManyAreHidden', async () => {
    installElectronApi({ getProjects: vi.fn().mockResolvedValue(PROJECTS) });
    render(modal());

    expect(await screen.findByText('Sprint')).toBeTruthy();
    expect(screen.queryByText('Empty')).toBeNull();
    expect(screen.queryByText('Finished')).toBeNull();
    expect(screen.getByText('(2 hidden)')).toBeTruthy();
  });

  it('Untick_Switch_ListsEveryProjectAndStoresTheChoice', async () => {
    const bridge = installElectronApi({ getProjects: vi.fn().mockResolvedValue(PROJECTS) });
    render(modal());
    await screen.findByText('Sprint');

    fireEvent.click(toggle());

    expect(await screen.findByText('Empty')).toBeTruthy();
    expect(screen.getByText('Finished')).toBeTruthy();
    expect(bridge.api.setOnlyProjectsWithTasks).toHaveBeenCalledWith(false);
  });

  it('StoredOff_OnOpen_ListsEveryProject', async () => {
    installElectronApi({
      getProjects: vi.fn().mockResolvedValue(PROJECTS),
      getOnlyProjectsWithTasks: vi.fn().mockResolvedValue(false)
    });
    render(modal());

    expect(await screen.findByText('Empty')).toBeTruthy();
    expect((toggle() as HTMLInputElement).checked).toBe(false);
  });

  it('Broadcast_FlippedElsewhere_FollowsIt', async () => {
    // The Projects tab behind the picker, or another window, flipped it.
    const bridge = installElectronApi({ getProjects: vi.fn().mockResolvedValue(PROJECTS) });
    render(modal());
    await screen.findByText('Sprint');

    act(() => bridge.emit('onOnlyProjectsWithTasks', false));

    expect(screen.getByText('Empty')).toBeTruthy();
  });

  it('Untick_SaveFails_WarnsAndKeepsWhatTheUserChose', async () => {
    const bridge = installElectronApi({
      getProjects: vi.fn().mockResolvedValue(PROJECTS),
      setOnlyProjectsWithTasks: vi.fn().mockRejectedValue(new Error('database locked'))
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(modal());
    await screen.findByText('Sprint');

    fireEvent.click(toggle());

    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not save'), expect.any(Error)));
    expect(bridge.api.setOnlyProjectsWithTasks).toHaveBeenCalledWith(false);
    expect(screen.getByText('Empty')).toBeTruthy();
  });

  it('Open_SettingReadFails_WarnsAndFiltersByDefault', async () => {
    installElectronApi({
      getProjects: vi.fn().mockResolvedValue(PROJECTS),
      getOnlyProjectsWithTasks: vi.fn().mockRejectedValue(new Error('database locked'))
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(modal());

    expect(await screen.findByText('Sprint')).toBeTruthy();
    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not read'), expect.any(Error)));
    expect(screen.queryByText('Empty')).toBeNull();
  });
});

describe('ProjectTaskManagerView project filter', () => {
  /** The sidebar, so a project's name in the task panel's header does not count. */
  const sidebar = async () => {
    const heading = await screen.findByText(/^Projects \(\d+\)$/);
    return within(heading.parentElement!.parentElement!);
  };

  it('Mount_SwitchOn_OpensOnAProjectWithTasksAndHidesTheEmptyOnes', async () => {
    installElectronApi({ getProjects: vi.fn().mockResolvedValue(PROJECTS) });
    render(<ProjectTaskManagerView />);

    const list = await sidebar();

    expect(list.getByText('Projects (1)')).toBeTruthy();
    expect(list.getByText('Sprint')).toBeTruthy();
    expect(list.queryByText('Empty')).toBeNull();
    expect(list.getByText('(2 hidden)')).toBeTruthy();
  });

  it('SelectedProject_SwitchTurnedOn_StaysListedWhileEmpty', async () => {
    // A project just created has no task yet, and is the one selected: it
    // must not vanish under the user's cursor.
    installElectronApi({
      getProjects: vi.fn().mockResolvedValue(PROJECTS),
      getOnlyProjectsWithTasks: vi.fn().mockResolvedValue(false)
    });
    render(<ProjectTaskManagerView />);
    let list = await sidebar();
    fireEvent.click(await list.findByText('Empty'));

    fireEvent.click(toggle());

    list = await sidebar();
    expect(list.getByText('Empty')).toBeTruthy();
    expect(list.queryByText('Finished')).toBeNull();
    expect(list.getByText('(1 hidden)')).toBeTruthy();
  });

  it('TaskAdded_ToAnEmptyProject_RefreshesItsCount', async () => {
    // The count comes back with every task change; a stale one hid a project
    // whose first task had just been added once another was selected.
    const getProjects = vi.fn().mockResolvedValue(PROJECTS);
    installElectronApi({ getProjects });
    render(<ProjectTaskManagerView />);
    await sidebar();
    const readsBefore = getProjects.mock.calls.length;

    fireEvent.click(screen.getByText('Add Task'));
    fireEvent.change(screen.getByPlaceholderText('P-2-101'), { target: { value: 'SPR-9' } });
    const title = screen.getByPlaceholderText('Implement Inventory System');
    fireEvent.change(title, { target: { value: 'New work' } });
    fireEvent.submit(title.closest('form')!);

    await waitFor(() => expect(getProjects.mock.calls.length).toBeGreaterThan(readsBefore));
  });
});
