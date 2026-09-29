import { describe, it, expect } from 'vitest';
import { fontHeight, PixelFont, ROW0_FONT, ROW1_FONT } from '../src/shared/fonts/pixel-font';
import { SPRINT_5 } from '../src/shared/fonts/sprint-5';
import { SPRINT_SMALL } from '../src/shared/fonts/sprint-small';
import { advanceOf, glyphFor, measureText, fitToWidth, ELLIPSIS } from '../src/shared/proportional-text';
import { PixelCanvas } from '../src/main/hardware/pixel-canvas';
import { DISPLAY_CONSTANTS } from '../src/shared/render-constants';

/**
 * Both rows of the front display are set in fonts drawn for this project, from
 * the glyph sheets in `packages/desktop-app/fonts/`.
 *
 * They replaced two fonts, and most of what is tested here is what went wrong
 * with those:
 *
 * - Row 1 was a fixed-width 3x5 font holding 40 characters. `( ) , ' " # + @ &
 *   =` and the rest of the punctuation drew as `?`, and it cut a row at a
 *   character count with no marker, so a title ended mid-word.
 * - Row 0 was the firmware's own font (OFL-1.1). It was legible, but it was
 *   not ours.
 *
 * The generator already refuses a sheet with a missing glyph, a duplicate or a
 * blank edge column. These tests are about what reaches the canvas.
 */

const FIELD = DISPLAY_CONSTANTS.LAYOUT_OFFSETS.TEXT_FIELD_WIDTH;
const PRINTABLE_ASCII = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i));

/** Renders text as rows of '#' and '.', for shape assertions. */
function shapeOf(text: string, font: PixelFont): string[] {
  const canvas = new PixelCanvas(64, fontHeight(font));
  const end = canvas.drawText(text, 0, 0, '#FFFFFF', font);
  return canvas.getPixels().map(row =>
    row
      .slice(0, end)
      .map(p => (p === null ? '.' : '#'))
      .join('')
  );
}

describe.each([
  ['Sprint 5 (row 0)', SPRINT_5],
  ['Sprint Small (row 1)', SPRINT_SMALL]
])('%s', (_label, font) => {
  it('Glyphs_EveryPrintableAsciiCharacter_HasItsOwnGlyph', () => {
    // The row-1 font this replaced drew 55 of these as `?`.
    const missing = PRINTABLE_ASCII.filter(char => font.glyphs[char] === undefined);
    expect(missing).toEqual([]);
    expect(font.glyphs[ELLIPSIS]).toBeDefined();
  });

  it('DrawText_Punctuation_DrawsItsOwnGlyphRatherThanAQuestionMark', () => {
    const question = shapeOf('?', font).join('/');
    for (const char of `(),'"#+@&=`) {
      expect(shapeOf(char, font).join('/')).not.toBe(question);
    }
  });

  it('Glyphs_LookalikeCharacters_AreDrawnDifferently', () => {
    // At this size a lookalike pair is where misreading starts. `g` and `q`
    // were the same bitmap in the old row-1 font.
    for (const [a, b] of [['l', '1'], ['l', 'I'], ['1', 'I'], ['0', 'O'], ['O', 'o'], ['g', 'q'], ['5', 'S'], ['8', 'B']]) {
      expect(shapeOf(a, font), `${a} vs ${b}`).not.toEqual(shapeOf(b, font));
    }
  });

  it('Glyphs_Digits_AreAllTheSameWidth', () => {
    // A running timer must not shift left and right as it counts.
    const widths = new Set('0123456789'.split('').map(d => glyphFor(d, font).width));
    expect(widths.size).toBe(1);
  });

  it('DrawText_Descender_HangsBelowTheBaselineWhereAnXHeightLetterDoesNot', () => {
    // Getting the row order wrong would lift the tail of a 'p' above the
    // letter, which is still plausible-looking pixels -- so compare against a
    // letter that must *not* descend.
    const inkBelowBaseline = (char: string): boolean =>
      shapeOf(char, font)
        .slice(font.ascent)
        .some(row => row.includes('#'));

    expect(inkBelowBaseline('p')).toBe(true);
    expect(inkBelowBaseline('o')).toBe(false);
    expect(inkBelowBaseline('A')).toBe(false);
  });

  it('DrawText_TwoLetters_AreSeparatedByExactlyTheLetterSpacing', () => {
    // 'H' has ink in both edge columns, so the gap between two of them is the
    // letter spacing and nothing else.
    const [row] = shapeOf('HH', font);
    const width = glyphFor('H', font).width;
    expect(row.slice(width, width + font.letterSpacing)).toBe('.'.repeat(font.letterSpacing));
    expect(row[width + font.letterSpacing]).toBe('#');
  });

  it('FitToWidth_LongTitle_EndsWithTheEllipsisAndStillFits', () => {
    const fitted = fitToWidth('Rédiger les notes de version du sprint', FIELD, font);

    expect(fitted.endsWith(ELLIPSIS)).toBe(true);
    expect(measureText(fitted, font)).toBeLessThanOrEqual(FIELD);
  });
});

