import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * A stand-in for Electron's NativeImage. `toBitmap()` is where the channel
 * order lives: Chromium hands back **BGRA**, so a parser that read it as RGBA
 * would still produce a plausible icon -- with red and blue swapped. The same
 * trap as the device's BGR screen readback (CLAUDE.md §4), and just as silent.
 */
interface FakeImage {
  isEmpty(): boolean;
  resize(): FakeImage;
  getSize(): { width: number; height: number };
  toBitmap(): Buffer;
}

const image = (bgra: Buffer | null, { empty = false, width = 15, height = 15 } = {}): FakeImage => {
  const self: FakeImage = {
    isEmpty: () => empty,
    resize: () => self,
    getSize: () => ({ width, height }),
    toBitmap: () => bgra ?? Buffer.alloc(0)
  };
  return self;
};

/** A 15x15 BGRA bitmap filled with one pixel value. */
const solid = (b: number, g: number, r: number, a: number) => {
  const buffer = Buffer.alloc(15 * 15 * 4);
  for (let i = 0; i < 15 * 15; i++) buffer.set([b, g, r, a], i * 4);
  return buffer;
};

const native = vi.hoisted(() => ({
  createFromBuffer: vi.fn(),
  createFromPath: vi.fn(),
  createFromDataURL: vi.fn()
}));

vi.mock('electron', () => ({ nativeImage: native }));

import { AppIconBitmapProcessor } from '../src/main/hardware/app-icon-bitmap-processor';

