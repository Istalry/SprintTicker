import zlib from 'zlib';
import { ArgumentException, ArgumentNullException } from '../../shared/dtos';

/** A decoded image: `width * height` pixels, four bytes each, RGBA, top row first. */
export interface DecodedPng {
  width: number;
  height: number;
  rgba: Buffer;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Colour types read here, by their bytes per pixel. */
const BYTES_PER_PIXEL: Record<number, number> = { 2: 3, 6: 4 };

/**
 * Decodes a PNG as the animation frames in `Animations/` are written: 8 bits
 * a channel, RGB or RGBA, not interlaced. Anything else throws an
 * ArgumentException rather than decoding wrong.
 *
 * Written here with `zlib`, as `pixel-matrix-to-png.ts` writes them, rather
 * than through Electron's `nativeImage`: the Stream Deck's icon frames are
 * built in a service the tests run in plain Node, and a dependency for
 * sixteen-pixel squares would ship in the app for nothing.
 */
export function decodePng(png: Buffer): DecodedPng {
  if (!png) throw new ArgumentNullException('png');
  if (png.length < SIGNATURE.length || !png.subarray(0, SIGNATURE.length).equals(SIGNATURE)) {
    throw new ArgumentException('Not a PNG.', 'png');
  }

  let width = 0;
  let height = 0;
  let bytesPerPixel = 0;
  const idat: Buffer[] = [];
  for (let offset = SIGNATURE.length; offset + 8 <= png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [bitDepth, colourType, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
      bytesPerPixel = BYTES_PER_PIXEL[colourType] ?? 0;
      if (bitDepth !== 8 || !bytesPerPixel || interlace !== 0) {
        throw new ArgumentException(`Unsupported PNG: depth ${bitDepth}, colour type ${colourType}, interlace ${interlace}.`, 'png');
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!width || !height || !bytesPerPixel) throw new ArgumentException('PNG has no header.', 'png');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bytesPerPixel;
  if (raw.length < height * (stride + 1)) throw new ArgumentException('PNG data is truncated.', 'png');

  const rgba = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const left = i >= bytesPerPixel ? line[i - bytesPerPixel] : 0;
      const up = previous[i];
      const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
      line[i] = (line[i] + predictor(filter, left, up, upLeft)) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const from = x * bytesPerPixel;
      const to = (y * width + x) * 4;
      rgba[to] = line[from];
      rgba[to + 1] = line[from + 1];
      rgba[to + 2] = line[from + 2];
      rgba[to + 3] = bytesPerPixel === 4 ? line[from + 3] : 0xff;
    }
    previous = line;
  }
  return { width, height, rgba };
}

/** What a scanline's filter adds back to each byte (PNG spec, section 9). */
function predictor(filter: number, left: number, up: number, upLeft: number): number {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4: {
      const p = left + up - upLeft;
      const pa = Math.abs(p - left);
      const pb = Math.abs(p - up);
      const pc = Math.abs(p - upLeft);
      return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
    }
    default:
      throw new ArgumentException(`Unknown PNG filter ${filter}.`, 'png');
  }
}
