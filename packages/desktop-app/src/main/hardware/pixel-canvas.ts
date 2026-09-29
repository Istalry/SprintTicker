import { PixelFont, ROW0_FONT, ROW1_FONT } from '../../shared/fonts/pixel-font';
import { glyphFor, measureText, fitToWidth } from '../../shared/proportional-text';
import { sanitizeAsciiText } from '../../shared/text-sanitizer';

/**
 * PixelCanvas — a 72×16 software pixel canvas for the BUSY Bar front display.
 *
 * Provides methods to draw icons, text (Sprint 5 on row 0, the condensed Sprint
 * Small on row 1, both proportional), rectangles, and other primitives into a
 * (string|null)[][] buffer.
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
   * Renders text proportionally in `font`, and returns the pen position after it.
   *
   * `y` is the top of the line, not the baseline, so callers keep using the
   * same row offsets they always did. Every glyph is stored at the full height
   * of its font, so a descender is simply ink in the rows below the ascent.
   */
  public drawText(text: string, x: number, y: number, color: string, font: PixelFont = ROW0_FONT): number {
    let pen = x;
    for (const char of text) {
      const glyph = glyphFor(char, font);
      for (let row = 0; row < glyph.rows.length; row++) {
        const bits = glyph.rows[row];
        for (let col = 0; col < glyph.width; col++) {
          if (bits & (1 << (glyph.width - 1 - col))) {
            this.setPixel(pen + col, y + row, color);
          }
        }
      }
      pen += glyph.width + font.letterSpacing;
    }
    return pen;
  }

  /** Measures the pixel width a string would occupy with drawText. */
  public measureText(text: string, font: PixelFont = ROW0_FONT): number {
    return measureText(text, font);
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
  public drawTextClipped(
    text: string,
    x: number,
    y: number,
    color: string,
    maxWidth: number,
    font: PixelFont = ROW0_FONT
  ): void {
    if (maxWidth <= 0) return;
    this.drawText(fitToWidth(sanitizeAsciiText(text), maxWidth, font), x, y, color, font);
  }

  /**
   * Draws row-1 text: the condensed font, truncated with an ellipsis.
   *
   * This used to be a fixed-width 3x5 font cut at a character count with no
   * marker, and 55 of the 95 printable characters were missing from it --
   * `(`, `,`, `'`, `#` and the rest drew as `?`. It now goes through exactly
   * the same measuring and truncation as row 0, in the row-1 font.
   */
  public drawSmallText(text: string, x: number, y: number, color: string, maxWidth: number): void {
    this.drawTextClipped(text, x, y, color, maxWidth, ROW1_FONT);
  }
}
