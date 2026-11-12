import { describe, it, expect } from 'vitest';
import {
  PAUSED_CHOICES,
  PAUSED_CHOICE_LABELS,
  PAUSED_CONFIRM_TEXT,
  PAUSED_MENU_OPENS_ON,
  PausedConfirm,
  RESUME_AFTER_INTERRUPTION_TEXT,
  PAUSED_MARK_WIDTH,
  pausedChoicesShown
} from '../src/main/hardware/display-renderer';
import { BarWord } from '../src/shared/words';
import { DISPLAY_CONSTANTS } from '../src/shared/render-constants';
import { measureText } from '../src/shared/proportional-text';
import { ROW0_FONT, ROW1_FONT } from '../src/shared/fonts/pixel-font';

/**
 * The paused menu's row 1 is 55px, and four choices do not fit in it. These
 * pin what the renderer draws instead -- the group holding the choice --
 * DONE and STOP, or DISCARD or INTERRUPT alone -- with an arrow towards each side that has more -- and that
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

  it('PausedChoicesShown_DoneOrStop_ShowThePairWithTheRestToTheRight', () => {
    // What a pause opens on: DONE ▸STOP, with DISCARD and INTERRUPT off screen.
    expect(pausedChoicesShown('STOP')).toEqual({ choices: ['DONE', 'STOP'], moreLeft: false, moreRight: true });
    expect(pausedChoicesShown('DONE')).toEqual({ choices: ['DONE', 'STOP'], moreLeft: false, moreRight: true });
  });

  it('PausedChoicesShown_Discard_ShowsItAloneBetweenTheOthers', () => {
    expect(pausedChoicesShown('DISCARD')).toEqual({ choices: ['DISCARD'], moreLeft: true, moreRight: true });
  });

  it('PausedChoicesShown_Interrupt_ShowsItAloneAtTheRightEnd', () => {
    expect(pausedChoicesShown('INTERRUPT')).toEqual({ choices: ['INTERRUPT'], moreLeft: true, moreRight: false });
  });

  it('PausedChoices_AreTheDecksOrder_ThenInterrupt', () => {
    // A, B and C on the deck: yes, stop or wait, throw away (S29).
    expect([...PAUSED_CHOICES]).toEqual(['DONE', 'STOP', 'DISCARD', 'INTERRUPT']);
  });

  it('PausedChoiceLabels_AreTheBarsWords_NeverFinishOrDrop', () => {
    expect(Object.values(PAUSED_CHOICE_LABELS)).toEqual([BarWord.DONE, BarWord.STOP, BarWord.DISCARD, BarWord.INTERRUPT]);
  });

  it('PausedChoiceLabels_DiscardBesideStop_WouldNotFit', () => {
    // Why DISCARD is shown alone: beside STOP, with both arrows, it overflows.
    const pair = measureText('STOP', ROW1_FONT) + 1 + 3 + measureText('DISCARD', ROW1_FONT) + 1 + 4 + 4;
    expect(pair).toBeGreaterThan(field);
  });

  it('PausedChoiceLabels_InterruptBesideDiscard_WouldNotFit', () => {
    const pair = measureText('DISCARD', ROW1_FONT) + 1 + 3 + measureText('INTERRUPT', ROW1_FONT) + 1 + 4;
    expect(pair).toBeGreaterThan(field);
  });

  it('PausedMenu_OpensOnStop', () => {
    // STOP changes nothing at the provider and keeps the time.
    expect(PAUSED_MENU_OPENS_ON).toBe('STOP');
  });

  it('PausedMark_LeavesAnEightCharacterKeyAndItsTimeSomething', () => {
    // ❚❚ takes its width from the key, which fitToWidth cuts; the time is never cut.
    const left = field - PAUSED_MARK_WIDTH - measureText('00:42', ROW0_FONT) - 2;
    expect(left).toBeGreaterThan(measureText('SPR-', ROW0_FONT));
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
