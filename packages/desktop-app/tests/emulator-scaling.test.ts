import { describe, it, expect } from 'vitest';
import {
  computeMatrixDotSize,
  matrixCanvasWidth,
  MATRIX_DOT_SIZE,
  MATRIX_GAP
} from '../src/renderer/components/emulator-scaling';
import { DISPLAY_CONSTANTS } from '../src/shared/render-constants';

/**
 * The arithmetic behind the responsive top bar, and deliberately only that.
 *
 * jsdom has no layout engine: it cannot evaluate a Tailwind breakpoint or report
 * an element's width, so the responsive behaviour itself is not unit-testable
 * and pretending otherwise would be testing the implementation rather than the
 * behaviour. Dragging the window is the real verification. What *is* worth
 * pinning is the sizing function, because a wrong answer here is what puts the
 * canvas back outside the window.
 */
describe('emulator scaling', () => {
  it('ComputeMatrixDotSize_AmpleWidth_ReturnsMaximumDotSize', () => {
    expect(computeMatrixDotSize(2000)).toBe(MATRIX_DOT_SIZE.MAX);
  });

  it('ComputeMatrixDotSize_NarrowWidth_ClampsToMinimum', () => {
    expect(computeMatrixDotSize(100)).toBe(MATRIX_DOT_SIZE.MIN);
  });

  it('ComputeMatrixDotSize_ZeroWidth_ReturnsMinimumRatherThanZero', () => {
    // A ResizeObserver reports 0 on its first callback, before layout has run.
    // Returning 0 or a negative here would make canvas.width invalid and blank
    // the emulator until the next resize.
    for (const width of [0, -1, -500, Number.NaN, Number.POSITIVE_INFINITY]) {
      const dot = computeMatrixDotSize(width);
      expect(dot).toBeGreaterThanOrEqual(MATRIX_DOT_SIZE.MIN);
      expect(dot).toBeLessThanOrEqual(MATRIX_DOT_SIZE.MAX);
    }
  });

  it('ComputeMatrixDotSize_AnyWidth_ReturnsWholePixels', () => {
    // Fractional cell sizes put the diodes on sub-pixel boundaries, where they
    // shimmer during a window drag and drift out of line with the 1px gap.
    for (let width = 200; width <= 2000; width += 7) {
      expect(Number.isInteger(computeMatrixDotSize(width))).toBe(true);
    }
  });

  it('ComputeMatrixDotSize_AnyWidthAboveTheFloor_CanvasNeverExceedsAvailableWidth', () => {
    // The property that actually matters, swept rather than sampled at a few
    // convenient points: if this fails the canvas is wider than its slot, which
    // is the clipping bug this whole change exists to fix.
    const floorWidth = matrixCanvasWidth(MATRIX_DOT_SIZE.MIN);

    for (let width = floorWidth; width <= 2000; width++) {
      const rendered = matrixCanvasWidth(computeMatrixDotSize(width));
      expect(rendered).toBeLessThanOrEqual(width);
    }
  });

  it('ComputeMatrixDotSize_IncreasingWidth_NeverShrinksTheDot', () => {
    // Monotonic, so dragging the window wider can only ever grow the matrix.
    let previous = 0;
    for (let width = 0; width <= 2000; width += 3) {
      const dot = computeMatrixDotSize(width);
      expect(dot).toBeGreaterThanOrEqual(previous);
      previous = dot;
    }
  });

  it('MatrixCanvasWidth_MaximumDotSize_MatchesTheHistoricalFixedWidth', () => {
    // 505px is what the header was hardcoded to before this change, and it is
    // the number the whole overflow problem was measured against.
    expect(matrixCanvasWidth(MATRIX_DOT_SIZE.MAX)).toBe(505);
    expect(matrixCanvasWidth(MATRIX_DOT_SIZE.MAX)).toBe(
      DISPLAY_CONSTANTS.FRONT_GRID_WIDTH * (MATRIX_DOT_SIZE.MAX + MATRIX_GAP) + MATRIX_GAP
    );
  });

  it('ComputeMatrixDotSize_MinimumWindowWidth_StaysLegible', () => {
    // At the app's 900px minimum window the matrix slot gets roughly 420px once
    // the logo, the right-hand controls and the padding have taken their share.
    // It should land above the floor -- the floor is a safety net, not the
    // everyday narrow case.
    expect(computeMatrixDotSize(420)).toBeGreaterThan(MATRIX_DOT_SIZE.MIN);
  });
});
