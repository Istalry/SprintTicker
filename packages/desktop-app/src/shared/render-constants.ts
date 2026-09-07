/**
 * Physical dimensions and layout metrics for the two BUSY Bar displays.
 *
 * Shared because both sides need the same numbers: the main process renders
 * into a 72x16 pixel canvas, and the renderer's emulator has to size its
 * canvases identically or the preview stops matching the device.
 *
 * Colour strings are 8-digit #RRGGBBAA. The hardware contract requires exactly
 * 8 hex digits and rejects the entire draw otherwise, so anything destined for
 * a draw payload must keep the alpha pair.
 */
export const DISPLAY_CONSTANTS = {
  /** Front RGB LED matrix. */
  FRONT_GRID_WIDTH: 72,
  FRONT_GRID_HEIGHT: 16,

  /**
   * Rear greyscale OLED.
   *
   * Preview only for now: DisplayRenderer.transmitFrame sends the front matrix
   * and nothing else, so these dimensions describe what the emulator draws.
   */
  REAR_OLED_WIDTH: 160,
  REAR_OLED_HEIGHT: 80,

  DEFAULT_SCROLL_RATE: 60,

  /**
   * Standard "16px icon, two text rows" front layout.
   *
   * The icon occupies x=0..15, leaving x=17..71 for text after a one-pixel
   * gutter -- so text starts at 17 and is 55 wide, not 16 and 56. The previous
   * values were off by one in both directions and had drifted from the code.
   */
  LAYOUT_OFFSETS: {
    ICON_SIZE: 16,
    TEXT_X: 17,
    ROW0_Y: 0,
    ROW1_Y: 8,
    TEXT_FIELD_WIDTH: 55,
  },

  /**
   * Glyph metrics for the two built-in fonts.
   *
   * Shared because two places need the same arithmetic: the notification text
   * composer decides how many characters fit a field *before* truncating, and
   * PixelCanvas lays those characters out. A private copy of 5 and 4 in each is
   * how a row gets truncated twice -- once to the composer's idea of the
   * capacity and again to the canvas's -- and the second cut lands mid-word
   * with no marker.
   *
   * A glyph's stride includes its trailing gap, but the last glyph on a row
   * does not need that gap: it may hang off the end of the field. Capacity is
   * therefore floor((fieldWidth + 1) / stride), not floor(fieldWidth / stride).
   */
  FONT_METRICS: {
    /** 4x6 font, used for row 0: 4px glyph + 1px gap. */
    ROW0: { GLYPH_WIDTH: 4, STRIDE_X: 5, ROWS: 6 },
    /** 3x5 font, used for row 1: 3px glyph + 1px gap. */
    ROW1: { GLYPH_WIDTH: 3, STRIDE_X: 4, ROWS: 5 }
  }
} as const;
