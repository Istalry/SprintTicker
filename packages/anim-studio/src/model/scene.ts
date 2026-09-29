/**
 * The scene model: what a `*.scene.json` file holds.
 *
 * A scene is a fixed number of frames at a fixed rate, drawn by compositing
 * layers bottom to top. It follows the visual language of the BUSY Bar's own
 * animations: a rounded plate with a two-colour gradient and an outline, an
 * animated icon on the left, and large text on the right. Each of those is a
 * layer, and each layer can move on its own.
 *
 * Everything here is plain data, so a scene diffs readably in a commit and the
 * compositor can render any frame from it without hidden state. That
 * determinism is the point: the frame the editor shows, the frame the exporter
 * writes and the frame a test asserts on are the same function of the same
 * input.
 */

import { EASINGS, Keyframe, TRACK_LIMITS, TRACK_PROPS, Tracks } from './motion';

/** `#RRGGBB`. Scene colours are opaque; transparency is a sprite pixel left empty. */
export type Rgb = string;

export const RGB_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * A scene id is also its folder name under `Animations/` and the base of its
 * `.anim` filename, so it must satisfy the device's asset rule
 * (`^[a-zA-Z0-9._-]+$`) -- narrowed here to lowercase and no dots, which keeps
 * it a safe path segment on every filesystem.
 */
export const SCENE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Sprite palette keys: one character each, so a sprite row is a readable string. */
export const PALETTE_KEY_PATTERN = /^[a-zA-Z0-9]$/;

/** The pixel in a sprite row that is left transparent. */
export const TRANSPARENT = '.';

export const FONT_IDS = ['bold-9', 'bold-7', 'sprint-5', 'sprint-small'] as const;
export type FontId = (typeof FONT_IDS)[number];

export const PLATE_MOTIONS = ['none', 'slide', 'pulse'] as const;
export type PlateMotion = (typeof PLATE_MOTIONS)[number];

export const TEXT_EFFECTS = ['none', 'typewriter', 'wave', 'shine', 'scroll', 'blink'] as const;
export type TextEffect = (typeof TEXT_EFFECTS)[number];

export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/** Sizes the device has somewhere to put: the whole front panel, or one icon. */
export const SCENE_SIZES = [
  { width: 72, height: 16, label: 'Full panel 72×16' },
  { width: 16, height: 16, label: 'Icon 16×16' }
] as const;

export const MIN_FPS = 1;
export const MAX_FPS = 60;
/** Long enough for any screen worth animating; short enough that an upload stays small. */
export const MAX_FRAMES = 1800;

interface LayerBase {
  /** Unique within the scene. */
  id: string;
  /** Shown in the layer list only. */
  name: string;
  visible: boolean;
}

/** The rounded, gradient-filled plate the official animations sit on. */
export interface PlateLayer extends LayerBase {
  type: 'plate';
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius in pixels; 0 is a plain rectangle. */
  radius: number;
  colorA: Rgb;
  colorB: Rgb;
  direction: 'horizontal' | 'vertical';
  /** A one-pixel border, or none. */
  outline: Rgb | null;
  /**
   * The outline's colour at the bottom, graded from `outline` at the top; null
   * for a flat outline. The official plates are lit from above, and their
   * outline fades down the sides with them.
   */
  outlineBottom: Rgb | null;
  /** A 1px line just inside the top outline: the plate's catch-light. */
  highlight: Rgb | null;
  motion: PlateMotion;
  /** Frames per cycle of `motion`. */
  period: number;
}

/**
 * A frame-by-frame pixel sprite -- the animated icon.
 *
 * `loopFrom` is what makes "the sandwich stacks up, then idles" possible
 * without repeating the stacking: frames before it play once, then the
 * frames from it onward repeat for the rest of the scene.
 */
export interface SpriteLayer extends LayerBase {
  type: 'sprite';
  /** Top-left, in panel pixels, when no track moves it. */
  x: number;
  y: number;
  sprite: Sprite;
  loopFrom: number;
  /**
   * The point scale is applied about, in sprite pixels from its top-left.
   * A squash wants the base (`height`); a flip wants the centre.
   */
  anchorX: number;
  anchorY: number;
  /** Keyframed x, y, scaleX, scaleY and opacity; x and y are the top-left. */
  tracks: Tracks;
  /**
   * Motion blur, as the fraction of a frame the shutter stays open (0 = none).
   * The official toss smears its fast frames; this is that.
   */
  shutter: number;
}

export interface Sprite {
  width: number;
  height: number;
  /** One character per colour; `.` is transparent and never in the palette. */
  palette: Record<string, Rgb>;
  frames: SpriteFrame[];
}

