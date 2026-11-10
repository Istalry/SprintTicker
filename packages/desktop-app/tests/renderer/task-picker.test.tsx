import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TaskPicker, TaskPickerProps } from '../../src/renderer/components/TaskPicker';
import { ProjectDTO, TaskDTO } from '../../src/shared/dtos';
import type { PickerDataDTO } from '../../src/shared/task-picker';
import { installElectronApi } from './electron-api-mock';

/** The one picker (P7, S7–S8, S12): what each mode lists, in which order, and what a pick says. */

const PF: ProjectDTO = { id: 'p-pf', key: 'PF', name: 'Pixel Forge' };
const MG: ProjectDTO = { id: 'p-mg', key: 'MG', name: 'Moonlight Garden' };
const OPS: ProjectDTO = { id: 'p-ops', key: 'OPS', name: 'Studio Ops' };

const task = (key: string, project: ProjectDTO, title: string, extra: Partial<TaskDTO> = {}): TaskDTO =>
  ({ id: `id-${key}`, projectId: project.id, key, title, status: 'todo', ...extra });

const PF31 = task('PF-31', PF, 'Hammer and quench sounds', { status: 'in_progress' });
const PF40 = task('PF-40', PF, 'Forge UI, tooltips', { priorityRank: 1 });
const PF44 = task('PF-44', PF, 'Anvil hit reactions', { ownership: 'unassigned' });
const MG15 = task('MG-15', MG, 'Boids, first pass', { status: 'in_progress' });
const MG22 = task('MG-22', MG, 'Grass shader wind', { status: 'in_progress' });
const OPS4 = task('OPS-4', OPS, 'Team discussions and meetings');
const ADHOC = { id: 'adhoc_1', projectId: 'ADHOC', key: 'MISC-1', title: 'Code review', status: 'todo' } as TaskDTO;

const DATA: PickerDataDTO = {
  previous: PF31,
  recent: [MG15, ADHOC],
  starred: [OPS4],
  tasks: [PF31, PF40, PF44, MG15, MG22, OPS4],
  projects: [PF, MG, OPS],
  projectSeconds: { [MG.id]: 7200, [PF.id]: 600 }
};

const open = (props: Partial<TaskPickerProps> = {}, overrides: Record<string, unknown> = {}) => {
  const bridge = installElectronApi({ getPickerData: vi.fn().mockResolvedValue(DATA), ...overrides });
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(<TaskPicker isOpen mode="switch" onClose={onClose} onPick={onPick} {...props} />);
  return { bridge, onPick, onClose };
};

/** The headings and rows in the order shown. */
const listed = () =>
  within(screen.getByRole('listbox', { name: 'Tasks' }))
    .getAllByText(/^(Recent|Starred|Assigned to me · open|All projects|[A-Z]+-\d+)$/)
    .map(el => el.textContent);

const search = (text: string) => fireEvent.change(screen.getByLabelText('Search tasks'), { target: { value: text } });

