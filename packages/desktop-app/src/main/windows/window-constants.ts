/**
 * The mini timer's size. Wide enough for a task key, about 25 characters of
 * title, an `HH:MM:SS` timer, the ⚡ count and six buttons in one row -- at
 * 360 the title was cut to its first word (the user's choice to widen it,
 * 2026-11-09), and S25's states (P12d) added Previous and the count, and the
 * interruption's name field and "started now ▾". One row tall, so it can
 * sit at a screen edge without covering work.
 */
export const MINI_WINDOW_SIZE = { width: 560, height: 56 } as const;

/** Gap from the screen edges when the mini timer opens in its default place. */
export const MINI_WINDOW_MARGIN = 16;

/** Settings key for the mini timer's position and whether it was open. */
export const MINI_WINDOW_SETTING_KEY = 'mini_window';

/**
 * The mini timer's always-on-top level. On Windows every level is the one
 * topmost band; 'floating' matters only on macOS, where it stays under
 * system UI such as the menu bar.
 */
export const MINI_WINDOW_TOP_LEVEL = 'floating';

/**
 * How long after the mini timer loses the focus it takes the top back: time
 * for the focus to land, so a window of the app's own -- the picker, on top
 * too -- is left in front.
 */
export const MINI_WINDOW_RECLAIM_DELAY_MS = 150;

/** After a wake, an unlock or a display change: time for Windows to settle the desktop. */
export const MINI_WINDOW_RECLAIM_AFTER_SYSTEM_MS = 1000;


/**
 * The picker window's size: the window's picker (S7) at its own width, tall
 * enough for the previous task, Recent and Starred without scrolling.
 */
export const PICKER_WINDOW_SIZE = { width: 600, height: 640 } as const;
