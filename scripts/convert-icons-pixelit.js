/**
 * PixelIt-Inspired PNG to 16x16 Pixel Art Matrix Converter.
 * Programmatically parses, downsamples, and quantizes high-resolution PNG reference icons
 * in `icon reference/` into 16x16 matrix arrays for physical and emulated LED matrix displays.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * Pure Node.js PNG Decoder supporting RGBA (Color Type 6) and RGB (Color Type 2).
 */
function decodePNG(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.slice(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`File ${filePath} is not a valid PNG image.`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buf.length) {
    const chunkLength = buf.readUInt32BE(offset);
    const chunkType = buf.slice(offset + 4, offset + 8).toString('ascii');

    if (chunkType === 'IHDR') {
      width = buf.readUInt32BE(offset + 8);
      height = buf.readUInt32BE(offset + 12);
      bitDepth = buf.readUInt8(offset + 16);
      colorType = buf.readUInt8(offset + 17);
    } else if (chunkType === 'IDAT') {
      idatChunks.push(buf.slice(offset + 8, offset + 8 + chunkLength));
    } else if (chunkType === 'IEND') {
      break;
    }

    offset += 12 + chunkLength;
  }

  const compressedData = Buffer.concat(idatChunks);
  const decompressed = zlib.inflateSync(compressedData);

  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 4;
  const stroke = width * bpp;
  const pixels = Buffer.alloc(width * height * 4);

  let prevRow = Buffer.alloc(stroke);
  let readIdx = 0;

  for (let y = 0; y < height; y++) {
    const filterType = decompressed[readIdx++];
    const currentRow = Buffer.alloc(stroke);

    for (let i = 0; i < stroke; i++) {
      const raw = decompressed[readIdx++];
      const a = i >= bpp ? currentRow[i - bpp] : 0;
      const b = prevRow[i];
      const c = i >= bpp ? prevRow[i - bpp] : 0;

      let val = raw;
      if (filterType === 1) val = (raw + a) & 0xff;
      else if (filterType === 2) val = (raw + b) & 0xff;
      else if (filterType === 3) val = (raw + Math.floor((a + b) / 2)) & 0xff;
      else if (filterType === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        val = (raw + pr) & 0xff;
      }
      currentRow[i] = val;
    }

    for (let x = 0; x < width; x++) {
      const srcIdx = x * bpp;
      const dstIdx = (y * width + x) * 4;

      if (bpp === 4) {
        pixels[dstIdx] = currentRow[srcIdx];
        pixels[dstIdx + 1] = currentRow[srcIdx + 1];
        pixels[dstIdx + 2] = currentRow[srcIdx + 2];
        pixels[dstIdx + 3] = currentRow[srcIdx + 3];
      } else {
        pixels[dstIdx] = currentRow[srcIdx];
        pixels[dstIdx + 1] = currentRow[srcIdx + 1];
        pixels[dstIdx + 2] = currentRow[srcIdx + 2];
        pixels[dstIdx + 3] = 255;
      }
    }

    prevRow = currentRow;
  }

  return { width, height, pixels };
}

/**
 * PixelIt Block-Downsampling Engine.
 * Downscales source pixels into a 16x16 matrix with alpha thresholding and color quantization.
 */
function pixelitTo16x16(pngData) {
  const { width, height, pixels } = pngData;
  const targetSize = 16;
  const blockW = width / targetSize;
  const blockH = height / targetSize;

  const matrix = Array.from({ length: targetSize }, () => Array(targetSize).fill(null));

  for (let gy = 0; gy < targetSize; gy++) {
    for (let gx = 0; gx < targetSize; gx++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0, count = 0;

      const startX = Math.floor(gx * blockW);
      const endX = Math.min(width, Math.floor((gx + 1) * blockW));
      const startY = Math.floor(gy * blockH);
      const endY = Math.min(height, Math.floor((gy + 1) * blockH));

      for (let sy = startY; sy < endY; sy++) {
        for (let sx = startX; sx < endX; sx++) {
          const idx = (sy * width + sx) * 4;
          const a = pixels[idx + 3];
          if (a > 40) {
            rSum += pixels[idx];
            gSum += pixels[idx + 1];
            bSum += pixels[idx + 2];
            aSum += a;
            count++;
          }
        }
      }

      if (count > 0 && (aSum / count) > 60) {
        const avgR = Math.round(rSum / count);
        const avgG = Math.round(gSum / count);
        const avgB = Math.round(bSum / count);
        const hex = '#' + [avgR, avgG, avgB].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
        matrix[gy][gx] = hex;
      } else {
        matrix[gy][gx] = null;
      }
    }
  }

  return matrix;
}

function matrixToTS(exportName, matrix, comment) {
  const lines = [];
  lines.push(`// ${comment}`);
  lines.push(`export const ${exportName}: (string | null)[][] = [`);
  matrix.forEach((row, idx) => {
    const rowStr = row.map(val => (val === null ? 'null' : `'${val}'`)).join(', ');
    const isLast = idx === matrix.length - 1;
    lines.push(`  [${rowStr}]${isLast ? '' : ','}`);
  });
  lines.push(`];\n`);
  return lines.join('\n');
}

