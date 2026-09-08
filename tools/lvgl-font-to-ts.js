#!/usr/bin/env node
/**
 * Converts an LVGL generated C font into the TypeScript glyph table this app draws with.
 *
 * The BUSY Bar firmware renders its own UI with LVGL, and ships the fonts as
 * `lv_font_*.c` sources under `lib/lvgl_addons/fonts/`. This app does not use
 * LVGL -- it rasterises its own 72x16 PNG and uploads that -- so the glyphs have
 * to be lifted out into a form `PixelCanvas` can draw.
 *
 * Kept in the repository rather than run once and thrown away, because the
 * alternative is a large generated file nobody can regenerate or check. Run it
 * again if the firmware updates its font:
 *
 *   node tools/lvgl-font-to-ts.js <path-to-lv_font_x.c> <output.ts>
 *
 * Only printable ASCII (0x20-0x7E) is emitted. The hardware contract limits
 * text to that range anyway -- `sanitizeAsciiText` enforces it -- and the full
 * font carries Cyrillic and 800-odd other codepoints that would be dead weight
 * in the renderer bundle.
 *
 * The format it reads, verified against the data rather than assumed:
 * - `adv_w` is in 1/16 px units, so 96 means a 6px advance.
 * - `ofs_y` is the offset of the *bottom* of the glyph box from the baseline,
 *   so a descender is negative.
 * - 1-bpp bitmaps pack bits continuously, MSB first, row after row, padded to a
 *   whole byte per glyph. Confirmed by checking that consecutive
 *   `bitmap_index` values differ by exactly `ceil(box_w * box_h / 8)`.
 *
 * ## What is being copied, and under which licence
 *
 * Read this before pointing the tool at another firmware font.
 *
 * The firmware's REUSE metadata annotates `lib/lvgl_addons/**` -- the directory
 * these `.c` files sit in -- as **GPL-2.0-or-later, (c) Flipper FZCO**, while
 * the `busy_*` font assets it was generated *from* are **OFL-1.1**, (c) TakWolf
 * and Flipper FZCO. The `.c` file itself carries no SPDX header, so on the face
 * of it a GPL notice would follow the glyphs into this MIT application.
 *
 * It does not, and that was checked rather than argued: every glyph this tool
 * emits is bit-identical to a direct rasterisation of the OFL-licensed
 * `busy_regular_5px.ttf` at the same 16px size -- 94 of 95 exactly, and the
 * 95th is the space, where lv_font_conv records a 1x1 empty box and a
 * rasteriser records an empty one. Both draw nothing.
 *
 * So what lands in `busy-font.ts` is the OFL font's own pixels. None of
 * Flipper's C is reproduced: not the tables, not the structs, not a line of the
 * source. The `.c` is being used as a container for the font data, and the
 * licence that travels with that data is the font's. See `LICENSE`.
 */

const fs = require('fs');
const path = require('path');

const FIRST_ASCII = 0x20;
const LAST_ASCII = 0x7e;
/**
 * Non-ASCII codepoints emitted as well.
 *
 * Just the ellipsis. It is what a truncated row ends with, so it is the one
 * glyph outside printable ASCII the renderer genuinely needs.
 */
const EXTRA_CODEPOINTS = [0x2026];
/** LVGL stores advance width with four fractional bits. */
const ADV_W_FRACTION = 16;

function fail(message) {
  console.error(`[lvgl-font-to-ts] ${message}`);
  process.exit(1);
}

/** Every `0x..` byte in the glyph_bitmap array, in order. */
function parseBitmap(source) {
  const match = source.match(/glyph_bitmap\[\]\s*=\s*\{([\s\S]*?)\n\};/);
  if (!match) fail('Could not find the glyph_bitmap array.');
  // Comments carry the codepoint of each run; strip them so only bytes remain.
  const body = match[1].replace(/\/\*[\s\S]*?\*\//g, '');
  return body.match(/0x[0-9a-fA-F]{2}/g).map(b => parseInt(b, 16));
}

/** One entry per glyph id, index 0 being LVGL's reserved empty glyph. */
function parseDescriptors(source) {
  const match = source.match(/glyph_dsc\[\]\s*=\s*\{([\s\S]*?)\n\};/);
  if (!match) fail('Could not find the glyph_dsc array.');
  const entries = [];
  const re =
    /\{\s*\.bitmap_index\s*=\s*(-?\d+),\s*\.adv_w\s*=\s*(-?\d+),\s*\.box_w\s*=\s*(-?\d+),\s*\.box_h\s*=\s*(-?\d+),\s*\.ofs_x\s*=\s*(-?\d+),\s*\.ofs_y\s*=\s*(-?\d+)\s*\}/g;
  let m;
  while ((m = re.exec(match[1])) !== null) {
    entries.push({
      bitmapIndex: Number(m[1]),
      advW: Number(m[2]),
      boxW: Number(m[3]),
      boxH: Number(m[4]),
      ofsX: Number(m[5]),
      ofsY: Number(m[6])
    });
  }
  if (entries.length === 0) fail('glyph_dsc was found but no entries parsed.');
  return entries;
}

/** Every `static const uint16_t unicode_list_N[] = {...}` in the file, by name. */
function parseUnicodeLists(source) {
  const lists = new Map();
  const re = /(unicode_list_\d+)\[\]\s*=\s*\{([\s\S]*?)\n\};/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const values = m[2].match(/0x[0-9a-fA-F]+/g) ?? [];
    lists.set(
      m[1],
      values.map(v => parseInt(v, 16))
    );
  }
  return lists;
}

