import { describe, expect, it } from 'vitest';
import { createScene, PlateLayer, Scene, SpriteLayer, TextLayer } from '../src/model/scene';
import { insideRoundedRect, renderFrame } from '../src/render/compositor';
import { Raster } from '../src/render/raster';
import { measure, SCENE_FONTS } from '../src/render/text';

const BLACK = [0, 0, 0];

function plate(overrides: Partial<PlateLayer> = {}): PlateLayer {
  return {
    id: 'p',
    name: 'Plate',
    visible: true,
    type: 'plate',
    x: 0,
    y: 0,
    width: 72,
    height: 16,
    radius: 0,
    colorA: '#FF0000',
    colorB: '#0000FF',
    direction: 'horizontal',
    outline: null,
    motion: 'none',
    period: 10,
    ...overrides
  };
}

function text(overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    id: 't',
    name: 'Text',
    visible: true,
    type: 'text',
    text: 'LUNCH',
    font: 'bold-7',
    color: '#FFFFFF',
    x: 0,
    y: 0,
    width: 72,
    align: 'left',
    effect: 'none',
    period: 10,
    ...overrides
  };
}

function sceneWith(...layers: Scene['layers']): Scene {
  return { ...createScene('t'), layers };
}

/** Columns that hold at least one lit pixel. */
function litColumns(raster: Raster): number[] {
  const columns: number[] = [];
  for (let x = 0; x < raster.width; x++) {
    for (let y = 0; y < raster.height; y++) {
      if (raster.get(x, y).some(c => c > 0)) {
        columns.push(x);
        break;
      }
    }
  }
  return columns;
}

describe('renderFrame', () => {
  it('RenderFrame_NoLayers_IsOpaqueBlack', () => {
    const raster = renderFrame(sceneWith(), 0);
    expect(raster.get(10, 5)).toEqual(BLACK);
    // Opaque, because an unlit LED is black, not transparent.
    expect(raster.data[3]).toBe(255);
  });

  it('RenderFrame_SameSceneAndFrame_ProducesIdenticalPixels', () => {
    const scene = sceneWith(plate({ motion: 'slide' }), text({ effect: 'shine' }));
    expect(renderFrame(scene, 17).data).toEqual(renderFrame(scene, 17).data);
  });

  it('RenderFrame_HiddenLayer_IsNotDrawn', () => {
    expect(renderFrame(sceneWith(plate({ visible: false })), 0).get(5, 5)).toEqual(BLACK);
  });

  it('RenderFrame_LaterLayer_DrawsOverEarlierOne', () => {
    const raster = renderFrame(sceneWith(plate(), plate({ id: 'q', colorA: '#00FF00', colorB: '#00FF00' })), 0);
    expect(raster.get(0, 0)).toEqual([0, 255, 0]);
  });
});

describe('plate', () => {
  it('Plate_HorizontalGradient_RunsFromColorAToColorB', () => {
    const raster = renderFrame(sceneWith(plate()), 0);
    expect(raster.get(0, 8)).toEqual([255, 0, 0]);
    expect(raster.get(71, 8)).toEqual([0, 0, 255]);
  });

  it('Plate_RadiusOne_ClipsOnlyTheCornerPixel', () => {
    const raster = renderFrame(sceneWith(plate({ radius: 1, colorB: '#FF0000' })), 0);
    expect(raster.get(0, 0)).toEqual(BLACK);
    expect(raster.get(1, 0)).toEqual([255, 0, 0]);
    expect(raster.get(0, 1)).toEqual([255, 0, 0]);
    expect(raster.get(71, 15)).toEqual(BLACK);
  });

  it('Plate_Outline_ColoursEdgesButNotInterior', () => {
    const raster = renderFrame(sceneWith(plate({ outline: '#FFFFFF', colorB: '#FF0000' })), 0);
    expect(raster.get(0, 8)).toEqual([255, 255, 255]);
    expect(raster.get(36, 0)).toEqual([255, 255, 255]);
    expect(raster.get(36, 8)).toEqual([255, 0, 0]);
  });

  it('Plate_Pulse_DimsHalfwayThroughPeriodAndRecovers', () => {
    const scene = sceneWith(plate({ colorA: '#C8C8C8', colorB: '#C8C8C8', motion: 'pulse', period: 10 }));
    expect(renderFrame(scene, 0).get(5, 5)).toEqual([200, 200, 200]);
    expect(renderFrame(scene, 5).get(5, 5)).toEqual([140, 140, 140]);
    expect(renderFrame(scene, 10).get(5, 5)).toEqual([200, 200, 200]);
  });

  it('Plate_Slide_ChangesOverTimeAndLoopsSeamlessly', () => {
    const scene = sceneWith(plate({ motion: 'slide', period: 20 }));
    expect(renderFrame(scene, 5).data).not.toEqual(renderFrame(scene, 0).data);
    expect(renderFrame(scene, 20).data).toEqual(renderFrame(scene, 0).data);
  });

  it('InsideRoundedRect_RadiusThree_ClipsAStaircaseNotASquare', () => {
    const clipped = (x: number, y: number) => !insideRoundedRect(x, y, 20, 10, 3);
    expect([0, 1, 2, 3].map(x => clipped(x, 0))).toEqual([true, true, true, false]);
    expect([0, 1].map(x => clipped(x, 1))).toEqual([true, false]);
    expect([0, 1].map(x => clipped(x, 2))).toEqual([true, false]);
    expect(clipped(0, 3)).toBe(false);
  });

  it('InsideRoundedRect_OutsideBounds_IsFalse', () => {
    expect(insideRoundedRect(-1, 0, 10, 10, 0)).toBe(false);
    expect(insideRoundedRect(10, 0, 10, 10, 0)).toBe(false);
    expect(insideRoundedRect(5, 5, 10, 10, 3)).toBe(true);
  });
});

