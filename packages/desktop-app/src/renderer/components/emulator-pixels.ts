/** A decoded image: `rgba` is `width * height * 4` bytes, row by row. */
export interface DecodedImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

const hex = (n: number): string => n.toString(16).padStart(2, '0');

/**
 * Lays an image's pixels into the emulator's LED buffer at (x, y).
 *
 * Images used to be drawn over the finished matrix as a crisp picture, while
 * rectangles and bitmaps went through the LEDs -- so an animated icon, whose
 * still frame is a bitmap and whose moving frames are images, flickered
 * between an LED and a flat picture of one (seen on 2026-10-15). Through the
 * buffer, every element is a lit or unlit LED.
 *
 * A transparent pixel leaves what is beneath it, as on the device. An opaque
 * black one is an LED turned off, so it clears what is beneath; a translucent
 * one lights the LED dimmer, by its alpha.
 */
export function compositeImage(buffer: (string | null)[][], image: DecodedImage, x: number, y: number): void {
  const rows = buffer.length;
  const cols = rows > 0 ? buffer[0].length : 0;
  for (let row = 0; row < image.height; row++) {
    const by = y + row;
    if (by < 0 || by >= rows) continue;
    for (let col = 0; col < image.width; col++) {
      const bx = x + col;
      if (bx < 0 || bx >= cols) continue;
      const i = (row * image.width + col) * 4;
      const alpha = image.rgba[i + 3];
      if (alpha === 0) continue;
      const scale = alpha / 255;
      const [r, g, b] = [image.rgba[i], image.rgba[i + 1], image.rgba[i + 2]].map(c => Math.round(c * scale));
      buffer[by][bx] = r === 0 && g === 0 && b === 0 ? null : `#${hex(r)}${hex(g)}${hex(b)}FF`;
    }
  }
}

/** Below this luminance an LED shows its colour alone: no white core. */
const CORE_THRESHOLD = 0.15;
/** The luminance span over which the core comes up to full strength. */
const CORE_RAMP = 0.6;

/**
 * How bright a lit LED is, 0 to 1, from its `#RRGGBB[AA]` colour.
 *
 * The emulator gave every lit LED the same white core and bloom, so a dark
 * pixel -- a scene's background, a deep teal -- looked as bright as white
 * text (seen on 2026-10-15). On the panel a dim colour is a dim LED.
 */
export function ledLuminance(color: string): number {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color);
  if (!m) return 1;
  const [r, g, b] = [m[1], m[2], m[3]].map(c => parseInt(c, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The strength of an LED's white core, 0 to 1: none for a dim colour. */
export function ledCoreAlpha(color: string): number {
  return Math.min(1, Math.max(0, (ledLuminance(color) - CORE_THRESHOLD) / CORE_RAMP));
}
