import { BUSY_FONT, ProportionalGlyph } from './busy-font';

/**
 * Measuring and truncating text in the BUSY Bar's own proportional font.
 *
 * The row-0 font used to be fixed-width, which made "how much fits" a division:
 * `floor((fieldWidth + 1) / stride)`. It is now proportional -- `i` advances
 * 2px and `#` advances 6 -- so the only honest answer is to add the glyphs up.
 * Two consequences worth knowing:
 *
 * - **There is no character capacity for row 0 any more.** A row holds however
 *   many characters happen to fit, which for the 55px field is about 14 of
 *   mixed-case text and as few as 9 of capitals. Anything that wants to know
 *   whether text fits has to measure it.
 * - **Truncation has to walk the string.** It cannot cut at a fixed index,
 *   because the width of the part being removed depends on which characters
 *   they were.
 *
 * Lives in `shared/` because the text composer measures before truncating and
 * `PixelCanvas` measures while laying out. When those two disagreed by a single
 * character under the old fixed-width model, every row was truncated twice --
 * the second time with no marker, mid-word.
 */

/** What a truncated row ends with. A real glyph in this font, not three dots. */
export const ELLIPSIS = '…';

/**
 * The glyph to draw for a character.
 *
 * Falls back to the uppercase form and then to `?`, matching what the previous
 * font did. The uppercase step matters because the font has no backtick and a
 * few other codepoints, and a recognisable letter beats a question mark.
 */
export function glyphFor(char: string): ProportionalGlyph {
  return BUSY_FONT[char] ?? BUSY_FONT[char.toUpperCase()] ?? BUSY_FONT['?'];
}

/** The width in pixels that `text` would occupy, including inter-glyph gaps. */
export function measureText(text: string): number {
  let width = 0;
  for (const char of text) width += glyphFor(char).advance;
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
export function fitToWidth(text: string, maxWidthPx: number): string {
  if (maxWidthPx <= 0) return '';
  if (measureText(text) <= maxWidthPx) return text;

  const markerWidth = measureText(ELLIPSIS);
  // No room for even the marker: fill what there is with plain characters, so a
  // very narrow field shows something rather than a lone ellipsis.
  if (markerWidth > maxWidthPx) return takeWhileUnder(text, maxWidthPx);

  const kept = takeWhileUnder(text, maxWidthPx - markerWidth);
  // A cut that lands on a space gives the space back: ' …' reads as a gap
  // before the marker rather than as a word continuing.
  return `${kept.trimEnd()}${ELLIPSIS}`;
}

/** The longest prefix of `text` that measures at most `maxWidthPx`. */
function takeWhileUnder(text: string, maxWidthPx: number): string {
  let width = 0;
  let end = 0;
  for (const char of text) {
    const advance = glyphFor(char).advance;
    if (width + advance > maxWidthPx) break;
    width += advance;
    end += char.length;
  }
  return text.slice(0, end);
}
