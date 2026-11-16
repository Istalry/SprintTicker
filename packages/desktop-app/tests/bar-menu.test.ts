import { describe, it, expect } from 'vitest';
import { barMenuEntries } from '../src/main/hardware/bar-menu';
import type { ActiveSessionDTO, TaskDTO } from '../src/shared/dtos';

const task = (id: string, key: string): TaskDTO => ({ id, key, title: `Task ${key}` } as TaskDTO);
const session = (extra: Partial<ActiveSessionDTO> = {}): ActiveSessionDTO =>
  ({ sessionId: 's1', taskId: 'A', taskKey: 'MG-12', taskTitle: 'The task', status: 'TRACKING', ...extra } as ActiveSessionDTO);

describe('barMenuEntries', () => {
  it('Timing_EachEntryHasTheIconOfItsVerb', () => {
    // The menu's verbs have their own icons (2026-11-16): DISCARD used the
    // PixelIt stop sign, PREV a red play button, RECENT the plain task card.
    const entries = barMenuEntries({ session: session(), previous: task('B', 'PF-31'), recent: [task('C', 'OP-7')] });

    expect(entries.map(e => [e.action, e.icon])).toEqual([
      ['DONE', 'task_done'],
      ['DISCARD', 'discard'],
      ['PREVIOUS', 'previous'],
      ['RECENT', 'recent']
    ]);
  });

  it('Interruption_DiscardAlone_WithTheBin', () => {
    const during = session({ interruption: { id: 'i1' } as ActiveSessionDTO['interruption'] });

    expect(barMenuEntries({ session: during, previous: task('B', 'PF-31'), recent: [] }).map(e => [e.action, e.icon]))
      .toEqual([['DISCARD', 'discard']]);
  });
});
