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
const FONT_4X6: Record<string, number[]> = {
  ' ': [0b0000, 0b0000, 0b0000, 0b0000, 0b0000, 0b0000],
  '!': [0b0100, 0b0100, 0b0100, 0b0100, 0b0000, 0b0100],
  '"': [0b1010, 0b1010, 0b0000, 0b0000, 0b0000, 0b0000],
  '#': [0b1010, 0b1110, 0b1010, 0b1110, 0b1010, 0b0000],
  '$': [0b0110, 0b1100, 0b0110, 0b1110, 0b0100, 0b0000],
  '%': [0b1000, 0b0010, 0b0100, 0b1000, 0b0010, 0b0000],
  '&': [0b0100, 0b1010, 0b0100, 0b1010, 0b0110, 0b0000],
  "'": [0b0100, 0b0100, 0b0000, 0b0000, 0b0000, 0b0000],
  '(': [0b0010, 0b0100, 0b0100, 0b0100, 0b0010, 0b0000],
  ')': [0b1000, 0b0100, 0b0100, 0b0100, 0b1000, 0b0000],
  '*': [0b0000, 0b1010, 0b0100, 0b1010, 0b0000, 0b0000],
  '+': [0b0000, 0b0100, 0b1110, 0b0100, 0b0000, 0b0000],
  ',': [0b0000, 0b0000, 0b0000, 0b0100, 0b0100, 0b1000],
  '-': [0b0000, 0b0000, 0b1110, 0b0000, 0b0000, 0b0000],
  '.': [0b0000, 0b0000, 0b0000, 0b0000, 0b0100, 0b0000],
  '/': [0b0010, 0b0010, 0b0100, 0b1000, 0b1000, 0b0000],
  '0': [0b0110, 0b1010, 0b1010, 0b1010, 0b0110, 0b0000],
  '1': [0b0100, 0b1100, 0b0100, 0b0100, 0b1110, 0b0000],
  '2': [0b0110, 0b1010, 0b0010, 0b0100, 0b1110, 0b0000],
  '3': [0b1110, 0b0010, 0b0110, 0b0010, 0b1110, 0b0000],
  '4': [0b1010, 0b1010, 0b1110, 0b0010, 0b0010, 0b0000],
  '5': [0b1110, 0b1000, 0b1110, 0b0010, 0b1110, 0b0000],
  '6': [0b0110, 0b1000, 0b1110, 0b1010, 0b0110, 0b0000],
  '7': [0b1110, 0b0010, 0b0100, 0b0100, 0b0100, 0b0000],
  '8': [0b0110, 0b1010, 0b0110, 0b1010, 0b0110, 0b0000],
  '9': [0b0110, 0b1010, 0b0110, 0b0010, 0b1100, 0b0000],
  ':': [0b0000, 0b0100, 0b0000, 0b0100, 0b0000, 0b0000],
  ';': [0b0000, 0b0100, 0b0000, 0b0100, 0b0100, 0b1000],
  '<': [0b0010, 0b0100, 0b1000, 0b0100, 0b0010, 0b0000],
  '=': [0b0000, 0b1110, 0b0000, 0b1110, 0b0000, 0b0000],
  '>': [0b1000, 0b0100, 0b0010, 0b0100, 0b1000, 0b0000],
  '?': [0b0110, 0b1010, 0b0010, 0b0100, 0b0000, 0b0100],
  '@': [0b0110, 0b1010, 0b1010, 0b1100, 0b0010, 0b1100],
  'A': [0b0100, 0b1010, 0b1110, 0b1010, 0b1010, 0b0000],
  'B': [0b1100, 0b1010, 0b1100, 0b1010, 0b1100, 0b0000],
  'C': [0b0110, 0b1000, 0b1000, 0b1000, 0b0110, 0b0000],
  'D': [0b1100, 0b1010, 0b1010, 0b1010, 0b1100, 0b0000],
  'E': [0b1110, 0b1000, 0b1100, 0b1000, 0b1110, 0b0000],
  'F': [0b1110, 0b1000, 0b1100, 0b1000, 0b1000, 0b0000],
  'G': [0b0110, 0b1000, 0b1010, 0b1010, 0b0110, 0b0000],
  'H': [0b1010, 0b1010, 0b1110, 0b1010, 0b1010, 0b0000],
  'I': [0b1110, 0b0100, 0b0100, 0b0100, 0b1110, 0b0000],
  'J': [0b0110, 0b0010, 0b0010, 0b1010, 0b0100, 0b0000],
  'K': [0b1010, 0b1010, 0b1100, 0b1010, 0b1010, 0b0000],
  'L': [0b1000, 0b1000, 0b1000, 0b1000, 0b1110, 0b0000],
  'M': [0b1010, 0b1110, 0b1110, 0b1010, 0b1010, 0b0000],
  'N': [0b1010, 0b1110, 0b1110, 0b1110, 0b1010, 0b0000],
  'O': [0b0100, 0b1010, 0b1010, 0b1010, 0b0100, 0b0000],
  'P': [0b1100, 0b1010, 0b1100, 0b1000, 0b1000, 0b0000],
  'Q': [0b0100, 0b1010, 0b1010, 0b0110, 0b0010, 0b0000],
  'R': [0b1100, 0b1010, 0b1100, 0b1010, 0b1010, 0b0000],
  'S': [0b0110, 0b1000, 0b0100, 0b0010, 0b1100, 0b0000],
  'T': [0b1110, 0b0100, 0b0100, 0b0100, 0b0100, 0b0000],
  'U': [0b1010, 0b1010, 0b1010, 0b1010, 0b0110, 0b0000],
  'V': [0b1010, 0b1010, 0b1010, 0b0100, 0b0100, 0b0000],
  'W': [0b1010, 0b1010, 0b1110, 0b1110, 0b1010, 0b0000],
  'X': [0b1010, 0b1010, 0b0100, 0b1010, 0b1010, 0b0000],
  'Y': [0b1010, 0b1010, 0b0100, 0b0100, 0b0100, 0b0000],
  'Z': [0b1110, 0b0010, 0b0100, 0b1000, 0b1110, 0b0000],
  '[': [0b0110, 0b0100, 0b0100, 0b0100, 0b0110, 0b0000],
  '\\': [0b1000, 0b1000, 0b0100, 0b0010, 0b0010, 0b0000],
  ']': [0b1100, 0b0100, 0b0100, 0b0100, 0b1100, 0b0000],
  '^': [0b0100, 0b1010, 0b0000, 0b0000, 0b0000, 0b0000],
  '_': [0b0000, 0b0000, 0b0000, 0b0000, 0b1110, 0b0000],
  '`': [0b1000, 0b0100, 0b0000, 0b0000, 0b0000, 0b0000],
  'a': [0b0000, 0b0110, 0b1010, 0b1010, 0b0110, 0b0000],
  'b': [0b1000, 0b1000, 0b1100, 0b1010, 0b1100, 0b0000],
  'c': [0b0000, 0b0110, 0b1000, 0b1000, 0b0110, 0b0000],
  'd': [0b0010, 0b0010, 0b0110, 0b1010, 0b0110, 0b0000],
  'e': [0b0000, 0b0110, 0b1110, 0b1000, 0b0110, 0b0000],
  'f': [0b0010, 0b0100, 0b1110, 0b0100, 0b0100, 0b0000],
  'g': [0b0000, 0b0110, 0b1010, 0b0110, 0b0010, 0b1100],
  'h': [0b1000, 0b1000, 0b1100, 0b1010, 0b1010, 0b0000],
  'i': [0b0100, 0b0000, 0b0100, 0b0100, 0b0100, 0b0000],
  'j': [0b0010, 0b0000, 0b0010, 0b0010, 0b1010, 0b0100],
  'k': [0b1000, 0b1010, 0b1100, 0b1010, 0b1010, 0b0000],
  'l': [0b0100, 0b0100, 0b0100, 0b0100, 0b0010, 0b0000],
  'm': [0b0000, 0b1010, 0b1110, 0b1010, 0b1010, 0b0000],
  'n': [0b0000, 0b1100, 0b1010, 0b1010, 0b1010, 0b0000],
  'o': [0b0000, 0b0100, 0b1010, 0b1010, 0b0100, 0b0000],
  'p': [0b0000, 0b1100, 0b1010, 0b1100, 0b1000, 0b1000],
  'q': [0b0000, 0b0110, 0b1010, 0b0110, 0b0010, 0b0010],
  'r': [0b0000, 0b0110, 0b1000, 0b1000, 0b1000, 0b0000],
  's': [0b0000, 0b0110, 0b1100, 0b0110, 0b1100, 0b0000],
  't': [0b0100, 0b1110, 0b0100, 0b0100, 0b0010, 0b0000],
  'u': [0b0000, 0b1010, 0b1010, 0b1010, 0b0110, 0b0000],
  'v': [0b0000, 0b1010, 0b1010, 0b0100, 0b0100, 0b0000],
  'w': [0b0000, 0b1010, 0b1110, 0b1110, 0b0100, 0b0000],
  'x': [0b0000, 0b1010, 0b0100, 0b1010, 0b1010, 0b0000],
  'y': [0b0000, 0b1010, 0b1010, 0b0110, 0b0010, 0b1100],
  'z': [0b0000, 0b1110, 0b0010, 0b0100, 0b1110, 0b0000],
  '{': [0b0010, 0b0100, 0b1000, 0b0100, 0b0010, 0b0000],
  '|': [0b0100, 0b0100, 0b0000, 0b0100, 0b0100, 0b0000],
  '}': [0b1000, 0b0100, 0b0010, 0b0100, 0b1000, 0b0000],
  '~': [0b0000, 0b0100, 0b1110, 0b0100, 0b0000, 0b0000],
  '…': [0b0000, 0b0000, 0b0000, 0b0000, 0b1010, 0b0000],
};

