import type { AnimationData } from '../hardware/animation-sequence';
import { decodePng } from '../hardware/png-decode';
import { ArgumentNullException } from '../../shared/dtos';
import { DECK_ICON_FPS, DECK_MAX_ICON_POSES, DECK_MAX_ICON_STEPS, DeckIconMotion } from '../../shared/deck-protocol';

/** The side of a bar icon, in LEDs. */
const ICON_SIDE = 16;

/** Below this alpha a pixel is not drawn. */
const OPAQUE_FROM = 128;

/**
 * One frame as an icon's pixels: `#RRGGBB`, or null for nothing.
 *
 * Pure black is nothing too. The frames in `Animations/` are drawn for the
 * bar, where black is an LED that is off, and most are opaque black around
 * the icon; on a key that black would be a dark square behind it.
 */
export function framePixels(png: Buffer): (string | null)[][] {
  const { width, height, rgba } = decodePng(png);
  const rows: (string | null)[][] = [];
  for (let y = 0; y < Math.min(height, ICON_SIDE); y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < Math.min(width, ICON_SIDE); x++) {
      const i = (y * width + x) * 4;
      const [r, g, b, a] = [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
      const lit = a >= OPAQUE_FROM && (r | g | b) !== 0;
      row.push(lit ? `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase()}` : null);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * An animation as the deck plays it: sampled at {@link DECK_ICON_FPS} at
 * most, every pose once, and the order they show in. Null when nothing
 * moves at that rate, or when it will not fit the protocol's bounds -- the
 * key then shows the still icon, as the bar does when it refuses an `.anim`.
 */
export function iconMotionFrom(animation: Pick<AnimationData, 'fps' | 'frames'>): DeckIconMotion | null {
  if (!animation || animation.frames.length === 0 || !(animation.fps > 0)) return null;
  const every = Math.max(1, Math.round(animation.fps / DECK_ICON_FPS));
  const poses: (string | null)[][][] = [];
  const keys = new Map<string, number>();
  const sequence: number[] = [];
  for (let i = 0; i < animation.frames.length; i += every) {
    const pixels = framePixels(animation.frames[i]);
    const key = JSON.stringify(pixels);
    let pose = keys.get(key);
    if (pose === undefined) {
      pose = poses.length;
      poses.push(pixels);
      keys.set(key, pose);
    }
    sequence.push(pose);
  }
  if (poses.length < 2 || poses.length > DECK_MAX_ICON_POSES || sequence.length > DECK_MAX_ICON_STEPS) return null;
  return { fps: animation.fps / every, poses, sequence };
}

/**
 * Each animated icon's motion, read from its frames the first time it is
 * asked for and kept: the bar's icons are a dozen, and a deck asks for the
 * same few all day.
 */
export class DeckIconMotions {
  private readonly _load: (name: string) => Promise<Pick<AnimationData, 'fps' | 'frames'> | null>;
  private readonly _motions = new Map<string, DeckIconMotion | null>();
  private readonly _loading = new Set<string>();
  private readonly _listeners = new Set<() => void>();

  constructor(load: (name: string) => Promise<Pick<AnimationData, 'fps' | 'frames'> | null>) {
    if (!load) throw new ArgumentNullException('load');
    this._load = load;
  }

  /**
   * The motion of `name` if it is read, and null until then -- the still
   * icon, which is also what the key shows if it never loads. The first
   * ask starts reading it, and {@link onLoaded} says when it is there.
   */
  public get(name: string): DeckIconMotion | null {
    if (this._motions.has(name)) return this._motions.get(name) ?? null;
    if (!this._loading.has(name)) this.read(name);
    return null;
  }

  /** Hears each motion as it becomes known, so the state can be pushed again. */
  public onLoaded(listener: () => void): () => void {
    if (!listener) throw new ArgumentNullException('listener');
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private read(name: string): void {
    this._loading.add(name);
    this._load(name)
      .then(animation => (animation ? iconMotionFrom(animation) : null))
      .catch((err: unknown) => {
        // A frame the decoder will not read, or a folder gone: the key keeps
        // the still icon, and asking again would fail the same way.
        console.warn(`[Deck] No motion for ${name}:`, err instanceof Error ? err.message : err);
        return null;
      })
      .then(motion => {
        this._motions.set(name, motion);
        this._loading.delete(name);
        if (!motion) return;
        for (const listener of this._listeners) {
          try {
            listener();
          } catch (err) {
            console.error('[Deck] Error in a motion listener:', err);
          }
        }
      })
      .catch((err: unknown) => console.error('[Deck] Unexpected failure reading a motion:', err));
  }
}
