/**
 * The shape of a pixel font, and which one each row of the front display uses.
 *
 * The fonts themselves are generated: the source is a hand-drawn glyph sheet in
 * `packages/desktop-app/fonts/`, compiled by `tools/glyphs-to-ts.js`. Edit the
 * sheet, then run `pnpm fonts:build`; `pnpm fonts:check` fails CI when the two
 * disagree.
 */

import { SPRINT_5 } from './sprint-5';
import { SPRINT_SMALL } from './sprint-small';

/** One character, drawn at the full height of its font. */
export interface PixelGlyph {
  /** Ink width in pixels. The font's letter spacing is added after it. */
  width: number;
  /**
   * One bitmask per row, top first, `ascent + descent` of them. Bit
   * `width - 1` is the leftmost pixel.
   */
  rows: readonly number[];
}

export interface PixelFont {
  name: string;
  /** Rows above the baseline, including the baseline row itself. */
  ascent: number;
  /** Rows below it, used by descenders only. */
  descent: number;
  /** Blank columns after every glyph. */
  letterSpacing: number;
  /** All of printable ASCII, plus the ellipsis. */
  glyphs: Readonly<Record<string, PixelGlyph>>;
}

/** Total rows a line of `font` occupies. */
export function fontHeight(font: PixelFont): number {
  return font.ascent + font.descent;
}

/**
 * The font for row 0 -- the task, the sender, a screen's title.
 *
 * Named by role, and imported from here by both the text composer and
 * `PixelCanvas`. Those two truncate independently, and when they measured with
 * different fonts every row was cut twice, the second time mid-word with no
 * marker. One name for "the row 0 font" is what keeps them measuring the same
 * thing.
 */
export const ROW0_FONT: PixelFont = SPRINT_5;

/** The font for row 1 -- the timer, a task title, a message body. */
export const ROW1_FONT: PixelFont = SPRINT_SMALL;
