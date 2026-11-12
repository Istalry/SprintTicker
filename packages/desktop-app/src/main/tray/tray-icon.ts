import { crc32, deflateSync } from 'node:zlib';
import type { TrayMark } from '../../shared/tray-state';
import { SPRINT_SMALL } from '../../shared/fonts/sprint-small';

/**
 * The tray icon, drawn in code (redesign P12b): a disc in the state's colour
 * with a dark mark on it, and the entries waiting as a number in a corner.
 * Drawn rather than shipped as files in `build/`, because the number is laid
 * over whichever mark shows: five marks times ten numbers is no set of files
 * anyone would keep in step.
 */

/**
 * The window's colour tokens (`tailwind.config.js`), which mean the same
 * here: green is timing, amber waits on the user, grey is nothing.
 * `tray-icon.test.ts` holds them equal to the config.
 */
export const TRAY_COLOURS = {
  green: '#22C55E',
  amber: '#F59E0B',
  grey: '#A1A1A8',
  ink: '#0F0F10',
  paper: '#EDEDEF'
} as const;

/** How often the icon is read again while nothing else asks: the mode, the hours, the queue. */
export const TRAY_ICON_REFRESH_MS = 5_000;

/** The sizes drawn: 16 px for 100 % scaling, 32 px for 200 %; Windows scales between. */
export const TRAY_ICON_SIZES = [16, 32] as const;

type Rgb = readonly [number, number, number];
type Point = readonly [number, number];

const rgb = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

const DISC: Record<TrayMark, string> = {
  timing: TRAY_COLOURS.green,
  interruption: TRAY_COLOURS.amber,
  paused: TRAY_COLOURS.amber,
  'nothing-timing': TRAY_COLOURS.amber,
  'off-hours': TRAY_COLOURS.grey
};

/** Each mark in unit coordinates, the icon being 1 × 1. */
const insidePolygon = (x: number, y: number, points: readonly Point[]): boolean => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const insideRect = (x: number, y: number, x0: number, x1: number, y0: number, y1: number) => x >= x0 && x < x1 && y >= y0 && y < y1;
const distance = (x: number, y: number, cx: number, cy: number) => Math.hypot(x - cx, y - cy);

const PLAY: Point[] = [[0.38, 0.27], [0.38, 0.73], [0.76, 0.5]];
const BOLT: Point[] = [[0.58, 0.13], [0.27, 0.56], [0.47, 0.56], [0.4, 0.87], [0.73, 0.42], [0.53, 0.42], [0.63, 0.13]];

/** Whether the mark covers this point, for the marks drawn in ink on the disc. */
function markCovers(mark: TrayMark, x: number, y: number): boolean {
  switch (mark) {
    case 'timing':
      return insidePolygon(x, y, PLAY);
    case 'interruption':
      return insidePolygon(x, y, BOLT);
    case 'paused':
      return insideRect(x, y, 0.31, 0.43, 0.27, 0.73) || insideRect(x, y, 0.57, 0.69, 0.27, 0.73);
    case 'nothing-timing':
      return insideRect(x, y, 0.44, 0.56, 0.21, 0.58) || distance(x, y, 0.5, 0.73) < 0.07;
    default:
      return false;
  }
}

/** One layer's coverage of a point: the disc, or for `off-hours` a ring with nothing in it. */
function discCovers(mark: TrayMark, x: number, y: number): boolean {
  const d = distance(x, y, 0.5, 0.5);
  return mark === 'off-hours' ? d < 0.47 && d >= 0.33 : d < 0.48;
}

const SUPERSAMPLE = 4;

/**
 * The icon at `size` px, RGBA with straight alpha, rows top first. Shapes are
 * supersampled 4 × 4, so the edges are soft at 16 px; the number is the
 * app's own pixel font, laid on the pixel grid, where it stays sharp.
 */
export function drawTrayIcon(mark: TrayMark, badge: string | null, size: number): Uint8Array {
  if (!Number.isInteger(size) || size < 8) throw new RangeError(`Not an icon size: ${size}`);
  const pixels = new Uint8Array(size * size * 4);
  const disc = rgb(DISC[mark]);
  const ink = rgb(TRAY_COLOURS.ink);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let discHits = 0;
      let markHits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          if (!discCovers(mark, x, y)) continue;
          discHits++;
          if (markCovers(mark, x, y)) markHits++;
        }
      }
      if (discHits === 0) continue;
      const samples = SUPERSAMPLE * SUPERSAMPLE;
      // The mark is cut out of the disc in ink: blend the two by coverage.
      const t = markHits / discHits;
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(disc[c] * (1 - t) + ink[c] * t);
      pixels[i + 3] = Math.round((255 * discHits) / samples);
    }
  }

  if (badge) drawBadge(pixels, size, badge);
  return pixels;
}

/**
 * The number in the bottom-right corner: paper digits on an ink plate, one
 * pixel round them and no more -- at 16 px a wider plate hid the mark (the
 * ! lost its dot). The plate's ink reads on a light taskbar, and the disc
 * it sits on keeps it apart from a dark one.
 */
function drawBadge(pixels: Uint8Array, size: number, text: string): void {
  const scale = Math.max(1, Math.floor(size / 16));
  const font = SPRINT_SMALL;
  const glyphs = [...text].map(ch => font.glyphs[ch]).filter(Boolean);
  const textWidth = glyphs.reduce((sum, g) => sum + g.width, 0) + font.letterSpacing * (glyphs.length - 1);
  const plateWidth = (textWidth + 2) * scale;
  const plateHeight = (font.ascent + 2) * scale;
  const left = size - plateWidth;
  const top = size - plateHeight;
  const paper = rgb(TRAY_COLOURS.paper);
  const ink = rgb(TRAY_COLOURS.ink);

  const put = (x: number, y: number, colour: Rgb) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    pixels[i] = colour[0];
    pixels[i + 1] = colour[1];
    pixels[i + 2] = colour[2];
    pixels[i + 3] = 255;
  };

  for (let y = top; y < size; y++) {
    for (let x = left; x < size; x++) put(x, y, ink);
  }

  let cursor = left + scale;
  const baseTop = top + scale;
  for (const glyph of glyphs) {
    for (let row = 0; row < font.ascent; row++) {
      const bits = glyph.rows[row];
      for (let col = 0; col < glyph.width; col++) {
        if (!(bits & (1 << (glyph.width - 1 - col)))) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) put(cursor + col * scale + dx, baseTop + row * scale + dy, paper);
        }
      }
    }
    cursor += (glyph.width + font.letterSpacing) * scale;
  }
}

/**
 * A PNG of RGBA pixels, for `nativeImage.createFromBuffer`: a format every
 * Electron reads, where a raw bitmap's channel order and alpha are the
 * platform's. Filter 0 on every row; the icons are a few hundred bytes.
 */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) throw new RangeError('Pixel data does not match the size.');
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
