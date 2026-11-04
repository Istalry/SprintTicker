import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import {
  ANIM_FORMATS,
  AnimFormat,
  animFileName,
  animFormatForFirmware,
  animFormatOf,
  animSignature
} from '../src/shared/anim-format';

/**
 * The `.anim` format a firmware reads. 1.3 moved the signature from
 * `bicycle0` to `bicycle1` and reads only the new one; a file in the other
 * format is stored and drawn with 200s, as a load-error icon.
 */

/** The tools' restatement, which cannot import TypeScript. */
interface ScriptFormats {
  ANIM_FORMATS: Array<{ format: number; compiler: string; firstFirmware: [number, number] }>;
  animFileName(name: string, format: number): string;
  animFormatForFirmware(version: string | null | undefined): number | null;
  animFormatOf(bytes: Uint8Array): number | null;
}
const scripts = createRequire(__filename)(path.resolve(__dirname, '../../../scripts/lib/anim-formats.js')) as ScriptFormats;

const VERSIONS: Array<[string | null | undefined, AnimFormat | null]> = [
  ['1.2.3', 0],
  ['1.2.4', 0],
  ['1.2.4-rc', 0],
  ['1.3.0-rc', 1],
  ['1.3.1', 1],
  ['v1.3.1', 1],
  ['1.10.0', 1],
  ['2.0.0', 1],
  ['0.9.0', 0],
  ['dev', null],
  ['', null],
  [null, null],
  [undefined, null]
];

describe('anim-format', () => {
  it.each(VERSIONS)('AnimFormatForFirmware_%s_Is%s', (version, format) => {
    expect(animFormatForFirmware(version)).toBe(format);
  });

  it.each(ANIM_FORMATS)('AnimFormatOf_SignatureOfFormat%s_ReadsItBack', format => {
    const bytes = Buffer.concat([Buffer.from(animSignature(format), 'latin1'), Buffer.alloc(16)]);
    expect(animFormatOf(bytes)).toBe(format);
  });

  it.each([
    ['too short', Buffer.from('bicycle')],
    ['a future format', Buffer.from('bicycle2........')],
    ['a PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])]
  ])('AnimFormatOf_%s_IsNull', (_what, bytes) => {
    expect(animFormatOf(bytes)).toBeNull();
  });

  it('AnimFileName_FormatZero_IsWhereTheFileAlwaysWas', () => {
    expect(animFileName('icon_gear_16x16', 0)).toBe('icon_gear_16x16.anim');
    expect(animFileName('icon_gear_16x16', 1)).toBe('icon_gear_16x16.v1.anim');
  });

  describe('the scripts restate the same rule', () => {
    it('Formats_Listed_AreTheSameInTheSameOrder', () => {
      expect(scripts.ANIM_FORMATS.map(f => f.format)).toEqual([...ANIM_FORMATS]);
    });

    it.each(VERSIONS)('AnimFormatForFirmware_%s_AgreesWithTheApp', (version, format) => {
      expect(scripts.animFormatForFirmware(version)).toBe(format);
    });

    it.each(ANIM_FORMATS)('AnimFileName_Format%s_AgreesWithTheApp', format => {
      expect(scripts.animFileName('lunch_sandwich_72x16', format)).toBe(animFileName('lunch_sandwich_72x16', format));
    });

    it.each(ANIM_FORMATS)('AnimFormatOf_Format%s_AgreesWithTheApp', format => {
      const bytes = Buffer.concat([Buffer.from(animSignature(format), 'latin1'), Buffer.alloc(16)]);
      expect(scripts.animFormatOf(bytes)).toBe(format);
    });

    it.each(ANIM_FORMATS)('Compiler_Format%s_ExistsAndWritesItsSignature', format => {
      // The compiler is the firmware's own; its source names the signature.
      const entry = scripts.ANIM_FORMATS.find(f => f.format === format)!;
      const source = fs.readFileSync(entry.compiler, 'utf8');
      expect(source).toContain(`b"${animSignature(format)}"`);
    });
  });
});
