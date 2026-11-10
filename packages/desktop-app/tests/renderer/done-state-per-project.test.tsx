import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DoneStatePerProject } from '../../src/renderer/components/DoneStatePerProject';
import { installElectronApi } from './electron-api-mock';

const PROJECTS = [
  { id: 'P1', key: 'MG', name: 'Mobile game', providerId: 'jira' },
  { id: 'P2', key: 'OPS', name: 'Operations', providerId: 'jira' },
  { id: 'P3', key: 'WEB', name: 'Website', providerId: 'openproject' }
];

/** "When I mark a task done", per project (S20). */
describe('DoneStatePerProject', () => {
  it('Jira_ListsItsProjects_AndCountsThoseThatDiffer', async () => {
    installElectronApi({
      getProjects: async () => PROJECTS,
      getFlowSetting: (async () => ({ default: null, overrides: { P2: 'Resolved' } })) as never
    });
    render(<DoneStatePerProject providerId="jira" statuses={[]} />);

    expect(await screen.findByText(/1 project differs/)).toBeTruthy();
    expect((screen.getByLabelText('Done for Operations') as HTMLInputElement).value).toBe('Resolved');
    expect(screen.getByLabelText('Done for Mobile game')).toBeTruthy();
    expect(screen.queryByLabelText('Done for Website')).toBeNull();
  });

  it('Jira_ATypedState_IsSavedForThatProject', async () => {
    const bridge = installElectronApi({ getProjects: async () => PROJECTS });
    render(<DoneStatePerProject providerId="jira" statuses={[]} />);
    const field = await screen.findByLabelText('Done for Mobile game');

    fireEvent.change(field, { target: { value: 'In Review' } });
    fireEvent.blur(field);

    await waitFor(() =>
      expect(bridge.api.saveFlowSetting).toHaveBeenCalledWith('done_state_by_project', { default: null, overrides: { P1: 'In Review' } })
    );
  });

  it('OpenProject_PicksAStatus_AndEmptyFollowsTheChoiceAbove', async () => {
    const bridge = installElectronApi({
      getProjects: async () => PROJECTS,
      getFlowSetting: (async () => ({ default: null, overrides: { P3: '21' } })) as never
    });
    render(<DoneStatePerProject providerId="openproject" statuses={[{ id: '21', name: 'In review', isClosed: false }, { id: '31', name: 'Closed', isClosed: true }]} />);

    fireEvent.change(await screen.findByLabelText('Done for Website'), { target: { value: '' } });

    await waitFor(() =>
      expect(bridge.api.saveFlowSetting).toHaveBeenCalledWith('done_state_by_project', { default: null, overrides: {} })
    );
  });

  it('NoProjectsYet_ShowsNothing', async () => {
    const bridge = installElectronApi();
    render(<DoneStatePerProject providerId="jira" statuses={[]} />);

    await waitFor(() => expect(bridge.api.getProjects).toHaveBeenCalled());
    expect(screen.queryByText(/set one per project/)).toBeNull();
  });
});
