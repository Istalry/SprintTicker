import { describe, it, expect } from 'vitest';
import { priorityRankFromName } from '../src/main/providers/task-priority';

describe('priorityRankFromName', () => {
  it.each([
    // Jira's current scheme
    ['Highest', 0], ['High', 1], ['Medium', 2], ['Low', 3], ['Lowest', 4],
    // Jira's classic scheme
    ['Blocker', 0], ['Critical', 1], ['Major', 2], ['Minor', 3], ['Trivial', 4],
    // OpenProject's shipped priorities
    ['Immediate', 0], ['Normal', 2]
  ])('PriorityRankFromName_%s_Is_%i', (name, rank) => {
    expect(priorityRankFromName(name)).toBe(rank);
  });

  it('PriorityRankFromName_AnyCaseOrPadding_StillMatches', () => {
    expect(priorityRankFromName('  hIGHEST ')).toBe(0);
  });

  it.each([
    ['a custom name', 'P1 - Drop everything'],
    ['an empty name', ''],
    ['no name', undefined],
    ['null', null]
  ])('PriorityRankFromName_%s_IsUnknownRatherThanAGuess', (_case, name) => {
    // A guessed rank would move a task somewhere the user does not expect; an
    // unknown one only leaves it in the provider's order.
    expect(priorityRankFromName(name as string | null | undefined)).toBeUndefined();
  });

  it('PriorityRankFromName_ANameMatchingAnObjectMethod_IsUnknown', () => {
    expect(priorityRankFromName('toString')).toBeUndefined();
    expect(priorityRankFromName('constructor')).toBeUndefined();
    expect(priorityRankFromName('__proto__')).toBeUndefined();
  });
});