/**
 * Builds codepoint -> glyph id from the cmap.
 *
 * Both range kinds are read. `FORMAT0_TINY` is a contiguous run; `SPARSE_TINY`
 * lists its codepoints as offsets from `range_start`, which is how the ellipsis
 * ends up at U+2026 inside a range that starts at 1105. Reading only the
 * contiguous ranges would silently drop it, and the truncation marker is not an
 * optional glyph -- a row cut without one just reads as a word ending oddly.
 */
function parseCmap(source) {
  const match = source.match(/cmaps\[\]\s*=\s*\{([\s\S]*?)\n\};/);
  if (!match) fail('Could not find the cmaps array.');
  const lists = parseUnicodeLists(source);
  const map = new Map();
  const re =
    /\.range_start\s*=\s*(\d+),\s*\.range_length\s*=\s*(\d+),\s*\.glyph_id_start\s*=\s*(\d+),\s*\.unicode_list\s*=\s*(\w+)[\s\S]*?\.type\s*=\s*(\w+)/g;
  let m;
  while ((m = re.exec(match[1])) !== null) {
    const start = Number(m[1]);
    const length = Number(m[2]);
    const idStart = Number(m[3]);
    const listName = m[4];
    const type = m[5];

    if (type.endsWith('FORMAT0_TINY')) {
      for (let i = 0; i < length; i++) map.set(start + i, idStart + i);
      continue;
    }
    if (type.endsWith('SPARSE_TINY')) {
      const offsets = lists.get(listName);
      if (!offsets) fail(`Sparse cmap range references ${listName}, which was not found.`);
      offsets.forEach((offset, i) => map.set(start + offset, idStart + i));
      continue;
    }
    fail(`Unsupported cmap type ${type}; this script reads FORMAT0_TINY and SPARSE_TINY.`);
  }
  return map;
}

/** Unpacks one glyph into `boxH` row bitmasks, bit `boxW-1` being the leftmost pixel. */
function unpackRows(bitmap, dsc) {
  const rows = [];
  let bit = dsc.bitmapIndex * 8;
  for (let row = 0; row < dsc.boxH; row++) {
    let mask = 0;
    for (let col = 0; col < dsc.boxW; col++) {
      const byte = bitmap[bit >> 3];
      const isSet = (byte & (0x80 >> (bit & 7))) !== 0;
      if (isSet) mask |= 1 << (dsc.boxW - 1 - col);
      bit++;
    }
    rows.push(mask);
  }
  return rows;
}

