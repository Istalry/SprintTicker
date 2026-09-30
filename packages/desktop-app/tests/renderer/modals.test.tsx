import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
