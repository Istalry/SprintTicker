const path = require('path');

/**
 * The `.anim` formats, for the tools: which compiler writes each, where its
 * file lives, and which firmware reads it.
 *
 * The rule itself is `packages/desktop-app/src/shared/anim-format.ts`, which
 * explains why there are two; this is its restatement for untyped,
 * dependency-free CommonJS, which cannot import TypeScript.
 * `anim-format.test.ts` holds the two equal -- change them together.
 *
 * Used by `build-anims.js`, the probe and the animation studio.
 */

const TOOLCHAIN_DIR = path.join(__dirname, '..', 'busybar-anim-toolchain');

/** Oldest first; `firstFirmware` is the first `[major, minor]` that reads the format. */
const ANIM_FORMATS = [
  { format: 0, compiler: path.join(TOOLCHAIN_DIR, 'seq2anim.py'), firstFirmware: [0, 0] },
  { format: 1, compiler: path.join(TOOLCHAIN_DIR, 'seq2anim_v1.py'), firstFirmware: [1, 3] }
];

/** `<name>.anim` for format 0, `<name>.v<N>.anim` for the others. */
function animFileName(name, format) {
  return format === 0 ? `${name}.anim` : `${name}.v${format}.anim`;
}

/** The format a firmware version reads, or null when no version can be read from it. */
function animFormatForFirmware(version) {
  const match = /(\d+)\.(\d+)/.exec(version || '');
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  let chosen = null;
  for (const { format, firstFirmware: [firstMajor, firstMinor] } of ANIM_FORMATS) {
    if (major > firstMajor || (major === firstMajor && minor >= firstMinor)) chosen = format;
  }
  return chosen;
}

/** The format a file's signature names, or null. */
function animFormatOf(bytes) {
  if (!bytes || bytes.length < 8) return null;
  const signature = Buffer.from(bytes.subarray(0, 8)).toString('latin1');
  const found = ANIM_FORMATS.find(({ format }) => signature === `bicycle${format}`);
  return found ? found.format : null;
}

module.exports = { ANIM_FORMATS, animFileName, animFormatForFirmware, animFormatOf };
