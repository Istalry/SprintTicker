import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('Mount_NothingAssigned_ListsEveryProjectAndSaysWhy', async () => {
    // The selected project used to count as "something left", so this showed
    // the first project alone with "(2 hidden)" -- every other project gone.
    const empty = PROJECTS.map(p => ({ ...p, openTaskCount: 0 }));
    installElectronApi({ getProjects: vi.fn().mockResolvedValue(empty) });
    render(<ProjectTaskManagerView />);

    const list = await sidebar();

    expect(list.getByText('Projects (3)')).toBeTruthy();
    expect(list.getByText('Empty')).toBeTruthy();
    expect(list.getByText('Finished')).toBeTruthy();
    expect(list.getByText('(none has a task: showing all)')).toBeTruthy();
    expect(list.queryByText(/hidden/)).toBeNull();
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
