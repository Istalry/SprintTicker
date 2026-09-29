/**
 * Keyframed motion: the smooth, eased movement the official animations are
 * made of (STYLE-GUIDE.md §5).
 *
 * A track is a list of keyframes for one property. Between two keys the value
 * is interpolated with the *earlier* key's easing, the convention of every
 * animation tool: the ease describes how the value leaves that key. Tracks are
 * evaluated at fractional frames too, which is what motion blur samples.
 */

export const EASINGS = ['linear', 'in', 'out', 'inOut', 'outBack', 'outBounce', 'step'] as const;
export type Easing = (typeof EASINGS)[number];

export const EASING_LABELS: Record<Easing, string> = {
  linear: 'Linear',
  in: 'Ease in',
  out: 'Ease out',
  inOut: 'Ease in-out',
  outBack: 'Overshoot',
  outBounce: 'Bounce',
  step: 'Hold'
};

/** What each curve is for, in the terms of the motion it produces. */
export const EASING_HINTS: Record<Easing, string> = {
  linear: 'Constant speed: a spin, a scroll',
  in: 'Starts slow and accelerates: a fall',
  out: 'Starts fast and decelerates: a landing, an arrival',
  inOut: 'Accelerates then decelerates: a move from rest to rest',
  outBack: 'Goes past the target and settles back: a squash recovering',
  outBounce: 'Bounces to rest on the target: something dropped',
  step: 'Holds the value, then jumps at the next key'
};

export const TRACK_PROPS = ['x', 'y', 'scaleX', 'scaleY', 'opacity'] as const;
export type TrackProp = (typeof TRACK_PROPS)[number];

export interface Keyframe {
  frame: number;
  value: number;
  ease: Easing;
}

export type Tracks = Partial<Record<TrackProp, Keyframe[]>>;

/** What each property may hold. Scale may be negative: that is a mirror. */
export const TRACK_LIMITS: Record<TrackProp, { min: number; max: number }> = {
  x: { min: -256, max: 256 },
  y: { min: -256, max: 256 },
  scaleX: { min: -8, max: 8 },
  scaleY: { min: -8, max: 8 },
  opacity: { min: 0, max: 1 }
};

/** Penner's overshoot constant: about 10% past the target before settling. */
const BACK_OVERSHOOT = 1.70158;

export function ease(kind: Easing, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (kind) {
    case 'linear':
      return x;
    case 'in':
      return x * x * x;
    case 'out':
      return 1 - (1 - x) ** 3;
    case 'inOut':
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
    case 'outBack': {
      const c = BACK_OVERSHOOT;
      return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
    }
    case 'outBounce':
      return bounceOut(x);
    case 'step':
      return x < 1 ? 0 : 1;
  }
}

function bounceOut(x: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
}

/**
 * The value of a track at `frame` (which may be fractional), or `fallback`
 * when the track is empty. Before the first key and after the last, the value
 * holds -- a layer rests where its motion left it.
 */
export function evaluateTrack(keys: readonly Keyframe[] | undefined, frame: number, fallback: number): number {
  if (!keys || keys.length === 0) return fallback;
  if (frame <= keys[0].frame) return keys[0].value;
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last.value;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (frame < b.frame) {
      const t = (frame - a.frame) / (b.frame - a.frame);
      return a.value + (b.value - a.value) * ease(a.ease, t);
    }
  }
  return last.value;
}

/** Inserts or replaces the key at `frame`, keeping the track in frame order. */
export function setKey(keys: Keyframe[], frame: number, value: number, easing?: Easing): Keyframe[] {
  const existing = keys.find(k => k.frame === frame);
  if (existing) {
    existing.value = value;
    if (easing) existing.ease = easing;
    return keys;
  }
  // A new key inherits the easing of the key before it, which is nearly
  // always what a person adding a key in the middle of a move wants.
  const before = [...keys].reverse().find(k => k.frame < frame);
  keys.push({ frame, value, ease: easing ?? before?.ease ?? 'inOut' });
  keys.sort((p, q) => p.frame - q.frame);
  return keys;
}

/** Every frame at which some track of these has a key, for the timeline. */
export function keyFrames(tracks: Tracks): number[] {
  const frames = new Set<number>();
  for (const keys of Object.values(tracks)) for (const k of keys ?? []) frames.add(k.frame);
  return [...frames].sort((a, b) => a - b);
}
