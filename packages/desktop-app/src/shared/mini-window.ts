/**
 * URL hash that makes the renderer mount the mini timer instead of the app.
 *
 * Shared because main loads the window with it and the renderer reads it; two
 * literals would drift, and the symptom would be the whole dashboard squeezed
 * into a 360x56 always-on-top window.
 */
export const MINI_WINDOW_HASH = 'mini';