describe('the letterforms themselves', () => {
  it('DrawText_CapitalA_LooksLikeAnA', () => {
    // A check on the bit order: reversed, this would still be five rows of
    // plausible pixels.
    expect(shapeOf('A', SPRINT_5)).toEqual(['.##..', '#..#.', '####.', '#..#.', '#..#.', '.....', '.....']);
  });

  it('DrawText_Hash_HasRoomForBothStrokes', () => {
    // The original row-0 font drew this in three columns, where a '#' has no
    // room for two strokes and the gaps between them.
    expect(shapeOf('#', SPRINT_5).slice(0, 5)).toEqual(['.#.#..', '#####.', '.#.#..', '#####.', '.#.#..']);
  });

  it('RowFonts_AreTheOnesTheCanvasAndComposerShare', () => {
    expect(ROW0_FONT).toBe(SPRINT_5);
    expect(ROW1_FONT).toBe(SPRINT_SMALL);
  });

  it('Advance_SmallFont_IsNarrowerThanRow0ForCapitals', () => {
    // The point of having two faces: row 1 carries the longer text.
    expect(measureText('WRITE THE NOTES', SPRINT_SMALL)).toBeLessThan(measureText('WRITE THE NOTES', SPRINT_5));
  });
});

describe('the font is proportional, which is the point', () => {
  it('Advance_NarrowAndWideGlyphs_Differ', () => {
    expect(advanceOf('i', ROW0_FONT)).toBeLessThan(advanceOf('#', ROW0_FONT));
    expect(advanceOf('l', ROW0_FONT)).toBeLessThan(advanceOf('m', ROW0_FONT));
  });

  it('FitToWidth_TheReportedSender_KeepsItsPunctuation', () => {
    // From a screenshot: the old row 1 drew this as "Sacha ??genera", with
    // question marks for the punctuation and no sign that it had been cut.
    const fitted = fitToWidth('Sacha (#general)', FIELD, ROW1_FONT);
    expect(fitted.startsWith('Sacha (#gen')).toBe(true);
    expect(fitted.endsWith(ELLIPSIS)).toBe(true);
  });

  it('MeasureText_EmptyString_IsZero', () => {
    expect(measureText('', ROW0_FONT)).toBe(0);
  });

  it('MeasureText_KnownGlyphs_IsTheSumOfTheirAdvances', () => {
    expect(measureText('ab', ROW0_FONT)).toBe(advanceOf('a', ROW0_FONT) + advanceOf('b', ROW0_FONT));
  });

  it('GlyphFor_UnknownCharacter_FallsBackWithoutThrowing', () => {
    // Upstream sanitising should make this unreachable, but a throw here would
    // take down the whole notification rather than one character.
    expect(glyphFor('\u{1F389}', ROW0_FONT)).toBe(ROW0_FONT.glyphs['?']);
  });
});

