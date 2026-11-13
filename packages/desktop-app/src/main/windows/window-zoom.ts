/**
 * Zoom for the dashboard (REVIEW-2026-11 A11, WCAG 1.4.4). `setMenu(null)`
 * took Electron's default menu away, and with it the only owner of Ctrl+=,
 * Ctrl+- and Ctrl+0; Ctrl+wheel does nothing unless `zoom-changed` is
 * handled. So text could grow only through Windows' display scale.
 *
 * Only the dashboard: the mini timer and the picker are fixed-size windows
 * whose content would be cut off, and the window they open (the dashboard)
 * is where reading happens.
 */

/** One step, in Electron's zoom levels (each level is 20 % more or less). */
export const ZOOM_STEP = 0.5;
/** About 50 %: below that the window's text is unreadable. */
export const ZOOM_MIN = -3;
/** About 250 %, past the 200 % WCAG asks for (level 3.8). */
export const ZOOM_MAX = 5;

export interface ZoomKey {
  type: string;
  key: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
}

/**
 * The zoom level a key press asks for, or null when it is not a zoom key.
 * `+` and `=` share a key on most layouts, with and without Shift.
 */
export function zoomLevelFor(input: ZoomKey, current: number): number | null {
  if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return null;
  switch (input.key) {
    case '=':
    case '+':
      return Math.min(current + ZOOM_STEP, ZOOM_MAX);
    case '-':
    case '_':
      return Math.max(current - ZOOM_STEP, ZOOM_MIN);
    case '0':
      return 0;
    default:
      return null;
  }
}

/** The level Ctrl+wheel asks for. */
export function zoomLevelForWheel(direction: 'in' | 'out', current: number): number {
  return direction === 'in' ? Math.min(current + ZOOM_STEP, ZOOM_MAX) : Math.max(current - ZOOM_STEP, ZOOM_MIN);
}

/** What `enableZoom` needs of a `WebContents`, so a test can pass a fake. */
export interface ZoomableContents {
  getZoomLevel(): number;
  setZoomLevel(level: number): void;
  on(event: 'before-input-event', listener: (event: { preventDefault(): void }, input: ZoomKey) => void): unknown;
  on(event: 'zoom-changed', listener: (event: unknown, direction: 'in' | 'out') => void): unknown;
}

export function enableZoom(contents: ZoomableContents): void {
  contents.on('before-input-event', (event, input) => {
    const level = zoomLevelFor(input, contents.getZoomLevel());
    if (level === null) return;
    event.preventDefault();
    contents.setZoomLevel(level);
  });
  contents.on('zoom-changed', (_event, direction) => {
    contents.setZoomLevel(zoomLevelForWheel(direction, contents.getZoomLevel()));
  });
}
