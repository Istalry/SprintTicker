import { describe, it, expect } from 'vitest';
import { orderTasksForSelection } from '../src/shared/task-order';
import { ArgumentNullException, TaskDTO } from '../src/shared/dtos';

const task = (id: string, status: TaskDTO['status']): Pick<TaskDTO, 'status'> & { id: string } => ({ id, status });
const ids = (tasks: Array<{ id: string }>): string[] => tasks.map(t => t.id);

describe('orderTasksForSelection', () => {
  it('OrderTasksForSelection_MixedStatuses_PutsInProgressThenTodoThenDone', () => {
    const ordered = orderTasksForSelection([
      task('d', 'done'), task('t', 'todo'), task('p', 'in_progress')
    ]);

    expect(ids(ordered)).toEqual(['p', 't', 'd']);
  });

  it('OrderTasksForSelection_SameStatus_KeepsTheProvidersOrder', () => {
    // The provider's order is usually a board's ranking; a status sort must
    // not shuffle it.
    const ordered = orderTasksForSelection([
      task('t3', 'todo'), task('d1', 'done'), task('t1', 'todo'), task('p1', 'in_progress'), task('t2', 'todo'), task('d2', 'done')
    ]);

    expect(ids(ordered)).toEqual(['p1', 't3', 't1', 't2', 'd1', 'd2']);
  });

  it('OrderTasksForSelection_UnknownStatus_SortsLast', () => {
    const ordered = orderTasksForSelection([
      task('x', 'archived' as TaskDTO['status']), task('d', 'done'), task('t', 'todo')
    ]);

    expect(ids(ordered)).toEqual(['t', 'd', 'x']);
  });

  it('OrderTasksForSelection_Always_LeavesTheInputAlone', () => {
    const input = [task('d', 'done'), task('p', 'in_progress')];

    orderTasksForSelection(input);

    expect(ids(input)).toEqual(['d', 'p']);
  });

  it('OrderTasksForSelection_Empty_ReturnsEmpty', () => {
    expect(orderTasksForSelection([])).toEqual([]);
  });

  it('OrderTasksForSelection_Null_ThrowsArgumentNullException', () => {
    expect(() => orderTasksForSelection(null as never)).toThrow(ArgumentNullException);
  });
});
