import { deflateSync } from 'zlib';

/**
 * Encodes a 72×16 pixel matrix into a valid PNG binary buffer using only Node.js built-ins.
 * Each cell in the matrix is either a hex color string ('#RRGGBB' or '#RRGGBBAA') or null (black).
 * The output is a 24-bit RGB PNG with no alpha channel, matching the BUSY Bar firmware expectation.
 */
export function encodeMatrixToPng(
  matrix: (string | null)[][],
  width: number = 72,
  height: number = 16
): Buffer {
  const rawRows: Buffer[] = [];

  for (let y = 0; y < height; y++) {
    // Each row: filter byte (0 = None) + 3 bytes per pixel (RGB)
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0; // filter type: None

    for (let x = 0; x < width; x++) {
      const colorStr = matrix[y]?.[x] ?? null;
      const { r, g, b } = parseHexColor(colorStr);
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }

    rawRows.push(row);
  }

  const rawData = Buffer.concat(rawRows);
  const compressedData = deflateSync(rawData, { level: 6 });

  return assemblePng(width, height, compressedData);
}

/**
 * Parses a hex color string into its RGB components.
 * Accepts '#RRGGBB', '#RRGGBBAA', or null (returns black).
 */
function parseHexColor(hex: string | null): { r: number; g: number; b: number } {
  if (!hex || hex.length < 7) return { r: 0, g: 0, b: 0 };
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.substring(0, 2), 16) || 0,
    g: parseInt(clean.substring(2, 4), 16) || 0,
    b: parseInt(clean.substring(4, 6), 16) || 0
  };
}

/**
 * Assembles a valid PNG binary from width, height, and zlib-compressed IDAT data.
 */
function assemblePng(width: number, height: number, compressedData: Buffer): Buffer {
  const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk: width(4) height(4) bitDepth(1) colorType(1=RGB=2) compression(1) filter(1) interlace(1)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 2;   // color type: RGB
  ihdrData[10] = 0;  // compression: deflate
  ihdrData[11] = 0;  // filter: adaptive
  ihdrData[12] = 0;  // interlace: none

  const ihdrChunk = buildChunk('IHDR', ihdrData);
  const idatChunk = buildChunk('IDAT', compressedData);
  const iendChunk = buildChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([PNG_SIGNATURE, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Builds a valid PNG chunk: length(4) + type(4) + data + CRC(4).
 */
function buildChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = crc32(crcInput);
  const crcBytes = Buffer.alloc(4);
  crcBytes.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeBytes, data, crcBytes]);
}

/** CRC32 table and computation per PNG spec. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