export interface SpriteFrame {
  /** How many scene frames this sprite frame is shown for. */
  duration: number;
  /** `height` strings of `width` palette keys or `.`. */
  rows: string[];
}

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  font: FontId;
  color: Rgb;
  /** The text box: text is aligned inside `x .. x + width`. */
  x: number;
  y: number;
  width: number;
  align: TextAlign;
  effect: TextEffect;
  /** Frames per cycle of `effect` (per character, for the typewriter). */
  period: number;
  /** A second colour the text is graded towards, or null for flat text. */
  colorB: Rgb | null;
  gradient: TextGradient;
  shadow: TextShadow | null;
  /** Keyframed x, y and opacity. Positions are rounded: text stays crisp. */
  tracks: Tracks;
}

export const TEXT_GRADIENTS = ['vertical', 'diagonal'] as const;
export type TextGradient = (typeof TEXT_GRADIENTS)[number];

/**
 * Depth under the text, as the official titles have (STYLE-GUIDE.md §4): a
 * hard 1px drop, or a soft blurred shade.
 */
export interface TextShadow {
  color: Rgb;
  dx: number;
  dy: number;
  soft: boolean;
}

export const GLOW_MODES = ['light', 'shade'] as const;
export type GlowMode = (typeof GLOW_MODES)[number];

/**
 * A soft elliptical pool of light (or of shadow) -- the halo behind the Back
 * Soon clock, the dark spot behind its words. `light` adds to what is below;
 * `shade` darkens it.
 */
export interface GlowLayer extends LayerBase {
  type: 'glow';
  /** Centre, in panel pixels. */
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  color: Rgb;
  /** Peak strength at the centre, 0..1. */
  strength: number;
  mode: GlowMode;
  /** Keyframed x, y, scaleX, scaleY (of the radii) and opacity. */
  tracks: Tracks;
}

export type Layer = PlateLayer | SpriteLayer | TextLayer | GlowLayer;

export interface Scene {
  version: 1;
  id: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  /** Bottom to top. */
  layers: Layer[];
}

/** Thrown for a scene file that does not describe a valid scene; says where. */
export class SceneError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'SceneError';
  }
}

// ─── parsing ──────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;

function obj(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SceneError(path, 'must be an object');
  }
  return value as Json;
}

function int(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new SceneError(path, `must be an integer from ${min} to ${max}`);
  }
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new SceneError(path, 'must be a string');
  return value;
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new SceneError(path, 'must be true or false');
  return value;
}

function rgb(value: unknown, path: string): Rgb {
  const s = str(value, path);
  // Not a style preference: the device rejects a whole draw for one malformed
  // colour, so nothing loose gets past the file format.
  if (!RGB_PATTERN.test(s)) throw new SceneError(path, `must be a #RRGGBB colour, got ${JSON.stringify(s)}`);
  return s.toUpperCase();
}

function num(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new SceneError(path, `must be a number from ${min} to ${max}`);
  }
  return value;
}

/**
 * Fields added after the first scenes were saved default when absent, so an
 * older file still opens. Present, they are validated like any other.
 */
function opt<T>(value: unknown, fallback: T, parse: (v: unknown) => T): T {
  return value === undefined ? fallback : parse(value);
}

function rgbOrNull(value: unknown, path: string): Rgb | null {
  return value === null ? null : rgb(value, path);
}

const ALL_TRACKS = TRACK_PROPS;
const TEXT_TRACKS = ['x', 'y', 'opacity'] as const;

function parseTracks(value: unknown, path: string, allowed: readonly string[]): Tracks {
  const t = obj(value, path);
  const tracks: Tracks = {};
  for (const [prop, raw] of Object.entries(t)) {
    if (!allowed.includes(prop)) {
      throw new SceneError(`${path}.${prop}`, `is not a track this layer has (${allowed.join(', ')})`);
    }
    if (!Array.isArray(raw)) throw new SceneError(`${path}.${prop}`, 'must be an array of keyframes');
    const limits = TRACK_LIMITS[prop as keyof typeof TRACK_LIMITS];
    let previous = -1;
    tracks[prop as keyof Tracks] = raw.map((k, i): Keyframe => {
      const kp = `${path}.${prop}[${i}]`;
      const key = obj(k, kp);
      const frame = int(key.frame, `${kp}.frame`, 0, MAX_FRAMES);
      // Strictly increasing: two keys on one frame make the value jump
      // without saying which one wins.
      if (frame <= previous) throw new SceneError(`${kp}.frame`, 'keyframes must be in increasing frame order');
      previous = frame;
      return {
        frame,
        value: num(key.value, `${kp}.value`, limits.min, limits.max),
        ease: oneOf(key.ease, `${kp}.ease`, EASINGS)
      };
    });
  }
  return tracks;
}