// ──────────────────────────────────────────────────────────────────────────────
// 3×5 Micro Font (for secondary info row)
// ──────────────────────────────────────────────────────────────────────────────
const FONT_3X5: Record<string, number[]> = {
  ' ': [0b000, 0b000, 0b000, 0b000, 0b000],
  '0': [0b010, 0b101, 0b101, 0b101, 0b010],
  '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b110, 0b001, 0b010, 0b100, 0b111],
  '3': [0b111, 0b001, 0b011, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001],
  '5': [0b111, 0b100, 0b110, 0b001, 0b110],
  '6': [0b011, 0b100, 0b110, 0b101, 0b010],
  '7': [0b111, 0b001, 0b010, 0b010, 0b010],
  '8': [0b010, 0b101, 0b010, 0b101, 0b010],
  '9': [0b010, 0b101, 0b011, 0b001, 0b110],
  ':': [0b000, 0b010, 0b000, 0b010, 0b000],
  'A': [0b010, 0b101, 0b111, 0b101, 0b101],
  'B': [0b110, 0b101, 0b110, 0b101, 0b110],
  'C': [0b011, 0b100, 0b100, 0b100, 0b011],
  'D': [0b110, 0b101, 0b101, 0b101, 0b110],
  'E': [0b111, 0b100, 0b110, 0b100, 0b111],
  'F': [0b111, 0b100, 0b110, 0b100, 0b100],
  'G': [0b011, 0b100, 0b101, 0b101, 0b011],
  'H': [0b101, 0b101, 0b111, 0b101, 0b101],
  'I': [0b111, 0b010, 0b010, 0b010, 0b111],
  'J': [0b001, 0b001, 0b001, 0b101, 0b010],
  'K': [0b101, 0b101, 0b110, 0b101, 0b101],
  'L': [0b100, 0b100, 0b100, 0b100, 0b111],
  'M': [0b101, 0b111, 0b101, 0b101, 0b101],
  'N': [0b101, 0b111, 0b111, 0b111, 0b101],
  'O': [0b010, 0b101, 0b101, 0b101, 0b010],
  'P': [0b110, 0b101, 0b110, 0b100, 0b100],
  'Q': [0b010, 0b101, 0b101, 0b011, 0b001],
  'R': [0b110, 0b101, 0b110, 0b101, 0b101],
  'S': [0b011, 0b100, 0b010, 0b001, 0b110],
  'T': [0b111, 0b010, 0b010, 0b010, 0b010],
  'U': [0b101, 0b101, 0b101, 0b101, 0b010],
  'V': [0b101, 0b101, 0b101, 0b010, 0b010],
  'W': [0b101, 0b101, 0b111, 0b111, 0b101],
  'X': [0b101, 0b101, 0b010, 0b101, 0b101],
  'Y': [0b101, 0b101, 0b010, 0b010, 0b010],
  'Z': [0b111, 0b001, 0b010, 0b100, 0b111],

  // Lowercase 'a' through 'z'
  'a': [0b000, 0b110, 0b001, 0b111, 0b101],
  'b': [0b100, 0b100, 0b110, 0b101, 0b110],
  'c': [0b000, 0b011, 0b100, 0b100, 0b011],
  'd': [0b001, 0b001, 0b011, 0b101, 0b011],
  'e': [0b000, 0b010, 0b111, 0b100, 0b011],
  'f': [0b010, 0b101, 0b110, 0b100, 0b100],
  'g': [0b000, 0b011, 0b101, 0b011, 0b001],
  'h': [0b100, 0b100, 0b110, 0b101, 0b101],
  'i': [0b010, 0b000, 0b010, 0b010, 0b010],
  'j': [0b001, 0b000, 0b001, 0b001, 0b110],
  'k': [0b100, 0b101, 0b110, 0b101, 0b101],
  'l': [0b010, 0b010, 0b010, 0b010, 0b011],
  'm': [0b000, 0b101, 0b111, 0b101, 0b101],
  'n': [0b000, 0b110, 0b101, 0b101, 0b101],
  'o': [0b000, 0b010, 0b101, 0b101, 0b010],
  'p': [0b000, 0b110, 0b101, 0b110, 0b100],
  'q': [0b000, 0b011, 0b101, 0b011, 0b001],
  'r': [0b000, 0b101, 0b110, 0b100, 0b100],
  's': [0b000, 0b011, 0b100, 0b001, 0b110],
  't': [0b100, 0b111, 0b100, 0b100, 0b011],
  'u': [0b000, 0b101, 0b101, 0b101, 0b011],
  'v': [0b000, 0b101, 0b101, 0b101, 0b010],
  'w': [0b000, 0b101, 0b101, 0b111, 0b101],
  'x': [0b000, 0b101, 0b010, 0b101, 0b101],
  'y': [0b000, 0b101, 0b101, 0b011, 0b001],
  'z': [0b000, 0b111, 0b001, 0b010, 0b111],

  '-': [0b000, 0b000, 0b111, 0b000, 0b000],
  '_': [0b000, 0b000, 0b000, 0b000, 0b111],
  '.': [0b000, 0b000, 0b000, 0b000, 0b010],
  '%': [0b101, 0b001, 0b010, 0b100, 0b101],
  '/': [0b001, 0b001, 0b010, 0b100, 0b100],
  '?': [0b010, 0b101, 0b001, 0b010, 0b010],
  '!': [0b010, 0b010, 0b010, 0b000, 0b010],
  '[': [0b011, 0b010, 0b010, 0b010, 0b011],
  ']': [0b110, 0b010, 0b010, 0b010, 0b110],
  '…': [0b000, 0b000, 0b000, 0b000, 0b101],
};