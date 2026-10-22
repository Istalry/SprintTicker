import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TASK_VISIBILITY,
  TASK_VISIBILITY_KEY,
  isTaskShown,
  isTaskVisibility,
  ownerLabel,
  ownerTag,
  parseTaskVisibility,
  readTaskVisibility,
  visibleTasks
} from '../src/shared/task-visibility';
import { TaskDTO } from '../src/shared/dtos';

const task = (id: string, ownership?: TaskDTO['ownership'], assigneeName?: string): Pick<TaskDTO, 'id' | 'ownership' | 'assigneeName'> =>
  ({ id, ownership, assigneeName });

describe('task visibility', () => {
  it('DefaultTaskVisibility_AsChosen_ShowsFreeWorkAndHidesTeammates', () => {
    expect(DEFAULT_TASK_VISIBILITY).toEqual({ unassigned: true, others: false });
  });

  it('IsTaskShown_UsersOwn_IsShownWhateverTheSetting', () => {
    const none = { unassigned: false, others: false };

    expect(isTaskShown(task('a'), none)).toBe(true);
    expect(isTaskShown(task('b', 'mine'), none)).toBe(true);
  });

  it('IsTaskShown_FreeAndTeammatesWork_FollowTheirSwitch', () => {
    expect(isTaskShown(task('a', 'unassigned'), { unassigned: true, others: false })).toBe(true);
    expect(isTaskShown(task('a', 'unassigned'), { unassigned: false, others: true })).toBe(false);
    expect(isTaskShown(task('b', 'other'), { unassigned: false, others: true })).toBe(true);
    expect(isTaskShown(task('b', 'other'), { unassigned: true, others: false })).toBe(false);
  });

  it('VisibleTasks_SomeHidden_KeepsTheOrderAndCountsThem', () => {
    const result = visibleTasks([task('1', 'other'), task('2'), task('3', 'unassigned'), task('4', 'other')], DEFAULT_TASK_VISIBILITY);

    expect(result.visible.map(t => t.id)).toEqual(['2', '3']);
    expect(result.hiddenCount).toBe(2);
  });

  it('VisibleTasks_TrackedTaskHidden_KeepsIt', () => {
    // Hiding a teammate's work must not take away the row a session on it
    // is stopped from.
    const result = visibleTasks([task('1', 'other'), task('2', 'other')], DEFAULT_TASK_VISIBILITY, ['2']);

    expect(result.visible.map(t => t.id)).toEqual(['2']);
    expect(result.hiddenCount).toBe(1);
  });

  it('ParseTaskVisibility_Stored_ReadsIt', () => {
    expect(parseTaskVisibility({ unassigned: false, others: true })).toEqual({ unassigned: false, others: true });
  });

  it('ParseTaskVisibility_DamagedOrMissingFields_TakesTheirDefaults', () => {
    expect(parseTaskVisibility(null)).toEqual(DEFAULT_TASK_VISIBILITY);
    expect(parseTaskVisibility('yes')).toEqual(DEFAULT_TASK_VISIBILITY);
    expect(parseTaskVisibility({ others: true })).toEqual({ unassigned: true, others: true });
    expect(parseTaskVisibility({ unassigned: 'no', others: 1 })).toEqual(DEFAULT_TASK_VISIBILITY);
  });

  it('IsTaskVisibility_OnlyTwoBooleans_Passes', () => {
    expect(isTaskVisibility({ unassigned: true, others: false })).toBe(true);
    expect(isTaskVisibility({ unassigned: true })).toBe(false);
    expect(isTaskVisibility({ unassigned: 'true', others: false })).toBe(false);
    expect(isTaskVisibility(null)).toBe(false);
    expect(isTaskVisibility(true)).toBe(false);
  });

  it('ReadTaskVisibility_FromSettings_ParsesWhatIsStored', () => {
    const asked: string[] = [];
    const settings = {
      getSetting<T>(key: string, defaultValue: T): T {
        asked.push(key);
        return (key === TASK_VISIBILITY_KEY ? { unassigned: false } : defaultValue) as T;
      }
    };

    expect(readTaskVisibility(settings)).toEqual({ unassigned: false, others: false });
    expect(asked).toEqual([TASK_VISIBILITY_KEY]);
  });

  it('OwnerLabel_EachOwner_SaysWhoseInTheWindow', () => {
    expect(ownerLabel(task('a'))).toBeNull();
    expect(ownerLabel(task('a', 'mine'))).toBeNull();
    expect(ownerLabel(task('a', 'unassigned'))).toBe('Unassigned');
    expect(ownerLabel(task('a', 'other', 'Alice Martin'))).toBe('Alice Martin');
    expect(ownerLabel(task('a', 'other', '  '))).toBe('Someone else');
  });

  it('OwnerTag_EachOwner_SaysWhoseInAWordForTheBar', () => {
    expect(ownerTag(task('a'))).toBe('');
    expect(ownerTag(task('a', 'unassigned'))).toBe('free');
    expect(ownerTag(task('a', 'other', '  Alice   Martin '))).toBe('@Alice');
    expect(ownerTag(task('a', 'other'))).toBe('@other');
  });
});