function parseShadow(value: unknown, path: string): TextShadow {
  const s = obj(value, path);
  return {
    color: rgb(s.color, `${path}.color`),
    dx: int(s.dx, `${path}.dx`, -4, 4),
    dy: int(s.dy, `${path}.dy`, -4, 4),
    soft: bool(s.soft, `${path}.soft`)
  };
}

function oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
    throw new SceneError(path, `must be one of ${options.join(', ')}`);
  }
  return value as T;
}

/** Coordinates may start off-panel, so an element can slide in. */
const COORD_MIN = -256;
const COORD_MAX = 256;

function parseSprite(value: unknown, path: string): Sprite {
  const s = obj(value, path);
  const width = int(s.width, `${path}.width`, 1, 72);
  const height = int(s.height, `${path}.height`, 1, 16);

  const palette: Record<string, Rgb> = {};
  for (const [key, colour] of Object.entries(obj(s.palette, `${path}.palette`))) {
    if (!PALETTE_KEY_PATTERN.test(key)) {
      throw new SceneError(`${path}.palette`, `key ${JSON.stringify(key)} must be one letter or digit`);
    }
    palette[key] = rgb(colour, `${path}.palette.${key}`);
  }

  if (!Array.isArray(s.frames) || s.frames.length === 0) {
    throw new SceneError(`${path}.frames`, 'must be a non-empty array');
  }
  const frames = s.frames.map((f, i): SpriteFrame => {
    const fp = `${path}.frames[${i}]`;
    const frame = obj(f, fp);
    if (!Array.isArray(frame.rows) || frame.rows.length !== height) {
      throw new SceneError(`${fp}.rows`, `must have ${height} rows`);
    }
    const rows = frame.rows.map((r, y) => {
      const row = str(r, `${fp}.rows[${y}]`);
      if (row.length !== width) throw new SceneError(`${fp}.rows[${y}]`, `must be ${width} characters`);
      for (const ch of row) {
        if (ch !== TRANSPARENT && palette[ch] === undefined) {
          throw new SceneError(`${fp}.rows[${y}]`, `uses ${JSON.stringify(ch)}, which is not in the palette`);
        }
      }
      return row;
    });
    return { duration: int(frame.duration, `${fp}.duration`, 1, MAX_FRAMES), rows };
  });

  return { width, height, palette, frames };
}

