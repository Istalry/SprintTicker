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

/** The text the search field is described by: the one line's tip, or null. */
const tip = () => {
  const id = screen.getByLabelText('Search tasks').getAttribute('aria-describedby');
  return id ? document.getElementById(id)?.textContent ?? null : null;
};

describe('TaskPicker', () => {
  it('Search_ManyMatches_EightPerProject_ThenMoreKeepsTheSearchInTheProject', async () => {
    // P15b: a first letter matched 881 of 1,000 tasks, all drawn.
    const many = [PF, MG].flatMap(p => Array.from({ length: 40 }, (_, i) => task(`${p.key}-${100 + i}`, p, `Lantern ${i}`)));
    const { onPick } = open({}, { getPickerData: vi.fn().mockResolvedValue({ ...DATA, tasks: many }) });
    await screen.findByText(/previous task/);

    search('lantern');

    const list = screen.getByRole('listbox', { name: 'Tasks' });
    expect(within(list).getAllByText(/^(PF|MG)-1\d\d$/)).toHaveLength(16);
    fireEvent.click(within(list).getByRole('option', { name: /32 more in Pixel Forge/ }));

    expect(within(list).getAllByText(/^PF-1\d\d$/)).toHaveLength(40);
    expect((screen.getByLabelText('Search tasks') as HTMLInputElement).value).toBe('lantern');
    fireEvent.click(within(list).getByText('PF-139'));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ task: expect.objectContaining({ key: 'PF-139' }) }));
  });

  it('Search_FewMatches_EveryOneShown', async () => {
    open();
    await screen.findByText(/previous task/);

    search('PF');

    expect(screen.queryByText(/more in/)).toBeNull();
  });

  it('Switch_TheRunningTask_IsLeftOut_TheHighlightOnTheFirstRealOption', async () => {
    open({ runningTaskId: MG15.id });
    await screen.findByText(/previous task/);

    // C8: MG-15 is timing; switching to it would switch to itself.
    expect(listed()).not.toContain('MG-15');
    const field = screen.getByRole('combobox', { name: 'Search tasks' });
    expect(document.getElementById(field.getAttribute('aria-activedescendant')!)?.textContent).toMatch(/^PF-31/);
  });

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

  it('FirstDay_NoRecentNoStarred_OpensOnMyTasks_AndSaysWhereTheOthersWillBe', async () => {
    open({ mode: 'start' }, { getPickerData: vi.fn().mockResolvedValue({ ...DATA, previous: null, recent: [], starred: [] }) });

    const heading = (await screen.findByText('Assigned to me · open')).parentElement!.parentElement!;

    expect(heading.textContent).toMatch(/in progress first, then to do by priority/);
    expect(heading.textContent).toMatch(/Recent and Starred appear once you have used a task or starred one\./);
    expect(screen.queryByText('Recent')).toBeNull();
  });

  it('LaterDays_SayHowManyAreMine_WithoutTheHint', async () => {
    open({ mode: 'start' });

    expect(await screen.findByText('Assigned to me · open')).toBeTruthy();
    expect(screen.queryByText(/Recent and Starred appear/)).toBeNull();
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

    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Code review' } });
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

    await act(async () => { fireEvent.click(screen.getByText(/A task is missing\?/)); });

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

    fireEvent.click(screen.getByRole('button', { name: 'Keep as its own entry' }));

    expect(onKeepOff).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  describe('work of your own on the fly (LOCAL-WORK-AND-CALENDAR.md)', () => {
    const DASH_ONLINE: ProjectDTO = { id: 'p-dash', key: 'DASH', name: 'Dash', providerId: 'jira' };
    const DASH_OWN: ProjectDTO = { id: 'DASH2', key: 'DASH2', name: 'dash', providerId: 'sprintticker' };
    const DASH_TASK = task('DASH-3', DASH_ONLINE, 'Backup the build server');
    const WITH_DASH = { ...DATA, tasks: [...DATA.tasks, DASH_TASK], projects: [...DATA.projects, DASH_ONLINE] };

    it('OneLine_ANewProject_IsTheSecondRow_SaidSo', async () => {
      const { onPick } = open({ mode: 'start' }, { getPickerData: vi.fn().mockResolvedValue(WITH_DASH) });
      await screen.findByText('Recent');

      search('Dash: Backup: before v2');
      const [first, second] = within(screen.getByRole('listbox', { name: 'Tasks' })).getAllByRole('option');
      expect(first.textContent).toContain('A task of my own named "Dash: Backup: before v2"');
      expect(second.textContent).toContain('Start "Backup" in Dash');
      expect(second.textContent).toContain('new project · note: before v2');
      // The online project of that name is found too, under its heading.
      expect(screen.getByText('DASH-3')).toBeTruthy();

      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowDown' });
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });

      expect(onPick).toHaveBeenCalledWith({ ownTitle: 'Backup', ownProject: 'Dash', ownNote: 'before v2', takeAlong: false });
    });

    it('OneLine_AColonForAnotherReason_EnterMakesNoProject', async () => {
      // 2.0.2 rc1: "Review: login page" made a project Review on Enter (F4).
      const { onPick } = open({ mode: 'start' });
      await screen.findByText('Recent');

      search('Review: login page');
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });

      expect(onPick).toHaveBeenCalledWith({ ownTitle: 'Review: login page', takeAlong: false });
    });

    it('OneLine_AProjectOfYours_IsNotNew_AndTheNamesGetTheirMarks', async () => {
      open({ mode: 'start' }, { getPickerData: vi.fn().mockResolvedValue({ ...WITH_DASH, projects: [...WITH_DASH.projects, DASH_OWN] }) });
      await screen.findByText('Recent');

      search('dash: Backup');

      const first = within(screen.getByRole('listbox', { name: 'Tasks' })).getAllByRole('option')[0];
      expect(first.textContent).toContain('Start "Backup" in dash');
      expect(first.textContent).not.toContain('new project');
      expect(screen.getByText('Jira')).toBeTruthy();
    });

    it('OneLine_InAMove_TheNoteStaysInTheName', async () => {
      const { onPick } = open({ mode: 'move', ownWork: true });
      await screen.findByText('Recent');

      search('Dash: Backup: before v2');
      fireEvent.click(screen.getByText(/A task of my own: "Backup: before v2" in Dash/));

      expect(onPick).toHaveBeenCalledWith({ ownTitle: 'Backup: before v2', ownProject: 'Dash', takeAlong: false });
    });

    it('TheForm_PrefilledFromTheLine_SaysWhatTheProjectIs', async () => {
      const { onPick } = open({ mode: 'start' }, { getPickerData: vi.fn().mockResolvedValue(WITH_DASH) });
      await screen.findByText('Recent');
      search('Dash: Backup: before v2');

      fireEvent.click(screen.getByText('Change project or note…'));

      expect((screen.getByLabelText('Project') as HTMLInputElement).value).toBe('Dash');
      expect((screen.getByLabelText('Task') as HTMLInputElement).value).toBe('Backup');
      expect((screen.getByLabelText(/^Note/) as HTMLInputElement).value).toBe('before v2');
      expect(screen.getByText(/^A new project Dash, kept on this computer\. Separate from .*'s Dash: its time is never sent\.$/)).toBeTruthy();
      // Opened for its project, the project's field has the focus.
      expect(document.activeElement).toBe(screen.getByLabelText('Project'));

      fireEvent.change(screen.getByLabelText('Project'), { target: { value: '' } });
      expect(screen.getByText('Leave it empty for work with no project.')).toBeTruthy();
      expect(screen.getByLabelText('Project').getAttribute('placeholder')).toBe('No project');
      fireEvent.click(screen.getByRole('button', { name: 'Start it' }));

      expect(onPick).toHaveBeenCalledWith({ ownTitle: 'Backup', ownNote: 'before v2', takeAlong: false });
    });

    it('TheSameName_AlreadyYours_SaysTodaysEntries', async () => {
      const backup = task('DASH2-1', DASH_OWN, 'Backup files');
      const data = { ...WITH_DASH, tasks: [...WITH_DASH.tasks, backup], projects: [...WITH_DASH.projects, DASH_OWN], today: { [backup.id]: { entries: 2, seconds: 2880 } } };
      open({ mode: 'start' }, { getPickerData: vi.fn().mockResolvedValue(data) });
      await screen.findByText('Recent');

      search('Dash: backup FILES');

      const first = within(screen.getByRole('listbox', { name: 'Tasks' })).getAllByRole('option')[0];
      expect(first.textContent).toContain('already yours · 2 entries today, 48m');
      expect(first.textContent).not.toContain('new project');
    });

    it('TheSameName_InYourOwnWork_AlreadyYours', async () => {
      open({ mode: 'start' }, { getPickerData: vi.fn().mockResolvedValue({ ...DATA, own: [ADHOC] }) });
      await screen.findByText('Recent');

      search('code review');

      expect(screen.getByRole('option', { name: /A task of my own named "code review"/ }).textContent).toContain('already yours');
    });

    it('Typed_TheSyntaxIsShown_WithTheNameTyped', async () => {
      open({ mode: 'start' });
      await screen.findByText('Recent');

      search('Backup files');

      // Read with the field, and outside the list, whose children are options.
      expect(tip()).toBe('Tip: project: Backup files: note puts it in a project, with a note.');
      expect(within(screen.getByRole('listbox', { name: 'Tasks' })).queryByText(/^Tip:/)).toBeNull();
      expect(screen.getByRole('option', { name: 'Add a project or note…' })).toBeTruthy();

      search('Dash: Backup files');

      expect(tip()).toBeNull();
      expect(screen.getByRole('option', { name: 'Change project or note…' })).toBeTruthy();
    });

    it('Typed_AProjectOfYours_TheTipNamesIt', async () => {
      open({ mode: 'start' }, { getPickerData: vi.fn().mockResolvedValue({ ...WITH_DASH, projects: [...WITH_DASH.projects, DASH_OWN] }) });
      await screen.findByText('Recent');

      search('Backup files');

      expect(tip()).toBe('Tip: dash: Backup files: note puts it in a project, with a note.');
    });

    it('ATaskOfMyOwn_EmptyLine_TheNameHasTheFocus', async () => {
      open({ mode: 'start' });
      await screen.findByText('Recent');

      fireEvent.click(screen.getByRole('option', { name: 'A task of my own…' }));

      expect(document.activeElement).toBe(screen.getByLabelText('Task'));
    });

    it('Typed_InAMove_TheSyntaxHasNoNote', async () => {
      open({ mode: 'move', ownWork: true });
      await screen.findByText('Recent');

      search('Backup files');

      expect(tip()).toBe('Tip: project: Backup files puts it in a project.');
      expect(screen.getByRole('option', { name: 'Add a project…' })).toBeTruthy();
    });

    it('Search_ResultsAbove_YourOwnRowsStayInViewUnderThem', async () => {
      open({ mode: 'start' });
      await screen.findByText('Recent');

      search('PF');

      // jsdom draws nothing: the class is what keeps them in view.
      const own = screen.getByRole('option', { name: /A task of my own named "PF"/ });
      expect(own.parentElement!.className).toContain('sticky');
      // Down into the list's bottom padding, where a result showed through (rc3).
      expect(own.parentElement!.className).toContain('-bottom-2');
      expect(screen.getByLabelText('Search tasks').getAttribute('placeholder')).toBe('Search 6 tasks, or type a new one');
    });

    it('NoColon_AsBefore_ATaskOfYourOwn', async () => {
      const { onPick } = open({ mode: 'start' });
      await screen.findByText('Recent');

      search('Sync at 10:30');
      fireEvent.click(screen.getByText(/A task of my own named "Sync at 10:30"/));

      expect(onPick).toHaveBeenCalledWith({ ownTitle: 'Sync at 10:30', takeAlong: false });
    });
  });
});
