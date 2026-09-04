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

  COLORS: {
    PRIMARY_GREEN: '#10B981FF',
    PAUSE_AMBER: '#FFFF00FF',
    BUILD_BLUE: '#3B82F6FF',
    ERROR_RED: '#FF0000FF',
    WHITE: '#FFFFFFFF',
  }
} as const;
