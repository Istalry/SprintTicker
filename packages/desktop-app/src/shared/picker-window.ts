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
 */
export type PickerWindowMode = 'start' | 'assign' | 'place';

/** The hash, without its `#`, for a mode: `picker`, or `picker?mode=assign`. */
export function pickerWindowHash(mode: PickerWindowMode): string {
  return mode === 'start' ? PICKER_WINDOW_HASH : `${PICKER_WINDOW_HASH}?mode=${mode}`;
}

/**
 * The mode a location hash opens the picker window in, or null when the hash
 * is not the picker window's. An unknown mode is `start`: a picker that opens
 * is better than a window left blank.
 */
export function readPickerWindowHash(hash: string): PickerWindowMode | null {
  const bare = hash.startsWith('#') ? hash.slice(1) : hash;
  const [route, query = ''] = bare.split('?', 2);
  if (route !== PICKER_WINDOW_HASH) return null;
  const mode = new URLSearchParams(query).get('mode');
  return mode === 'assign' || mode === 'place' ? mode : 'start';
}
