import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FRONT_ANIMATIONS } from '../src/shared/render-constants';

/**
 * Every animation the app names must exist on disk, in the layout
 * `AnimationPlayer` reads. A missing folder is not an error anywhere: the
 * player logs a warning and the panel stays empty for the whole break, which
 * is what renaming Lunch and Away to our own sets could otherwise do silently.
 *
 * Reads names, `meta.json` and the `.anim` only. The PNG frames are Git LFS
 * objects and the quality workflow checks out without LFS, where they are
 * pointer files -- present under the right names, so counting them still works.
 */
const ANIMATIONS_DIR = path.resolve(__dirname, '../../../Animations');

describe('front animation assets', () => {
  describe.each(Object.entries(FRONT_ANIMATIONS))('%s (%s)', (_key, name) => {
    const dir = path.join(ANIMATIONS_DIR, name, name);

    it('Folder_NamedAnimation_ExistsInTheNestedLayout', () => {
      expect(fs.statSync(dir).isDirectory()).toBe(true);
    });

    it('Meta_NamedAnimation_DeclaresAPositiveFrameRate', () => {
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) as { fps?: unknown };
      expect(typeof meta.fps).toBe('number');
      expect(meta.fps as number).toBeGreaterThan(0);
    });

    it('Frames_NamedAnimation_HasPngFramesForTheStreamingFallback', () => {
      const frames = fs.readdirSync(dir).filter(file => file.endsWith('.png'));
      expect(frames.length).toBeGreaterThan(0);
    });

    it('AnimFile_NamedAnimation_HasACompiledAnimForHardwarePlayback', () => {
      const anim = path.join(dir, `${name}.anim`);
      expect(fs.statSync(anim).size).toBeGreaterThan(0);
    });
  });
});
