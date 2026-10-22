import { crc32, deflateSync } from 'node:zlib';

/**
 * Just enough PNG to write the plugin's icon, which the manifest wants as a
 * PNG and nothing else: 8-bit RGBA, no filtering. Node's zlib does the
 * compression and the checksums, so no image library joins the build.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

/** A PNG of `width` x `height` pixels from RGBA bytes, row by row from the top. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error(`Expected ${width * height * 4} bytes of RGBA, got ${rgba.length}.`);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  // Compression, filter and interlace methods: all 0.
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const start = y * (width * 4 + 1);
    rows[start] = 0; // no filter on this row
    rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), start + 1);
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

function hexToRgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1, 7), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/**
 * The plugin's icon: a 16x16 bitmap of the bar's, drawn as round LEDs on a
 * dark rounded tile, `size` pixels across. Supersampled 4x4, so the edges
 * are smooth at 256 and at 512.
 */
export function ledTilePng(pixels: (string | null)[][], size: number): Buffer {
  const background = hexToRgb('#0F172A');
  const unlit = hexToRgb('#1E293B');
  const margin = size * 0.125;
  const cell = (size - 2 * margin) / 16;
  const radius = size * 0.18;
  const ledRadius = cell * 0.42;
  const SAMPLES = 4;
  const rgba = new Uint8Array(size * size * 4);

  const inTile = (x: number, y: number): boolean => {
    const dx = Math.max(radius - x, 0, x - (size - radius));
    const dy = Math.max(radius - y, 0, y - (size - radius));
    return dx * dx + dy * dy <= radius * radius;
  };
  const colourAt = (x: number, y: number): [number, number, number] | null => {
    if (!inTile(x, y)) return null;
    const ix = Math.floor((x - margin) / cell);
    const iy = Math.floor((y - margin) / cell);
    if (ix < 0 || iy < 0 || ix > 15 || iy > 15) return background;
    const cx = margin + (ix + 0.5) * cell;
    const cy = margin + (iy + 0.5) * cell;
    if ((x - cx) ** 2 + (y - cy) ** 2 > ledRadius ** 2) return background;
    const lit = pixels[iy]?.[ix];
    return lit ? hexToRgb(lit) : unlit;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const c = colourAt(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const i = (y * size + x) * 4;
      if (a > 0) {
        rgba[i] = Math.round(r / a);
        rgba[i + 1] = Math.round(g / a);
        rgba[i + 2] = Math.round(b / a);
      }
      rgba[i + 3] = Math.round((a / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return encodePng(size, size, rgba);
}
