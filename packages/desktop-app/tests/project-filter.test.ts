import { describe, it, expect } from 'vitest';
import { filterProjectsWithTasks, firstProjectWithTasks } from '../src/shared/project-filter';
import { ProjectDTO } from '../src/shared/dtos';
import { ADHOC_PROJECT_ID } from '../src/shared/adhoc-project';

const project = (id: string, openTaskCount?: number): ProjectDTO => ({ id, key: id, name: id, openTaskCount });

describe('filterProjectsWithTasks', () => {
  const projects = [project('A', 2), project('B', 0), project('C', 1), project('D', 0)];

  it('FilterProjectsWithTasks_On_KeepsOnlyProjectsWithAnOpenTask', () => {
    const result = filterProjectsWithTasks(projects, true);

    expect(result.visible.map(p => p.id)).toEqual(['A', 'C']);
    expect(result.hiddenCount).toBe(2);
  });

  it('FilterProjectsWithTasks_Off_KeepsEverything', () => {
    const result = filterProjectsWithTasks(projects, false);

    expect(result.visible).toEqual(projects);
    expect(result.hiddenCount).toBe(0);
  });

  it('FilterProjectsWithTasks_CountUnknown_KeepsTheProject', () => {
    // A provider's own project list carries no count; hiding on a guess
    // would lose a project.
    const result = filterProjectsWithTasks([project('A'), project('B', 0)], true);

    expect(result.visible.map(p => p.id)).toEqual(['A']);
  });

  it('FilterProjectsWithTasks_KeptId_StaysWhateverItHolds', () => {
    // A project just created has no task yet and is the one selected.
    const result = filterProjectsWithTasks(projects, true, ['D']);

    expect(result.visible.map(p => p.id)).toEqual(['A', 'C', 'D']);
    expect(result.hiddenCount).toBe(1);
  });

  it('FilterProjectsWithTasks_NothingWouldRemain_ListsEverything', () => {
    // A first launch, or a provider not synced yet: an empty picker there
    // reads as data lost.
    const empty = [project('A', 0), project('B', 0)];

    const result = filterProjectsWithTasks(empty, true);

    expect(result.visible).toEqual(empty);
    expect(result.hiddenCount).toBe(0);
    expect(result.nothingAssigned).toBe(true);
  });

  it('FilterProjectsWithTasks_NothingAssignedButAProjectKept_StillListsEverything', () => {
    // The selected project used to count as "something left", so the
    // Projects tab showed that one project alone, with the rest hidden.
    const empty = [project('A', 0), project('B', 0), project('C', 0)];

    const result = filterProjectsWithTasks(empty, true, ['B']);

    expect(result.visible).toEqual(empty);
    expect(result.nothingAssigned).toBe(true);
  });

  it('FilterProjectsWithTasks_OnlyTheAdHocProjectHasTasks_ListsEverything', () => {
    // An ad-hoc task stays in progress until finished as done, so the ad-hoc project often
    // has one; it used to be the whole list whenever nothing was assigned.
    const list = [project(ADHOC_PROJECT_ID, 4), project('A', 0), project('B', 0)];

    const result = filterProjectsWithTasks(list, true);

    expect(result.visible).toEqual(list);
    expect(result.nothingAssigned).toBe(true);
  });

  it('FilterProjectsWithTasks_AdHocAndAssignedWork_ListsBoth', () => {
    const list = [project(ADHOC_PROJECT_ID, 4), project('A', 2), project('B', 0)];

    const result = filterProjectsWithTasks(list, true);

    expect(result.visible.map(p => p.id)).toEqual([ADHOC_PROJECT_ID, 'A']);
    expect(result.hiddenCount).toBe(1);
    expect(result.nothingAssigned).toBe(false);
  });

  it('FilterProjectsWithTasks_NoProjects_ListsNothingAndClaimsNothing', () => {
    // "None has a task" beside an empty list would be about nothing.
    const result = filterProjectsWithTasks([], true);

    expect(result).toEqual({ visible: [], hiddenCount: 0, nothingAssigned: false });
  });

  it('FilterProjectsWithTasks_Off_NeverSaysNothingIsAssigned', () => {
    expect(filterProjectsWithTasks([project('A', 0)], false).nothingAssigned).toBe(false);
  });
});

describe('filterProjectsWithTasks with the task visibility', () => {
  const counted = (id: string, mine: number, unassigned: number, others: number): ProjectDTO => ({
    id, key: id, name: id, openTaskCount: mine, openUnassignedCount: unassigned, openOthersCount: others
  });
  const projects = [counted('MINE', 1, 0, 0), counted('FREE', 0, 2, 0), counted('THEIRS', 0, 0, 3)];

  it('FilterProjectsWithTasks_FreeWorkShown_ListsAProjectHoldingOnlyFreeWork', () => {
    const result = filterProjectsWithTasks(projects, true, [], { unassigned: true, others: false });

    expect(result.visible.map(p => p.id)).toEqual(['MINE', 'FREE']);
    expect(result.hiddenCount).toBe(1);
  });

  it('FilterProjectsWithTasks_TeammatesShown_ListsAProjectHoldingOnlyTheirWork', () => {
    const result = filterProjectsWithTasks(projects, true, [], { unassigned: false, others: true });

    expect(result.visible.map(p => p.id)).toEqual(['MINE', 'THEIRS']);
  });

  it('FilterProjectsWithTasks_NoVisibilityNamed_CountsTheUsersOwnWorkOnly', () => {
    expect(filterProjectsWithTasks(projects, true).visible.map(p => p.id)).toEqual(['MINE']);
  });

  it('FilterProjectsWithTasks_OnlyHiddenOwnersHaveWork_ListsEverythingAndSaysSo', () => {
    // Nothing the lists would show is open anywhere: the same as nothing assigned.
    const result = filterProjectsWithTasks([counted('THEIRS', 0, 0, 3)], true, [], { unassigned: true, others: false });

    expect(result.nothingAssigned).toBe(true);
  });

  it('FirstProjectWithTasks_FreeWorkShown_OpensOnFreeWork', () => {
    expect(firstProjectWithTasks([counted('THEIRS', 0, 0, 3), counted('FREE', 0, 2, 0)], { unassigned: true, others: false }))
      .toBe('FREE');
  });
});

describe('firstProjectWithTasks', () => {
  it('FirstProjectWithTasks_SomeEmpty_SkipsToTheFirstWithAnOpenTask', () => {
    expect(firstProjectWithTasks([project('A', 0), project('B', 3)])).toBe('B');
  });

  it('FirstProjectWithTasks_AdHocFirst_OpensOnTheAssignedWork', () => {
    expect(firstProjectWithTasks([project(ADHOC_PROJECT_ID, 4), project('A', 0), project('B', 1)])).toBe('B');
  });

  it('FirstProjectWithTasks_AllEmpty_FallsBackToTheFirst', () => {
    expect(firstProjectWithTasks([project('A', 0), project('B', 0)])).toBe('A');
  });

  it('FirstProjectWithTasks_NoProjects_AnswersEmpty', () => {
    expect(firstProjectWithTasks([])).toBe('');
  });
});
