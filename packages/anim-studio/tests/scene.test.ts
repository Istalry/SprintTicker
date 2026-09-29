import { describe, expect, it } from 'vitest';
import {
  createGlow,
  createPlate,
  createScene,
  createSprite,
  createText,
  nextLayerId,
  nextPaletteKey,
  parseScene,
  Scene,
  SceneError,
  serializeScene,
  spriteFrameIndexAt
} from '../src/model/scene';

function sampleScene(): Scene {
  const scene = createScene('sample_72x16');
  scene.layers.push(createPlate(scene));
  scene.layers.push(createSprite(scene, 4));
  scene.layers.push(createText(scene));
  return scene;
}

/**
 * A deep copy as plain JSON, the form a scene file arrives in. Untyped on
 * purpose: these tests corrupt it in ways the Scene type would not allow.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asJson(scene: Scene): Record<string, any> {
  return JSON.parse(serializeScene(scene));
}

describe('parseScene', () => {
  it('ParseScene_SerializedScene_RoundTripsUnchanged', () => {
    const scene = sampleScene();
    expect(parseScene(asJson(scene))).toEqual(scene);
  });

  it('ParseScene_LowercaseColour_NormalisesToUppercase', () => {
    const json = asJson(sampleScene());
    json.layers[0].colorA = '#abcdef';
    expect((parseScene(json).layers[0] as { colorA: string }).colorA).toBe('#ABCDEF');
  });

  it('ParseScene_ColourWithAlpha_ThrowsNamingTheField', () => {
    // The device refuses a whole draw for one malformed colour, so the file
    // format must not let one through.
    const json = asJson(sampleScene());
    json.layers[0].colorA = '#FFFFFFFF';
    expect(() => parseScene(json)).toThrow(SceneError);
    expect(() => parseScene(json)).toThrow('scene.layers[0].colorA');
  });

  it('ParseScene_UnsupportedSize_Throws', () => {
    const json = asJson(sampleScene());
    json.width = 32;
    expect(() => parseScene(json)).toThrow('not one the device can place');
  });

  it('ParseScene_IdWithPathSeparator_Throws', () => {
    // The id becomes a folder name under Animations/.
    const json = asJson(sampleScene());
    json.id = '../escape';
    expect(() => parseScene(json)).toThrow('scene.id');
  });

  it('ParseScene_DuplicateLayerIds_Throws', () => {
    const json = asJson(sampleScene());
    json.layers[1].id = json.layers[0].id;
    expect(() => parseScene(json)).toThrow('used twice');
  });

  it('ParseScene_SpriteRowUsingUnknownKey_Throws', () => {
    const json = asJson(sampleScene());
    json.layers[1].sprite.frames[0].rows[0] = 'z...';
    expect(() => parseScene(json)).toThrow('not in the palette');
  });

  it('ParseScene_SpriteRowOfWrongLength_Throws', () => {
    const json = asJson(sampleScene());
    json.layers[1].sprite.frames[0].rows[0] = '...';
    expect(() => parseScene(json)).toThrow('must be 4 characters');
  });

  it('ParseScene_LoopFromPastLastFrame_Throws', () => {
    const json = asJson(sampleScene());
    json.layers[1].loopFrom = 1;
    expect(() => parseScene(json)).toThrow('loopFrom');
  });

  it('ParseScene_UnknownLayerType_Throws', () => {
    const json = asJson(sampleScene());
    json.layers[0].type = 'circle';
    expect(() => parseScene(json)).toThrow('must be plate, sprite, text or glow');
  });

  it('ParseScene_WrongVersion_Throws', () => {
    const json = asJson(sampleScene());
    json.version = 2;
    expect(() => parseScene(json)).toThrow('scene.version');
  });
});

describe('spriteFrameIndexAt', () => {
  const layer = {
    loopFrom: 2,
    sprite: {
      width: 1,
      height: 1,
      palette: {},
      frames: [2, 1, 3, 1].map(duration => ({ duration, rows: ['.'] }))
    }
  };

  it('SpriteFrameIndexAt_FirstPass_PlaysEachFrameForItsDuration', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(f => spriteFrameIndexAt(layer, f))).toEqual([0, 0, 1, 2, 2, 2, 3]);
  });

  it('SpriteFrameIndexAt_AfterLastFrame_LoopsFromLoopFromNotFromZero', () => {
    // Total 7 frames; the intro (frames 0-1) is 3 long and never repeats.
    expect([7, 8, 9, 10, 11].map(f => spriteFrameIndexAt(layer, f))).toEqual([2, 2, 2, 3, 2]);
  });

  it('SpriteFrameIndexAt_LoopFromZero_RepeatsWholeSequence', () => {
    const whole = { ...layer, loopFrom: 0 };
    expect(spriteFrameIndexAt(whole, 7)).toBe(0);
    expect(spriteFrameIndexAt(whole, 9)).toBe(1);
  });
});

describe('construction helpers', () => {
  it('NextLayerId_ExistingIds_ReturnsFirstUnused', () => {
    const scene = sampleScene();
    expect(nextLayerId(scene, 'plate')).toBe('plate-2');
  });

  it('NextPaletteKey_FullPalette_ReturnsNull', () => {
    const palette: Record<string, string> = {};
    for (const key of 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') palette[key] = '#000000';
    expect(nextPaletteKey({ width: 1, height: 1, palette, frames: [] })).toBeNull();
  });
});

describe('parseScene, motion and depth fields', () => {
  it('ParseScene_FileSavedBeforeMotionExisted_OpensWithDefaults', () => {
    const json = asJson(sampleScene());
    const [plate, sprite, text] = json.layers;
    for (const key of ['outlineBottom', 'highlight']) delete plate[key];
    for (const key of ['tracks', 'anchorX', 'anchorY', 'shutter']) delete sprite[key];
    for (const key of ['tracks', 'colorB', 'gradient', 'shadow']) delete text[key];
    const scene = parseScene(json);
    const parsed = scene.layers[1] as { tracks: object; anchorX: number; anchorY: number; shutter: number };
    expect(parsed.tracks).toEqual({});
    expect(parsed.shutter).toBe(0);
    expect([parsed.anchorX, parsed.anchorY]).toEqual([2, 2]);
    expect((scene.layers[2] as { shadow: unknown }).shadow).toBeNull();
  });

  it('ParseScene_KeyframesOutOfOrder_Throws', () => {
    const json = asJson(sampleScene());
    json.layers[1].tracks = {
      y: [
        { frame: 10, value: 0, ease: 'linear' },
        { frame: 5, value: 1, ease: 'linear' }
      ]
    };
    expect(() => parseScene(json)).toThrow('increasing frame order');
  });

  it('ParseScene_ScaleTrackOnText_Throws', () => {
    // Text moves but never scales: scaled pixel text is unreadable.
    const json = asJson(sampleScene());
    json.layers[2].tracks = { scaleX: [{ frame: 0, value: 2, ease: 'linear' }] };
    expect(() => parseScene(json)).toThrow('is not a track this layer has');
  });

  it('ParseScene_OpacityAboveOne_Throws', () => {
    const json = asJson(sampleScene());
    json.layers[1].tracks = { opacity: [{ frame: 0, value: 1.5, ease: 'linear' }] };
    expect(() => parseScene(json)).toThrow('tracks.opacity[0].value');
  });

  it('ParseScene_UnknownEasing_Throws', () => {
    const json = asJson(sampleScene());
    json.layers[1].tracks = { y: [{ frame: 0, value: 1, ease: 'wobble' }] };
    expect(() => parseScene(json)).toThrow('ease');
  });

  it('ParseScene_GlowLayer_RoundTrips', () => {
    const scene = sampleScene();
    scene.layers.push(createGlow(scene));
    expect(parseScene(asJson(scene))).toEqual(scene);
  });
});
