import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ProjectTaskManagerView } from '../../src/renderer/views/Tasks/ProjectTaskManagerView';
import { ProjectDTO, TaskDTO } from '../../src/shared/dtos';
import { FlowSettingKey } from '../../src/shared/flow-settings';
import { installElectronApi } from './electron-api-mock';

const JIRA: ProjectDTO = { id: 'P-MG', key: 'MG', name: 'Moonlight Garden', providerId: 'jira', openTaskCount: 3, openUnassignedCount: 1, openOthersCount: 0 };
const FORGE: ProjectDTO = { id: 'P-PF', key: 'PF', name: 'Pixel Forge', providerId: 'jira', openTaskCount: 2 };
const OWN: ProjectDTO = { id: 'ADMIN', key: 'ADMIN', name: 'Studio admin', providerId: 'sprintticker', openTaskCount: 1 };
const TASKS: TaskDTO[] = [
  { id: 'T-12', projectId: 'P-MG', key: 'MG-12', title: 'Fix the lantern glow', status: 'in_progress' },
  { id: 'T-14', projectId: 'P-MG', key: 'MG-14', title: 'Pond ripple shader', status: 'todo', description: 'Koi wake under the bridge' },
  { id: 'T-25', projectId: 'P-MG', key: 'MG-25', title: 'Firefly flocking', status: 'todo', ownership: 'unassigned' },
  { id: 'T-9', projectId: 'P-MG', key: 'MG-9', title: 'Old fog pass', status: 'done' }
];
const OWN_TASKS: TaskDTO[] = [{ id: 'ADMIN_ADMIN-1', projectId: 'ADMIN', key: 'ADMIN-1', title: 'Expense report', status: 'todo' }];

const install = (over: Record<string, unknown> = {}) => installElectronApi({
  getProjects: vi.fn().mockResolvedValue([JIRA, FORGE, OWN]),
  getTasks: vi.fn(async (id: string) => (id === 'ADMIN' ? OWN_TASKS : id === 'P-MG' ? TASKS : [])),
  ...over
});
const keysInOrder = () => screen.getAllByRole('row').slice(1).map(r => within(r).getAllByRole('cell')[1].textContent);
const column = () => within(screen.getByRole('navigation', { name: 'Projects' }));
const openProject = async (name: string) => {
  fireEvent.click(await within(await screen.findByRole('navigation', { name: 'Projects' })).findByRole('button', { name: new RegExp(`^${name}`) }));
};

