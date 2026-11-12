import { describe, it, expect } from 'vitest';
import {
  PAUSED_CONFIRM_TEXT,
  PAUSED_MARK_WIDTH,
  PausedConfirm,
  RESUME_AFTER_INTERRUPTION_TEXT
} from '../src/main/hardware/display-renderer';
import { DISPLAY_CONSTANTS } from '../src/shared/render-constants';
import { measureText } from '../src/shared/proportional-text';
import { ROW0_FONT, ROW1_FONT } from '../src/shared/fonts/pixel-font';

/**
 * What the paused screen draws, and that each fits its row. The paused menu
 * went with the bar's rethink (P14b): row 0 is ❚❚ and the key, row 1 the
 * time. A label that grows by a pixel would otherwise run off the panel with
 * no error anywhere.
 */
describe('paused screen layout', () => {
  const field = DISPLAY_CONSTANTS.LAYOUT_OFFSETS.TEXT_FIELD_WIDTH;

  it('PausedMark_LeavesAnEightCharacterKeyWhole', () => {
    // The time moved to row 1, so the key has the row but for the mark.
    expect(field - PAUSED_MARK_WIDTH).toBeGreaterThanOrEqual(measureText('SPR-1428', ROW0_FONT));
  });

  it.each(Object.keys(PAUSED_CONFIRM_TEXT) as PausedConfirm[])('PausedConfirmText_%s_FitsBothRows', kind => {
    const { question, hint } = PAUSED_CONFIRM_TEXT[kind];
    expect(measureText(question, ROW0_FONT)).toBeLessThanOrEqual(field);
    expect(measureText(hint, ROW1_FONT)).toBeLessThanOrEqual(field);
  });

  it('BackToTheTaskText_FitsBothRows', () => {
    // Row 0 is the task's key, cut where it must be; the answer is never cut.
    expect(measureText(RESUME_AFTER_INTERRUPTION_TEXT.fallback, ROW0_FONT)).toBeLessThanOrEqual(field);
    expect(measureText(RESUME_AFTER_INTERRUPTION_TEXT.hint, ROW1_FONT)).toBeLessThanOrEqual(field);
  });
});
