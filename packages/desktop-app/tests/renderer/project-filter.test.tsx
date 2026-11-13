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

const toggle = () => screen.getByRole('checkbox', { name: /hide empty/ });

describe('ProjectTaskManagerView project filter', () => {
  /** The projects column, so a project's name in the task panel's header does not count. */
  const column = async () => {
    const nav = await screen.findByRole('navigation', { name: 'Projects' });
    return within(nav);
  };

  it('Mount_SwitchOn_OpensOnAProjectWithTasksAndHidesTheEmptyOnes', async () => {
    installElectronApi({ getProjects: vi.fn().mockResolvedValue(PROJECTS) });
    render(<ProjectTaskManagerView />);

    const list = await column();

    expect(await list.findByText('All · 1')).toBeTruthy();
    expect(list.getByText('Sprint')).toBeTruthy();
    expect(list.queryByText('Empty')).toBeNull();
    expect(list.getByText('2 empty hidden')).toBeTruthy();
  });

  it('Mount_NothingAssigned_ListsEveryProjectAndSaysWhy', async () => {
    // The selected project used to count as "something left", so this showed
    // the first project alone with "2 hidden" -- every other project gone.
    const empty = PROJECTS.map(p => ({ ...p, openTaskCount: 0 }));
    installElectronApi({ getProjects: vi.fn().mockResolvedValue(empty) });
    render(<ProjectTaskManagerView />);

    const list = await column();

    expect(await list.findByText('All · 3')).toBeTruthy();
    expect(list.getByText('Empty')).toBeTruthy();
    expect(list.getByText('Finished')).toBeTruthy();
    expect(list.getByText('None has an open task: showing all.')).toBeTruthy();
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
    let list = await column();
    fireEvent.click(await list.findByText('Empty'));

    fireEvent.click(toggle());

    list = await column();
    expect(list.getByText('Empty')).toBeTruthy();
    expect(list.queryByText('Finished')).toBeNull();
    expect(list.getByText('1 empty hidden')).toBeTruthy();
  });

  it('TaskAdded_ToAProjectOfMyOwn_RefreshesItsCount', async () => {
    // The count comes back with every task change; a stale one hid a project
    // whose first task had just been added once another was selected.
    const own = PROJECTS.map(p => ({ ...p, providerId: 'sprintticker' }));
    const getProjects = vi.fn().mockResolvedValue(own);
    installElectronApi({ getProjects });
    render(<ProjectTaskManagerView />);
    await column();
    const readsBefore = getProjects.mock.calls.length;

    fireEvent.click(await screen.findByRole('button', { name: /Task of my own/ }));
    fireEvent.change(screen.getByPlaceholderText('SPR-101'), { target: { value: 'SPR-9' } });
    const title = screen.getByPlaceholderText('Expense report');
    fireEvent.change(title, { target: { value: 'New work' } });
    fireEvent.submit(title.closest('form')!);

    await waitFor(() => expect(getProjects.mock.calls.length).toBeGreaterThan(readsBefore));
  });
});
