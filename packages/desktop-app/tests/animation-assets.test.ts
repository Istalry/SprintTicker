import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { ANIMATED_ICONS, FRONT_ANIMATIONS } from '../src/shared/render-constants';
import { getBitmapById } from '../src/shared/pixel-bitmaps';
import { BitmapIconId } from '../src/shared/dtos';

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

const NAMED_ANIMATIONS = [
  ...Object.entries(FRONT_ANIMATIONS),
  // An animated icon with no files behind it degrades to its static bitmap,
  // silently; the test is what notices.
  ...Object.entries(ANIMATED_ICONS).map(([icon, name]) => [`icon ${icon}`, name as string])
];

describe('front animation assets', () => {
  describe.each(NAMED_ANIMATIONS)('%s (%s)', (_key, name) => {
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

/**
 * An animated icon's first frame is the still icon the screen draws beneath
 * it, pixel for pixel. It replaces that icon on the bar the moment the device
 * starts playing, so any difference shows as a jump. One did, for most of
 * them: the icon generator quantised colours to cap the palette, the clock's
 * purple came back as #9555FF, and the docs said "pixel for pixel" throughout.
 *
 * Reads the studio scene rather than the exported PNG: the scene is what the
 * export is made from, and the PNGs are LFS pointers where CI checks out.
 */
const SCENES_DIR = path.resolve(__dirname, '../../anim-studio/scenes');

interface IconScene {
  layers: Array<{ sprite: { palette: Record<string, string>; frames: Array<{ rows: string[] }> } }>;
}

describe('animated icon rest poses', () => {
  it.each(Object.entries(ANIMATED_ICONS))('FirstFrame_%s_IsTheStillIconExactly', (icon, name) => {
    const scene = JSON.parse(fs.readFileSync(path.join(SCENES_DIR, `${name}.scene.json`), 'utf8')) as IconScene;
    const { palette, frames } = scene.layers[0].sprite;
    const firstFrame = frames[0].rows.map(row =>
      [...row].map(key => (key === '.' ? null : palette[key].toUpperCase()))
    );
    const still = getBitmapById(icon as BitmapIconId).map(row => row.map(c => (c ? c.toUpperCase() : null)));

    expect(firstFrame).toEqual(still);
  });
});
