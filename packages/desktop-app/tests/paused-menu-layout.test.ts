import { describe, it, expect } from 'vitest';
import {
  PAUSED_CHOICES,
  PAUSED_CHOICE_LABELS,
  PAUSED_CONFIRM_TEXT,
  PAUSED_MENU_OPENS_ON,
  PausedConfirm,
  RESUME_AFTER_INTERRUPTION_TEXT,
  pausedChoicesShown
} from '../src/main/hardware/display-renderer';
import { DISPLAY_CONSTANTS } from '../src/shared/render-constants';
import { measureText } from '../src/shared/proportional-text';
import { ROW0_FONT, ROW1_FONT } from '../src/shared/fonts/pixel-font';

/**
 * The paused menu's row 1 is 55px, and four choices do not fit in it. These
 * pin what the renderer draws instead -- the pair holding the choice, or
 * INTERRUPT alone, with an arrow towards each side that has more -- and that
 * every one fits. A label that
 * grows by a pixel would otherwise run off the panel with no error anywhere.
 */
describe('paused menu layout', () => {
  const field = DISPLAY_CONSTANTS.LAYOUT_OFFSETS.TEXT_FIELD_WIDTH;
  /** As paintPausedRows draws them: a 1px bar each side, 3px between, a 2px arrow 2px away. */
  const rowWidth = (selection: (typeof PAUSED_CHOICES)[number]): number => {
    const shown = pausedChoicesShown(selection);
    const bars = shown.choices.map(choice => measureText(PAUSED_CHOICE_LABELS[choice], ROW1_FONT) + 1);
    const arrows = (shown.moreLeft ? 4 : 0) + (shown.moreRight ? 4 : 0);
    return bars.reduce((a, b) => a + b, 0) + 3 * (bars.length - 1) + arrows;
  };

  it.each(PAUSED_CHOICES)('PausedChoicesShown_%s_FitsRowOne', selection => {
    expect(rowWidth(selection)).toBeLessThanOrEqual(field);
  });

  it('PausedChoicesShown_StopOrFinish_ShowTheRowAPauseAlwaysHad', () => {
    expect(pausedChoicesShown('STOP')).toEqual({ choices: ['STOP', 'FINISH'], moreLeft: true, moreRight: true });
    expect(pausedChoicesShown('FINISH')).toEqual({ choices: ['STOP', 'FINISH'], moreLeft: true, moreRight: true });
  });

  it('PausedChoicesShown_Interrupt_ShowsItAloneWithTheRestOffScreen', () => {
    expect(pausedChoicesShown('INTERRUPT')).toEqual({ choices: ['INTERRUPT'], moreLeft: false, moreRight: true });
  });

  it('PausedChoiceLabels_InterruptBesideStop_WouldNotFit', () => {
    // Why INTERRUPT is shown alone: beside STOP, with both arrows, it overflows.
    const pair = measureText('INTERRUPT', ROW1_FONT) + 1 + 3 + measureText('STOP', ROW1_FONT) + 1 + 4 + 4;
    expect(pair).toBeGreaterThan(field);
  });

  it('PausedMenu_OpensOnFinish_TwoNotchesFromInterrupt', () => {
    // The row a pause always opened on, so a click there does what it did.
    expect(PAUSED_MENU_OPENS_ON).toBe('FINISH');
    expect(PAUSED_CHOICES.indexOf(PAUSED_MENU_OPENS_ON) - PAUSED_CHOICES.indexOf('INTERRUPT')).toBe(2);
  });

  it('PausedChoicesShown_Discard_ShowsItBesideFinishWithStopOffScreen', () => {
    expect(pausedChoicesShown('DISCARD')).toEqual({ choices: ['FINISH', 'DISCARD'], moreLeft: true, moreRight: false });
  });

  it('PausedChoiceLabels_DiscardBesideFinish_WouldNotFitUnderItsFullName', () => {
    // Why the bar says DROP: the day the font narrows, DISCARD can come back.
    const full = measureText('FINISH', ROW1_FONT) + 1 + 3 + measureText('DISCARD', ROW1_FONT) + 1 + 4;
    expect(full).toBeGreaterThan(field);
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
