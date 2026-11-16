import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AccountSettings } from '../../src/renderer/views/Settings/AccountSettings';
import { SETTINGS_ENTRIES } from '../../src/renderer/views/Settings/settings-groups';
import { installElectronApi } from './electron-api-mock';

const JIRA = {
  activeProviderId: 'jira', fallbackTicketKey: 'MISC-1',
  jiraSite: 'https://studio.atlassian.net', jiraEmail: 'alex@studio.example', jiraApiToken: 'old',
  jiraTaskScope: 'assigned_to_me', jiraTaskQuery: '', jiraTransitionInProgress: 'In Progress',
  jiraTransitionToTest: 'Ready for QA', jiraTransitionToReview: 'In Review', jiraCompletionAction: 'to_review'
};
const PROJECTS = [
  { id: 'p1', key: 'MG', name: 'Moonlight Garden', providerId: 'jira', openTaskCount: 30, openUnassignedCount: 4, openOthersCount: 0 },
  { id: 'p2', key: 'PF', name: 'Pixel Forge', providerId: 'jira', openTaskCount: 10, openUnassignedCount: 0, openOthersCount: 2 },
  { id: 'local', key: 'OWN', name: 'Mine', providerId: 'sprintticker', openTaskCount: 3 }
];
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const row = (name: string | RegExp) => screen.getByRole('group', { name });

