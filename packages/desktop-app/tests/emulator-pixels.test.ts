import { describe, it, expect } from 'vitest';
import { compositeImage, DecodedImage, ledCoreAlpha, ledLuminance } from '../src/renderer/components/emulator-pixels';

/** A 2x1 image from two RGBA pixels. */
const image = (...pixels: number[][]): DecodedImage => ({
  width: pixels.length,
  height: 1,
  rgba: new Uint8ClampedArray(pixels.flat())
});
const blank = (): (string | null)[][] => Array.from({ length: 2 }, () => Array(3).fill(null));

/**
 * An image in the emulator lights LEDs, as rectangles and bitmaps do: an
 * animated icon drawn as a crisp picture over the matrix flickered between
 * that and its LED still frame.
 */
describe('compositeImage', () => {
  it('CompositeImage_OpaquePixels_LightTheirLeds', () => {
    const buffer = blank();

    compositeImage(buffer, image([255, 0, 0, 255], [0, 128, 255, 255]), 1, 1);

    expect(buffer).toEqual([
      [null, null, null],
      [null, '#ff0000FF', '#0080ffFF']
    ]);
  });

  it('CompositeImage_TransparentPixel_LeavesWhatIsBeneath', () => {
    const buffer = blank();
    buffer[0][0] = '#00ff00FF';

    compositeImage(buffer, image([0, 0, 0, 0], [255, 255, 255, 255]), 0, 0);

    expect(buffer[0]).toEqual(['#00ff00FF', '#ffffffFF', null]);
  });

  it('CompositeImage_OpaqueBlack_TurnsTheLedOff', () => {
    // An animation frame covers the icon's still pixels under it.
    const buffer = blank();
    buffer[0][0] = '#00ff00FF';

    compositeImage(buffer, image([0, 0, 0, 255]), 0, 0);

    expect(buffer[0][0]).toBeNull();
  });

  it('CompositeImage_Translucent_IsDimmer', () => {
    const buffer = blank();

    compositeImage(buffer, image([255, 255, 255, 128]), 0, 0);

    expect(buffer[0][0]).toBe('#808080FF');
  });

  it('CompositeImage_PartlyOffThePanel_ClipsIt', () => {
    const buffer = blank();

    compositeImage(buffer, image([255, 0, 0, 255], [0, 255, 0, 255]), 2, 0);
    compositeImage(buffer, image([0, 0, 255, 255], [0, 0, 255, 255]), -1, 5);

    expect(buffer).toEqual([
      [null, null, '#ff0000FF'],
      [null, null, null]
    ]);
  });
});

/** A dim colour is a dim LED: the white core was on every lit LED alike. */
describe('ledCoreAlpha', () => {
  it('LedCoreAlpha_White_FullCore', () => {
    expect(ledCoreAlpha('#FFFFFFFF')).toBe(1);
  });

  it('LedCoreAlpha_ASceneBackground_NoCore', () => {
    // The lunch scene's deep teal looked as white as its text.
    expect(ledCoreAlpha('#0E2A2EFF')).toBe(0);
  });

  it('LedCoreAlpha_AMidColour_APartCore', () => {
    const alpha = ledCoreAlpha('#3B82F6FF');
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });

  it('LedLuminance_NotAColour_TreatedAsBright', () => {
    expect(ledLuminance('red')).toBe(1);
  });
});
