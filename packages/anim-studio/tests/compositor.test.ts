import { describe, expect, it } from 'vitest';
import { createScene, GlowLayer, PlateLayer, Scene, SpriteLayer, TextLayer } from '../src/model/scene';
import { loopSeam, renderFrame, roundedRectCoverage } from '../src/render/compositor';
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
    outlineBottom: null,
    highlight: null,
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
    colorB: null,
    gradient: 'vertical',
    shadow: null,
    tracks: {},
    ...overrides
  };
}

/** A solid 2x2 green block: small enough to reason about pixel by pixel. */
function block(overrides: Partial<SpriteLayer> = {}): SpriteLayer {
  return {
    id: 'b',
    name: 'Block',
    visible: true,
    type: 'sprite',
    x: 4,
    y: 4,
    loopFrom: 0,
    anchorX: 1,
    anchorY: 2,
    tracks: {},
    shutter: 0,
    sprite: { width: 2, height: 2, palette: { a: '#00FF00' }, frames: [{ duration: 1, rows: ['aa', 'aa'] }] },
    ...overrides
  };
}

function glow(overrides: Partial<GlowLayer> = {}): GlowLayer {
  return {
    id: 'g',
    name: 'Glow',
    visible: true,
    type: 'glow',
    x: 10,
    y: 8,
    radiusX: 6,
    radiusY: 6,
    color: '#0000FF',
    strength: 1,
    mode: 'light',
    tracks: {},
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

  it('Plate_RadiusTwo_CornerPixelIsPartlyLitNotCut', () => {
    // Anti-aliased, as the official plates are: neither a notch nor a square.
    const raster = renderFrame(sceneWith(plate({ radius: 2, colorB: '#FF0000' })), 0);
    const corner = raster.get(0, 0)[0];
    expect(corner).toBeGreaterThan(0);
    expect(corner).toBeLessThan(128);
    expect(raster.get(1, 0)[0]).toBeGreaterThan(corner);
    expect(raster.get(3, 0)).toEqual([255, 0, 0]);
    expect(raster.get(71, 15)[0]).toBe(corner);
  });

  it('Plate_OutlineBottom_GradesTheOutlineDownTheSides', () => {
    const raster = renderFrame(sceneWith(plate({ outline: '#FFFFFF', outlineBottom: '#000080' })), 0);
    expect(raster.get(0, 0)).toEqual([255, 255, 255]);
    expect(raster.get(0, 15)).toEqual([0, 0, 128]);
    const middle = raster.get(0, 8);
    expect(middle[0]).toBeGreaterThan(0);
    expect(middle[0]).toBeLessThan(255);
  });

  it('Plate_Highlight_LightsTheRowUnderTheTopOutline', () => {
    const raster = renderFrame(
      sceneWith(plate({ outline: '#FFFFFF', highlight: '#00FF00', colorA: '#FF0000', colorB: '#FF0000' })),
      0
    );
    expect(raster.get(36, 1)).toEqual([0, 255, 0]);
    expect(raster.get(36, 2)).toEqual([255, 0, 0]);
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

  it('RoundedRectCoverage_CornerOfRadiusThree_FallsOffTowardsTheCorner', () => {
    const cov = (x: number, y: number) => roundedRectCoverage(x, y, 20, 10, 3);
    expect(cov(0, 0)).toBeLessThan(cov(1, 0));
    expect(cov(1, 0)).toBeLessThan(1);
    expect(cov(1, 1)).toBe(1);
    expect(cov(3, 0)).toBe(1);
    expect(cov(0, 3)).toBe(1);
  });

  it('RoundedRectCoverage_OutsideBounds_IsZero', () => {
    expect(roundedRectCoverage(-1, 0, 10, 10, 0)).toBe(0);
    expect(roundedRectCoverage(10, 0, 10, 10, 0)).toBe(0);
    expect(roundedRectCoverage(5, 5, 10, 10, 3)).toBe(1);
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
    anchorX: 1,
    anchorY: 0.5,
    tracks: {},
    shutter: 0,
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

describe('keyframed sprite', () => {
  const GREEN = [0, 255, 0];

  it('Sprite_WholePixelPositionAtScaleOne_StaysCrisp', () => {
    const raster = renderFrame(sceneWith(block()), 0);
    expect(raster.get(4, 4)).toEqual(GREEN);
    expect(raster.get(5, 5)).toEqual(GREEN);
    expect(raster.get(6, 4)).toEqual(BLACK);
  });

  it('Sprite_HalfPixelPosition_BlendsBothNeighbours', () => {
    const raster = renderFrame(sceneWith(block({ x: 4.5 })), 0);
    expect(raster.get(4, 4)).toEqual([0, 128, 0]);
    expect(raster.get(5, 4)).toEqual(GREEN);
    expect(raster.get(6, 4)).toEqual([0, 128, 0]);
  });

  it('Sprite_YTrack_MovesTheSpriteBetweenKeys', () => {
    const falling = block({
      tracks: {
        y: [
          { frame: 0, value: 0, ease: 'linear' },
          { frame: 10, value: 10, ease: 'linear' }
        ]
      }
    });
    expect(renderFrame(sceneWith(falling), 0).get(4, 0)).toEqual(GREEN);
    expect(renderFrame(sceneWith(falling), 5).get(4, 5)).toEqual(GREEN);
    expect(renderFrame(sceneWith(falling), 5).get(4, 0)).toEqual(BLACK);
    // Held after the last key.
    expect(renderFrame(sceneWith(falling), 20).get(4, 10)).toEqual(GREEN);
  });

  it('Sprite_ScaleYAboutBaseAnchor_SquashesTowardsTheBase', () => {
    // Anchor at the bottom edge: a squash keeps the sprite standing on its base.
    const squashed = block({ tracks: { scaleY: [{ frame: 0, value: 0.5, ease: 'linear' }] } });
    const raster = renderFrame(sceneWith(squashed), 0);
    expect(raster.get(4, 4)).toEqual(BLACK);
    expect(raster.get(4, 5)).toEqual(GREEN);
  });

  it('Sprite_NegativeScaleX_MirrorsTheSprite', () => {
    const asymmetric = block({
      anchorX: 1,
      sprite: { width: 2, height: 1, palette: { a: '#00FF00' }, frames: [{ duration: 1, rows: ['a.'] }] },
      tracks: { scaleX: [{ frame: 0, value: -1, ease: 'linear' }] }
    });
    const raster = renderFrame(sceneWith(asymmetric), 0);
    expect(raster.get(4, 4)).toEqual(BLACK);
    expect(raster.get(5, 4)).toEqual(GREEN);
  });

  it('Sprite_HalfOpacity_BlendsOverWhatIsBelow', () => {
    const faded = block({ tracks: { opacity: [{ frame: 0, value: 0.5, ease: 'linear' }] } });
    expect(renderFrame(sceneWith(faded), 0).get(4, 4)).toEqual([0, 128, 0]);
  });

  it('Sprite_ZeroOpacity_DrawsNothing', () => {
    const hidden = block({ tracks: { opacity: [{ frame: 0, value: 0, ease: 'linear' }] } });
    expect(renderFrame(sceneWith(hidden), 0).get(4, 4)).toEqual(BLACK);
  });

  it('Sprite_Shutter_SmearsAFastMoveAcrossItsPath', () => {
    const fast = (shutter: number) =>
      block({
        shutter,
        tracks: {
          x: [
            { frame: 0, value: 0, ease: 'linear' },
            { frame: 4, value: 32, ease: 'linear' }
          ]
        }
      });
    const lit = (r: Raster) => {
      let n = 0;
      for (let x = 0; x < r.width; x++) if (r.get(x, 4)[1] > 0) n++;
      return n;
    };
    expect(lit(renderFrame(sceneWith(fast(1)), 1))).toBeGreaterThan(lit(renderFrame(sceneWith(fast(0)), 1)));
  });
});

describe('glow', () => {
  it('Glow_Light_BrightensTheCentreAndNothingBeyondItsRadius', () => {
    const raster = renderFrame(sceneWith(glow()), 0);
    expect(raster.get(9, 7)[2]).toBeGreaterThan(200);
    expect(raster.get(12, 7)[2]).toBeLessThan(raster.get(9, 7)[2]);
    expect(raster.get(30, 7)).toEqual(BLACK);
  });

  it('Glow_Shade_TintsWhatIsBelowTowardsItsColour', () => {
    const white = plate({ colorA: '#FFFFFF', colorB: '#FFFFFF' });
    const raster = renderFrame(sceneWith(white, glow({ mode: 'shade', color: '#000000' })), 0);
    expect(raster.get(9, 7)[0]).toBeLessThan(60);
    expect(raster.get(40, 7)).toEqual([255, 255, 255]);
  });

  it('Glow_OpacityTrackAtZero_DrawsNothing', () => {
    const off = glow({ tracks: { opacity: [{ frame: 0, value: 0, ease: 'linear' }] } });
    expect(renderFrame(sceneWith(off), 0).get(9, 7)).toEqual(BLACK);
  });
});

describe('text depth', () => {
  it('Text_HardShadow_DrawsOneRowBelowTheInkAndNotOverIt', () => {
    const shadowed = text({ text: 'L', y: 0, shadow: { color: '#FF0000', dx: 0, dy: 1, soft: false } });
    const raster = renderFrame(sceneWith(shadowed), 0);
    // The L's bottom bar ends at row 6 of Bold 7; its shadow is row 7.
    expect(raster.get(1, 6)).toEqual([255, 255, 255]);
    expect(raster.get(1, 7)).toEqual([255, 0, 0]);
  });

  it('Text_SoftShadow_SpreadsFurtherThanAHardOne', () => {
    const lit = (soft: boolean) => {
      const r = renderFrame(sceneWith(text({ shadow: { color: '#FF0000', dx: 0, dy: 1, soft } })), 0);
      let n = 0;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 72; x++) if (r.get(x, y)[0] > 0) n++;
      return n;
    };
    expect(lit(true)).toBeGreaterThan(lit(false));
  });

  it('Text_VerticalGradient_TopAndBottomRowsDiffer', () => {
    const raster = renderFrame(sceneWith(text({ text: 'I', colorB: '#0000FF' })), 0);
    expect(raster.get(0, 0)).toEqual([255, 255, 255]);
    expect(raster.get(0, 6)).toEqual([0, 0, 255]);
  });

  it('Text_XTrack_MovesTheTextByWholePixels', () => {
    const sliding = text({
      text: 'I',
      tracks: {
        x: [
          { frame: 0, value: 0, ease: 'linear' },
          { frame: 10, value: 10, ease: 'linear' }
        ]
      }
    });
    const raster = renderFrame(sceneWith(sliding), 5);
    expect(raster.get(5, 0)).toEqual([255, 255, 255]);
    expect(raster.get(0, 0)).toEqual(BLACK);
  });
});

describe('loopSeam', () => {
  it('LoopSeam_StillScene_IsZero', () => {
    expect(loopSeam(sceneWith(plate(), text()))).toBe(0);
  });

  it('LoopSeam_MotionThatDoesNotReturn_CountsTheJump', () => {
    const drifting = block({
      tracks: {
        x: [
          { frame: 0, value: 0, ease: 'linear' },
          { frame: 240, value: 20, ease: 'linear' }
        ]
      }
    });
    expect(loopSeam(sceneWith(drifting))).toBeGreaterThan(0);
  });

  it('LoopSeam_MotionThatReturnsToItsStart_IsZero', () => {
    const returning = block({
      tracks: {
        x: [
          { frame: 0, value: 0, ease: 'inOut' },
          { frame: 120, value: 20, ease: 'inOut' },
          { frame: 240, value: 0, ease: 'inOut' }
        ]
      }
    });
    expect(loopSeam(sceneWith(returning))).toBe(0);
  });
});
