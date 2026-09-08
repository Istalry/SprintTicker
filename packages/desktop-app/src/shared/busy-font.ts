/**
 * Printable ASCII of the BUSY Bar's own `lv_font_busy_regular_5`, as pixel rows.
 *
 * GENERATED FILE -- do not edit by hand.
 * Regenerate with:
 *   node tools/lvgl-font-to-ts.js <firmware>/lib/lvgl_addons/fonts/lv_font_busy_regular_5.c \
 *     packages/desktop-app/src/shared/busy-font.ts
 *
 * Font: BUSY Bar firmware, derived from Ark Pixel Font.
 * Copyright 2021 TakWolf (https://ark-pixel-font.takwolf.com/)
 * Copyright 2024-2026 Flipper FZCO
 * SPDX-License-Identifier: OFL-1.1
 */

/** One glyph: a bitmap box positioned against the baseline, plus how far the pen moves. */
export interface ProportionalGlyph {
  /** Pen movement in whole pixels, including the gap to the next glyph. */
  advance: number;
  /** Ink box width in pixels; 0 for a blank glyph such as space. */
  boxW: number;
  boxH: number;
  /** Horizontal bearing: where the ink starts relative to the pen. */
  ofsX: number;
  /** Bottom of the ink box relative to the baseline. Negative for a descender. */
  ofsY: number;
  /** One bitmask per row, top first; bit `boxW - 1` is the leftmost pixel. */
  rows: number[];
}

/** Rows of ink above the baseline, across every glyph emitted here. */
export const BUSY_FONT_ASCENT = 5;

/** Rows of ink below the baseline. Only descenders use it. */
export const BUSY_FONT_DESCENT = 2;

/** Total rows a line of this font occupies. */
export const BUSY_FONT_HEIGHT = BUSY_FONT_ASCENT + BUSY_FONT_DESCENT;

