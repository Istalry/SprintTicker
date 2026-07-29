/**
 * Constants governing hardware rendering layouts, font metrics, default colors,
 * animation rates, and pixel grid dimensions for the BUSY Bar displays.
 */
export const DISPLAY_CONSTANTS = {
  FRONT_GRID_WIDTH: 72,
  FRONT_GRID_HEIGHT: 16,

  REAR_OLED_WIDTH: 160,
  REAR_OLED_HEIGHT: 80,

  DEFAULT_SCROLL_RATE: 60,

  LAYOUT_OFFSETS: {
    TASK_PROJECT_X: 16,
    TASK_PROJECT_Y: 0,
    TASK_TITLE_X: 16,
    TASK_TITLE_Y: 8,
    TEXT_FIELD_WIDTH: 56,
  },

  COLORS: {
    PRIMARY_GREEN: '#10B981FF',
    PAUSE_AMBER: '#FFFF00FF',
    BUILD_BLUE: '#3B82F6FF',
    ERROR_RED: '#FF0000FF',
    DISCORD_PURPLE: '#8B5CF6FF',
    WHITE: '#FFFFFFFF',
  }
} as const;
