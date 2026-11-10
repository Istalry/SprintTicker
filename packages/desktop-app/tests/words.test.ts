import { describe, it, expect } from 'vitest';
import {
  BarWord,
  BAR_FIELD_BESIDE_ICON,
  BAR_FIELD_FULL_WIDTH,
  BAR_MAX_COUNT,
  barToPlaceLabel,
  barWordField,
  DECK_WORDS,
  keepOffLabel,
  StateWord,
  toPlaceLabel,
  Verb
} from '../src/shared/words';
import { measureText } from '../src/shared/proportional-text';
import { ROW0_FONT, ROW1_FONT } from '../src/shared/fonts/pixel-font';
import { sanitizeAsciiText } from '../src/shared/text-sanitizer';

const fontOf = (row: 0 | 1) => (row === 0 ? ROW0_FONT : ROW1_FONT);

describe('words', () => {
  describe('the bar', () => {
    it.each(Object.keys(BarWord) as (keyof typeof BarWord)[])('BarWord_%s_FitsItsFieldInItsFont', word => {
      const field = barWordField(word);

      expect(measureText(BarWord[word], fontOf(field.row))).toBeLessThanOrEqual(field.widthPx);
    });

    it.each(Object.entries(BarWord))('BarWord_%s_IsPrintableAsciiTheSanitizerLeavesAlone', (_name, text) => {
      expect(sanitizeAsciiText(text)).toBe(text);
      expect(text).toMatch(/^[\x20-\x7E]+$/);
    });

    it('NothingTiming_DoesNotFitBesideTheIcon_SoItIsDrawnAlone', () => {
      // D5, measured 2026-11-10: 63 px in row 0. If the font narrows, the
      // icon can come back -- and this test says so.
      expect(measureText(BarWord.NOTHING_TIMING, ROW0_FONT)).toBeGreaterThan(BAR_FIELD_BESIDE_ICON.widthPx);
      expect(barWordField('NOTHING_TIMING')).toBe(BAR_FIELD_FULL_WIDTH);
    });

    it.each([0, 1, 3, 42, BAR_MAX_COUNT, BAR_MAX_COUNT + 1, 1000])('BarToPlaceLabel_%i_FitsBesideTheIcon', count => {
      expect(measureText(barToPlaceLabel(count), ROW0_FONT)).toBeLessThanOrEqual(BAR_FIELD_BESIDE_ICON.widthPx);
    });

    it.each([
      [3, '3 TO PLACE'],
      [BAR_MAX_COUNT, '99 TO PLACE'],
      [BAR_MAX_COUNT + 1, '99+ TO PLACE'],
      [2.7, '2 TO PLACE'],
      [-1, '0 TO PLACE'],
      [Number.NaN, '0 TO PLACE']
    ])('BarToPlaceLabel_%s_Reads%s', (count, expected) => {
      expect(barToPlaceLabel(count)).toBe(expected);
    });
  });

  describe('one word per meaning', () => {
    it.each([
      ['Verb', Verb],
      ['StateWord', StateWord],
      ['BarWord', BarWord],
      ['DECK_WORDS', DECK_WORDS]
    ])('%s_NoTwoEntries_ShareAWord', (_name, words) => {
      const values = Object.values(words as Record<string, string>);

      expect(new Set(values).size).toBe(values.length);
    });

    it('Verbs_AreTheGlossarys_NotTheOldBarWords', () => {
      // The bar's paused menu said DROP and FINISH for Discard and Done.
      const all = [...Object.values(Verb), ...Object.values(BarWord), ...Object.values(DECK_WORDS)].map(w => w.toUpperCase());
      expect(all).not.toContain('DROP');
      expect(all).not.toContain('FINISH');
      expect(all).not.toContain('NOT DONE');
    });

    it('DeckWords_DiscardDuringAnInterruption_IsMarked', () => {
      expect(DECK_WORDS.DISCARD_INTERRUPTION).toBe('DISCARD ⚡');
      expect(DECK_WORDS.DISCARD).toBe(BarWord.DISCARD);
    });
  });

  describe('labels', () => {
    it.each([
      ['Jira', 'Keep off Jira'],
      ['  OpenProject ', 'Keep off OpenProject'],
      ['', 'Keep off the provider']
    ])('KeepOffLabel_%s_Reads%s', (name, expected) => {
      expect(keepOffLabel(name)).toBe(expected);
    });

    it.each([
      [3, '3 to place'],
      [0, '0 to place'],
      [-2, '0 to place']
    ])('ToPlaceLabel_%i_Reads%s', (count, expected) => {
      expect(toPlaceLabel(count)).toBe(expected);
    });
  });
});