/**
 * Main execution function processing all reference PNG icons in `icon reference/`
 * and updating `packages/desktop-app/src/main/hardware/pixel-bitmaps.ts`.
 */
function processAllIcons() {
  const iconDir = path.resolve(__dirname, '../icon reference');
  if (!fs.existsSync(iconDir)) {
    console.error('Icon reference directory not found:', iconDir);
    process.exit(1);
  }

  const files = fs.readdirSync(iconDir).filter(f => f.endsWith('.png'));
  console.log(`Processing ${files.length} reference icons using PixelIt downsampling...`);

  const fileToExport = [
    { file: 'Slack_icon_2019.png', exportName: 'SLACK_16X16_BITMAP', comment: '💬 Slack 16x16 PixelIt Bitmap' },
    { file: 'discord-color-icon.png', exportName: 'DISCORD_16X16_BITMAP', comment: '🎮 Discord Clyde 16x16 PixelIt Bitmap' },
    { file: 'Gmail_icon_(2020).png', exportName: 'GMAIL_16X16_BITMAP', comment: '✉️ Gmail Envelope 16x16 PixelIt Bitmap' },
    { file: 'unity-game-engine-icon.png', exportName: 'UNITY_16X16_BITMAP', comment: '🕹️ Unity 3D Cube 16x16 PixelIt Bitmap' },
    { file: 'lunch_icon.png', exportName: 'BURGER_16X16_BITMAP', comment: '🍔 Lunch Burger 16x16 PixelIt Bitmap' },
    { file: 'away_Icon.png', exportName: 'CLOCK_16X16_BITMAP', comment: '⏰ Away Clock 16x16 PixelIt Bitmap' },
    { file: 'pause-button-red-icon.png', exportName: 'PAUSE_16X16_BITMAP', comment: '⏸️ Pause Task 16x16 PixelIt Bitmap' },
    { file: 'resume_icon.png', exportName: 'PLAY_16X16_BITMAP', comment: '▶️ Resume Task 16x16 PixelIt Bitmap' },
    { file: 'stop_task_Icon.png', exportName: 'STOP_16X16_BITMAP', comment: '⏹️ Stop Task 16x16 PixelIt Bitmap' },
    { file: 'orange-error-icon-0.png', exportName: 'ERROR_16X16_BITMAP', comment: '⚠️ Unity Exception Error 16x16 PixelIt Bitmap' },
    { file: 'compiling_icon.png', exportName: 'COMPILING_16X16_BITMAP', comment: '⚡ Unity Compiling 16x16 PixelIt Bitmap' },
    { file: 'play_mode_icon.png', exportName: 'PLAYMODE_16X16_BITMAP', comment: '🔴 Unity Play Mode ON AIR 16x16 PixelIt Bitmap' }
  ];

  const generatedTSBlocks = [];

  fileToExport.forEach(({ file, exportName, comment }) => {
    const fullPath = path.join(iconDir, file);
    try {
      const pngData = decodePNG(fullPath);
      const matrix = pixelitTo16x16(pngData);
      generatedTSBlocks.push(matrixToTS(exportName, matrix, comment));
      console.log(`✓ Processed ${file} -> ${exportName} (16x16)`);
    } catch (err) {
      console.error(`✕ Failed to process ${file}:`, err.message);
    }
  });

  updatePixelBitmapsFile(generatedTSBlocks);
}

function updatePixelBitmapsFile(tsBlocks) {
  const targetPath = path.resolve(__dirname, '../packages/desktop-app/src/main/hardware/pixel-bitmaps.ts');
  const existingContent = fs.readFileSync(targetPath, 'utf8');

  // Preserve WAVE_16X16_BITMAP
  const waveStart = existingContent.indexOf('export const WAVE_16X16_BITMAP');
  const waveEnd = existingContent.indexOf('export function getBitmapById');
  const waveBlock = existingContent.slice(waveStart, waveEnd);

  // Preserve helper functions and font bitmask dictionary
  const tailBlock = existingContent.slice(existingContent.indexOf('export function getBitmapById'));

  const header = `import { BitmapIconId } from '../../shared/dtos';

/**
 * PixelIt-Generated 16x16 RGB Pixel-Art Bitmap Matrices for BUSY Bar Display.
 * Programmatically generated from high-resolution reference icons via scripts/convert-icons-pixelit.js.
 */

const N = null;
const W_DB = '#1E3A8A'; // Dark Blue
const W_LB = '#38BDF8'; // Light Blue
const W_WT = '#FFFFFF'; // White Foam
const W_BK = '#0F172A'; // Shadow Dark
`;

  const updatedContent = `${header}\n${tsBlocks.join('\n')}\n${waveBlock}\n${tailBlock}`;
  fs.writeFileSync(targetPath, updatedContent, 'utf8');
  console.log(`Successfully updated ${targetPath} with PixelIt matrices!`);
}

if (require.main === module) {
  processAllIcons();
}

module.exports = { decodePNG, pixelitTo16x16, processAllIcons };
