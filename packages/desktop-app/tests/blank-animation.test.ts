import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { BLANK_ANIMATION_BYTES, BLANK_ANIMATION_FILE } from '../src/main/hardware/blank-animation';
import { ANIM_FORMATS, animFileName, animFormatOf } from '../src/shared/anim-format';

const SOURCE = path.resolve(__dirname, '../../../Animations/blank_16x16/blank_16x16');

describe('The empty animation that replaces a removal', () => {
  it.each(ANIM_FORMATS)('BlankAnimation_BytesInFormat%s_AreTheCompiledFile', format => {
    // Recompile the folder with `node scripts/build-anims.js` and paste the
    // new base64 when it changes; the probe's --park soak uploads the file,
    // the app these bytes.
    const file = fs.readFileSync(path.join(SOURCE, animFileName('blank_16x16', format)));
    expect(BLANK_ANIMATION_BYTES[format].equals(file)).toBe(true);
    expect(animFormatOf(BLANK_ANIMATION_BYTES[format])).toBe(format);
  });

  it('BlankAnimation_DeviceName_IsTheFormatZeroName', () => {
    // The device holds one firmware's files, so both go under one name.
    expect(BLANK_ANIMATION_FILE).toBe(animFileName('blank_16x16', 0));
  });

  it('BlankAnimation_Source_IsOneTransparentFrame', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(SOURCE, 'meta.json'), 'utf8'));
    expect(meta.color_mode).toBe('argb8888');
    expect(fs.readdirSync(SOURCE).filter(name => name.endsWith('.png'))).toEqual(['frame_00000.png']);
  });
});