function parseLayer(value: unknown, path: string): Layer {
  const l = obj(value, path);
  const base = {
    id: str(l.id, `${path}.id`),
    name: str(l.name, `${path}.name`),
    visible: bool(l.visible, `${path}.visible`)
  };
  if (!base.id) throw new SceneError(`${path}.id`, 'must not be empty');

  switch (l.type) {
    case 'plate':
      return {
        ...base,
        type: 'plate',
        x: int(l.x, `${path}.x`, COORD_MIN, COORD_MAX),
        y: int(l.y, `${path}.y`, COORD_MIN, COORD_MAX),
        width: int(l.width, `${path}.width`, 1, 72),
        height: int(l.height, `${path}.height`, 1, 16),
        radius: int(l.radius, `${path}.radius`, 0, 8),
        colorA: rgb(l.colorA, `${path}.colorA`),
        colorB: rgb(l.colorB, `${path}.colorB`),
        direction: oneOf(l.direction, `${path}.direction`, ['horizontal', 'vertical'] as const),
        outline: l.outline === null ? null : rgb(l.outline, `${path}.outline`),
        outlineBottom: opt(l.outlineBottom, null, v => rgbOrNull(v, `${path}.outlineBottom`)),
        highlight: opt(l.highlight, null, v => rgbOrNull(v, `${path}.highlight`)),
        motion: oneOf(l.motion, `${path}.motion`, PLATE_MOTIONS),
        period: int(l.period, `${path}.period`, 1, MAX_FRAMES)
      };
    case 'sprite': {
      const sprite = parseSprite(l.sprite, `${path}.sprite`);
      return {
        ...base,
        type: 'sprite',
        x: int(l.x, `${path}.x`, COORD_MIN, COORD_MAX),
        y: int(l.y, `${path}.y`, COORD_MIN, COORD_MAX),
        sprite,
        loopFrom: int(l.loopFrom, `${path}.loopFrom`, 0, sprite.frames.length - 1),
        anchorX: opt(l.anchorX, sprite.width / 2, v => num(v, `${path}.anchorX`, COORD_MIN, COORD_MAX)),
        anchorY: opt(l.anchorY, sprite.height / 2, v => num(v, `${path}.anchorY`, COORD_MIN, COORD_MAX)),
        tracks: opt(l.tracks, {}, v => parseTracks(v, `${path}.tracks`, ALL_TRACKS)),
        shutter: opt(l.shutter, 0, v => num(v, `${path}.shutter`, 0, 1))
      };
    }
    case 'text':
      return {
        ...base,
        type: 'text',
        text: str(l.text, `${path}.text`),
        font: oneOf(l.font, `${path}.font`, FONT_IDS),
        color: rgb(l.color, `${path}.color`),
        x: int(l.x, `${path}.x`, COORD_MIN, COORD_MAX),
        y: int(l.y, `${path}.y`, COORD_MIN, COORD_MAX),
        width: int(l.width, `${path}.width`, 1, 72),
        align: oneOf(l.align, `${path}.align`, TEXT_ALIGNS),
        effect: oneOf(l.effect, `${path}.effect`, TEXT_EFFECTS),
        period: int(l.period, `${path}.period`, 1, MAX_FRAMES),
        colorB: opt(l.colorB, null, v => rgbOrNull(v, `${path}.colorB`)),
        gradient: opt(l.gradient, 'vertical', v => oneOf(v, `${path}.gradient`, TEXT_GRADIENTS)),
        shadow: opt(l.shadow, null, v => (v === null ? null : parseShadow(v, `${path}.shadow`))),
        tracks: opt(l.tracks, {}, v => parseTracks(v, `${path}.tracks`, TEXT_TRACKS))
      };
    case 'glow':
      return {
        ...base,
        type: 'glow',
        x: num(l.x, `${path}.x`, COORD_MIN, COORD_MAX),
        y: num(l.y, `${path}.y`, COORD_MIN, COORD_MAX),
        radiusX: num(l.radiusX, `${path}.radiusX`, 0.5, 72),
        radiusY: num(l.radiusY, `${path}.radiusY`, 0.5, 72),
        color: rgb(l.color, `${path}.color`),
        strength: num(l.strength, `${path}.strength`, 0, 1),
        mode: oneOf(l.mode, `${path}.mode`, GLOW_MODES),
        tracks: opt(l.tracks, {}, v => parseTracks(v, `${path}.tracks`, ALL_TRACKS))
      };
    default:
      throw new SceneError(`${path}.type`, 'must be plate, sprite, text or glow');
  }
}

/**
 * Validates a parsed scene file and returns it typed.
 *
 * Throws `SceneError` naming the first bad field, rather than accepting a
 * scene the compositor would render wrongly or the device would refuse.
 */
export function parseScene(value: unknown): Scene {
  const s = obj(value, 'scene');
  if (s.version !== 1) throw new SceneError('scene.version', 'must be 1');

  const id = str(s.id, 'scene.id');
  if (!SCENE_ID_PATTERN.test(id)) {
    throw new SceneError('scene.id', 'must be lowercase letters, digits, - or _, starting with a letter or digit');
  }
  const width = int(s.width, 'scene.width', 1, 72);
  const height = int(s.height, 'scene.height', 1, 16);
  if (!SCENE_SIZES.some(size => size.width === width && size.height === height)) {
    throw new SceneError('scene', `size ${width}x${height} is not one the device can place (72x16 or 16x16)`);
  }
  if (!Array.isArray(s.layers)) throw new SceneError('scene.layers', 'must be an array');

  const layers = s.layers.map((l, i) => parseLayer(l, `scene.layers[${i}]`));
  const ids = new Set<string>();
  for (const layer of layers) {
    if (ids.has(layer.id)) throw new SceneError('scene.layers', `layer id ${JSON.stringify(layer.id)} is used twice`);
    ids.add(layer.id);
  }

  return {
    version: 1,
    id,
    width,
    height,
    fps: int(s.fps, 'scene.fps', MIN_FPS, MAX_FPS),
    frameCount: int(s.frameCount, 'scene.frameCount', 1, MAX_FRAMES),
    layers
  };
}

/** Serialises a scene the way it is stored: stable key order, two-space indent. */
export function serializeScene(scene: Scene): string {
  return `${JSON.stringify(scene, null, 2)}\n`;
}

// ─── sprite timing ────────────────────────────────────────────────────────────

