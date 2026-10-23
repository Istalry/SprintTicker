import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { decodePng } from '../src/main/hardware/png-decode';
import { encodeMatrixToPng } from '../src/main/hardware/pixel-matrix-to-png';
import { ArgumentException } from '../src/shared/dtos';

/** A PNG chunk: length, type, data, and a CRC the decoder does not check. */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}

/** A PNG of the given scanlines, each already filtered and led by its filter byte. */
function png(width: number, height: number, scanlines: Buffer, { depth = 8, colourType = 6, interlace = 0 } = {}): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = colourType;
  ihdr[12] = interlace;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Filters one RGBA scanline the way an encoder would, so the decoder must undo it. */
function filtered(filter: number, line: number[], previous: number[]): number[] {
  const bpp = 4;
  return line.map((value, i) => {
    const left = i >= bpp ? line[i - bpp] : 0;
    const up = previous[i] ?? 0;
    const upLeft = i >= bpp ? previous[i - bpp] ?? 0 : 0;
    let predicted = 0;
    if (filter === 1) predicted = left;
    else if (filter === 2) predicted = up;
    else if (filter === 3) predicted = (left + up) >> 1;
    else if (filter === 4) {
      const p = left + up - upLeft;
      const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
      predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
    }
    return (value - predicted + 256) & 0xff;
  });
}

describe('decodePng', () => {
  it('DecodePng_OurOwnRgbEncoding_RoundTrips', () => {
    const matrix = [
      ['#FF0000', '#00FF00'],
      ['#0000FF', null]
    ];
    const { width, height, rgba } = decodePng(encodeMatrixToPng(matrix, 2, 2));
    expect([width, height]).toEqual([2, 2]);
    expect([...rgba]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255]);
  });

  it('DecodePng_EveryFilter_UndoneRowByRow', () => {
    // Five rows of three RGBA pixels, each row under another filter.
    const rows = [0, 1, 2, 3, 4].map(r => Array.from({ length: 12 }, (_, i) => (r * 37 + i * 23 + (i % 4 === 3 ? 200 : 0)) & 0xff));
    const scanlines = Buffer.from(rows.flatMap((line, r) => [r, ...filtered(r, line, rows[r - 1] ?? [])]));
    expect([...decodePng(png(3, 5, scanlines)).rgba]).toEqual(rows.flat());
  });

  it('DecodePng_ARealIconFrame_IsSixteenSquare', () => {
    // As Pillow writes them, with whatever filters it chose. A copy of the
    // stopwatch's first frame, not the file in Animations/: those are Git LFS
    // objects, and the quality workflow checks out without LFS, where each is
    // a 130-byte pointer.
    const frame = path.join(__dirname, 'fixtures/icon-stopwatch-frame-0.png');
    const { width, height, rgba } = decodePng(fs.readFileSync(frame));
    expect([width, height, rgba.length]).toEqual([16, 16, 1024]);
  });

  it.each([
    ['not a PNG', Buffer.from('GIF89a........')],
    ['16 bits a channel', png(1, 1, Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0]), { depth: 16 })],
    ['a palette', png(1, 1, Buffer.from([0, 0]), { colourType: 3 })],
    ['interlaced', png(1, 1, Buffer.from([0, 1, 2, 3, 4]), { interlace: 1 })],
    ['an unknown filter', png(1, 1, Buffer.from([9, 1, 2, 3, 4]))],
    ['truncated data', png(2, 2, Buffer.from([0, 1, 2, 3, 4]))]
  ])('DecodePng_%s_ThrowsRatherThanGuess', (_name, buffer) => {
    expect(() => decodePng(buffer)).toThrow(ArgumentException);
  });

  it('DecodePng_Nothing_Throws', () => {
    expect(() => decodePng(null as never)).toThrow();
  });
});