/** Tasks (P16f, S13). */
describe('Tasks', () => {
  it('Render_AProvidersProject_HeaderTableNoOwnActions', async () => {
    install();
    render(<ProjectTaskManagerView />);

    await screen.findByText('Fix the lantern glow');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Moonlight Garden · from Jira · 3 open tasks');
    expect(keysInOrder()).toEqual(['MG-12', 'MG-14', 'MG-25']);
    expect(screen.getAllByTestId('task-owner').map(c => c.textContent)).toEqual(['me', 'me', 'nobody']);
    expect(screen.queryByRole('button', { name: /Task of my own/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /More for/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Delete / })).toBeNull();
  });

  it('ProjectSearch_FindsByNameOrKey', async () => {
    install();
    render(<ProjectTaskManagerView />);
    await screen.findByText('Fix the lantern glow');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search projects' }), { target: { value: 'pf' } });

    expect(column().getByRole('button', { name: /^Pixel Forge/ })).toBeTruthy();
    expect(column().queryByRole('button', { name: /^Studio admin/ })).toBeNull();
  });

  it('StarAProject_MovesItToStarredAndKeepsIt', async () => {
    const bridge = install();
    render(<ProjectTaskManagerView />);
    await screen.findByText('Fix the lantern glow');

    fireEvent.click(column().getByRole('button', { name: 'Star Pixel Forge' }));

    expect(within(screen.getByRole('list', { name: 'Starred projects' })).getByRole('button', { name: /^Pixel Forge/ })).toBeTruthy();
    await waitFor(() => expect(bridge.api.saveFlowSetting).toHaveBeenCalledWith(FlowSettingKey.STARRED_PROJECTS, ['P-PF']));
  });

  it('StarAProject_Refused_TakesItBack', async () => {
    install({ saveFlowSetting: vi.fn().mockRejectedValue(new Error('disk full')) });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    render(<ProjectTaskManagerView />);
    await screen.findByText('Fix the lantern glow');

    fireEvent.click(column().getByRole('button', { name: 'Star Pixel Forge' }));

    await waitFor(() => expect(screen.queryByRole('list', { name: 'Starred projects' })).toBeNull());
  });

  it('StarATask_SavesTheStar', async () => {
    const bridge = install();
    render(<ProjectTaskManagerView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Star MG-14' }));

    expect(bridge.api.starTask).toHaveBeenCalledWith('T-14');
    expect(screen.getByRole('button', { name: 'Unstar MG-14' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('TaskSearchAndState_FilterAndSaySo', async () => {
    install();
    render(<ProjectTaskManagerView />);
    await screen.findByText('Fix the lantern glow');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search this project' }), { target: { value: 'pond' } });
    expect(keysInOrder()).toEqual(['MG-14']);
    expect(screen.getByText('3 more tasks not shown by the search or the state chosen.')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search this project' }), { target: { value: 'koi' } });
    expect(keysInOrder()).toEqual(['MG-14']);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search this project' }), { target: { value: '' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'State' }), { target: { value: 'done' } });
    expect(keysInOrder()).toEqual(['MG-9']);
  });

  it('SortByKey_AscendingThenDescending', async () => {
    install();
    render(<ProjectTaskManagerView />);
    await screen.findByText('Fix the lantern glow');
    fireEvent.change(screen.getByRole('combobox', { name: 'State' }), { target: { value: 'all' } });

    fireEvent.click(screen.getByRole('button', { name: 'Key' }));
    expect(keysInOrder()).toEqual(['MG-9', 'MG-12', 'MG-14', 'MG-25']);
    expect(screen.getByRole('columnheader', { name: /Key/ }).getAttribute('aria-sort')).toBe('ascending');

    fireEvent.click(screen.getByRole('button', { name: /Key/ }));
    expect(keysInOrder()).toEqual(['MG-25', 'MG-14', 'MG-12', 'MG-9']);
  });

  it('WhosePills_UnassignedOff_HidesAndCounts', async () => {
    const bridge = install();
    render(<ProjectTaskManagerView />);
    await screen.findByText('Firefly flocking');

    fireEvent.click(screen.getByRole('button', { name: /Unassigned/ }));

    expect(screen.queryByText('Firefly flocking')).toBeNull();
    expect(bridge.api.setTaskVisibility).toHaveBeenCalledWith({ unassigned: false, others: false });
  });

  it('Start_Refused_SaysSo', async () => {
    install({ startTask: vi.fn().mockRejectedValue(new Error('Jira did not answer')) });
    render(<ProjectTaskManagerView />);
    await screen.findByText('Pond ripple shader');

    fireEvent.click(screen.getAllByRole('button', { name: 'Start' })[1]);

    expect((await screen.findByRole('alert')).textContent).toMatch(/Not started: Jira did not answer/);
  });

  describe('a project of my own', () => {
    it('Rename_FromTheMenu_SavesIt', async () => {
      const bridge = install();
      render(<ProjectTaskManagerView />);
      await openProject('Studio admin');

      fireEvent.click(await screen.findByRole('button', { name: 'More for Studio admin' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Rename…' }));
      const dialog = screen.getByRole('dialog', { name: 'Rename Studio admin' });
      fireEvent.change(within(dialog).getByPlaceholderText('Studio admin'), { target: { value: 'Admin' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Rename' }));

      await waitFor(() => expect(bridge.api.renameProject).toHaveBeenCalledWith({ id: 'ADMIN', name: 'Admin', key: 'ADMIN' }));
    });

    it('DeleteATask_AsksFirst', async () => {
      const bridge = install();
      render(<ProjectTaskManagerView />);
      await openProject('Studio admin');

      fireEvent.click(await screen.findByRole('button', { name: 'Delete ADMIN-1' }));
      expect(bridge.api.deleteTask).not.toHaveBeenCalled();
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete this task' })).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(bridge.api.deleteTask).toHaveBeenCalledWith('ADMIN_ADMIN-1'));
    });

    it('DeleteTheProject_AsksFirst', async () => {
      const bridge = install();
      render(<ProjectTaskManagerView />);
      await openProject('Studio admin');

      fireEvent.click(await screen.findByRole('button', { name: 'More for Studio admin' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }));
      fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete this project' })).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(bridge.api.deleteProject).toHaveBeenCalledWith('ADMIN'));
    });

    it('Import_CsvLines_ImportedAndCounted_BadJson_NothingImported', async () => {
      const bridge = install();
      render(<ProjectTaskManagerView />);
      await openProject('Studio admin');
      fireEvent.click(await screen.findByRole('button', { name: 'More for Studio admin' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Import tasks…' }));
      const box = screen.getByRole('textbox', { name: 'Tasks to import' });

      fireEvent.change(box, { target: { value: '[{ "key": "A-1" }' } });
      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
      expect(screen.getByRole('alert').textContent).toMatch(/Nothing was imported/);

      fireEvent.change(box, { target: { value: 'ADMIN-2, Timesheet, todo\nCall the bank' } });
      fireEvent.click(screen.getByRole('button', { name: 'Import' }));

      expect(await screen.findByText('Imported 2 tasks.')).toBeTruthy();
      expect(bridge.api.importTasks).toHaveBeenCalledWith('ADMIN', [
        { key: 'ADMIN-2', title: 'Timesheet', status: 'todo' },
        { key: 'IMP-2', title: 'Call the bank', status: 'todo' }
      ]);
    });

    it('MakeOne_FromTheColumn_SelectsIt', async () => {
      const bridge = install();
      render(<ProjectTaskManagerView />);
      await screen.findByText('Fix the lantern glow');

      fireEvent.click(screen.getByRole('button', { name: /A project of my own/ }));
      const dialog = screen.getByRole('dialog', { name: 'A project of my own' });
      fireEvent.change(within(dialog).getByPlaceholderText('ADMIN'), { target: { value: 'ops' } });
      fireEvent.change(within(dialog).getByPlaceholderText('Studio admin'), { target: { value: 'Operations' } });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Make the project' }));

      await waitFor(() => expect(bridge.api.createProject).toHaveBeenCalledWith({ id: 'OPS', key: 'OPS', name: 'Operations', providerId: 'sprintticker' }));
    });
  });
});
