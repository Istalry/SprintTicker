import { BitmapIconId } from '../../shared/dtos';
import { getBitmapById } from './pixel-bitmaps';

/**
 * Utility processor that converts, downscales, and centers notification application icons
 * into a 15x15 pixel matrix centered inside a 16x16 icon slot on the 72x16 LED matrix display.
 */
export class AppIconBitmapProcessor {
  /**
   * Processes an incoming raw pixel matrix or fallback icon identifier,
   * returning a 16x16 pixel matrix containing a centered 15x15 icon.
   *
   * @param iconInput Raw 2D pixel array or BitmapIconId string
   * @returns 16x16 grid with 15x15 icon centered
   */
  public static processAppIcon(
    iconInput: (string | null)[][] | BitmapIconId | string
  ): (string | null)[][] {
    let sourceMatrix: (string | null)[][];

    const knownIcons = [
      'checkmark', 'slack', 'discord', 'gmail', 'antigravity', 'battery',
      'windows', 'bell', 'burger', 'clock', 'wave', 'pause', 'play',
      'resume', 'stop', 'error', 'compiling', 'playmode', 'unity'
    ];

    if (typeof iconInput === 'string') {
      const lower = iconInput.toLowerCase();
      sourceMatrix = knownIcons.includes(lower) ? getBitmapById(lower) : getBitmapById('bell');
    } else if (Array.isArray(iconInput) && iconInput.length > 0) {
      sourceMatrix = iconInput;
    } else {
      sourceMatrix = getBitmapById('bell');
    }

    const scaled15 = this.downscaleTo15x15(sourceMatrix);
    return this.center15x15In16x16(scaled15);
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