describe('fitToWidth', () => {
  it('FitToWidth_TextThatAlreadyFits_IsReturnedUnchanged', () => {
    expect(fitToWidth('Alice', FIELD, ROW0_FONT)).toBe('Alice');
  });

  it('FitToWidth_TheEllipsisIsInsideTheBudget_NotAppendedPastTheEdge', () => {
    // Appending past the field would push the marker off the edge, where the
    // canvas clips it silently -- a half-drawn ellipsis reads as a rendering
    // fault rather than as "there is more".
    const fitted = fitToWidth('mmmmmmmmmmmmmmmmmmmm', FIELD, ROW0_FONT);

    expect(measureText(fitted, ROW0_FONT)).toBeLessThanOrEqual(FIELD);
    expect(fitted.endsWith(ELLIPSIS)).toBe(true);
  });

  it('FitToWidth_CutLandingOnASpace_GivesTheSpaceBack', () => {
    const fitted = fitToWidth('Alice Margaret Thatcher', FIELD, ROW0_FONT);

    expect(fitted).not.toContain(' ' + ELLIPSIS);
  });

  it('FitToWidth_ZeroOrNegativeWidth_ReturnsEmpty', () => {
    expect(fitToWidth('anything', 0, ROW0_FONT)).toBe('');
    expect(fitToWidth('anything', -5, ROW0_FONT)).toBe('');
  });

  it('FitToWidth_FieldTooNarrowForTheMarker_ShowsCharactersInstead', () => {
    // A lone ellipsis in a 3px field says nothing at all.
    const narrow = measureText(ELLIPSIS, ROW0_FONT) - 1;
    const fitted = fitToWidth('Alice', narrow, ROW0_FONT);

    expect(fitted).not.toContain(ELLIPSIS);
    expect(measureText(fitted, ROW0_FONT)).toBeLessThanOrEqual(narrow);
  });

  it('FitToWidth_ExactlyTheFieldWidth_IsNotTruncated', () => {
    // The off-by-one that would truncate every row twice.
    const text = 'Sacha';
    expect(fitToWidth(text, measureText(text, ROW0_FONT), ROW0_FONT)).toBe(text);
  });
});

describe('it fits the two-row layout', () => {
  const layout = DISPLAY_CONSTANTS.LAYOUT_OFFSETS;

  it('FontHeight_Row0WithDescenders_EndsBeforeRow1Starts', () => {
    expect(layout.ROW0_Y + fontHeight(ROW0_FONT)).toBeLessThanOrEqual(layout.ROW1_Y);
  });

  it('DrawText_Row0Descenders_PaintNothingInRow1', () => {
    const canvas = new PixelCanvas(72, 16);
    canvas.drawText('gjpqy', layout.TEXT_X, layout.ROW0_Y, '#FFFFFF', ROW0_FONT);
    const pixels = canvas.getPixels();

    for (let y = layout.ROW1_Y; y < 16; y++) {
      expect(pixels[y].every(p => p === null)).toBe(true);
    }
  });

  it('DrawSmallText_Row1Descenders_StayOnThePanel', () => {
    // Row 1 starts at y=8 and its descenders reach y=14 -- one row to spare on
    // a 16-row panel.
    expect(layout.ROW1_Y + fontHeight(ROW1_FONT)).toBeLessThanOrEqual(16);
  });

  it('DrawSmallText_PausedControls_FitInsideTheirHighlight', () => {
    // The paused screen draws STOP and FINISH in capitals inside 7px-tall
    // highlight bars (y=1..7 and 9..15), with the text 1px below the bar's top.
    // Capitals must not reach the bar's last row, or the label touches its edge.
    const capitals = 'STOPFINISH';
    for (const char of capitals) {
      const glyph = glyphFor(char, ROW1_FONT);
      const inkRows = glyph.rows.map((bits, row) => (bits ? row : -1)).filter(row => row >= 0);
      expect(Math.max(...inkRows)).toBeLessThan(ROW1_FONT.ascent);
    }
  });
});

