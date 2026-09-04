import { FONT_4X6, FONT_3X5 } from '../../shared/pixel-fonts';
/**
 * PixelCanvas — a 72×16 software pixel canvas for the BUSY Bar front display.
 *
 * Provides methods to draw icons, text (via compact 4×6 and 3×5 bitmap fonts),
 * rectangles, and other primitives into a (string|null)[][] buffer.
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
   * Renders ASCII text into the pixel buffer using the built-in 4×6 bitmap font.
   * Characters are 4px wide + 1px gap (stride = 5px).
   */
  public drawText(text: string, x: number, y: number, color: string): number {
    let cx = x;
    for (const char of text) {
      // Fallback order: Exact character -> Uppercase variant -> Question mark
      const glyph = FONT_4X6[char] ?? FONT_4X6[char.toUpperCase()] ?? FONT_4X6['?'];
      for (let row = 0; row < glyph.length; row++) {
        const bits = glyph[row];
        for (let col = 0; col < 4; col++) {
          if (bits & (0b1000 >> col)) {
            this.setPixel(cx + col, y + row, color);
          }
        }
      }
      cx += 5; // 4px glyph + 1px gap
    }
    return cx;
  }

  /** Measures the pixel width a string would occupy with drawText. */
  public measureText(text: string): number {
    return text.length * 5;
  }

  /** Draws text clipped to maxWidth with ellipsis fallback. */
  public drawTextClipped(text: string, x: number, y: number, color: string, maxWidth: number): void {
    const maxChars = Math.floor(maxWidth / 5);
    if (maxChars <= 0) return;
    const clipped = text.length > maxChars ? text.substring(0, Math.max(1, maxChars - 1)) + '…' : text;
    this.drawText(clipped, x, y, color);
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
    const maxChars = Math.floor(maxWidth / 4);
    if (maxChars <= 0) return;
    const clipped = text.length > maxChars ? text.substring(0, maxChars) : text;

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
      cx += 4; // 3px glyph + 1px gap
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 4×6 Bitmap Font (ASCII 32–126)
// Each character is 6 rows × 4 bits (MSB = leftmost pixel)
// ──────────────────────────────────────────────────────────────────────────────

// Re-exported for existing main-process importers; the definitions now live in
// src/shared/pixel-fonts.ts so the renderer can use them without importing main.
export { FONT_4X6, FONT_3X5 };