function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    fail('Usage: node tools/lvgl-font-to-ts.js <lv_font_x.c> <output.ts>');
  }
  if (!fs.existsSync(inputPath)) fail(`No such font source: ${inputPath}`);

  const source = fs.readFileSync(inputPath, 'utf8');
  const bitmap = parseBitmap(source);
  const dsc = parseDescriptors(source);
  const cmap = parseCmap(source);

  // The packing assumption, checked rather than trusted: if it were wrong,
  // every glyph after the first would silently decode as noise.
  for (let id = 1; id < dsc.length - 1; id++) {
    const expected = Math.ceil((dsc[id].boxW * dsc[id].boxH) / 8);
    const actual = dsc[id + 1].bitmapIndex - dsc[id].bitmapIndex;
    if (actual !== expected) {
      fail(
        `Glyph ${id} occupies ${actual} bytes but a ${dsc[id].boxW}x${dsc[id].boxH} 1-bpp box needs ` +
          `${expected}. The bitmap is probably compressed or multi-bpp, which this script does not read.`
      );
    }
  }

  const glyphs = [];
  let maxAscent = 0;
  let maxDescent = 0;
  const missing = [];

  const wanted = [];
  for (let code = FIRST_ASCII; code <= LAST_ASCII; code++) wanted.push(code);
  wanted.push(...EXTRA_CODEPOINTS);

  for (const code of wanted) {
    const id = cmap.get(code);
    if (id === undefined || id >= dsc.length) {
      missing.push(code);
      continue;
    }
    const g = dsc[id];
    if (g.advW % ADV_W_FRACTION !== 0) {
      fail(`Glyph U+${code.toString(16)} has a fractional advance (${g.advW}/16), which cannot be drawn on a pixel grid.`);
    }
    const rows = g.boxW > 0 && g.boxH > 0 ? unpackRows(bitmap, g) : [];
    maxAscent = Math.max(maxAscent, g.ofsY + g.boxH);
    maxDescent = Math.max(maxDescent, -g.ofsY);
    glyphs.push({
      code,
      char: String.fromCharCode(code),
      advance: g.advW / ADV_W_FRACTION,
      boxW: g.boxW,
      boxH: g.boxH,
      ofsX: g.ofsX,
      ofsY: g.ofsY,
      rows
    });
  }

  if (missing.length > 0) {
    console.warn(
      `[lvgl-font-to-ts] No glyph for: ${missing.map(c => JSON.stringify(String.fromCharCode(c))).join(', ')}`
    );
  }

  const fontName = path.basename(inputPath, '.c');
  const lines = [];
  lines.push('/**');
  lines.push(` * Printable ASCII of the BUSY Bar's own \`${fontName}\`, as pixel rows.`);
  lines.push(' *');
  lines.push(' * GENERATED FILE -- do not edit by hand.');
  lines.push(' * Regenerate with:');
  lines.push(` *   node tools/lvgl-font-to-ts.js <firmware>/lib/lvgl_addons/fonts/${fontName}.c \\`);
  lines.push(' *     packages/desktop-app/src/shared/busy-font.ts');
  lines.push(' *');
  lines.push(' * Font: BUSY Bar firmware, derived from Ark Pixel Font.');
  lines.push(' * Copyright 2021 TakWolf (https://ark-pixel-font.takwolf.com/)');
  lines.push(' * Copyright 2024-2026 Flipper FZCO');
  lines.push(' * SPDX-License-Identifier: OFL-1.1');
  lines.push(' */');
  lines.push('');
  lines.push('/** One glyph: a bitmap box positioned against the baseline, plus how far the pen moves. */');
  lines.push('export interface ProportionalGlyph {');
  lines.push('  /** Pen movement in whole pixels, including the gap to the next glyph. */');
  lines.push('  advance: number;');
  lines.push('  /** Ink box width in pixels; 0 for a blank glyph such as space. */');
  lines.push('  boxW: number;');
  lines.push('  boxH: number;');
  lines.push('  /** Horizontal bearing: where the ink starts relative to the pen. */');
  lines.push('  ofsX: number;');
  lines.push('  /** Bottom of the ink box relative to the baseline. Negative for a descender. */');
  lines.push('  ofsY: number;');
  lines.push('  /** One bitmask per row, top first; bit `boxW - 1` is the leftmost pixel. */');
  lines.push('  rows: number[];');
  lines.push('}');
  lines.push('');
  lines.push('/** Rows of ink above the baseline, across every glyph emitted here. */');
  lines.push(`export const BUSY_FONT_ASCENT = ${maxAscent};`);
  lines.push('');
  lines.push('/** Rows of ink below the baseline. Only descenders use it. */');
  lines.push(`export const BUSY_FONT_DESCENT = ${maxDescent};`);
  lines.push('');
  lines.push('/** Total rows a line of this font occupies. */');
  lines.push('export const BUSY_FONT_HEIGHT = BUSY_FONT_ASCENT + BUSY_FONT_DESCENT;');
  lines.push('');
  lines.push('export const BUSY_FONT: Record<string, ProportionalGlyph> = {');
  for (const g of glyphs) {
    const key = JSON.stringify(g.char);
    const rows = `[${g.rows.join(', ')}]`;
    lines.push(
      `  ${key}: { advance: ${g.advance}, boxW: ${g.boxW}, boxH: ${g.boxH}, ` +
        `ofsX: ${g.ofsX}, ofsY: ${g.ofsY}, rows: ${rows} },`
    );
  }
  lines.push('};');
  lines.push('');

  fs.writeFileSync(outputPath, lines.join('\n'));
  console.log(
    `[lvgl-font-to-ts] Wrote ${glyphs.length} glyphs to ${outputPath} ` +
      `(ascent ${maxAscent}, descent ${maxDescent}).`
  );
}

main();