describe('non-ASCII text is transliterated, not stubbed out', () => {
  /**
   * Reported from a photograph of the bar: a Jira task called "Tache 2" (with a
   * circumflex) arrived as "T?che?2". The fonts hold printable ASCII, so
   * `glyphFor` substitutes `?` for anything else; `sanitizeAsciiText`
   * transliterates instead, and the canvas has to call it.
   */
  function pixelsOf(draw: (c: PixelCanvas) => void): string {
    const canvas = new PixelCanvas(72, 16);
    draw(canvas);
    return canvas
      .getPixels()
      .map(row => row.map(p => (p === null ? '.' : '#')).join(''))
      .join('/');
  }

  it('DrawTextClipped_AccentedTitle_DrawsTheSamePixelsAsItsPlainAsciiForm', () => {
    const accented = pixelsOf(c => c.drawTextClipped('Tâche 2', 17, 0, '#FFFFFF', FIELD));
    const plain = pixelsOf(c => c.drawTextClipped('Tache 2', 17, 0, '#FFFFFF', FIELD));

    expect(accented).toBe(plain);
  });

  it('DrawTextClipped_NonBreakingSpace_DrawsAsAnOrdinarySpace', () => {
    const nbsp = pixelsOf(c => c.drawTextClipped('a b', 17, 0, '#FFFFFF', FIELD));
    const plain = pixelsOf(c => c.drawTextClipped('a b', 17, 0, '#FFFFFF', FIELD));

    expect(nbsp).toBe(plain);
  });

  it('DrawSmallText_AccentedText_TransliteratesOnRow1Too', () => {
    const accented = pixelsOf(c => c.drawSmallText('Réunion', 17, 8, '#FFFFFF', FIELD));
    const plain = pixelsOf(c => c.drawSmallText('Reunion', 17, 8, '#FFFFFF', FIELD));

    expect(accented).toBe(plain);
  });

  it('DrawTextClipped_TransliterationThatGrows_StillFitsTheField', () => {
    // One eszett becomes two letters, so the sanitiser has to run before the
    // measurement. Checked on the output, which is what the device receives.
    const canvas = new PixelCanvas(72, 16);
    canvas.drawTextClipped('ßßßßßßßßßß', 17, 0, '#FFFFFF', FIELD);

    for (const row of canvas.getPixels()) {
      for (let x = 17 + FIELD; x < 72; x++) {
        expect(row[x]).toBeNull();
      }
    }
  });
});

describe('the canvas and the composer agree', () => {
  // These two truncate independently. If they ever disagree, every row is cut
  // twice -- the second time with no marker, mid-word.

  it.each([
    ['row 0', ROW0_FONT, (c: PixelCanvas, t: string) => c.drawTextClipped(t, 17, 0, '#FFFFFF', FIELD)],
    ['row 1', ROW1_FONT, (c: PixelCanvas, t: string) => c.drawSmallText(t, 17, 0, '#FFFFFF', FIELD)]
  ])('DrawClipped_ComposerOutputOn%s_IsDrawnVerbatim', (_row, font, drawClipped) => {
    const fitted = fitToWidth('Alexandra Rodriguez de la Vega', FIELD, font);
    const clipped = new PixelCanvas(72, 16);
    drawClipped(clipped, fitted);
    const direct = new PixelCanvas(72, 16);
    direct.drawText(fitted, 17, 0, '#FFFFFF', font);

    expect(clipped.getPixels()).toEqual(direct.getPixels());
  });

  it('DrawSmallText_LongTitle_EndsInAnEllipsisInsteadOfMidWord', () => {
    // The old row 1 cut at fourteen characters with no marker: "Write the
    // notes" arrived as "Write the note" -- or, with a task key in front,
    // "PROJ-142: Writ".
    const canvas = new PixelCanvas(72, 16);
    canvas.drawSmallText('PROJ-142: Write the release notes', 17, 8, '#FFFFFF', FIELD);
    const expected = new PixelCanvas(72, 16);
    expected.drawText(fitToWidth('PROJ-142: Write the release notes', FIELD, ROW1_FONT), 17, 8, '#FFFFFF', ROW1_FONT);

    expect(canvas.getPixels()).toEqual(expected.getPixels());
    expect(fitToWidth('PROJ-142: Write the release notes', FIELD, ROW1_FONT).endsWith(ELLIPSIS)).toBe(true);
  });

  it('MeasureText_OnTheCanvas_MatchesTheSharedHelper', () => {
    const canvas = new PixelCanvas(72, 16);
    expect(canvas.measureText('Sacha (#')).toBe(measureText('Sacha (#', ROW0_FONT));
  });

  it('DrawText_ReturnsThePenPositionAfterTheText', () => {
    const canvas = new PixelCanvas(72, 16);
    expect(canvas.drawText('abc', 17, 0, '#FFFFFF')).toBe(17 + measureText('abc', ROW0_FONT));
  });
});
