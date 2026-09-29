import { describe, expect, it } from 'vitest';
import { ease, EASINGS, evaluateTrack, Keyframe, keyFrames, setKey } from '../src/model/motion';

describe('ease', () => {
  it('Ease_EveryCurve_StartsAtZeroAndEndsAtOne', () => {
    for (const kind of EASINGS) {
      expect(ease(kind, 0)).toBeCloseTo(0, 6);
      expect(ease(kind, 1)).toBeCloseTo(1, 6);
    }
  });

  it('Ease_In_IsSlowerThanLinearAtFirst', () => {
    // A fall: it starts slowly and accelerates.
    expect(ease('in', 0.25)).toBeLessThan(0.25);
    expect(ease('out', 0.25)).toBeGreaterThan(0.25);
  });

  it('Ease_OutBack_OvershootsTheTarget', () => {
    const peak = Math.max(...Array.from({ length: 100 }, (_, i) => ease('outBack', i / 100)));
    expect(peak).toBeGreaterThan(1);
  });

  it('Ease_OutBounce_NeverPassesTheTarget', () => {
    for (let i = 0; i <= 100; i++) expect(ease('outBounce', i / 100)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('Ease_Step_HoldsUntilTheNextKey', () => {
    expect(ease('step', 0.99)).toBe(0);
  });
});

describe('evaluateTrack', () => {
  const keys: Keyframe[] = [
    { frame: 10, value: 0, ease: 'linear' },
    { frame: 20, value: 10, ease: 'step' },
    { frame: 30, value: 30, ease: 'linear' }
  ];

  it('EvaluateTrack_NoKeys_ReturnsTheFallback', () => {
    expect(evaluateTrack(undefined, 5, 7)).toBe(7);
    expect(evaluateTrack([], 5, 7)).toBe(7);
  });

  it('EvaluateTrack_BeforeFirstAndAfterLast_HoldsTheEndValues', () => {
    expect(evaluateTrack(keys, 0, 99)).toBe(0);
    expect(evaluateTrack(keys, 100, 99)).toBe(30);
  });

  it('EvaluateTrack_BetweenKeys_UsesTheEarlierKeysEase', () => {
    expect(evaluateTrack(keys, 15, 0)).toBe(5);
    expect(evaluateTrack(keys, 25, 0)).toBe(10);
  });

  it('EvaluateTrack_FractionalFrame_Interpolates', () => {
    // Motion blur samples between frames.
    expect(evaluateTrack(keys, 10.5, 0)).toBeCloseTo(0.5);
  });
});

describe('setKey', () => {
  it('SetKey_NewFrame_InsertsInOrderWithThePreviousKeysEase', () => {
    const keys: Keyframe[] = [
      { frame: 0, value: 0, ease: 'in' },
      { frame: 20, value: 1, ease: 'linear' }
    ];
    setKey(keys, 10, 5);
    expect(keys.map(k => k.frame)).toEqual([0, 10, 20]);
    expect(keys[1].ease).toBe('in');
  });

  it('SetKey_ExistingFrame_ReplacesTheValue', () => {
    const keys: Keyframe[] = [{ frame: 5, value: 1, ease: 'out' }];
    setKey(keys, 5, 2);
    expect(keys).toEqual([{ frame: 5, value: 2, ease: 'out' }]);
  });

  it('KeyFrames_SeveralTracks_ReturnsEachFrameOnce', () => {
    expect(
      keyFrames({
        x: [{ frame: 5, value: 0, ease: 'linear' }],
        y: [
          { frame: 0, value: 0, ease: 'linear' },
          { frame: 5, value: 1, ease: 'linear' }
        ]
      })
    ).toEqual([0, 5]);
  });
});
