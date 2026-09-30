#!/usr/bin/env node
/**
 * Compiles the pixel fonts from their glyph sheets into TypeScript.
 *
 *   node tools/glyphs-to-ts.js            regenerate every font
 *   node tools/glyphs-to-ts.js --check    fail if a generated file is stale (CI)
 *   node tools/glyphs-to-ts.js --preview "Some text"   print it in every font
 *
 * The sheets in `packages/desktop-app/fonts/` are the source of truth, and they
 * are drawn by hand: one block per character, `#` for a lit pixel and `.` for an
 * unlit one, every block the full height of the font so the baseline is visible
 * in the drawing itself. That makes a glyph reviewable in a diff, which a table
 * of bitmasks is not.
 *
 * These fonts replaced two others, and the rules enforced below are the
 * reasons:
 *
 * - Row 0 used the BUSY Bar firmware's own font (OFL-1.1, Flipper FZCO). It was
 *   legible, but it was not ours, and it was the one file in the package under
 *   another licence.
 * - Row 1 used a hand-rolled 3x5 font with 40 glyphs. `( ) , ' " # + @ & =`
 *   and the rest of the punctuation were missing and drew as `?`, and `g` and
 *   `q` were the same bitmap.
 *
 * So the generator refuses a sheet that is missing any character of its
 * charset (all of printable ASCII for the app's fonts), that draws two
 * characters identically, or that leaves a blank column at either edge of a
 * glyph (spacing is the font's `letterSpacing` and nothing else, so every pair
 * of letters is the same distance apart).
 *
 * Deliberately dependency-free CommonJS, like everything else in `tools/`: it
 * has to run before anything is installed, and it is not linted or typed.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');

const APP_FONTS = {
  dir: 'packages/desktop-app/fonts',
  outDir: 'packages/desktop-app/src/shared/fonts',
  typeImport: './pixel-font'
};
const STUDIO_FONTS = {
  dir: 'packages/anim-studio/fonts',
  outDir: 'packages/anim-studio/src/fonts',
  // The studio reads the app's fonts in place rather than keeping a copy, so
  // the type comes from the same place. A relative path, not an alias, so the
  // import resolves the same under tsc, Vitest and the dev server's SSR loader
  // without teaching each of them an alias.
  typeImport: '../../../desktop-app/src/shared/fonts/pixel-font'
};

/**
 * Every font there is. The sheet name is also the generated file's name.
 *
 * The first two draw the front display's text rows. The two display faces
 * are the animation studio's large scene text: Bold 9 for a one-line title,
 * Bold 7 for two lines. Bold 7 lives with the app's fonts because the app
 * also draws the running timer in it, and the app cannot import from the
 * studio; Bold 9 is never drawn by the app and stays in the studio.
 */
const FONTS = [
  { sheet: 'sprint-5', exportName: 'SPRINT_5', ...APP_FONTS },
  { sheet: 'sprint-small', exportName: 'SPRINT_SMALL', ...APP_FONTS },
  { sheet: 'sprint-bold-7', exportName: 'SPRINT_BOLD_7', ...APP_FONTS },
  { sheet: 'sprint-bold-9', exportName: 'SPRINT_BOLD_9', ...STUDIO_FONTS }
];

/** Printable ASCII, plus the ellipsis that marks a truncated row. */
const ASCII_CHARS = (() => {
  const chars = [];
  for (let code = 0x20; code <= 0x7e; code++) chars.push(String.fromCharCode(code));
  chars.push('…');
  return chars;
})();

/**
 * A display face's characters: capitals, digits and the punctuation a
 * one- or two-word scene title uses. It has no lowercase -- text drawn in it is
 * upper-cased first -- which is what lets it be large and bold at 7px.
 */
