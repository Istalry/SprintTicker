import { describe, it, expect } from 'vitest';
import { ProjectDTO, TaskDTO } from '../src/shared/dtos';
import {
  countProject,
  looksLikeTaskKey,
  matchesSearch,
  myOpenTasks,
  needsRealTask,
  offersOwnTask,
  orderProjects,
  parseProjectPrefix,
  pickerUsageSince,
  recentWithJustChosen,
  searchByProject
} from '../src/shared/task-picker';

/** The picker's rules (P7, S7–S8, S12), without a DOM. */

const PF: ProjectDTO = { id: 'p-pf', key: 'PF', name: 'Pixel Forge' };
const MG: ProjectDTO = { id: 'p-mg', key: 'MG', name: 'Moonlight Garden' };
const TP: ProjectDTO = { id: 'p-tp', key: 'TP', name: 'Tide Pool' };

const task = (id: string, projectId: string, title: string, extra: Partial<TaskDTO> = {}): TaskDTO =>
  ({ id, projectId, key: id, title, status: 'todo', ...extra });

const PF40 = task('PF-40', PF.id, 'Forge UI, tooltips', { priorityRank: 1 });
const PF31 = task('PF-31', PF.id, 'Hammer and quench sounds', { status: 'in_progress' });
const PF28 = task('PF-28', PF.id, 'Save slots UI', { status: 'in_progress', ownership: 'other', assigneeName: 'Rin Okada' });
const MG22 = task('MG-22', MG.id, 'Grass shader wind', { status: 'in_progress' });
const MG14 = task('MG-14', MG.id, 'Pond ripple shader', { description: 'Ripples when the koi surface' });
const MG3 = task('MG-3', MG.id, 'Shader warm-up', { status: 'done' });

describe('task picker rules', () => {
  describe('parseProjectPrefix', () => {
    it.each([
      ['pf ', 'PF', ''],
      ['PF 40', 'PF', '40'],
      ['  mg  shader', 'MG', 'shader']
    ])('ParseProjectPrefix_%s_FiltersTo%s', (typed, key, rest) => {
      expect(parseProjectPrefix(typed, [PF, MG])).toEqual({ project: expect.objectContaining({ key }), rest });
    });

    it.each([['pf'], ['pfx '], ['shader wind'], ['']])('ParseProjectPrefix_%s_NoProject', typed => {
      // No space yet, or no project by that key: the words are a search.
      expect(parseProjectPrefix(typed, [PF, MG])).toBeNull();
    });
  });

  describe('looksLikeTaskKey', () => {
    it.each([['MG-77'], ['pf-40'], [' MG-77 '], ['#1234'], ['1234']])('LooksLikeTaskKey_%s_Yes', typed => {
      expect(looksLikeTaskKey(typed)).toBe(true);
    });

    it.each([['MG'], ['MG-'], ['shader'], ['MG 77'], ['']])('LooksLikeTaskKey_%s_No', typed => {
      expect(looksLikeTaskKey(typed)).toBe(false);
    });
  });

  describe('matchesSearch', () => {
    it.each([
      ['grass', MG22],
      ['Grass Wind', MG22],
      ['koi', MG14],
      ['moonlight', MG22],
      ['mg-22', MG22]
    ])('MatchesSearch_%s_Finds', (query, t) => {
      expect(matchesSearch(t, query, MG)).toBe(true);
    });

    it('MatchesSearch_OneWordMissing_DoesNotMatch', () => {
      expect(matchesSearch(MG22, 'grass lantern', MG)).toBe(false);
    });

    it('MatchesSearch_Nothing_MatchesAll', () => {
      expect(matchesSearch(MG22, '   ')).toBe(true);
    });
  });

  it('SearchByProject_Shader_GroupsInTheProjectsOrder_DoneLast', () => {
    const groups = searchByProject([MG3, PF40, MG14, MG22], 'shader', [MG, PF]);

    expect(groups.map(g => g.project.key)).toEqual(['MG']);
    expect(groups[0].tasks.map(t => t.key)).toEqual(['MG-22', 'MG-14', 'MG-3']);
  });

  it('SearchByProject_TaskOfAProjectNotListed_LeftOut', () => {
    expect(searchByProject([task('X-1', 'gone', 'shader')], 'shader', [MG])).toEqual([]);
  });

  it('MyOpenTasks_AcrossProjects_InProgressThenToDoByPriority_NotATeammatesNorDone', () => {
    const low = task('TP-9', TP.id, 'Crab pathing', { priorityRank: 3 });

    expect(myOpenTasks([low, PF40, PF28, MG3, MG22, PF31]).map(t => t.key)).toEqual(['MG-22', 'PF-31', 'PF-40', 'TP-9']);
  });

  it('OrderProjects_StarredFirst_ThenMostUsed_ThenName_OnlyWithTasks', () => {
    const empty: ProjectDTO = { id: 'p-x', key: 'X', name: 'Empty' };
    const ordered = orderProjects([TP, empty, MG, PF], [PF40, MG22, task('TP-1', TP.id, 'Tide')], [task('TP-1', TP.id, 'Tide')], { [MG.id]: 3600, [PF.id]: 60 });

    expect(ordered.map(p => p.key)).toEqual(['TP', 'MG', 'PF']);
  });

  it('OrderProjects_NoUsage_ByName', () => {
    expect(orderProjects([TP, PF, MG], [PF40, MG22, task('TP-1', TP.id, 'Tide')], [], {}).map(p => p.key)).toEqual(['MG', 'PF', 'TP']);
  });

  it('CountProject_ByStatus_AndWhatIsLeftForMe', () => {
    expect(countProject([PF40, PF31, PF28, task('PF-1', PF.id, 'Old', { status: 'done' })])).toEqual({
      total: 4, inProgress: 2, todo: 1, done: 1, mineLeft: 2
    });
  });

  it('RecentWithJustChosen_JustChosenFirst_EachOnce', () => {
    expect(recentWithJustChosen([PF31, MG22, PF40], [PF40, MG14]).map(t => t.key)).toEqual(['PF-40', 'MG-14', 'PF-31', 'MG-22']);
  });

  it.each([
    ['start', false, true],
    ['switch', false, true],
    ['assign', true, false],
    ['place', true, false],
    ['move', true, false]
  ] as const)('Mode_%s_RealTaskOnly%s_OwnWork%s', (mode, real, own) => {
    expect(needsRealTask(mode)).toBe(real);
    expect(offersOwnTask(mode)).toBe(own);
  });

  it('PickerUsageSince_ThirtyCalendarDaysBack', () => {
    const since = new Date(pickerUsageSince(new Date(2026, 10, 10, 9, 0)));

    expect([since.getFullYear(), since.getMonth(), since.getDate(), since.getHours()]).toEqual([2026, 9, 11, 9]);
  });
});
