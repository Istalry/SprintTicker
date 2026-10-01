/**
 * The mini timer's size. Wide enough for a task key, a title cut short, an
 * `HH:MM:SS` timer and four buttons in one row; one row tall, so it can sit at
 * a screen edge without covering work.
 */
export const MINI_WINDOW_SIZE = { width: 360, height: 56 } as const;

/** Gap from the screen edges when the mini timer opens in its default place. */
export const MINI_WINDOW_MARGIN = 16;

/** Settings key for the mini timer's position and whether it was open. */
export const MINI_WINDOW_SETTING_KEY = 'mini_window';

