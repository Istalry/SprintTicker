/**
 * URL hash that makes the renderer mount the mini timer instead of the app.
 *
 * Shared because main loads the window with it and the renderer reads it; two
 * literals would drift, and the symptom would be the whole dashboard squeezed
 * into the mini timer's small always-on-top window (`MINI_WINDOW_SIZE`).
 */
export const MINI_WINDOW_HASH = 'mini';
