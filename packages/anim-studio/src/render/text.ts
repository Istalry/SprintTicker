import type { PixelFont, PixelGlyph } from '../../../desktop-app/src/shared/fonts/pixel-font';
import { SPRINT_5 } from '../../../desktop-app/src/shared/fonts/sprint-5';
import { SPRINT_SMALL } from '../../../desktop-app/src/shared/fonts/sprint-small';
import { SPRINT_BOLD_7 } from '../fonts/sprint-bold-7';
import type { FontId } from '../model/scene';

/**
 * The fonts a scene can use.
 *
 * The two row fonts are the app's own, imported in place rather than copied,
 * so a glyph retouched in the app's sheet shows up here on the next build. The
 * paths are relative rather than aliased because the server half of the studio
 * is bundled into `vite.config.ts`, and that bundling resolves no aliases. The
 * display face exists only for scenes.
 */
export const SCENE_FONTS: Record<FontId, PixelFont> = {
  'bold-7': SPRINT_BOLD_7,
  'sprint-5': SPRINT_5,
  'sprint-small': SPRINT_SMALL
};

export const FONT_LABELS: Record<FontId, string> = {
  'bold-7': 'Bold 7 (titles, capitals)',
  'sprint-5': 'Sprint 5 (row 0 face)',
  'sprint-small': 'Sprint Small (row 1 face)'
};

/**
 * The glyph for a character, falling back to its capital and then to `?`.
 *
 * The capital step is for the display face, which has no lowercase: "Lunch"
 * typed into a title should come out as LUNCH, not as five question marks.
 */
export function glyphOf(char: string, font: PixelFont): PixelGlyph {
  return font.glyphs[char] ?? font.glyphs[char.toUpperCase()] ?? font.glyphs['?'];
}

export function advanceOf(char: string, font: PixelFont): number {
  return glyphOf(char, font).width + font.letterSpacing;
}

/**
 * Width of `text` as drawn: the sum of advances, less the trailing spacing
 * after the last glyph, which is not ink and would push centred text left.
 */
export function measure(text: string, font: PixelFont): number {
  if (text.length === 0) return 0;
  let width = 0;
  for (const char of text) width += advanceOf(char, font);
  return width - font.letterSpacing;
}

/**
 * Calls `plot` for every lit pixel of `text` with its top-left at (x, y), and
 * the index of the character it belongs to -- effects such as the wave move
 * each character on its own.
 */
export function forEachTextPixel(
  text: string,
  font: PixelFont,
  x: number,
  y: number,
  plot: (px: number, py: number, charIndex: number) => void
): void {
  let pen = x;
  let index = 0;
  for (const char of text) {
    const glyph = glyphOf(char, font);
    glyph.rows.forEach((bits, row) => {
      for (let col = 0; col < glyph.width; col++) {
        if (bits & (1 << (glyph.width - 1 - col))) plot(pen + col, y + row, index);
      }
    });
    pen += glyph.width + font.letterSpacing;
    index++;
  }
}