const DISPLAY_CHARS = [..." !%&'()+,-./0123456789:?ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

/** What each `charset:` header value requires, in output order. */
const CHARSETS = { ascii: ASCII_CHARS, display: DISPLAY_CHARS };

/** Glyph names that cannot be written literally after `glyph`. */
const NAMED_CHARS = { space: ' ' };

/**
 * Parses a glyph sheet.
 *
 * Exported so other tools can read the sheets directly rather than the
 * generated TypeScript -- the probe draws a font sheet on a real bar from here.
 */
function parseGlyphSheet(text, sourceName = '<sheet>') {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const header = {};
  const glyphs = new Map();
  let current = null;

  const fail = (lineNo, message) => {
    throw new Error(`${sourceName}:${lineNo}: ${message}`);
  };

  const finish = lineNo => {
    if (!current) return;
    if (current.rows.length === 0) fail(lineNo, `glyph ${JSON.stringify(current.char)} has no rows`);
    glyphs.set(current.char, current);
    current = null;
  };

  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.trimEnd();
    if (line.startsWith('//')) return;
    if (line === '') {
      finish(lineNo);
      return;
    }

    const glyphMatch = /^glyph (.+)$/.exec(line);
    if (glyphMatch) {
      finish(lineNo);
      const name = glyphMatch[1];
      const char = NAMED_CHARS[name] ?? name;
      if ([...char].length !== 1) fail(lineNo, `glyph name ${JSON.stringify(name)} is not one character`);
      if (glyphs.has(char)) fail(lineNo, `glyph ${JSON.stringify(char)} is defined twice`);
      current = { char, rows: [], line: lineNo };
      return;
    }

    if (current) {
      if (!/^[#.]+$/.test(line)) fail(lineNo, `glyph rows may only contain '#' and '.', got ${JSON.stringify(line)}`);
      current.rows.push(line);
      return;
    }

    const headerMatch = /^([a-zA-Z]+):\s*(.+)$/.exec(line);
    if (!headerMatch) fail(lineNo, `expected a header line or a glyph, got ${JSON.stringify(line)}`);
    header[headerMatch[1]] = headerMatch[2].trim();
  });
  finish(lines.length);

  for (const key of ['name', 'ascent', 'descent', 'letterSpacing']) {
    if (header[key] === undefined) throw new Error(`${sourceName}: missing header '${key}:'`);
  }
  const charset = header.charset ?? 'ascii';
  if (!CHARSETS[charset]) {
    throw new Error(`${sourceName}: unknown charset '${charset}' (expected ${Object.keys(CHARSETS).join(' or ')})`);
  }
  const font = {
    name: header.name,
    ascent: Number(header.ascent),
    descent: Number(header.descent),
    letterSpacing: Number(header.letterSpacing),
    chars: CHARSETS[charset],
    glyphs
  };
  validateFont(font, sourceName);
  return font;
}

/** The rules that keep a sheet legible; see the file comment for why each exists. */
function validateFont(font, sourceName) {
  const height = font.ascent + font.descent;
  const problems = [];

  for (const char of font.chars) {
    if (!font.glyphs.has(char)) problems.push(`missing glyph ${JSON.stringify(char)}`);
  }
  for (const char of font.glyphs.keys()) {
    // Would be dropped from the output without a word otherwise.
    if (!font.chars.includes(char)) problems.push(`glyph ${JSON.stringify(char)} is not in this font's charset`);
  }

  const seen = new Map();
  for (const glyph of font.glyphs.values()) {
    const label = `glyph ${JSON.stringify(glyph.char)} (line ${glyph.line})`;
    if (glyph.rows.length !== height) {
      problems.push(`${label} has ${glyph.rows.length} rows; every glyph is drawn full height (${height})`);
      continue;
    }
    const width = glyph.rows[0].length;
    if (glyph.rows.some(row => row.length !== width)) {
      problems.push(`${label} has rows of different widths`);
      continue;
    }
    const inkInColumn = column => glyph.rows.some(row => row[column] === '#');
    const hasInk = glyph.rows.some(row => row.includes('#'));

    if (glyph.char === ' ') {
      if (hasInk) problems.push(`${label} must be blank`);
      continue;
    }
    if (!hasInk) problems.push(`${label} is blank`);
    if (!inkInColumn(0) || !inkInColumn(width - 1)) {
      problems.push(`${label} has a blank edge column; spacing belongs to letterSpacing`);
    }

    const bitmap = glyph.rows.join('/');
    if (seen.has(bitmap)) {
      problems.push(`${label} is drawn identically to ${JSON.stringify(seen.get(bitmap))}`);
    } else {
      seen.set(bitmap, glyph.char);
    }
  }

  if (problems.length > 0) {
    throw new Error(`${sourceName}: ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  }
}

function toBinaryLiteral(row) {
  return `0b${row.replace(/#/g, '1').replace(/\./g, '0')}`;
}

function generateTypeScript(font, { sheet, exportName, dir, typeImport }) {
  const entries = font.chars.map(char => {
    const glyph = font.glyphs.get(char);
    const rows = glyph.rows.map(toBinaryLiteral).join(', ');
    return `  ${JSON.stringify(char)}: { width: ${glyph.rows[0].length}, rows: [${rows}] }`;
  });

  return [
    '/**',
    ` * The ${font.name} pixel font.`,
    ' *',
    ' * GENERATED FILE -- do not edit by hand. The source is the glyph sheet',
    ` * ${dir}/${sheet}.glyphs; regenerate with \`pnpm fonts:build\`.`,
    ' */',
    '',
    `import type { PixelFont } from '${typeImport}';`,
    '',
    `export const ${exportName}: PixelFont = {`,
    `  name: ${JSON.stringify(font.name)},`,
    `  ascent: ${font.ascent},`,
    `  descent: ${font.descent},`,
    `  letterSpacing: ${font.letterSpacing},`,
    '  glyphs: {',
    entries.map(entry => `  ${entry}`).join(',\n'),
    '  }',
    '};',
    ''
  ].join('\n');
}

function loadFont(sheet) {
  const entry = FONTS.find(f => f.sheet === sheet);
  if (!entry) throw new Error(`unknown font '${sheet}'`);
  const file = path.join(REPO_ROOT, entry.dir, `${sheet}.glyphs`);
  return parseGlyphSheet(fs.readFileSync(file, 'utf8'), path.relative(REPO_ROOT, file));
}

/** Renders text as rows of '#' and '.', the same way PixelCanvas lays it out. */
function renderText(font, text) {
  const height = font.ascent + font.descent;
  const lines = Array.from({ length: height }, () => '');
  for (const char of text) {
    const glyph = font.glyphs.get(char) ?? font.glyphs.get(char.toUpperCase()) ?? font.glyphs.get('?');
    const gap = '.'.repeat(font.letterSpacing);
    glyph.rows.forEach((row, index) => {
      lines[index] += row + gap;
    });
  }
  return lines;
}

function main() {
  const args = process.argv.slice(2);

  const previewIndex = args.indexOf('--preview');
  if (previewIndex >= 0) {
    const text = args[previewIndex + 1] ?? ASCII_CHARS.join('');
    for (const { sheet } of FONTS) {
      const font = loadFont(sheet);
      console.log(`${font.name}:`);
      console.log(renderText(font, text).join('\n'));
      console.log('');
    }
    return;
  }

  const check = args.includes('--check');
  let stale = 0;
  for (const entry of FONTS) {
    const { sheet, outDir } = entry;
    const font = loadFont(sheet);
    const output = generateTypeScript(font, entry);
    const outFile = path.join(REPO_ROOT, outDir, `${sheet}.ts`);
    const relative = path.relative(REPO_ROOT, outFile);

    if (check) {
      const existing = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').replace(/\r\n/g, '\n') : null;
      if (existing !== output) {
        console.error(`[fonts] ${relative} is out of date with ${sheet}.glyphs. Run \`pnpm fonts:build\`.`);
        stale++;
      }
      continue;
    }

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, output);
    console.log(`[fonts] Wrote ${relative} (${font.glyphs.size} glyphs).`);
  }

  if (check) {
    if (stale > 0) process.exit(1);
    console.log('[fonts] Generated fonts are up to date.');
  }
}

module.exports = { parseGlyphSheet, renderText, loadFont, FONTS, ASCII_CHARS, DISPLAY_CHARS };

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`[fonts] ${err.message}`);
    process.exit(1);
  }
}
