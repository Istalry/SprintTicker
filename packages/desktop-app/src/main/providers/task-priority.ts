/**
 * Turns a provider's priority name into the app's rank: 0 is the most urgent,
 * 4 the least; `undefined` when the name is not one this knows.
 *
 * By name, because that is what both providers hand over on a task. Jira puts
 * `fields.priority.name` on an issue and OpenProject the priority's title on
 * a work package's `_links.priority`; neither gives a rank there. The names
 * below are both products' shipped schemes, which is what an instance uses
 * unless someone has replaced them:
 *
 * | Rank | Jira (current)  | Jira (classic) | OpenProject |
 * | :--- | :---            | :---           | :---        |
 * | 0    | Highest         | Blocker        | Immediate   |
 * | 1    | High            | Critical       | High        |
 * | 2    | Medium          | Major          | Normal      |
 * | 3    | Low             | Minor          | Low         |
 * | 4    | Lowest          | Trivial        |             |
 *
 * A renamed or custom priority maps to `undefined` rather than to a guess, and
 * sorts after every known one: a wrong rank would put a task where the user
 * does not expect it, while an unknown one only leaves it in the provider's
 * order.
 */
const PRIORITY_RANKS: ReadonlyMap<string, number> = new Map([
  ['highest', 0],
  ['blocker', 0],
  ['immediate', 0],
  ['urgent', 0],
  ['high', 1],
  ['critical', 1],
  ['medium', 2],
  ['major', 2],
  ['normal', 2],
  ['low', 3],
  ['minor', 3],
  ['lowest', 4],
  ['trivial', 4]
]);

/**
 * A `Map`, not an object literal: a name is data from a server, and an object
 * would answer `constructor` or `__proto__` with what it inherits.
 */
export function priorityRankFromName(name: string | null | undefined): number | undefined {
  if (typeof name !== 'string') return undefined;
  return PRIORITY_RANKS.get(name.trim().toLowerCase());
}
