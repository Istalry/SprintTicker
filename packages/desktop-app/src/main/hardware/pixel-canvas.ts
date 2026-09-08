import { FONT_3X5 } from '../../shared/pixel-fonts';
import { BUSY_FONT_ASCENT } from '../../shared/busy-font';
import { glyphFor, measureText, fitToWidth } from '../../shared/proportional-text';
import { sanitizeAsciiText } from '../../shared/text-sanitizer';
import { DISPLAY_CONSTANTS } from '../../shared/render-constants';
import { capacityFor } from '../../shared/text-capacity';

const { ROW1: ROW1_FONT } = DISPLAY_CONSTANTS.FONT_METRICS;
/**
 * PixelCanvas — a 72×16 software pixel canvas for the BUSY Bar front display.
 *
 * Provides methods to draw icons, text (the BUSY Bar's own proportional font on
 * row 0, a compact fixed-width 3×5 font on row 1), rectangles, and other
 * primitives into a (string|null)[][] buffer.
 *
 * Coordinate system: x = 0..71 (left→right), y = 0..15 (top→bottom).
 */
export class PixelCanvas {
  public readonly width: number;
  public readonly height: number;
  private pixels: (string | null)[][];

  constructor(width: number = 72, height: number = 16) {
    this.width = width;
    this.height = height;
    this.pixels = this._makeBlankCanvas();
  }

  /** Returns a fresh blank (all null = black) pixel grid. */
  private _makeBlankCanvas(): (string | null)[][] {
    return Array.from({ length: this.height }, () => Array(this.width).fill(null));
  }

  /** Clears the entire canvas to black. */
  public clear(): void {
    this.pixels = this._makeBlankCanvas();
  }

  /** Returns the current pixel buffer (row-major). */
  public getPixels(): (string | null)[][] {
    return this.pixels;
  }

  /** Sets a single pixel if within bounds. */
  public setPixel(x: number, y: number, color: string): void {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      this.pixels[y][x] = color;
    }
  }

  /**
   * Blits a source 2D color matrix (any size) onto the canvas at (originX, originY).
   * Transparent (null) pixels in the source are skipped.
   */
  public drawBitmap(
    bitmap: (string | null)[][],
    originX: number,
    originY: number,
    scaleToWidth?: number,
    scaleToHeight?: number
  ): void {
    if (!bitmap || bitmap.length === 0) return;

    const srcH = bitmap.length;
    const srcW = bitmap[0]?.length ?? 0;
    const dstW = scaleToWidth ?? srcW;
    const dstH = scaleToHeight ?? srcH;

    for (let dy = 0; dy < dstH; dy++) {
      const sy = Math.floor((dy * srcH) / dstH);
      for (let dx = 0; dx < dstW; dx++) {
        const sx = Math.floor((dx * srcW) / dstW);
        const color = bitmap[sy]?.[sx] ?? null;
        if (color !== null) {
          this.setPixel(originX + dx, originY + dy, color);
        }
      }
    }
  }

  /** Draws a filled rectangle. */
  public drawRect(x: number, y: number, w: number, h: number, color: string): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.setPixel(x + dx, y + dy, color);
      }
    }
  }

  /** Draws a horizontal line. */
  public drawHLine(x: number, y: number, length: number, color: string): void {
    for (let i = 0; i < length; i++) {
      this.setPixel(x + i, y, color);
    }
  }

  /**
   * Renders text in the BUSY Bar's own font, proportionally spaced.
   *
   * `y` is the top of the line, not the baseline, so callers keep using the
   * same row offsets they always did. The baseline sits `BUSY_FONT_ASCENT` rows
   * below it, and a glyph's `ofsY` is measured up from there -- negative for a
   * descender, which is what puts the tail of a `j` below the other letters.
   *
   * This replaced a hand-rolled "4×6" font whose glyphs were, with two
   * exceptions, only 3px wide inside a 4px cell. Drawn at a 5px stride that
   * left two blank columns between every character, and dense glyphs had no
   * room to read: `#` came out as an unrecognisable blob. See ROADMAP.md.
   */
  public drawText(text: string, x: number, y: number, color: string): number {
    let pen = x;
    for (const char of text) {
      const glyph = glyphFor(char);
      for (let row = 0; row < glyph.boxH; row++) {
        const bits = glyph.rows[row];
        for (let col = 0; col < glyph.boxW; col++) {
          if (bits & (1 << (glyph.boxW - 1 - col))) {
            this.setPixel(
              pen + glyph.ofsX + col,
              y + BUSY_FONT_ASCENT - glyph.ofsY - glyph.boxH + row,
              color
            );
          }
        }
      }
      pen += glyph.advance;
    }
    return pen;
  }

  /** Measures the pixel width a string would occupy with drawText. */
  public measureText(text: string): number {
    return measureText(text);
  }

  /**
   * Draws text truncated to maxWidth, ending in an ellipsis when it did not fit.
   *
   * Sanitises first, and the order is the point. The fonts hold printable ASCII
   * only, so `glyphFor` substitutes `?` for anything else -- which is how a
   * French task title reached the bar as "T?che?2" instead of "Tache 2".
   * `sanitizeAsciiText` transliterates rather than substitutes, turning the
   * circumflex into a plain `a` and the non-breaking space back into a space.
   *
   * It has to happen *before* `fitToWidth` measures, because transliteration
   * changes length -- one em dash becomes two hyphens, one eszett two letters
   * -- so sanitising after measuring silently overflows the row that was just
   * fitted. Callers that sanitise and measure themselves, such as the
   * notification composer, are unaffected: this pass is idempotent.
   */
  public drawTextClipped(text: string, x: number, y: number, color: string, maxWidth: number): void {
    if (maxWidth <= 0) return;
    this.drawText(fitToWidth(sanitizeAsciiText(text), maxWidth), x, y, color);
  }

  /** Draws a 7px-tall text row. */
  public drawRow0Text(text: string, x: number, y: number, color: string, maxWidth: number): void {
    this.drawTextClipped(text, x, y, color, maxWidth);
  }

  /**
   * Draws small text using the 3×5 font with full uppercase and lowercase support.
   * Stride = 4px (3px glyph + 1px gap).
   */
  public drawSmallText(text: string, x: number, y: number, color: string, maxWidth: number): void {
    let cx = x;
    const maxChars = capacityFor(maxWidth, ROW1_FONT.STRIDE_X);
    if (maxChars <= 0) return;
    // Sanitised before the capacity cut, for the reason given on
    // drawTextClipped: transliteration changes the character count.
    const safe = sanitizeAsciiText(text);
    const clipped = safe.length > maxChars ? safe.substring(0, maxChars) : safe;

    for (const char of clipped) {
      // Fallback: exact match -> uppercase match -> question mark
      const glyph = FONT_3X5[char] ?? FONT_3X5[char.toUpperCase()] ?? FONT_3X5['?'];
      for (let row = 0; row < glyph.length; row++) {
        const bits = glyph[row];
        for (let col = 0; col < 3; col++) {
          if (bits & (0b100 >> col)) {
            this.setPixel(cx + col, y + row, color);
          }
        }
      }
      cx += ROW1_FONT.STRIDE_X;
    }
  }
}

// Re-exported for existing main-process importers; the definition now lives in
// src/shared/pixel-fonts.ts so the renderer can use it without importing main.
export { FONT_3X5 };
