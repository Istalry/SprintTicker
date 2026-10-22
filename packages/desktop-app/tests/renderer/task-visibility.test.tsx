import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TaskSelectionModal } from '../../src/renderer/components/TaskSelectionModal';
import { ProjectTaskManagerView } from '../../src/renderer/views/Tasks/ProjectTaskManagerView';
import { ProjectDTO, TaskDTO } from '../../src/shared/dtos';
import { installElectronApi, TRACKING_SESSION } from './electron-api-mock';

/**
 * Whose tasks the window's two task lists show, and in what order. The rules
 * are pinned in tests/task-visibility.test.ts and tests/task-order.test.ts;
 * these pin that both views apply them, say whose a task is, and follow the
 * one stored setting.
 */

const PROJECTS: ProjectDTO[] = [
  { id: 'P-1', key: 'TEAM', name: 'Team', openTaskCount: 1, openUnassignedCount: 1, openOthersCount: 1 }
];

// In the store's order, which is not the lists' order.
const TASKS: TaskDTO[] = [
  { id: 'T-3', projectId: 'P-1', key: 'TEAM-3', title: 'Alice busy', status: 'in_progress', ownership: 'other', assigneeName: 'Alice Martin' },
  { id: 'T-2', projectId: 'P-1', key: 'TEAM-2', title: 'Free todo', status: 'todo', ownership: 'unassigned' },
  { id: 'T-1', projectId: 'P-1', key: 'TEAM-1', title: 'Mine todo', status: 'todo' }
];

const titlesInOrder = () =>
  screen.getAllByText(/^(Alice busy|Free todo|Mine todo)$/).map(el => el.textContent);

describe('TaskSelectionModal task visibility', () => {
  const openOnTheTasks = async () => {
    render(<TaskSelectionModal isOpen onClose={vi.fn()} projects={PROJECTS} onSelectTask={vi.fn()} />);
    fireEvent.click(await screen.findByText('Team'));
    await screen.findByText('Mine todo');
  };

  it('Open_DefaultVisibility_ListsMineThenFreeWorkAndHidesTeammates', async () => {
    installElectronApi({ getProjects: vi.fn().mockResolvedValue(PROJECTS), getTasks: vi.fn().mockResolvedValue(TASKS) });
    await openOnTheTasks();

    expect(titlesInOrder()).toEqual(['Mine todo', 'Free todo']);
    expect(screen.getAllByTestId('task-owner').map(el => el.textContent)).toEqual(['Unassigned']);
    expect(screen.getByText('(1 hidden)')).toBeTruthy();
  });

  it('Tick_Teammates_ShowsTheirWorkWithTheirNameAndStoresTheChoice', async () => {
    const bridge = installElectronApi({ getProjects: vi.fn().mockResolvedValue(PROJECTS), getTasks: vi.fn().mockResolvedValue(TASKS) });
    await openOnTheTasks();

    fireEvent.click(screen.getByRole('checkbox', { name: /Teammates/ }));

    expect(await screen.findByText('Alice busy')).toBeTruthy();
    expect(screen.getByText('Alice Martin')).toBeTruthy();
    expect(titlesInOrder()).toEqual(['Mine todo', 'Free todo', 'Alice busy']);
    expect(bridge.api.setTaskVisibility).toHaveBeenCalledWith({ unassigned: true, others: true });
  });

  it('ChangedElsewhere_Broadcast_FollowsIt', async () => {
    // Flipped in the Projects tab behind the picker, the picker follows.
    const bridge = installElectronApi({ getProjects: vi.fn().mockResolvedValue(PROJECTS), getTasks: vi.fn().mockResolvedValue(TASKS) });
    await openOnTheTasks();

    act(() => bridge.emit('onTaskVisibility', { unassigned: false, others: false }));

    expect(titlesInOrder()).toEqual(['Mine todo']);
    expect(screen.getByText('(2 hidden)')).toBeTruthy();
  });
});

describe('ProjectTaskManagerView task visibility', () => {
  it('Mount_SessionOnATeammatesTask_KeepsItsRowWhileTheirWorkIsHidden', async () => {
    // Its row holds the session's Stop button.
    installElectronApi({
      getProjects: vi.fn().mockResolvedValue(PROJECTS),
      getTasks: vi.fn().mockResolvedValue(TASKS),
      getCurrentSession: vi.fn().mockResolvedValue({ ...TRACKING_SESSION, taskId: 'T-3', taskKey: 'TEAM-3', taskTitle: 'Alice busy' })
    });
    render(<ProjectTaskManagerView />);

    expect(await screen.findByText('Alice busy')).toBeTruthy();
    expect(titlesInOrder()).toEqual(['Mine todo', 'Free todo', 'Alice busy']);
    expect(screen.getByText('Alice Martin')).toBeTruthy();
    expect(screen.getByText('Stop')).toBeTruthy();
  });

  it('Untick_Unassigned_HidesFreeWorkAndSaysSo', async () => {
    const bridge = installElectronApi({ getProjects: vi.fn().mockResolvedValue(PROJECTS), getTasks: vi.fn().mockResolvedValue(TASKS) });
    render(<ProjectTaskManagerView />);
    await screen.findByText('Free todo');

    fireEvent.click(screen.getByRole('checkbox', { name: /Unassigned/ }));

    expect(screen.queryByText('Free todo')).toBeNull();
    expect(titlesInOrder()).toEqual(['Mine todo']);
    expect(screen.getByText('(2 hidden)')).toBeTruthy();
    expect(bridge.api.setTaskVisibility).toHaveBeenCalledWith({ unassigned: false, others: false });
  });
});
