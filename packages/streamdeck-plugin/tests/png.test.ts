import { crc32, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { encodePng, ledTilePng } from '../src/assets/png';

interface Chunk {
  type: string;
  data: Buffer;
  crcOk: boolean;
}

/** The chunks of a PNG, each with whether its checksum holds. */
function chunksOf(png: Buffer): Chunk[] {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: Chunk[] = [];
  let at = 8;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const typed = png.subarray(at + 4, at + 8 + length);
    const crc = png.readUInt32BE(at + 8 + length);
    chunks.push({ type: typed.subarray(0, 4).toString('ascii'), data: typed.subarray(4), crcOk: crc32(typed) === crc });
    at += 12 + length;
  }
  return chunks;
}

/** The RGBA bytes back out of a PNG this encoder wrote: no filter on any row. */
function decode(png: Buffer): { width: number; height: number; rgba: Buffer } {
  const chunks = chunksOf(png);
  const header = chunks[0].data;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const rows = inflateSync(Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data)));
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    expect(rows[y * (width * 4 + 1)]).toBe(0);
    rows.copy(rgba, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1));
  }
  return { width, height, rgba };
}

describe('encodePng', () => {
  it('EncodePng_TwoByTwo_ChunksInOrderWithValidChecksums', () => {
    const png = encodePng(2, 2, new Uint8Array(16));
    const chunks = chunksOf(png);
    expect(chunks.map(c => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(chunks.every(c => c.crcOk)).toBe(true);
    expect([...chunks[0].data.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
  });

  it('EncodePng_Pixels_RoundTrip', () => {
    const rgba = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 1, 2, 3, 4, 9, 9, 9, 9, 7, 7, 7, 7]);
    const decoded = decode(encodePng(3, 2, rgba));
    expect(decoded).toMatchObject({ width: 3, height: 2 });
    expect([...decoded.rgba]).toEqual([...rgba]);
  });

  it('EncodePng_WrongByteCount_Throws', () => {
    expect(() => encodePng(2, 2, new Uint8Array(15))).toThrow(/Expected 16 bytes/);
  });
});

describe('ledTilePng', () => {
  const lit = '#FF0000';
  const pixels = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => (x === 7 && y === 7 ? lit : null)));

  it('LedTilePng_Size_IsTheSizeAsked', () => {
    expect(decode(ledTilePng(pixels, 64))).toMatchObject({ width: 64, height: 64 });
  });

  it('LedTilePng_Corners_TransparentAndTheMiddleOpaque', () => {
    const size = 64;
    const { rgba } = decode(ledTilePng(pixels, size));
    const at = (x: number, y: number) => [...rgba.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];
    expect(at(0, 0)[3]).toBe(0);
    expect(at(size - 1, size - 1)[3]).toBe(0);
    expect(at(size / 2, size / 2)[3]).toBe(255);
  });

  it('LedTilePng_LitLed_DrawnInItsColour', () => {
    const size = 160;
    const { rgba } = decode(ledTilePng(pixels, size));
    // LED (7, 7)'s centre: a margin of size/8, then 7.5 cells of (size*0.75)/16.
    const centre = Math.floor(size / 8 + 7.5 * ((size * 0.75) / 16));
    const i = (centre * size + centre) * 4;
    expect([...rgba.subarray(i, i + 4)]).toEqual([255, 0, 0, 255]);
  });
});
