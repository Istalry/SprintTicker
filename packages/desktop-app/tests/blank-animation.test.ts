import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { BLANK_ANIMATION_BYTES, BLANK_ANIMATION_FILE } from '../src/main/hardware/blank-animation';

const SOURCE = path.resolve(__dirname, '../../../Animations/blank_16x16/blank_16x16');

describe('The empty animation that replaces a removal', () => {
  it('BlankAnimation_Bytes_AreTheCompiledFile', () => {
    // Recompile the folder with seq2anim.py and paste the new base64 when it
    // changes; the probe's --park soak uploads the file, the app these bytes.
    expect(BLANK_ANIMATION_BYTES.equals(fs.readFileSync(path.join(SOURCE, BLANK_ANIMATION_FILE)))).toBe(true);
  });

  it('BlankAnimation_Source_IsOneTransparentFrame', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(SOURCE, 'meta.json'), 'utf8'));
    expect(meta.color_mode).toBe('argb8888');
    expect(fs.readdirSync(SOURCE).filter(name => name.endsWith('.png'))).toEqual(['frame_00000.png']);
  });
});
