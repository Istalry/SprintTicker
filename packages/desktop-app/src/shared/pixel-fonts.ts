/**
 * The fixed-width 3x5 bitmap font, shared by the hardware renderer and the
 * on-screen emulator.
 *
 * These live in `shared/` because both processes need them. The emulator used
 * to reach into `src/main/hardware/pixel-canvas.ts` directly, which crosses the
 * process boundary: renderer code must never import from `src/main/**`, and
 * that import also pulled the whole PixelCanvas class into the renderer bundle
 * just to read two glyph tables.
 *
 * Each glyph is a row-major bitmask array; see PixelCanvas.drawSmallText for
 * how the bits are unpacked.
 *
 * A 4x6 font used to live here too, for row 0. It was replaced by the BUSY
 * Bar's own proportional font (`busy-font.ts`) and deleted rather than left
 * available: 82 of its 96 glyphs were only 3px wide inside a 4px cell, so it
 * printed two blank columns between every character and had no room to draw a
 * legible `#`.
 */

// ──────────────────────────────────────────────────────────────────────────────
// 3×5 Micro Font (for secondary info row)
// ──────────────────────────────────────────────────────────────────────────────
export const FONT_3X5: Record<string, number[]> = {
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
