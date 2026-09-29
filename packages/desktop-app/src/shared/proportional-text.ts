import { PixelFont, PixelGlyph } from './fonts/pixel-font';

/**
 * Measuring and truncating text in the proportional pixel fonts.
 *
 * Both rows of the front display are proportional -- `i` advances 2px and `M`
 * advances 6 -- so "how much fits" is never a division: the only honest answer
 * is to add the glyphs up. Two consequences worth knowing:
 *
 * - **There is no character capacity for either row.** A row holds however many
 *   characters happen to fit. Anything that wants to know whether text fits has
 *   to measure it, in the font it will be drawn in.
 * - **Truncation has to walk the string.** It cannot cut at a fixed index,
 *   because the width of the part being removed depends on which characters
 *   they were.
 *
 * Row 1 used to be a fixed-width font cut at a character count, with no marker,
 * so a title stopped mid-word ("Writ") and looked like a rendering fault. It is
 * measured here now, the same way as row 0.
 *
 * Lives in `shared/` because the text composer measures before truncating and
 * `PixelCanvas` measures while laying out. When those two disagreed by a single
 * character, every row was truncated twice -- the second time with no marker,
 * mid-word. The font is a required argument rather than a default for the same
 * reason: measuring in one font and drawing in another is that bug again.
 */

/** What a truncated row ends with. A real glyph in both fonts, not three dots. */
export const ELLIPSIS = '…';

/**
 * The glyph to draw for a character.
 *
 * Every font carries all of printable ASCII (the generator refuses one that
 * does not), so the `?` fallback is only reached by text that skipped
 * `sanitizeAsciiText`. It is a fallback rather than a throw because one odd
 * character must not take down a whole notification.
 */
export function glyphFor(char: string, font: PixelFont): PixelGlyph {
  return font.glyphs[char] ?? font.glyphs['?'];
}

/** How far the pen moves after drawing `char`: its width plus the letter spacing. */
export function advanceOf(char: string, font: PixelFont): number {
  return glyphFor(char, font).width + font.letterSpacing;
}

/**
 * The width in pixels that `text` would occupy, including inter-glyph gaps.
 *
 * The last glyph's trailing gap is counted. It lands in the blank column after
 * the field, which is exactly where a gap is wanted, so a string that measures
 * the field width fits it.
 */
export function measureText(text: string, font: PixelFont): number {
  let width = 0;
  for (const char of text) width += advanceOf(char, font);
  return width;
}

/**
 * Shortens `text` until it fits `maxWidthPx`, ending it with an ellipsis.
 *
 * Returns the text unchanged when it already fits, so the common case costs one
 * measurement and no allocation.
 *
 * The ellipsis is included in the budget rather than appended past the edge.
 * Appending it would push the last glyph off the field, and the canvas clips
 * silently -- so the row would end in a half-drawn ellipsis, which reads as a
 * rendering fault rather than as "there is more text".
 */
export function fitToWidth(text: string, maxWidthPx: number, font: PixelFont): string {
  if (maxWidthPx <= 0) return '';
  if (measureText(text, font) <= maxWidthPx) return text;

  const markerWidth = measureText(ELLIPSIS, font);
  // No room for even the marker: fill what there is with plain characters, so a
  // very narrow field shows something rather than a lone ellipsis.
  if (markerWidth > maxWidthPx) return takeWhileUnder(text, maxWidthPx, font);

  const kept = takeWhileUnder(text, maxWidthPx - markerWidth, font);
  // A cut that lands on a space gives the space back: ' …' reads as a gap
  // before the marker rather than as a word continuing.
  return `${kept.trimEnd()}${ELLIPSIS}`;
}

/** The longest prefix of `text` that measures at most `maxWidthPx`. */
function takeWhileUnder(text: string, maxWidthPx: number, font: PixelFont): string {
  let width = 0;
  let end = 0;
  for (const char of text) {
    const advance = advanceOf(char, font);
    if (width + advance > maxWidthPx) break;
    width += advance;
    end += char.length;
  }
  return text.slice(0, end);
}
