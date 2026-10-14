import { describe, it, expect } from 'vitest';
import { filterProjectsWithTasks, firstProjectWithTasks } from '../src/shared/project-filter';
import { ProjectDTO } from '../src/shared/dtos';

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
  });
});

describe('firstProjectWithTasks', () => {
  it('FirstProjectWithTasks_SomeEmpty_SkipsToTheFirstWithAnOpenTask', () => {
    expect(firstProjectWithTasks([project('A', 0), project('B', 3)])).toBe('B');
  });

  it('FirstProjectWithTasks_AllEmpty_FallsBackToTheFirst', () => {
    expect(firstProjectWithTasks([project('A', 0), project('B', 0)])).toBe('A');
  });

  it('FirstProjectWithTasks_NoProjects_AnswersEmpty', () => {
    expect(firstProjectWithTasks([])).toBe('');
  });
});