/**
 * Which sprite frame is showing at scene frame `sceneFrame`.
 *
 * Frames play in order for their durations. After the last one, playback
 * returns to `loopFrom` rather than to 0, so an intro plays once and the idle
 * part repeats.
 */
export function spriteFrameIndexAt(layer: Pick<SpriteLayer, 'sprite' | 'loopFrom'>, sceneFrame: number): number {
  const { frames } = layer.sprite;
  const loopFrom = Math.min(Math.max(0, layer.loopFrom), frames.length - 1);

  let t = Math.max(0, sceneFrame);
  const total = frames.reduce((sum, f) => sum + f.duration, 0);
  if (t >= total) {
    const introLength = frames.slice(0, loopFrom).reduce((sum, f) => sum + f.duration, 0);
    const loopLength = total - introLength;
    t = introLength + ((t - total) % loopLength);
  }

  for (let i = 0; i < frames.length; i++) {
    if (t < frames[i].duration) return i;
    t -= frames[i].duration;
  }
  return frames.length - 1;
}

// ─── construction ─────────────────────────────────────────────────────────────

/** A new, empty scene of one of the supported sizes. */
export function createScene(id: string, width = 72, height = 16): Scene {
  // 60 fps like the official animations (STYLE-GUIDE.md §7): holds cost
  // nothing, and smooth motion needs the frames. Four seconds to start with.
  return { version: 1, id, width, height, fps: 60, frameCount: 240, layers: [] };
}

/** A layer id not yet used in `scene`, derived from `base`. */
export function nextLayerId(scene: Scene, base: string): string {
  const used = new Set(scene.layers.map(l => l.id));
  for (let n = 1; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export function createPlate(scene: Scene): PlateLayer {
  return {
    id: nextLayerId(scene, 'plate'),
    name: 'Plate',
    visible: true,
    type: 'plate',
    // One dark column at each end, as the official plates leave
    // (STYLE-GUIDE.md §2); an icon scene uses the whole square.
    x: scene.width > 16 ? 1 : 0,
    y: 0,
    width: scene.width > 16 ? scene.width - 2 : scene.width,
    height: scene.height,
    radius: 2,
    // Lit from above: the fill darkens downwards, the outline is brighter
    // and more saturated than the fill, and fades down the sides.
    colorA: '#223A33',
    colorB: '#1A2B26',
    direction: 'vertical',
    outline: '#2C5A36',
    outlineBottom: '#19331E',
    highlight: '#274236',
    motion: 'none',
    period: 60
  };
}

export function createSprite(scene: Scene, size = 16): SpriteLayer {
  const blank = '.'.repeat(size);
  return {
    id: nextLayerId(scene, 'icon'),
    name: 'Icon',
    visible: true,
    type: 'sprite',
    x: 0,
    y: Math.max(0, Math.floor((scene.height - size) / 2)),
    sprite: {
      width: size,
      height: size,
      palette: { a: '#FFFFFF' },
      frames: [{ duration: 6, rows: Array.from({ length: size }, () => blank) }]
    },
    loopFrom: 0,
    anchorX: size / 2,
    anchorY: size,
    tracks: {},
    shutter: 0
  };
}

export function createText(scene: Scene): TextLayer {
  const x = scene.width > 16 ? 20 : 0;
  return {
    id: nextLayerId(scene, 'text'),
    name: 'Text',
    visible: true,
    type: 'text',
    text: 'HELLO',
    // The one-line title face: the official single-word titles are 9px tall.
    font: 'bold-9',
    color: '#FFFFFF',
    x,
    // Centred, rounding down-panel: the shadow below needs the spare row.
    y: Math.max(0, Math.ceil((scene.height - 9) / 2)),
    width: scene.width - x - 1,
    align: 'center',
    effect: 'none',
    period: 30,
    colorB: null,
    gradient: 'vertical',
    shadow: { color: '#0E1A16', dx: 0, dy: 1, soft: true },
    tracks: {}
  };
}

export function createGlow(scene: Scene): GlowLayer {
  return {
    id: nextLayerId(scene, 'glow'),
    name: 'Glow',
    visible: true,
    type: 'glow',
    x: scene.width > 16 ? 10 : 8,
    y: 8,
    radiusX: 10,
    radiusY: 8,
    color: '#3A7BD5',
    strength: 0.5,
    mode: 'light',
    tracks: {}
  };
}

/** A palette key not yet used by `sprite`, for a newly picked colour. */
export function nextPaletteKey(sprite: Sprite): string | null {
  const keys = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (const key of keys) if (sprite.palette[key] === undefined) return key;
  return null;
}