describe('sprite', () => {
  const sprite: SpriteLayer = {
    id: 's',
    name: 'Icon',
    visible: true,
    type: 'sprite',
    x: 2,
    y: 3,
    loopFrom: 0,
    sprite: {
      width: 2,
      height: 1,
      palette: { a: '#00FF00' },
      frames: [
        { duration: 2, rows: ['a.'] },
        { duration: 2, rows: ['.a'] }
      ]
    }
  };

  it('Sprite_PaletteKey_DrawsItsColourAtTheLayerOffset', () => {
    const raster = renderFrame(sceneWith(sprite), 0);
    expect(raster.get(2, 3)).toEqual([0, 255, 0]);
  });

  it('Sprite_TransparentPixel_LeavesTheLayerBelowVisible', () => {
    const raster = renderFrame(sceneWith(plate({ colorA: '#FF0000', colorB: '#FF0000' }), sprite), 0);
    expect(raster.get(3, 3)).toEqual([255, 0, 0]);
  });

  it('Sprite_LaterFrame_ShowsTheFrameForThatTime', () => {
    const raster = renderFrame(sceneWith(sprite), 2);
    expect(raster.get(2, 3)).toEqual(BLACK);
    expect(raster.get(3, 3)).toEqual([0, 255, 0]);
  });
});

describe('text', () => {
  const lunchWidth = measure('LUNCH', SCENE_FONTS['bold-7']);

  it('Text_LeftAligned_InkSpansItsMeasuredWidth', () => {
    const columns = litColumns(renderFrame(sceneWith(text()), 0));
    expect(columns[0]).toBe(0);
    expect(columns.at(-1)).toBe(lunchWidth - 1);
  });

  it('Text_Centred_SplitsTheSpareWidthEvenly', () => {
    const columns = litColumns(renderFrame(sceneWith(text({ align: 'center' })), 0));
    const left = columns[0];
    const right = 72 - 1 - columns.at(-1)!;
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it('Text_LowercaseInDisplayFont_FallsBackToCapitals', () => {
    const upper = renderFrame(sceneWith(text({ text: 'LUNCH' })), 0);
    const lower = renderFrame(sceneWith(text({ text: 'lunch' })), 0);
    expect(lower.data).toEqual(upper.data);
  });

  it('Text_OutsideItsBox_IsClipped', () => {
    const columns = litColumns(renderFrame(sceneWith(text({ width: 10 })), 0));
    expect(Math.max(...columns)).toBeLessThan(10);
  });

  it('Text_Typewriter_RevealsOneLetterPerPeriodWithoutRecentring', () => {
    const scene = sceneWith(text({ effect: 'typewriter', period: 4, align: 'center' }));
    const first = litColumns(renderFrame(scene, 0));
    const all = litColumns(renderFrame(scene, 4 * 5));
    // Same left edge: alignment is computed on the full text.
    expect(first[0]).toBe(all[0]);
    expect(first.length).toBeLessThan(all.length);
    expect(litColumns(renderFrame(scene, 4)).length).toBeGreaterThan(first.length);
  });

  it('Text_Blink_HiddenInSecondHalfOfPeriod', () => {
    const scene = sceneWith(text({ effect: 'blink', period: 10 }));
    expect(litColumns(renderFrame(scene, 2)).length).toBeGreaterThan(0);
    expect(litColumns(renderFrame(scene, 7))).toEqual([]);
  });

  it('Text_Scroll_MovesLeftAndRepeatsAfterOneCycle', () => {
    const scene = sceneWith(text({ effect: 'scroll', period: 1, width: 72 }));
    const start = renderFrame(scene, 0);
    expect(renderFrame(scene, 1).data).not.toEqual(start.data);
    // One cycle is the text's width plus the gap between repeats.
    expect(renderFrame(scene, lunchWidth + 12).data).toEqual(start.data);
  });

  it('Text_Wave_MovesLettersVertically', () => {
    const scene = sceneWith(text({ effect: 'wave', y: 4, period: 8 }));
    expect(renderFrame(scene, 2).data).not.toEqual(renderFrame(sceneWith(text({ y: 4 })), 0).data);
  });

  it('Text_Shine_BrightensPartOfTheText', () => {
    const scene = sceneWith(text({ effect: 'shine', color: '#808080', period: 20 }));
    const pixels = (r: Raster) => {
      const seen = new Set<string>();
      for (let x = 0; x < r.width; x++) for (let y = 0; y < r.height; y++) seen.add(r.get(x, y).join());
      return seen;
    };
    expect(pixels(renderFrame(scene, 10)).size).toBeGreaterThan(2);
  });
});
