import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { DeckIconMotions, framePixels, iconMotionFrom } from '../src/main/services/deck-icon-motion';
import { encodeMatrixToPng } from '../src/main/hardware/pixel-matrix-to-png';
import { loadAnimationSequence } from '../src/main/hardware/animation-sequence';
import { STOPWATCH_16X16_BITMAP } from '../src/shared/pixel-bitmaps';
import { ANIMATED_ICONS } from '../src/shared/render-constants';
import { DECK_ICON_FPS, DECK_MAX_ICON_POSES, isPlayableMotion } from '../src/shared/deck-protocol';

const ANIMATIONS = path.join(__dirname, '../../../Animations');

/**
 * The real animations are read only where their frames are there. They are
 * Git LFS objects, and the quality workflow checks out without LFS -- LFS
 * bandwidth is the binding quota -- so there each frame is a 130-byte pointer
 * and these tests would only measure that. Every machine with LFS runs them.
 */
const FRAMES_PRESENT = !fs
  .readFileSync(path.join(ANIMATIONS, 'icon_stopwatch_16x16/icon_stopwatch_16x16/frame_00000.png'))
  .subarray(0, 40)
  .toString('latin1')
  .startsWith('version https://git-lfs');

/** A 16x16 frame lit in one colour at one pixel, black elsewhere. */
const frame = (x: number, colour = '#22C55E') =>
  encodeMatrixToPng(Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (__, i) => (y === 0 && i === x ? colour : null))), 16, 16);

describe('framePixels', () => {
  it('FramePixels_BlackIsAnUnlitLed_NotADarkSquare', () => {
    const pixels = framePixels(frame(3, '#FF8800'));
    expect(pixels).toHaveLength(16);
    expect(pixels[0][3]).toBe('#FF8800');
    expect(pixels.flat().filter(Boolean)).toEqual(['#FF8800']);
  });
});

describe('iconMotionFrom', () => {
  it('IconMotionFrom_SixtyFps_SampledToTheDecksRateWithEachPoseOnce', () => {
    // Two poses, a second each, at 60 fps: 120 frames.
    const frames = [...Array(60).fill(frame(0)), ...Array(60).fill(frame(1))];
    const motion = iconMotionFrom({ fps: 60, frames })!;
    expect(motion.fps).toBe(DECK_ICON_FPS);
    expect(motion.poses).toHaveLength(2);
    expect(motion.sequence).toEqual([...Array(10).fill(0), ...Array(10).fill(1)]);
    expect(isPlayableMotion(motion)).toBe(true);
  });

  it('IconMotionFrom_SlowerThanTheDeck_KeptAtItsOwnRate', () => {
    expect(iconMotionFrom({ fps: 4, frames: [frame(0), frame(1)] })?.fps).toBe(4);
  });

  it.each([
    ['nothing moves', { fps: 60, frames: [frame(0), frame(0)] }],
    ['no frames', { fps: 60, frames: [] }],
    ['no rate', { fps: 0, frames: [frame(0), frame(1)] }],
    ['too many poses', { fps: 10, frames: Array.from({ length: DECK_MAX_ICON_POSES + 1 }, (_, i) => frame(i % 16, `#${(i + 16).toString(16).padStart(2, '0')}0000`)) }]
  ])('IconMotionFrom_%s_IsNoMotion', (_name, animation) => {
    expect(iconMotionFrom(animation)).toBeNull();
  });

  it.skipIf(!FRAMES_PRESENT)('IconMotionFrom_TheBarsStopwatch_ThirteenPosesStartingOnItsStillIcon', async () => {
    const animation = await loadAnimationSequence(ANIMATIONS, ANIMATED_ICONS.stopwatch!);
    const motion = iconMotionFrom(animation!)!;
    // One step a second round a twelve-second turn, and one beat more.
    expect(motion.poses).toHaveLength(13);
    expect(motion.sequence).toHaveLength(120);
    // The key starts where the still icon is, as the bar does.
    expect(motion.poses[motion.sequence[0]]).toEqual(STOPWATCH_16X16_BITMAP);
  });

  it.skipIf(!FRAMES_PRESENT).each(Object.entries(ANIMATED_ICONS))('IconMotionFrom_%s_FitsTheProtocol', async (_id, name) => {
    const animation = await loadAnimationSequence(ANIMATIONS, name!);
    const motion = iconMotionFrom(animation!);
    expect(motion === null || isPlayableMotion(motion)).toBe(true);
  });
});

describe('DeckIconMotions', () => {
  const ANIMATION = { fps: 10, frames: [frame(0), frame(1)] };

  it('Get_FirstAsk_StillUntilReadThenTheMotionAndATellingOnce', async () => {
    const load = vi.fn().mockResolvedValue(ANIMATION);
    const motions = new DeckIconMotions(load);
    const heard = vi.fn();
    motions.onLoaded(heard);

    expect(motions.get('icon_gear_16x16')).toBeNull();
    expect(motions.get('icon_gear_16x16')).toBeNull();
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    expect(motions.get('icon_gear_16x16')?.poses).toHaveLength(2);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('Get_LoadFails_StaysStillWithoutTellingOrAskingAgain', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const load = vi.fn().mockRejectedValue(new Error('gone'));
    const motions = new DeckIconMotions(load);
    const heard = vi.fn();
    motions.onLoaded(heard);

    motions.get('icon_bell_16x16');
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    await new Promise(resolve => setImmediate(resolve));
    expect(motions.get('icon_bell_16x16')).toBeNull();
    expect(heard).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('OnLoaded_Unsubscribed_HearsNothing', async () => {
    const motions = new DeckIconMotions(vi.fn().mockResolvedValue(ANIMATION));
    const heard = vi.fn();
    motions.onLoaded(heard)();
    motions.get('icon_check_16x16');
    await new Promise(resolve => setImmediate(resolve));
    expect(heard).not.toHaveBeenCalled();
  });

  it('Constructor_NoLoader_Throws', () => {
    expect(() => new DeckIconMotions(null as never)).toThrow();
    expect(() => new DeckIconMotions(vi.fn()).onLoaded(null as never)).toThrow();
  });
});
