import { describe, it, expect } from 'vitest';
import {
  BUSY_FONT,
  BUSY_FONT_ASCENT,
  BUSY_FONT_DESCENT,
  BUSY_FONT_HEIGHT
} from '../src/shared/busy-font';
import { glyphFor, measureText, fitToWidth, ELLIPSIS } from '../src/shared/proportional-text';
import { PixelCanvas } from '../src/main/hardware/pixel-canvas';
import { DISPLAY_CONSTANTS } from '../src/shared/render-constants';

/**
 * Row 0 is set in the BUSY Bar's own font, lifted out of the firmware's LVGL
 * font by `tools/lvgl-font-to-ts.js`.
 *
 * It replaced a hand-rolled "4x6" font that was really 3px wide in a 4px cell,
 * drawn at a 5px stride. Two visible faults came out of that, both reported
 * from a photograph of the bar: two blank columns between every character, and
 * a `#` with no room to draw, which rendered as an unreadable blob.
 *
 * Since the glyph table is generated, these tests are not about its contents so
 * much as about the decoding being right. A wrong bit order or a wrong packing
 * assumption produces glyphs that are still 5px tall and still the right width,
 * so nothing but the shapes would catch it.
 */
describe('the BUSY Bar font', () => {
  /** Renders one glyph as rows of '#' and '.', for shape assertions. */
  function shapeOf(char: string): string[] {
    const canvas = new PixelCanvas(16, BUSY_FONT_HEIGHT);
    canvas.drawText(char, 0, 0, '#FFFFFF');
    const pixels = canvas.getPixels();
    const width = glyphFor(char).advance;
    return pixels.map(row =>
      row
        .slice(0, width)
        .map(p => (p === null ? '.' : '#'))
        .join('')
    );
  }

  describe('glyphs decode to the right shapes', () => {
    it('DrawText_Hash_IsLegibleRatherThanABlob', () => {
      // The reported defect. The old font drew this in three columns, where a
      // '#' has no room for two strokes and the gaps between them.
      // A 5px box in a 6px advance, so the last column is the inter-glyph gap.
      expect(shapeOf('#')).toEqual([
        '.#.#..',
        '#####.',
        '.#.#..',
        '#####.',
        '.#.#..',
        '......',
        '......'
      ]);
    });

    it('DrawText_CapitalA_LooksLikeAnA', () => {
      // A sanity check on the bit order: reversed, this would still be 5 rows
      // of plausible-looking pixels.
      expect(shapeOf('A')).toEqual([
        '.##..',
        '#..#.',
        '####.',
        '#..#.',
        '#..#.',
        '.....',
        '.....'
      ]);
    });

    it('DrawText_Descender_HangsBelowTheBaselineWhereAnXHeightLetterDoesNot', () => {
      // `ofsY` is measured up from the baseline, so a descender is negative.
      // Getting the sign wrong would lift the tail of a 'p' above the letter
      // instead, which is still five rows of plausible pixels -- so the test
      // has to compare against a letter that must *not* descend.
      const inkBelowBaseline = (char: string): boolean =>
        shapeOf(char)
          .slice(BUSY_FONT_ASCENT)
          .some(row => row.includes('#'));

      expect(inkBelowBaseline('p')).toBe(true);
      expect(inkBelowBaseline('o')).toBe(false);
    });
  });

  describe('the font is proportional, which is the point', () => {
    it('Advance_NarrowAndWideGlyphs_Differ', () => {
      // The old font gave every character the same 5px. A proportional font is
      // what lets a 55px field hold about 14 characters instead of 11.
      expect(glyphFor('i').advance).toBeLessThan(glyphFor('#').advance);
      expect(glyphFor('l').advance).toBeLessThan(glyphFor('m').advance);
    });

    it('MeasureText_MixedCaseSentence_FitsMoreThanTheOldElevenCharacters', () => {
      // The string from the reported screenshot. Eleven characters was the old
      // ceiling regardless of content.
      const fitted = fitToWidth('Sacha (#general)', DISPLAY_CONSTANTS.LAYOUT_OFFSETS.TEXT_FIELD_WIDTH);

      expect(fitted.length).toBeGreaterThan(11);
      expect(fitted.startsWith('Sacha (#')).toBe(true);
    });

    it('MeasureText_EmptyString_IsZero', () => {
      expect(measureText('')).toBe(0);
    });

    it('MeasureText_KnownGlyphs_IsTheSumOfTheirAdvances', () => {
      expect(measureText('ab')).toBe(glyphFor('a').advance + glyphFor('b').advance);
    });

    it('GlyphFor_UnknownCharacter_FallsBackWithoutThrowing', () => {
      // Upstream sanitising should make this unreachable, but a throw here
      // would take down the whole notification rather than one character.
      expect(glyphFor('é')).toBeDefined();
      expect(glyphFor('\u{1F389}')).toBe(BUSY_FONT['?']);
    });

    it('GlyphFor_Backtick_FallsBackRatherThanBeingUndefined', () => {
      // The firmware font has no U+0060, which the converter warns about.
      expect(glyphFor('`')).toBeDefined();
    });
  });

  describe('fitToWidth', () => {
    const FIELD = DISPLAY_CONSTANTS.LAYOUT_OFFSETS.TEXT_FIELD_WIDTH;

    it('FitToWidth_TextThatAlreadyFits_IsReturnedUnchanged', () => {
      expect(fitToWidth('Alice', FIELD)).toBe('Alice');
    });

    it('FitToWidth_TextThatDoesNot_EndsWithTheEllipsisAndStillFits', () => {
      const fitted = fitToWidth('Alexandra Rodriguez de la Vega', FIELD);

      expect(fitted.endsWith(ELLIPSIS)).toBe(true);
      expect(measureText(fitted)).toBeLessThanOrEqual(FIELD);
    });

    it('FitToWidth_TheEllipsisIsInsideTheBudget_NotAppendedPastTheEdge', () => {
      // Appending past the field would push the marker off the edge, where the
      // canvas clips it silently -- a half-drawn ellipsis reads as a rendering
      // fault rather than as "there is more".
      const fitted = fitToWidth('mmmmmmmmmmmmmmmmmmmm', FIELD);

      expect(measureText(fitted)).toBeLessThanOrEqual(FIELD);
      expect(fitted.endsWith(ELLIPSIS)).toBe(true);
    });

    it('FitToWidth_CutLandingOnASpace_GivesTheSpaceBack', () => {
      const fitted = fitToWidth('Alice Margaret Thatcher', FIELD);

      expect(fitted).not.toContain(' ' + ELLIPSIS);
    });

    it('FitToWidth_ZeroOrNegativeWidth_ReturnsEmpty', () => {
      expect(fitToWidth('anything', 0)).toBe('');
      expect(fitToWidth('anything', -5)).toBe('');
    });

    it('FitToWidth_FieldTooNarrowForTheMarker_ShowsCharactersInstead', () => {
      // A lone ellipsis in a 3px field says nothing at all.
      const narrow = measureText(ELLIPSIS) - 1;
      const fitted = fitToWidth('Alice', narrow);

      expect(fitted).not.toContain(ELLIPSIS);
      expect(measureText(fitted)).toBeLessThanOrEqual(narrow);
    });

    it('FitToWidth_ExactlyTheFieldWidth_IsNotTruncated', () => {
      // The off-by-one that would truncate every row twice.
      const text = 'Sacha';
      const exact = measureText(text);

      expect(fitToWidth(text, exact)).toBe(text);
    });
  });

  describe('it fits the two-row layout', () => {
    it('FontHeight_WithDescenders_FitsBetweenTheTwoRows', () => {
      // Row 1 starts at ROW1_Y. A descender in row 0 must not reach into it.
      const layout = DISPLAY_CONSTANTS.LAYOUT_OFFSETS;

      expect(BUSY_FONT_HEIGHT).toBe(BUSY_FONT_ASCENT + BUSY_FONT_DESCENT);
      expect(layout.ROW0_Y + BUSY_FONT_HEIGHT).toBeLessThanOrEqual(layout.ROW1_Y);
    });

    it('DrawText_AtRow0_PaintsNothingBelowTheRow1Boundary', () => {
      // 'j' is the tallest glyph in the font: ascent plus two rows of descent.
      const layout = DISPLAY_CONSTANTS.LAYOUT_OFFSETS;
      const canvas = new PixelCanvas(72, 16);
      canvas.drawText('jjjj', layout.TEXT_X, layout.ROW0_Y, '#FFFFFF');
      const pixels = canvas.getPixels();

      for (let y = layout.ROW1_Y; y < 16; y++) {
        expect(pixels[y].every(p => p === null)).toBe(true);
      }
    });

    it('DrawText_AnyGlyph_PaintsNothingAboveTheRow', () => {
      const canvas = new PixelCanvas(72, 16);
      canvas.drawText('Ag#j', 17, 2, '#FFFFFF');
      const pixels = canvas.getPixels();

      expect(pixels[0].every(p => p === null)).toBe(true);
      expect(pixels[1].every(p => p === null)).toBe(true);
    });
  });

  describe('non-ASCII text is transliterated, not stubbed out', () => {
    /**
     * Reported from a photograph of the bar: a Jira task called "Tache 2"
     * (with a circumflex) arrived as "T?che?2".
     *
     * The fonts hold printable ASCII, so `glyphFor` substitutes `?` for
     * anything else. `sanitizeAsciiText` exists precisely to transliterate
     * instead -- it was written for this, complete with a comment about French
     * notifications arriving with holes in their words -- but only the
     * notification composer and the device's element path called it. The front
     * matrix is rasterised here, and this path called nobody.
     *
     * Both `?` in that string had a cause: the circumflex, and the
     * non-breaking space Windows and French keyboards put before punctuation.
     * The sanitiser handles each.
     */
    const FIELD = DISPLAY_CONSTANTS.LAYOUT_OFFSETS.TEXT_FIELD_WIDTH;

    function pixelsOf(text: string, draw: (c: PixelCanvas) => void): string {
      const canvas = new PixelCanvas(72, 16);
      draw(canvas);
      return canvas
        .getPixels()
        .map(row => row.map(p => (p === null ? '.' : '#')).join(''))
        .join('/');
    }

    it('DrawTextClipped_AccentedTitle_DrawsTheSamePixelsAsItsPlainAsciiForm', () => {
      // The strongest form of the assertion: not "no question marks" but
      // "identical to what the plain spelling draws".
      const accented = pixelsOf('Tâche 2', c => c.drawTextClipped('Tâche 2', 17, 0, '#FFFFFF', FIELD));
      const plain = pixelsOf('Tache 2', c => c.drawTextClipped('Tache 2', 17, 0, '#FFFFFF', FIELD));

      expect(accented).toBe(plain);
    });

    it('DrawTextClipped_NonBreakingSpace_DrawsAsAnOrdinarySpace', () => {
      const nbsp = pixelsOf('a b', c => c.drawTextClipped('a b', 17, 0, '#FFFFFF', FIELD));
      const plain = pixelsOf('a b', c => c.drawTextClipped('a b', 17, 0, '#FFFFFF', FIELD));

      expect(nbsp).toBe(plain);
    });

    it('DrawSmallText_AccentedText_TransliteratesOnRow1Too', () => {
      // Row 1 is a different font with its own clipping arithmetic, so it
      // needed the same treatment rather than inheriting it.
      const accented = pixelsOf('Réunion', c => c.drawSmallText('Réunion', 17, 8, '#FFFFFF', FIELD));
      const plain = pixelsOf('Reunion', c => c.drawSmallText('Reunion', 17, 8, '#FFFFFF', FIELD));

      expect(accented).toBe(plain);
    });

    it('DrawTextClipped_TransliterationThatGrows_StillFitsTheField', () => {
      // Why the sanitiser has to run before the measurement rather than after:
      // one eszett becomes two letters, so a string that fitted when measured
      // raw overflows once transliterated. Measured on the output, which is
      // what the device receives.
      const canvas = new PixelCanvas(72, 16);
      canvas.drawTextClipped('ßßßßßßßßßß', 17, 0, '#FFFFFF', FIELD);
      const pixels = canvas.getPixels();

      for (const row of pixels) {
        for (let x = 17 + FIELD; x < 72; x++) {
          expect(row[x]).toBeNull();
        }
      }
    });
  });

  describe('the canvas and the composer agree', () => {
    // These two truncate independently. If they ever disagree, every row is cut
    // twice -- the second time with no marker, mid-word. Under the old
    // fixed-width font this was an off-by-one in a division; now it is whether
    // both use the same measurement.

    it('DrawTextClipped_TextThatFits_IsNotReTruncated', () => {
      const text = 'Sacha (#';
      const clipped = new PixelCanvas(72, 16);
      clipped.drawTextClipped(text, 17, 0, '#FFFFFF', DISPLAY_CONSTANTS.LAYOUT_OFFSETS.TEXT_FIELD_WIDTH);
      const unclipped = new PixelCanvas(72, 16);
      unclipped.drawText(text, 17, 0, '#FFFFFF');

      expect(clipped.getPixels()).toEqual(unclipped.getPixels());
    });

    it('DrawTextClipped_ComposerOutput_IsDrawnVerbatim', () => {
      const fitted = fitToWidth(
        'Alexandra Rodriguez de la Vega',
        DISPLAY_CONSTANTS.LAYOUT_OFFSETS.TEXT_FIELD_WIDTH
      );
      const clipped = new PixelCanvas(72, 16);
      clipped.drawTextClipped(fitted, 17, 0, '#FFFFFF', DISPLAY_CONSTANTS.LAYOUT_OFFSETS.TEXT_FIELD_WIDTH);
      const direct = new PixelCanvas(72, 16);
      direct.drawText(fitted, 17, 0, '#FFFFFF');

      expect(clipped.getPixels()).toEqual(direct.getPixels());
    });

    it('MeasureText_OnTheCanvas_MatchesTheSharedHelper', () => {
      const canvas = new PixelCanvas(72, 16);
      expect(canvas.measureText('Sacha (#')).toBe(measureText('Sacha (#'));
    });

    it('DrawText_ReturnsThePenPositionAfterTheText', () => {
      const canvas = new PixelCanvas(72, 16);
      expect(canvas.drawText('abc', 17, 0, '#FFFFFF')).toBe(17 + measureText('abc'));
    });
  });
});