export const BUSY_FONT: Record<string, ProportionalGlyph> = {
  " ": { advance: 2, boxW: 1, boxH: 1, ofsX: 0, ofsY: 0, rows: [0] },
  "!": { advance: 2, boxW: 1, boxH: 5, ofsX: 0, ofsY: 0, rows: [1, 1, 1, 0, 1] },
  "\"": { advance: 4, boxW: 3, boxH: 2, ofsX: 0, ofsY: 3, rows: [5, 5] },
  "#": { advance: 6, boxW: 5, boxH: 5, ofsX: 0, ofsY: 0, rows: [10, 31, 10, 31, 10] },
  "$": { advance: 4, boxW: 3, boxH: 6, ofsX: 0, ofsY: -1, rows: [2, 3, 6, 1, 6, 2] },
  "%": { advance: 5, boxW: 4, boxH: 4, ofsX: 0, ofsY: 1, rows: [9, 2, 4, 9] },
  "&": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [4, 10, 4, 10, 5] },
  "'": { advance: 2, boxW: 1, boxH: 2, ofsX: 0, ofsY: 3, rows: [1, 1] },
  "(": { advance: 3, boxW: 2, boxH: 5, ofsX: 0, ofsY: 0, rows: [1, 2, 2, 2, 1] },
  ")": { advance: 3, boxW: 2, boxH: 5, ofsX: 0, ofsY: 0, rows: [2, 1, 1, 1, 2] },
  "*": { advance: 4, boxW: 3, boxH: 4, ofsX: 0, ofsY: 1, rows: [2, 7, 2, 5] },
  "+": { advance: 4, boxW: 3, boxH: 3, ofsX: 0, ofsY: 1, rows: [2, 7, 2] },
  ",": { advance: 2, boxW: 1, boxH: 2, ofsX: 0, ofsY: -1, rows: [1, 1] },
  "-": { advance: 3, boxW: 2, boxH: 1, ofsX: 0, ofsY: 2, rows: [3] },
  ".": { advance: 2, boxW: 1, boxH: 1, ofsX: 0, ofsY: 0, rows: [1] },
  "/": { advance: 3, boxW: 2, boxH: 5, ofsX: 0, ofsY: 0, rows: [1, 1, 2, 2, 2] },
  "0": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [2, 5, 5, 5, 2] },
  "1": { advance: 3, boxW: 2, boxH: 5, ofsX: 0, ofsY: 0, rows: [1, 3, 1, 1, 1] },
  "2": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [6, 1, 2, 4, 7] },
  "3": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [6, 1, 2, 1, 6] },
  "4": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [1, 3, 5, 7, 1] },
  "5": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [7, 4, 6, 1, 6] },
  "6": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [3, 4, 6, 5, 2] },
  "7": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [7, 1, 2, 2, 2] },
  "8": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [2, 5, 2, 5, 2] },
  "9": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [2, 5, 3, 1, 6] },
  ":": { advance: 2, boxW: 1, boxH: 4, ofsX: 0, ofsY: 0, rows: [1, 0, 0, 1] },
  ";": { advance: 3, boxW: 2, boxH: 5, ofsX: 0, ofsY: -1, rows: [1, 0, 0, 1, 2] },
  "<": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [1, 2, 4, 2, 1] },
  "=": { advance: 4, boxW: 3, boxH: 3, ofsX: 0, ofsY: 1, rows: [7, 0, 7] },
  ">": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [4, 2, 1, 2, 4] },
  "?": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [6, 1, 2, 0, 2] },
  "@": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [7, 9, 11, 8, 7] },
  "A": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [6, 9, 15, 9, 9] },
  "B": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [14, 9, 14, 9, 14] },
  "C": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [6, 9, 8, 9, 6] },
  "D": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [14, 9, 9, 9, 14] },
  "E": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [15, 8, 14, 8, 15] },
  "F": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [15, 8, 14, 8, 8] },
  "G": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [7, 8, 11, 9, 7] },
  "H": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [9, 9, 15, 9, 9] },
  "I": { advance: 2, boxW: 1, boxH: 5, ofsX: 0, ofsY: 0, rows: [1, 1, 1, 1, 1] },
  "J": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [1, 1, 1, 5, 2] },
  "K": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [9, 10, 12, 10, 9] },
  "L": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [4, 4, 4, 4, 7] },
  "M": { advance: 6, boxW: 5, boxH: 5, ofsX: 0, ofsY: 0, rows: [17, 27, 21, 17, 17] },
  "N": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [9, 13, 11, 9, 9] },
  "O": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [6, 9, 9, 9, 6] },
  "P": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [14, 9, 14, 8, 8] },
  "Q": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [6, 9, 9, 10, 5] },
  "R": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [14, 9, 14, 9, 9] },
  "S": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [7, 8, 6, 1, 14] },
  "T": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [7, 2, 2, 2, 2] },
  "U": { advance: 5, boxW: 4, boxH: 5, ofsX: 0, ofsY: 0, rows: [9, 9, 9, 9, 6] },
  "V": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [5, 5, 5, 2, 2] },
  "W": { advance: 6, boxW: 5, boxH: 5, ofsX: 0, ofsY: 0, rows: [21, 21, 21, 10, 10] },
  "X": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [5, 5, 2, 5, 5] },
  "Y": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [5, 5, 2, 2, 2] },
  "Z": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [7, 1, 2, 4, 7] },
  "[": { advance: 3, boxW: 2, boxH: 5, ofsX: 0, ofsY: 0, rows: [3, 2, 2, 2, 3] },
  "\\": { advance: 3, boxW: 2, boxH: 5, ofsX: 0, ofsY: 0, rows: [2, 2, 1, 1, 1] },
  "]": { advance: 3, boxW: 2, boxH: 5, ofsX: 0, ofsY: 0, rows: [3, 1, 1, 1, 3] },
  "^": { advance: 4, boxW: 3, boxH: 2, ofsX: 0, ofsY: 3, rows: [2, 5] },
  "_": { advance: 4, boxW: 3, boxH: 1, ofsX: 0, ofsY: 0, rows: [7] },
  "a": { advance: 4, boxW: 3, boxH: 4, ofsX: 0, ofsY: 0, rows: [3, 5, 5, 3] },
  "b": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [4, 6, 5, 5, 6] },
  "c": { advance: 4, boxW: 3, boxH: 4, ofsX: 0, ofsY: 0, rows: [3, 4, 4, 3] },
  "d": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [1, 3, 5, 5, 3] },
  "e": { advance: 4, boxW: 3, boxH: 4, ofsX: 0, ofsY: 0, rows: [2, 7, 4, 3] },
  "f": { advance: 3, boxW: 2, boxH: 5, ofsX: 0, ofsY: 0, rows: [1, 2, 3, 2, 2] },
  "g": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: -1, rows: [3, 5, 5, 3, 6] },
  "h": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [4, 6, 5, 5, 5] },
  "i": { advance: 2, boxW: 1, boxH: 5, ofsX: 0, ofsY: 0, rows: [1, 0, 1, 1, 1] },
  "j": { advance: 3, boxW: 2, boxH: 7, ofsX: 0, ofsY: -2, rows: [1, 0, 1, 1, 1, 1, 2] },
  "k": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [4, 5, 6, 5, 5] },
  "l": { advance: 2, boxW: 1, boxH: 5, ofsX: 0, ofsY: 0, rows: [1, 1, 1, 1, 1] },
  "m": { advance: 6, boxW: 5, boxH: 4, ofsX: 0, ofsY: 0, rows: [30, 21, 21, 21] },
  "n": { advance: 4, boxW: 3, boxH: 4, ofsX: 0, ofsY: 0, rows: [6, 5, 5, 5] },
  "o": { advance: 4, boxW: 3, boxH: 4, ofsX: 0, ofsY: 0, rows: [2, 5, 5, 2] },
  "p": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: -1, rows: [6, 5, 5, 6, 4] },
  "q": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: -1, rows: [3, 5, 5, 3, 1] },
  "r": { advance: 3, boxW: 2, boxH: 4, ofsX: 0, ofsY: 0, rows: [3, 2, 2, 2] },
  "s": { advance: 4, boxW: 3, boxH: 4, ofsX: 0, ofsY: 0, rows: [3, 6, 1, 6] },
  "t": { advance: 3, boxW: 2, boxH: 5, ofsX: 0, ofsY: 0, rows: [2, 3, 2, 2, 1] },
  "u": { advance: 4, boxW: 3, boxH: 4, ofsX: 0, ofsY: 0, rows: [5, 5, 5, 3] },
  "v": { advance: 4, boxW: 3, boxH: 4, ofsX: 0, ofsY: 0, rows: [5, 5, 2, 2] },
  "w": { advance: 6, boxW: 5, boxH: 4, ofsX: 0, ofsY: 0, rows: [21, 21, 10, 10] },
  "x": { advance: 4, boxW: 3, boxH: 4, ofsX: 0, ofsY: 0, rows: [5, 2, 2, 5] },
  "y": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: -1, rows: [5, 5, 5, 2, 4] },
  "z": { advance: 4, boxW: 3, boxH: 4, ofsX: 0, ofsY: 0, rows: [7, 2, 4, 7] },
  "{": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [3, 2, 4, 2, 3] },
  "|": { advance: 2, boxW: 1, boxH: 5, ofsX: 0, ofsY: 0, rows: [1, 1, 1, 1, 1] },
  "}": { advance: 4, boxW: 3, boxH: 5, ofsX: 0, ofsY: 0, rows: [6, 2, 1, 2, 6] },
  "~": { advance: 5, boxW: 4, boxH: 2, ofsX: 0, ofsY: 1, rows: [5, 10] },
  "…": { advance: 6, boxW: 5, boxH: 1, ofsX: 0, ofsY: 0, rows: [21] },
};