/** Settings · Account as rows (P16b, S20). */
describe('Settings · Account', () => {
  const jira = (over: Record<string, unknown> = {}) => installElectronApi({
    getProviders: vi.fn().mockResolvedValue(JIRA),
    getProjects: vi.fn().mockResolvedValue(PROJECTS),
    getSyncHealth: vi.fn().mockResolvedValue({ state: 'ok', providerId: 'jira', sinceUtc: null, lastSyncedAtUtc: null, progress: null }),
    ...over
  });

  it('Render_TheRowsOfS20_ForJira', async () => {
    jira();
    render(<AccountSettings />);

    expect(await screen.findByRole('group', { name: 'Jira · studio.atlassian.net' })).toBeTruthy();
    for (const name of ['Tasks to fetch from Jira', 'When I start a task', 'When I mark a task done', 'Jira notifications']) {
      expect(row(name)).toBeTruthy();
    }
    expect(screen.getByText(/Advanced:/)).toBeTruthy();
    expect(screen.queryByText(/TASK PROVIDERS/)).toBeNull();
  });

  it('AccountLine_CountsTheProvidersProjectsAndTasks', async () => {
    jira();
    render(<AccountSettings />);

    // The app's own project is not Jira's; every open task counts, whoever has it.
    expect(await screen.findByText(/alex@studio\.example\. 2 projects, 46 tasks\./)).toBeTruthy();
  });

  it('RefreshNow_SyncsAndSaysWhyItFailed', async () => {
    const bridge = jira({ syncProviderNow: vi.fn().mockResolvedValue({ status: 'failed', reason: 'Jira did not answer', projects: 0, tasks: 0 }) });
    render(<AccountSettings />);

    fireEvent.click(await screen.findByRole('button', { name: 'Refresh now' }));

    expect(await screen.findByText('Could not refresh: Jira did not answer')).toBeTruthy();
    expect(bridge.api.syncProviderNow).toHaveBeenCalledTimes(1);
  });

  it('ChangeAccount_OpensTheCredentials_TheyAreSaved', async () => {
    const bridge = jira();
    render(<AccountSettings />);
    await screen.findByRole('group', { name: 'Jira · studio.atlassian.net' });
    expect(screen.queryByLabelText('API token')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Change account' }));
    fireEvent.change(screen.getByLabelText('API token'), { target: { value: 'fresh' } });

    await waitFor(() => expect(bridge.api.setActiveProvider).toHaveBeenCalledWith(expect.objectContaining({ jiraApiToken: 'fresh' })), { timeout: 3000 });
  });

  it('TasksToFetch_Custom_ShowsTheQueryUnderTheRow', async () => {
    jira();
    render(<AccountSettings />);
    const scope = await screen.findByRole('combobox', { name: 'Tasks to fetch' });

    fireEvent.change(scope, { target: { value: 'custom' } });

    expect(within(row('Tasks to fetch from Jira')).getByLabelText('Custom JQL')).toBeTruthy();
  });

  it('WhenDone_NamesTheStatesTheUserTyped', async () => {
    const bridge = jira();
    render(<AccountSettings />);
    const done = await screen.findByRole('combobox', { name: 'When I mark a task done' });
    await waitFor(() => expect((done as HTMLSelectElement).value).toBe('to_review'));

    expect(within(done).getByText('All projects: In Review')).toBeTruthy();
    fireEvent.change(done, { target: { value: 'to_test' } });

    await waitFor(() => expect(bridge.api.setActiveProvider).toHaveBeenCalledWith(expect.objectContaining({ jiraCompletionAction: 'to_test' })), { timeout: 3000 });
  });

  it('Refused_TheBannerSavesTheNewTokenAndSends', async () => {
    const bridge = jira({
      getSyncHealth: vi.fn().mockResolvedValue({ state: 'refused', providerId: 'jira', sinceUtc: null, lastSyncedAtUtc: null, progress: null })
    });
    render(<AccountSettings />);
    const field = await screen.findByLabelText('New API token');
    expect(screen.getByText(/Jira refused your token\./)).toBeTruthy();

    fireEvent.change(field, { target: { value: 'renewed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and send' }));

    await waitFor(() => expect(bridge.api.syncProviderNow).toHaveBeenCalledTimes(1));
    expect(bridge.api.setActiveProvider).toHaveBeenCalledWith({ jiraApiToken: 'renewed' });
  });

  it('NotRefused_NoBanner', async () => {
    jira();
    render(<AccountSettings />);
    await screen.findByRole('group', { name: 'Jira · studio.atlassian.net' });

    expect(screen.queryByLabelText('New API token')).toBeNull();
  });

  it('ThisComputer_OnlyTheAccountLineAndAdvanced', async () => {
    installElectronApi({ getProviders: vi.fn().mockResolvedValue({ activeProviderId: 'adhoc', fallbackTicketKey: 'MISC-1' }) });
    render(<AccountSettings />);

    expect(await screen.findByRole('group', { name: 'This computer' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: /Tasks to fetch/ })).toBeNull();
    expect(screen.queryByRole('group', { name: 'When I mark a task done' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Refresh now' })).toBeNull();
  });

  it('SprintTickerServer_AddressTokenAndTest_NoStatesToMap', async () => {
    // A SprintTicker server decides its own workflow and scope: the page
    // asks for an address and a token, and names the server once it answered.
    const bridge = installElectronApi({
      getProviders: vi.fn().mockResolvedValue({
        activeProviderId: 'custom-server', fallbackTicketKey: 'MISC-1',
        customServerUrl: 'https://tracker.example.com/st/v1', customServerToken: 'tok', customServerName: 'Team Tracker'
      }),
      testProviderConnection: vi.fn().mockResolvedValue({ ok: true, userName: 'Ada Lovelace', projectCount: 2, serverName: 'Team Tracker' })
    });
    render(<AccountSettings />);

    expect(await screen.findByRole('group', { name: 'Team Tracker · tracker.example.com' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: /Tasks to fetch/ })).toBeNull();
    expect(screen.queryByRole('group', { name: 'When I mark a task done' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change account' }));
    click('Test connection');

    expect((await screen.findByRole('status')).textContent).toBe('Connected to Team Tracker as Ada Lovelace');
    expect(bridge.api.testProviderConnection).toHaveBeenCalledWith({ providerId: 'custom-server', site: 'https://tracker.example.com/st/v1', token: 'tok' });
  });

  it('SprintTickerServer_AnHttpAddress_IsRefusedBeforeTheTest', async () => {
    installElectronApi({ getProviders: vi.fn().mockResolvedValue({ activeProviderId: 'custom-server', fallbackTicketKey: 'MISC-1', customServerToken: 'tok' }) });
    render(<AccountSettings />);
    await screen.findByRole('group', { name: /Your server/ });
    fireEvent.click(screen.getByRole('button', { name: 'Set up' }));

    fireEvent.change(screen.getByLabelText('Server address'), { target: { value: 'http://tracker.example.com/st/v1' } });

    expect(screen.getByText(/must start with https:\/\//)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Test connection' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('EverySearchEntryOfTheGroup_IsOnThePage', async () => {
    // The search sends the user here by these names: each must be findable.
    jira();
    render(<AccountSettings />);
    await screen.findByRole('group', { name: 'Jira · studio.atlassian.net' });
    fireEvent.click(screen.getByRole('button', { name: 'Change account' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Tasks to fetch' }), { target: { value: 'custom' } });
    const text = document.body.textContent ?? '';

    const shownAs: Record<string, RegExp> = {
      'Task provider': /Where your tasks come from/,
      Credentials: /API token/,
      'Tasks to fetch': /Tasks to fetch/,
      'When I start a task': /When I start a task/,
      'When I mark a task done': /When I mark a task done/,
      'Key for tasks of my own': /Key for tasks of my own/,
      'Provider notifications': /Jira notifications/,
      'Entries waiting to send': /Entries waiting to send/
    };
    for (const entry of SETTINGS_ENTRIES.filter(e => e.group === 'account')) {
      expect(shownAs[entry.label], entry.label).toBeDefined();
      expect(text).toMatch(shownAs[entry.label]);
    }
  });
});
