import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ActiveTaskHeroCard } from '../../src/renderer/components/ActiveTaskHeroCard';
import { WorklogHistoryView } from '../../src/renderer/views/History/WorklogHistoryView';
import { ProjectTaskManagerView } from '../../src/renderer/views/Tasks/ProjectTaskManagerView';
import { ActiveSessionDTO, ProjectDTO, TaskDTO, WorklogDTO } from '../../src/shared/dtos';
import { installElectronApi, TRACKING_SESSION } from './electron-api-mock';

/**
 * The button that opens a task's page on its provider. Where it shows is
 * `hasTaskPage` (tests/task-page.test.ts); these pin that each view shows it
 * there and nowhere else, and that it names the task -- never a URL.
 */

const openButton = (key: string) => screen.queryByRole('button', { name: `Open ${key} on its provider` });

const hero = (session: ActiveSessionDTO) => (
  <ActiveTaskHeroCard session={session} onPause={vi.fn()} onResume={vi.fn()} onComplete={vi.fn()} onDiscard={vi.fn()} onOpenTaskModal={vi.fn()} />
);

describe('the session card', () => {
  it('Render_ProviderTask_OpensItsPageByTaskId', () => {
    const bridge = installElectronApi();
    render(hero({ ...TRACKING_SESSION, providerId: 'jira' }));

    fireEvent.click(openButton('SPR-142')!);

    expect(bridge.api.openTaskPage).toHaveBeenCalledWith('T-1');
  });

  it('Render_AdHocOrTheAppsOwnProject_HasNoButton', () => {
    installElectronApi();
    const { rerender } = render(hero({ ...TRACKING_SESSION, isAdHoc: true }));
    expect(openButton('SPR-142')).toBeNull();

    rerender(hero({ ...TRACKING_SESSION, providerId: 'sprintticker' }));
    expect(openButton('SPR-142')).toBeNull();
  });
});

describe('Work History', () => {
  const START = '2026-10-13T09:00:00.000Z';
  const log = (id: string, taskKey: string, hasTaskPage: boolean): WorklogDTO => ({
    id, sessionId: `s-${id}`, taskId: `t-${id}`, taskKey, durationSeconds: 600, startedAtUtc: START, comment: '', createdAtUtc: START, hasTaskPage
  });

  it('Render_RowsWhoseTaskHasAPage_OnlyThoseHaveTheButton', async () => {
    const bridge = installElectronApi({ getWorklogsByDate: vi.fn().mockResolvedValue([log('a', 'MG-12', true), log('b', 'MISC-1', false)]) });
    render(<WorklogHistoryView />);
    await screen.findByText('MG-12');

    expect(openButton('MISC-1')).toBeNull();
    fireEvent.click(openButton('MG-12')!);
    expect(bridge.api.openTaskPage).toHaveBeenCalledWith('t-a');
  });
});

describe('the Projects tab', () => {
  const tasks = (projectId: string): TaskDTO[] => [{ id: `${projectId}-1`, projectId, key: `${projectId}-1`, title: 'Some work', status: 'todo' }];

  it('Render_ProviderProject_EachTaskHasTheButton', async () => {
    const projects: ProjectDTO[] = [{ id: 'J', key: 'J', name: 'Jira work', providerId: 'jira', openTaskCount: 1 }];
    installElectronApi({ getProjects: vi.fn().mockResolvedValue(projects), getTasks: vi.fn(async (id: string) => tasks(id)) });
    render(<ProjectTaskManagerView />);

    expect(await screen.findByRole('button', { name: 'Open J-1 on its provider' })).toBeTruthy();
  });

  it('Render_TheAppsOwnProject_NoTaskHasIt', async () => {
    const projects: ProjectDTO[] = [{ id: 'OWN', key: 'OWN', name: 'Made here', providerId: 'sprintticker', openTaskCount: 1 }];
    installElectronApi({ getProjects: vi.fn().mockResolvedValue(projects), getTasks: vi.fn(async (id: string) => tasks(id)) });
    render(<ProjectTaskManagerView />);
    await screen.findByText('Some work');

    expect(openButton('OWN-1')).toBeNull();
  });
});
