import { nativeImage } from 'electron';
import fs from 'fs';
import { BitmapIconId } from '../../shared/dtos';
import { getBitmapById } from './pixel-bitmaps';

/**
 * Utility processor that converts, downscales, and centers notification application icons
 * into a 15x15 pixel matrix centered inside a 16x16 icon slot on the 72x16 LED matrix display.
 */
export class AppIconBitmapProcessor {
  private static iconCache = new Map<string, (string | null)[][]>();

  /**
   * Clears the in-memory app icon cache.
   */
  public static clearCache(): void {
    this.iconCache.clear();
  }

  /**
   * Processes an incoming raw pixel matrix, image file path, Base64 string, or fallback icon identifier,
   * returning a 16x16 pixel matrix containing a centered 15x15 icon.
   *
   * @param iconInput Raw 2D pixel array, file path, Base64 data, or BitmapIconId string
   * @param cacheKey Optional cache key identifier (e.g. appId)
   * @returns 16x16 grid with 15x15 icon centered
   */
  public static processAppIcon(
    iconInput: (string | null)[][] | BitmapIconId | string,
    cacheKey?: string
  ): (string | null)[][] {
    if (cacheKey && this.iconCache.has(cacheKey)) {
      return this.iconCache.get(cacheKey)!;
    }

    let sourceMatrix: (string | null)[][];

    const knownIcons = [
      'checkmark', 'slack', 'discord', 'gmail', 'antigravity', 'battery',
      'windows', 'bell', 'burger', 'clock', 'wave', 'pause', 'play',
      'resume', 'stop', 'error', 'compiling', 'playmode', 'unity'
    ];

    if (typeof iconInput === 'string') {
      const lower = iconInput.toLowerCase();
      if (knownIcons.includes(lower)) {
        sourceMatrix = getBitmapById(lower as BitmapIconId);
      } else {
        console.log('[AppIconProcessor] Processing custom image:', iconInput);
        const parsed = this.parseImageToMatrix(iconInput);
        if (!parsed) {
          console.warn(`[AppIconProcessor] -> parseImageToMatrix returned null for custom image. Falling back to default 'bell' icon.`);
          sourceMatrix = getBitmapById('bell');
        } else {
          console.log(`[AppIconProcessor] -> Successfully parsed custom image into matrix.`);
          sourceMatrix = parsed;
        }
      }
    } else if (Array.isArray(iconInput) && iconInput.length > 0) {
      sourceMatrix = iconInput;
    } else {
      sourceMatrix = getBitmapById('bell');
    }

    const scaled15 = this.downscaleTo15x15(sourceMatrix);
    const result16 = this.center15x15In16x16(scaled15);

    if (cacheKey) {
      this.iconCache.set(cacheKey, result16);
    }

    return result16;
  }

  /**
   * Parses an image file or Base64 string into a 15x15 pixel color matrix.
   */
  public static parseImageToMatrix(imageInput: string): (string | null)[][] | null {
    try {
      if (!nativeImage || typeof nativeImage.createFromPath !== 'function') {
        console.error('[AppIconProcessor] nativeImage is undefined or invalid');
        return null;
      }

      let img: ReturnType<typeof nativeImage.createFromPath> | null = null;
      if (imageInput.startsWith('data:image/')) {
        img = nativeImage.createFromDataURL(imageInput);
      } else {
        const filePath = imageInput.startsWith('file://') ? imageInput.replace('file://', '') : imageInput;
        try {
          const buffer = fs.readFileSync(filePath);
          img = nativeImage.createFromBuffer(buffer);
        } catch (err) {
          console.warn('[AppIconProcessor] fs.readFileSync failed, falling back to createFromPath:', err);
          img = nativeImage.createFromPath(filePath);
        }
      }

      if (!img || img.isEmpty()) {
        console.warn('[AppIconProcessor] nativeImage is empty after loading');
        return null;
      }
      
      console.log(`[AppIconProcessor] Successfully loaded image, resizing...`);

      const resized = img.resize({ width: 15, height: 15, quality: 'best' });
      const size = resized.getSize();
      if (!size || size.width === 0 || size.height === 0) {
        console.warn('[AppIconProcessor] resized image has 0 size');
        return null;
      }

      const buffer = resized.toBitmap();
      if (!buffer || buffer.length < 15 * 15 * 4) {
        console.warn('[AppIconProcessor] buffer length is too small:', buffer?.length);
        return null;
      }

      const matrix: (string | null)[][] = Array.from({ length: 15 }, () => Array(15).fill(null));

      let processedPixels = 0;
      for (let y = 0; y < 15; y++) {
        for (let x = 0; x < 15; x++) {
          const offset = (y * 15 + x) * 4;
          const b = buffer[offset];
          const g = buffer[offset + 1];
          const r = buffer[offset + 2];
          const a = buffer[offset + 3];

          if (a > 30) {
            const hexR = r.toString(16).padStart(2, '0').toUpperCase();
            const hexG = g.toString(16).padStart(2, '0').toUpperCase();
            const hexB = b.toString(16).padStart(2, '0').toUpperCase();
            const hexA = a.toString(16).padStart(2, '0').toUpperCase();
            matrix[y][x] = `#${hexR}${hexG}${hexB}${hexA}`;
            processedPixels++;
          }
        }
      }
      console.log(`[AppIconProcessor] -> Matrix conversion complete. ${processedPixels}/225 pixels are visible.`);
      return matrix;
    } catch (e) {
      console.error('[AppIconProcessor] Exception during parse:', e);
      return null;
    }
  }

  /**
   * Resizes an N x N pixel array down to a 15x15 pixel grid using nearest-neighbor sampling.
   *
   * @param matrix Input N x N 2D array
   * @returns 15x15 2D pixel array
   */
  public static downscaleTo15x15(matrix: (string | null)[][]): (string | null)[][] {
    const srcHeight = matrix.length;
    const srcWidth = srcHeight > 0 ? matrix[0].length : 0;

    if (srcHeight === 15 && srcWidth === 15) {
      return matrix;
    }

    const targetSize = 15;
    const result: (string | null)[][] = Array.from({ length: targetSize }, () =>
      Array(targetSize).fill(null)
    );

    if (srcHeight === 0 || srcWidth === 0) {
      return result;
    }

    for (let r = 0; r < targetSize; r++) {
      const srcR = Math.floor((r * srcHeight) / targetSize);
      for (let c = 0; c < targetSize; c++) {
        const srcC = Math.floor((c * srcWidth) / targetSize);
        result[r][c] = matrix[srcR]?.[srcC] ?? null;
      }
    }

    return result;
  }

  /**
   * Centers a 15x15 pixel array inside a 16x16 grid with 1-pixel margin offset.
   *
   * @param matrix15x15 15x15 2D pixel array
   * @returns 16x16 2D pixel array
   */
  public static center15x15In16x16(matrix15x15: (string | null)[][]): (string | null)[][] {
    const result16: (string | null)[][] = Array.from({ length: 16 }, () =>
      Array(16).fill(null)
    );

    const offsetR = 0;
    const offsetC = 0;

    for (let r = 0; r < 15 && r < matrix15x15.length; r++) {
      for (let c = 0; c < 15 && c < matrix15x15[r].length; c++) {
        result16[r + offsetR][c + offsetC] = matrix15x15[r][c];
      }
    }

    return result16;
  }
}
