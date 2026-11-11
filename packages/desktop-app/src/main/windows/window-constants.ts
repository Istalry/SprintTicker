/**
 * The mini timer's size. Wide enough for a task key, about 25 characters of
 * title, an `HH:MM:SS` timer and five buttons in one row -- at 360 the title
 * was cut to its first word (the user's choice to widen it, 2026-11-09). One
 * row tall, so it can sit at a screen edge without covering work.
 */
export const MINI_WINDOW_SIZE = { width: 480, height: 56 } as const;

/** Gap from the screen edges when the mini timer opens in its default place. */
export const MINI_WINDOW_MARGIN = 16;

/** Settings key for the mini timer's position and whether it was open. */
export const MINI_WINDOW_SETTING_KEY = 'mini_window';


/**
 * The picker window's size: the window's picker (S7) at its own width, tall
 * enough for the previous task, Recent and Starred without scrolling.
 */
export const PICKER_WINDOW_SIZE = { width: 600, height: 640 } as const;
