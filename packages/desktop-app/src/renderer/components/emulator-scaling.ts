import { DISPLAY_CONSTANTS } from '../../shared/render-constants';

/**
 * How large one LED diode is drawn in the front-matrix emulator, in CSS pixels.
 *
 * The matrix is 72 diodes wide, so the dot size is what decides whether the
 * header fits: at the maximum it is 505px, which is more than half the width of
 * the app's own 900px minimum window. Scaling it is the highest-leverage part of
 * keeping the top bar on one row.
 *
 * `MIN` is 3 because below that the text main rasterises onto the bar stops
 * being readable in the preview, and a preview nobody can read is not worth the
 * space it occupies.
 */
export const MATRIX_DOT_SIZE = { MIN: 3, MAX: 6 } as const;

/** Space between diodes, and the border inset around the grid. One pixel, always. */
export const MATRIX_GAP = 1;

/**
 * Width the matrix's bezel costs: `p-1.5` (6px) plus a 1px border, each side.
 *
 * Subtracted from the measured slot before sizing the canvas. Without it the
 * canvas is sized to the slot and then the frame pushes it 14px past the edge,
 * which is invisible at wide widths and clips at narrow ones -- the exact bug
 * this scaling exists to fix.
 */
export const MATRIX_FRAME_CHROME = 14;

/**
 * Picks the largest whole-pixel LED size whose grid fits in `availableWidthPx`.
 *
 * **Whole pixels only, deliberately.** The dot grid is the visual identity of
 * this component, and a fractional cell size puts the diodes on sub-pixel
 * boundaries where they shimmer while the window is dragged and drift out of
 * alignment with the 1px gap. Stepping 6 -> 5 -> 4 -> 3 keeps every diode
 * aligned at every size.
 *
 * A `ResizeObserver` reports 0 on its first callback, before layout has run, so
 * a non-positive width must yield the minimum rather than a zero or negative
 * cell size -- the latter would make `canvas.width` invalid and blank the
 * emulator until the next resize.
 */
export function computeMatrixDotSize(availableWidthPx: number): number {
  if (!Number.isFinite(availableWidthPx) || availableWidthPx <= 0) {
    return MATRIX_DOT_SIZE.MIN;
  }

  // The rendered grid is `columns * (dot + gap) + gap` wide, so solve for dot.
  const columns = DISPLAY_CONSTANTS.FRONT_GRID_WIDTH;
  const perColumn = Math.floor((availableWidthPx - MATRIX_GAP) / columns);
  const dotSize = perColumn - MATRIX_GAP;

  return Math.min(MATRIX_DOT_SIZE.MAX, Math.max(MATRIX_DOT_SIZE.MIN, dotSize));
}

/** The rendered width of the front matrix at a given dot size, including the gaps. */
export function matrixCanvasWidth(dotSize: number): number {
  return DISPLAY_CONSTANTS.FRONT_GRID_WIDTH * (dotSize + MATRIX_GAP) + MATRIX_GAP;
}
