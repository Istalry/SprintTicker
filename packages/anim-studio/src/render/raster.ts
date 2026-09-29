/**
 * An RGBA pixel buffer the compositor draws into.
 *
 * Opaque black to start with, because that is what an unlit LED is: the device
 * has no transparency to show through, and a PNG with alpha would leave the
 * exporter to guess what the transparent parts mean.
 */

export type RgbTriplet = readonly [number, number, number];

export function parseRgb(hex: string): RgbTriplet {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function mix(a: RgbTriplet, b: RgbTriplet, t: number): RgbTriplet {
  const k = Math.min(1, Math.max(0, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k)
  ];
}

export function scale(c: RgbTriplet, factor: number): RgbTriplet {
  return [
    Math.min(255, Math.round(c[0] * factor)),
    Math.min(255, Math.round(c[1] * factor)),
    Math.min(255, Math.round(c[2] * factor))
  ];
}

export class Raster {
  public readonly data: Uint8ClampedArray;

  constructor(public readonly width: number, public readonly height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
    for (let i = 3; i < this.data.length; i += 4) this.data[i] = 255;
  }

  public inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  /** Writes one pixel; anything off the panel is ignored, so layers may overhang. */
  public set(x: number, y: number, [r, g, b]: RgbTriplet): void {
    if (!this.inBounds(x, y)) return;
    const p = (y * this.width + x) * 4;
    this.data[p] = r;
    this.data[p + 1] = g;
    this.data[p + 2] = b;
  }

  public get(x: number, y: number): RgbTriplet {
    const p = (y * this.width + x) * 4;
    return [this.data[p], this.data[p + 1], this.data[p + 2]];
  }
}