describe('AppIconBitmapProcessor image parsing', () => {
  let dir: string;
  let iconFile: string;

  beforeEach(() => {
    AppIconBitmapProcessor.clearCache();
    native.createFromBuffer.mockReset();
    native.createFromPath.mockReset();
    native.createFromDataURL.mockReset();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sprintticker-icon-'));
    iconFile = path.join(dir, 'app.png');
    fs.writeFileSync(iconFile, 'png bytes');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ParseImageToMatrix_ChromiumBgra_ReadsAsRgbaColours', () => {
    native.createFromBuffer.mockReturnValue(image(solid(0x11, 0x22, 0x33, 0xff)));

    const matrix = AppIconBitmapProcessor.parseImageToMatrix(iconFile);

    // Blue 0x11, green 0x22, red 0x33 -> #RRGGBBAA, the device's colour form.
    expect(matrix?.[0][0]).toBe('#332211FF');
    expect(matrix?.[14][14]).toBe('#332211FF');
  });

  it('ParseImageToMatrix_NearlyTransparentPixels_AreLeftEmpty', () => {
    // Antialiased edges at a few percent alpha would otherwise draw as a dark
    // fringe on the LEDs, which have no blending.
    native.createFromBuffer.mockReturnValue(image(solid(0xff, 0xff, 0xff, 30)));

    expect(AppIconBitmapProcessor.parseImageToMatrix(iconFile)?.[7][7]).toBeNull();
  });

  it('ParseImageToMatrix_DataUrl_DecodesItDirectly', () => {
    native.createFromDataURL.mockReturnValue(image(solid(0, 0, 0xff, 0xff)));

    const matrix = AppIconBitmapProcessor.parseImageToMatrix('data:image/png;base64,AAAA');

    expect(native.createFromDataURL).toHaveBeenCalledWith('data:image/png;base64,AAAA');
    expect(matrix?.[0][0]).toBe('#FF0000FF');
  });

  it('ParseImageToMatrix_FileUrl_ReadsThePathBehindIt', () => {
    native.createFromBuffer.mockReturnValue(image(solid(0, 0, 0, 0xff)));

    AppIconBitmapProcessor.parseImageToMatrix(`file://${iconFile}`);

    expect(native.createFromBuffer).toHaveBeenCalledWith(Buffer.from('png bytes'));
  });

  it('ParseImageToMatrix_FileUnreadable_LetsElectronTryThePath', () => {
    // Electron can open some things fs cannot, .ico inside an .exe among them.
    native.createFromPath.mockReturnValue(image(solid(0, 0xff, 0, 0xff)));
    const missing = path.join(dir, 'Slack.exe');

    const matrix = AppIconBitmapProcessor.parseImageToMatrix(missing);

    expect(native.createFromPath).toHaveBeenCalledWith(missing);
    expect(matrix?.[0][0]).toBe('#00FF00FF');
  });

  it.each([
    ['an empty image', image(null, { empty: true })],
    ['a zero-size resize', image(solid(0, 0, 0, 0xff), { width: 0 })],
    ['a truncated bitmap', image(Buffer.alloc(10))]
  ])('ParseImageToMatrix_%s_ReturnsNull', (_label, fake) => {
    native.createFromBuffer.mockReturnValue(fake);

    expect(AppIconBitmapProcessor.parseImageToMatrix(iconFile)).toBeNull();
  });

  it('ParseImageToMatrix_DecoderThrows_ReturnsNull', () => {
    native.createFromBuffer.mockImplementation(() => { throw new Error('corrupt PNG'); });

    expect(AppIconBitmapProcessor.parseImageToMatrix(iconFile)).toBeNull();
  });

  describe('tryProcessAppImage', () => {
    it('TryProcessAppImage_Readable_ReturnsTheIconInTheSlot', () => {
      native.createFromBuffer.mockReturnValue(image(solid(0, 0, 0xff, 0xff)));

      const grid = AppIconBitmapProcessor.tryProcessAppImage(iconFile, 'slack');

      expect(grid).toHaveLength(16);
      expect(grid?.[0][0]).toBe('#FF0000FF');
      // 15x15 in a 16x16 slot: the last row and column stay empty.
      expect(grid?.[15][15]).toBeNull();
    });

    it('TryProcessAppImage_Unreadable_ReturnsNullAndCachesNothing', () => {
      // Returning null lets the caller use the app's own bitmap; caching a
      // failure would pin the fallback for the rest of the session.
      native.createFromBuffer.mockReturnValueOnce(image(null, { empty: true }));
      expect(AppIconBitmapProcessor.tryProcessAppImage(iconFile, 'slack')).toBeNull();

      native.createFromBuffer.mockReturnValueOnce(image(solid(0, 0, 0xff, 0xff)));
      expect(AppIconBitmapProcessor.tryProcessAppImage(iconFile, 'slack')?.[0][0]).toBe('#FF0000FF');
    });

    it('TryProcessAppImage_SecondCallForTheSameApp_DoesNotDecodeAgain', () => {
      native.createFromBuffer.mockReturnValue(image(solid(0, 0, 0xff, 0xff)));

      AppIconBitmapProcessor.tryProcessAppImage(iconFile, 'slack');
      AppIconBitmapProcessor.tryProcessAppImage(iconFile, 'slack');

      expect(native.createFromBuffer).toHaveBeenCalledTimes(1);
    });

    it('TryProcessAppImage_Empty_ReturnsNull', () => {
      expect(AppIconBitmapProcessor.tryProcessAppImage('')).toBeNull();
    });
  });

  describe('processAppIcon', () => {
    it('ProcessAppIcon_UnreadableCustomImage_FallsBackToTheBell', () => {
      native.createFromBuffer.mockReturnValue(image(null, { empty: true }));

      expect(AppIconBitmapProcessor.processAppIcon(iconFile)).toEqual(AppIconBitmapProcessor.processAppIcon('bell'));
    });

    it('ProcessAppIcon_EmptyMatrix_FallsBackToTheBell', () => {
      expect(AppIconBitmapProcessor.processAppIcon([])).toEqual(AppIconBitmapProcessor.processAppIcon('bell'));
    });
  });

  describe('downscaleTo15x15', () => {
    it('DownscaleTo15x15_LargerIcon_SamplesNearestNeighbour', () => {
      const big = Array.from({ length: 30 }, (_, r) => Array.from({ length: 30 }, (_, c) => `#${r}-${c}`));

      const small = AppIconBitmapProcessor.downscaleTo15x15(big);

      expect(small).toHaveLength(15);
      expect(small[1][2]).toBe('#2-4');
    });

    it('DownscaleTo15x15_NoRows_IsAnEmptyGrid', () => {
      const small = AppIconBitmapProcessor.downscaleTo15x15([]);

      expect(small).toHaveLength(15);
      expect(small.flat().every(p => p === null)).toBe(true);
    });
  });
});
