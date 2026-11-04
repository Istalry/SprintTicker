/**
 * Which `.anim` file a bar can play, by its firmware.
 *
 * The container starts with an 8-byte signature, `bicycle` and a digit, and
 * the firmware's loader (`lib/anim_file/components/anim_file_load.c`) accepts
 * exactly one: 1.2 reads `bicycle0`, 1.3 reads `bicycle1`, which added
 * interframe compression and made the files about four times smaller. Neither
 * reads the other's.
 *
 * **A file in the wrong format is not refused.** The upload stores it and the
 * draw answers 200; the firmware then draws its 9x9 load-error placeholder
 * where the animation should be (its own integration test,
 * `test_api_display_draw.py`, firmware 1.3.1). So a status code cannot tell
 * the app it sent the wrong file, and the static icon or the streamed frames
 * that stand in for a refused `.anim` never take over. The format has to be
 * chosen before the upload, from the firmware version, and an unknown version
 * gets no `.anim` at all.
 *
 * Every animation is therefore compiled once per format, by the firmware's own
 * compiler for that release (`scripts/busybar-anim-toolchain/`), and kept side
 * by side on disk. `scripts/lib/anim-formats.js` restates this for the
 * untyped tools; `anim-format.test.ts` holds the two equal.
 *
 * Kept free of Node and Electron: the studio imports it too.
 */

/** The digit at the end of the signature. */
export type AnimFormat = 0 | 1;

/** Oldest first. */
export const ANIM_FORMATS: readonly AnimFormat[] = [0, 1];

export const ANIM_SIGNATURE_PREFIX = 'bicycle';

/** Bytes the signature takes at the start of the file. */
export const ANIM_SIGNATURE_LENGTH = 8;

/**
 * The first firmware, as `[major, minor]`, that reads each format -- and the
 * last that reads the one before it. Measured from the firmware's source: the
 * signature moved in `736af4c7` (2026-09-11), first tagged in 1.3.0-rc.
 */
const FIRST_FIRMWARE: Record<AnimFormat, readonly [number, number]> = {
  0: [0, 0],
  1: [1, 3]
};

export function animSignature(format: AnimFormat): string {
  return `${ANIM_SIGNATURE_PREFIX}${format}`;
}

/**
 * The file's format, read from its signature, or null when it carries none
 * this app knows -- a future format, or not an `.anim` at all.
 */
export function animFormatOf(bytes: Uint8Array): AnimFormat | null {
  if (bytes.length < ANIM_SIGNATURE_LENGTH) return null;
  let signature = '';
  for (let i = 0; i < ANIM_SIGNATURE_LENGTH; i++) signature += String.fromCharCode(bytes[i]);
  return ANIM_FORMATS.find(format => animSignature(format) === signature) ?? null;
}

/**
 * Where an animation's file in `format` lives beside its frames:
 * `<name>.anim` for format 0, which is where it always was, and
 * `<name>.v<N>.anim` for the others.
 *
 * The name on the *device* stays `<name>.anim` whatever the format: a bar
 * holds the files of one firmware at a time.
 */
export function animFileName(name: string, format: AnimFormat): string {
  return format === 0 ? `${name}.anim` : `${name}.v${format}.anim`;
}

/**
 * The format a firmware reads, from the version it reports (`1.2.4`,
 * `1.3.1`, `1.3.0-rc`), or null when the version says nothing a number can be
 * read from -- a development build, or a bar that has not said.
 *
 * A firmware newer than the newest format's first one is assumed to read that
 * format. That is a guess about releases nobody has seen, and 1.3 already
 * proved it can be wrong: run `pnpm probe:busybar` after a firmware release,
 * whose animation check reads the panel back and so sees a placeholder.
 */
export function animFormatForFirmware(version: string | null | undefined): AnimFormat | null {
  const match = /(\d+)\.(\d+)/.exec(version ?? '');
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  let chosen: AnimFormat | null = null;
  for (const format of ANIM_FORMATS) {
    const [firstMajor, firstMinor] = FIRST_FIRMWARE[format];
    if (major > firstMajor || (major === firstMajor && minor >= firstMinor)) chosen = format;
  }
  return chosen;
}
