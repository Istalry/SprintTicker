/**
 * The URL hash that makes the renderer mount the task picker as its own
 * small window (redesign P7b), as `#mini` mounts the mini timer.
 *
 * Shared because main loads the window with it and the renderer reads it:
 * two literals would drift, and the symptom would be the whole dashboard
 * squeezed into the picker's frame.
 */
export const PICKER_WINDOW_HASH = 'picker';

/**
 * What the picker window is opened for. `start` becomes Switch while a
 * session runs -- the window reads the session itself -- `assign` chooses
 * the task an ad-hoc session goes to, and `place` the task the running
 * interruption's time goes to when it ends (the mini timer's ↳, P12d).
 * `place-ended` lists the interruptions a Stop just ended, each placed and
 * named on its own row (the user's choice, 2026-11-12).
 */
export type PickerWindowMode = 'start' | 'assign' | 'place' | 'place-ended';

const MODES_WITH_A_QUERY: readonly PickerWindowMode[] = ['assign', 'place', 'place-ended'];

/**
 * The hash, without its `#`, for a mode: `picker`, `picker?mode=assign`, or
 * `picker?mode=place-ended&ids=a,b` with the interruptions to list.
 */
export function pickerWindowHash(mode: PickerWindowMode, ids: readonly string[] = []): string {
  if (mode === 'start') return PICKER_WINDOW_HASH;
  const query = new URLSearchParams({ mode });
  if (mode === 'place-ended' && ids.length > 0) query.set('ids', ids.join(','));
  return `${PICKER_WINDOW_HASH}?${query.toString()}`;
}

function queryOf(hash: string): { route: string; query: URLSearchParams } {
  const bare = hash.startsWith('#') ? hash.slice(1) : hash;
  const [route, query = ''] = bare.split('?', 2);
  return { route, query: new URLSearchParams(query) };
}

/**
 * The mode a location hash opens the picker window in, or null when the hash
 * is not the picker window's. An unknown mode is `start`: a picker that opens
 * is better than a window left blank.
 */
export function readPickerWindowHash(hash: string): PickerWindowMode | null {
  const { route, query } = queryOf(hash);
  if (route !== PICKER_WINDOW_HASH) return null;
  const mode = query.get('mode');
  return (MODES_WITH_A_QUERY as readonly (string | null)[]).includes(mode) ? (mode as PickerWindowMode) : 'start';
}

/** The interruptions a `place-ended` hash names; none for any other hash. */
export function readPickerWindowIds(hash: string): string[] {
  const { route, query } = queryOf(hash);
  if (route !== PICKER_WINDOW_HASH || query.get('mode') !== 'place-ended') return [];
  return (query.get('ids') ?? '').split(',').filter(Boolean);
}
