import type { BitmapIconId } from './dtos';

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
/**
 * Full-screen animations, by folder name under `Animations/`.
 *
 * `AnimationPlayer` resolves a name to `Animations/<name>/<name>/` and plays
 * `<name>.anim` on the device when it is there, streaming the PNG frames
 * otherwise. A name with no folder behind it fails silently -- a warning in the
 * log and an empty panel -- so `animation-assets.test.ts` checks every entry
 * here against the repository.
 *
 * All four are our own, drawn in `packages/anim-studio/scenes/`. Each has its
 * own plate colour -- teal, purple, blue, green -- so the mode reads at a
 * glance.
 */
export const FRONT_ANIMATIONS = {
  LUNCH: 'lunch_sandwich_72x16',
  AWAY: 'away_coffee_72x16',
  MEETING: 'meeting_table_72x16',
  /** Played once, not looped: see TASK_DONE_DISPLAY_SECONDS. */
  TASK_DONE: 'task_done_72x16',
} as const;

/**
 * How long the task-done scene holds the display before the session returns.
 *
 * Longer than the scene itself (3 s) on purpose: a one-shot `.anim` holds its
 * last frame on the device (measured on firmware 1.2.4), so the extra second
 * shows the finished badge at rest rather than cutting away mid-fall.
 */
export const TASK_DONE_DISPLAY_SECONDS = 4;

/**
 * Icons that animate on the device, by the static bitmap they stand over.
 *
 * Each value is a 16x16 animation under `Animations/<name>/<name>/`. The screen
 * still draws the static bitmap into its frame; `IconAnimator` plays the
 * `.anim` above it, so anything missing here, or refused by the device, shows
 * the static icon instead. `animation-assets.test.ts` checks every entry.
 *
 * App logos are absent, as the applications' own marks, with one exception:
 * OpenProject, the tracker this app is built around, asked for by the user.
 * Its animation only passes a light across it -- the shape and the brand blue
 * never change -- which is as far as a mark that is not ours should go.
 */
export const ANIMATED_ICONS: Partial<Record<BitmapIconId, string>> = {
  // Work in progress: moves steadily, since a pause reads as a stall.
  compiling: 'icon_gear_16x16',
  playmode: 'icon_playmode_16x16',
  hammer: 'icon_hammer_16x16',
  bulb: 'icon_bulb_16x16',
  // Events and prompts: act, then rest.
  error: 'icon_warning_16x16',
  bell: 'icon_bell_16x16',
  clock: 'icon_clock_16x16',
  burger: 'icon_burger_16x16',
  checkmark: 'icon_check_16x16',
  openproject: 'icon_openproject_16x16',
};

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
  }

  // No font metrics here. Both rows are proportional, so there is no stride to
  // share: the fonts and their per-glyph widths are in `fonts/`, and the
  // arithmetic is in `proportional-text.ts`.
} as const;