describe('TaskPicker', () => {
  it('Switch_Opened_PreviousRecentStarredMineProjects_InThatOrder', async () => {
    open();
    await screen.findByText(/previous task/);

    expect(listed()).toEqual([
      'PF-31', // previous
      'Recent', 'MG-15', 'MISC-1',
      'Starred', 'OPS-4',
      'Assigned to me · open', 'PF-31', 'MG-15', 'MG-22', 'PF-40', 'OPS-4',
      'All projects'
    ]);
    // Starred first, then most used.
    const projects = screen.getAllByRole('option', { name: /tasks · \d+ in progress/ }).map(el => el.textContent);
    expect(projects[0]).toMatch(/^Studio Ops/);
    expect(projects[1]).toMatch(/^Moonlight Garden/);
    expect(screen.getByText('A task of my own…')).toBeTruthy();
  });

  it('Start_Opened_NoPreviousTask', async () => {
    open({ mode: 'start' });
    await screen.findByRole('dialog', { name: 'Start a task' });
    await screen.findByText('Recent');

    expect(screen.queryByText('previous task')).toBeNull();
  });

  it.each([['assign' as const], ['move' as const], ['place' as const]])('%s_Opened_NoAdHocWorkNorOwnTask', async mode => {
    open({ mode });
    await screen.findByText('Starred');

    expect(screen.queryByText('MISC-1')).toBeNull();
    expect(screen.queryByText(/A task of my own/)).toBeNull();
  });

  it('Place_Opened_StarredBeforeRecent_JustChosenFirst_NothingPicked', async () => {
    const { onPick } = open({ mode: 'place', justChosen: [PF40] });
    await screen.findByText('Starred');

    expect(listed().slice(0, 5)).toEqual(['Starred', 'OPS-4', 'Recent', 'PF-40', 'MG-15']);
    expect(screen.getByText('just chosen')).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('Click_ATask_PicksItAndCloses', async () => {
    const { onPick, onClose } = open();

    fireEvent.click(await screen.findByText('Grass shader wind'));

    expect(onPick).toHaveBeenCalledWith({ task: MG22, takeAlong: false });
    expect(onClose).toHaveBeenCalled();
  });

  it('Keyboard_DownAndEnter_PicksTheSecondRow', async () => {
    const { onPick } = open();
    await screen.findByText(/previous task/);
    const dialog = screen.getByRole('dialog');

    fireEvent.keyDown(dialog, { key: 'ArrowDown' });
    fireEvent.keyDown(dialog, { key: 'Enter' });

    expect(onPick).toHaveBeenCalledWith({ task: MG15, takeAlong: false });
  });

  it('Search_AcrossProjects_GroupedByProject_ThenOwnWorkNamedSo', async () => {
    const { onPick } = open();
    await screen.findByText('Recent');

    search('shader');

    expect(screen.getByText('Moonlight Garden')).toBeTruthy();
    expect(screen.getByText('MG-22')).toBeTruthy();
    expect(screen.queryByText('PF-40')).toBeNull();
    fireEvent.click(screen.getByText(/A task of my own named/));
    expect(onPick).toHaveBeenCalledWith({ ownTitle: 'shader', takeAlong: false });
  });

  it('KeyAndSpace_FiltersToTheProject_BackspaceTakesItOff', async () => {
    open();
    await screen.findByText('Recent');

    search('pf ');

    expect(screen.getByRole('button', { name: 'Show every project, not only Pixel Forge' })).toBeTruthy();
    expect(screen.getByText(/3 tasks: 1 in progress · 2 to do · 0 done · 2 left are yours/)).toBeTruthy();
    // Yours first, then the lists' order.
    expect(listed()).toEqual(['PF-31', 'PF-40', 'PF-44']);
    expect(screen.getByText(/starting it makes it yours/)).toBeTruthy();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Backspace' });
    expect(screen.queryByRole('button', { name: /Show every project/ })).toBeNull();
  });

  it('AllMyOpenTasks_ListsThemByStatus', async () => {
    installElectronApi({ getPickerData: vi.fn().mockResolvedValue({ ...DATA, tasks: [...DATA.tasks, task('PF-50', PF, 'More'), task('PF-51', PF, 'More still')] }) });
    render(<TaskPicker isOpen mode="switch" onClose={vi.fn()} onPick={vi.fn()} />);

    fireEvent.click(await screen.findByText('all 7 of my open tasks'));

    expect(screen.getByRole('heading', { name: 'My open tasks' })).toBeTruthy();
    expect(screen.getByText('In progress')).toBeTruthy();
    expect(screen.getByText('To do, most urgent first')).toBeTruthy();
  });

  describe('fetch by key', () => {
    const canFetch = (can: boolean) => ({
      getProviderCapabilities: vi.fn().mockResolvedValue({ providerId: 'jira', canAssign: true, canTransition: true, canFindWorklog: true, canFetchByKey: can, hasHolidays: false })
    });

    it('KeyNotListed_Capable_OffersToFetch_AndPicksWhatComes', async () => {
      const MG77 = task('MG-77', MG, 'New ticket');
      const { bridge, onPick } = open({}, { ...canFetch(true), fetchTaskByKey: vi.fn().mockResolvedValue(MG77) });
      await screen.findByText('Recent');
      await waitFor(() => expect(bridge.api.getProviderCapabilities).toHaveBeenCalled());

      search('mg-77');
      fireEvent.click(await screen.findByRole('option', { name: /^Fetch MG-\d+ from Jira/ }));

      await waitFor(() => expect(onPick).toHaveBeenCalledWith({ task: MG77, takeAlong: false }));
      expect(bridge.api.fetchTaskByKey).toHaveBeenCalledWith('MG-77');
    });

    it('KeyNotListed_ProviderCannotFetch_NoButton', async () => {
      open({}, canFetch(false));
      await screen.findByText('Recent');

      search('MG-77');

      expect(screen.queryByText(/^Fetch/)).toBeNull();
    });

    it('KeyListed_NoFetch', async () => {
      open({}, canFetch(true));
      await screen.findByText('Recent');

      search('MG-22');

      await screen.findByText('Grass shader wind');
      expect(screen.queryByRole('option', { name: /^Fetch/ })).toBeNull();
    });

    it('ProviderHasNone_SaysSo', async () => {
      const { onPick } = open({}, { ...canFetch(true), fetchTaskByKey: vi.fn().mockResolvedValue(null) });
      await screen.findByText('Recent');
      search('MG-99');

      fireEvent.click(await screen.findByRole('option', { name: /^Fetch MG-\d+ from Jira/ }));

      expect((await screen.findByRole('alert')).textContent).toMatch(/Jira has no task MG-99/);
      expect(onPick).not.toHaveBeenCalled();
    });
  });

  it('FromAnInterruption_TickedTakeAlong_SaysSoInThePick', async () => {
    const { onPick } = open({ takeAlongOf: { title: 'Call with Marc', seconds: 720 } });
    await screen.findByText('Recent');

    fireEvent.click(screen.getByRole('checkbox', { name: /Put "Call with Marc" \(12m\) on it too/ }));
    fireEvent.click(screen.getByText('Grass shader wind'));

    expect(onPick).toHaveBeenCalledWith({ task: MG22, takeAlong: true });
  });

  it('OwnTask_Empty_AsksItsName', async () => {
    const { onPick } = open({ mode: 'start' });
    fireEvent.click(await screen.findByText('A task of my own…'));

    fireEvent.change(screen.getByLabelText(/What is it\?/), { target: { value: 'Code review' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start it' }));

    expect(onPick).toHaveBeenCalledWith({ ownTitle: 'Code review', takeAlong: false });
  });

  it('Star_ATask_StarsItAndFollowsTheAnswer', async () => {
    const { bridge } = open({}, { starTask: vi.fn().mockResolvedValue([OPS4, MG22]) });
    await screen.findByText('Recent');

    fireEvent.click(screen.getAllByRole('button', { name: 'Star MG-22' })[0]);

    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Unstar MG-22' }).length).toBeGreaterThan(0));
    expect(bridge.api.starTask).toHaveBeenCalledWith('id-MG-22');
  });

  it('Refresh_SyncsThenReadsAgain', async () => {
    const { bridge } = open();
    await screen.findByText('Recent');

    await act(async () => { fireEvent.click(screen.getByText(/A ticket is missing\?/)); });

    expect(bridge.api.syncProviderNow).toHaveBeenCalled();
    await waitFor(() => expect(bridge.api.getPickerData).toHaveBeenCalledTimes(2));
  });

  it('ReadFails_StillOffersOwnWork_RatherThanSpinning', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    open({}, { getPickerData: vi.fn().mockRejectedValue(new Error('database closed')) });

    expect(await screen.findByText('A task of my own…')).toBeTruthy();
    expect(screen.queryByText('Reading your tasks…')).toBeNull();
  });

  it('ReadFails_PlaceMode_SaysNothingMatches', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    open({ mode: 'place' }, { getPickerData: vi.fn().mockRejectedValue(new Error('database closed')) });

    expect(await screen.findByText('Nothing matches.')).toBeTruthy();
  });

  it('Place_KeepOff_IsOfferedAndCloses', async () => {
    const onKeepOff = vi.fn();
    const { onClose } = open({ mode: 'place', onKeepOff });
    await screen.findByText('Starred');

    fireEvent.click(screen.getByRole('button', { name: /^Keep off/ }));

    expect(onKeepOff).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
