import { evaluateTrack } from '../model/motion';
import {
  GlowLayer,
  Layer,
  PlateLayer,
  Scene,
  SpriteLayer,
  TextLayer,
  TRANSPARENT,
  spriteFrameIndexAt
} from '../model/scene';
import { Raster, RgbTriplet, mix, parseRgb, scale } from './raster';
import { SCENE_FONTS, forEachTextPixel, measure } from './text';

/**
 * Renders one frame of a scene.
 *
 * A pure function of the scene and the frame index: no clock, no randomness,
 * no state carried between frames. The editor's preview, the exporter and the
 * tests all call this, so what the editor shows is exactly what is exported.
 * Any effect that looks random is derived from the frame number.
 *
 * Edges are anti-aliased by supersampling, because that is how the official
 * animations look (STYLE-GUIDE.md §5): an object moving by a fraction of a
 * pixel blends into its neighbours instead of jumping a whole LED. A sprite at
 * rest on whole pixels at scale 1 comes out exactly as drawn -- every sample
 * in a pixel hits the same sprite pixel -- so pixel art stays crisp.
 */
export function renderFrame(scene: Scene, frame: number): Raster {
  const raster = new Raster(scene.width, scene.height);
  for (const layer of scene.layers) {
    if (layer.visible) drawLayer(raster, layer, frame);
  }
  return raster;
}

function drawLayer(raster: Raster, layer: Layer, frame: number): void {
  switch (layer.type) {
    case 'plate':
      drawPlate(raster, layer, frame);
      break;
    case 'sprite':
      drawSprite(raster, layer, frame);
      break;
    case 'text':
      drawText(raster, layer, frame);
      break;
    case 'glow':
      drawGlow(raster, layer, frame);
      break;
  }
}

/** Samples per pixel along each axis: 4 x 4 gives 17 levels of coverage. */
const SUPERSAMPLE = 4;

function subsample(i: number): number {
  return (i + 0.5) / SUPERSAMPLE;
}

/** 0 → 1 → 0 over one period: a loop that has no seam. */
function triangle(phase: number): number {
  const p = phase - Math.floor(phase);
  return p < 0.5 ? p * 2 : 2 - p * 2;
}

// ─── plate ────────────────────────────────────────────────────────────────────

/** Whether the point (u, v) lies inside a w × h rectangle with corners of radius r. */
function insideRoundRect(u: number, v: number, w: number, h: number, r: number): boolean {
  if (u < 0 || v < 0 || u > w || v > h) return false;
  if (r <= 0) return true;
  const qx = Math.max(Math.abs(u - w / 2) - (w / 2 - r), 0);
  const qy = Math.max(Math.abs(v - h / 2) - (h / 2 - r), 0);
  return qx * qx + qy * qy <= r * r;
}

/**
 * How much of pixel (px, py) the rounded rectangle covers, 0..1.
 *
 * A corner pixel is partly covered and so partly lit, which is how the
 * official plates round a corner at this size (STYLE-GUIDE.md §3). A hard
 * in-or-out test either rounds nothing or bites a visible notch.
 */
export function roundedRectCoverage(px: number, py: number, w: number, h: number, r: number): number {
  let inside = 0;
  for (let j = 0; j < SUPERSAMPLE; j++) {
    for (let i = 0; i < SUPERSAMPLE; i++) {
      if (insideRoundRect(px + subsample(i), py + subsample(j), w, h, r)) inside++;
    }
  }
  return inside / (SUPERSAMPLE * SUPERSAMPLE);
}

function drawPlate(raster: Raster, layer: PlateLayer, frame: number): void {
  const a = parseRgb(layer.colorA);
  const b = parseRgb(layer.colorB);
  const outlineTop = layer.outline ? parseRgb(layer.outline) : null;
  const outlineBottom = layer.outlineBottom ? parseRgb(layer.outlineBottom) : outlineTop;
  const highlight = layer.highlight ? parseRgb(layer.highlight) : null;
  const phase = frame / layer.period;
  const { width: w, height: h, radius: r } = layer;
  // The outline is the ring between the plate and the plate inset by 1px.
  const highlightRow = outlineTop ? 1 : 0;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const outer = roundedRectCoverage(px, py, w, h, r);
      if (outer === 0) continue;
      const inner = outlineTop ? roundedRectCoverage(px - 1, py - 1, w - 2, h - 2, Math.max(0, r - 1)) : outer;

      const span = layer.direction === 'horizontal' ? w - 1 : h - 1;
      const pos = layer.direction === 'horizontal' ? px : py;
      let t = span > 0 ? pos / span : 0;
      // `slide` moves the gradient along itself and back, so the loop point
      // is invisible whatever the scene length.
      if (layer.motion === 'slide') t = triangle(t / 2 + phase);
      let fill = mix(a, b, t);
      if (highlight && py === highlightRow) fill = highlight;

      let colour: RgbTriplet = fill;
      if (outlineTop && outlineBottom && outer > inner) {
        const ring = mix(outlineTop, outlineBottom, h > 1 ? py / (h - 1) : 0);
        // Weighted by how much of the pixel each part covers, so the ring's
        // anti-aliased inner corner blends into the fill.
        colour = inner > 0 ? mix(fill, ring, (outer - inner) / outer) : ring;
      }
      if (layer.motion === 'pulse') {
        // A gentle breath between 70% and 100%, not a flash: the official
        // plates barely move, and anything more reads as an alert.
        colour = scale(colour, 0.7 + 0.3 * (0.5 + 0.5 * Math.cos(2 * Math.PI * phase)));
      }
      raster.blend(layer.x + px, layer.y + py, colour, outer);
    }
  }
}

// ─── sprite ───────────────────────────────────────────────────────────────────

/** Time samples across an open shutter. Four smear a fast move without banding at this size. */
const SHUTTER_SAMPLES = 4;

interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
}

function transformAt(layer: SpriteLayer | GlowLayer, t: number): Transform {
  const tr = layer.tracks;
  return {
    x: evaluateTrack(tr.x, t, layer.x),
    y: evaluateTrack(tr.y, t, layer.y),
    scaleX: evaluateTrack(tr.scaleX, t, 1),
    scaleY: evaluateTrack(tr.scaleY, t, 1),
    opacity: evaluateTrack(tr.opacity, t, 1)
  };
}

/**
 * Draws a sprite through its keyframed transform.
 *
 * Each panel pixel is sampled 4 x 4 times; each sample is mapped back into the
 * sprite, and the pixel takes the average of what the samples hit, with the
 * fraction that hit anything as its coverage. With a shutter, the whole thing
 * is repeated at several instants within the frame and averaged: motion blur.
 */
function drawSprite(raster: Raster, layer: SpriteLayer, frame: number): void {
  const { sprite, anchorX: ax, anchorY: ay } = layer;
  const samples = layer.shutter > 0 ? SHUTTER_SAMPLES : 1;
  const size = raster.width * raster.height;
  // Premultiplied accumulation across the time samples.
  const acc = new Float32Array(size * 4);
  const colours = new Map(Object.entries(sprite.palette).map(([k, v]) => [k, parseRgb(v)]));

  for (let s = 0; s < samples; s++) {
    const t = frame + (samples > 1 ? (layer.shutter * s) / samples : 0);
    const { x, y, scaleX, scaleY, opacity } = transformAt(layer, t);
    if (scaleX === 0 || scaleY === 0 || opacity <= 0) continue;
    // Sprite frames change on whole scene frames; only the transform is
    // sampled between them.
    const rows = sprite.frames[spriteFrameIndexAt(layer, Math.floor(t))].rows;

    const xs = [x + ax + (0 - ax) * scaleX, x + ax + (sprite.width - ax) * scaleX];
    const ys = [y + ay + (0 - ay) * scaleY, y + ay + (sprite.height - ay) * scaleY];
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const x1 = Math.min(raster.width - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const y1 = Math.min(raster.height - 1, Math.ceil(Math.max(...ys)));

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        let hits = 0;
        let r = 0;
        let g = 0;
        let b = 0;
        for (let j = 0; j < SUPERSAMPLE; j++) {
          const v = ay + (py + subsample(j) - y - ay) / scaleY;
          if (v < 0 || v >= sprite.height) continue;
          const row = rows[Math.floor(v)];
          for (let i = 0; i < SUPERSAMPLE; i++) {
            const u = ax + (px + subsample(i) - x - ax) / scaleX;
            if (u < 0 || u >= sprite.width) continue;
            const key = row[Math.floor(u)];
            if (key === TRANSPARENT) continue;
            const c = colours.get(key);
            if (!c) continue;
            hits++;
            r += c[0];
            g += c[1];
            b += c[2];
          }
        }
        if (hits === 0) continue;
        const alpha = (hits / (SUPERSAMPLE * SUPERSAMPLE)) * opacity;
        const p = (py * raster.width + px) * 4;
        acc[p] += (r / hits) * alpha;
        acc[p + 1] += (g / hits) * alpha;
        acc[p + 2] += (b / hits) * alpha;
        acc[p + 3] += alpha;
      }
    }
  }

  for (let p = 0; p < size; p++) {
    const alpha = acc[p * 4 + 3];
    if (alpha <= 0) continue;
    const colour: RgbTriplet = [
      Math.round(acc[p * 4] / alpha),
      Math.round(acc[p * 4 + 1] / alpha),
      Math.round(acc[p * 4 + 2] / alpha)
    ];
    raster.blend(p % raster.width, Math.floor(p / raster.width), colour, alpha / samples);
  }
}

// ─── glow ─────────────────────────────────────────────────────────────────────

/**
 * A soft ellipse of light or shade. Falloff is (1 - d²)², which has no visible
 * edge: a glow that ends in a ring reads as an object, not as light.
 */
function drawGlow(raster: Raster, layer: GlowLayer, frame: number): void {
  const { x, y, scaleX, scaleY, opacity } = transformAt(layer, frame);
  const rx = layer.radiusX * Math.abs(scaleX);
  const ry = layer.radiusY * Math.abs(scaleY);
  if (rx <= 0 || ry <= 0 || opacity <= 0 || layer.strength <= 0) return;
  const colour = parseRgb(layer.color);

  for (let py = Math.max(0, Math.floor(y - ry)); py <= Math.min(raster.height - 1, Math.ceil(y + ry)); py++) {
    for (let px = Math.max(0, Math.floor(x - rx)); px <= Math.min(raster.width - 1, Math.ceil(x + rx)); px++) {
      const dx = (px + 0.5 - x) / rx;
      const dy = (py + 0.5 - y) / ry;
      const d = dx * dx + dy * dy;
      if (d >= 1) continue;
      const amount = layer.strength * opacity * (1 - d) * (1 - d);
      if (layer.mode === 'light') raster.add(px, py, colour, amount);
      else raster.blend(px, py, colour, amount);
    }
  }
}

// ─── text ─────────────────────────────────────────────────────────────────────

/** Gap between repeats of scrolling text, in pixels. */
const SCROLL_GAP = 12;
/** Width of the shine band, and how far it travels off each side. */
const SHINE_WIDTH = 3;
/** How dark a soft shadow is at its core; the blur then fades it out. */
const SOFT_SHADOW_STRENGTH = 0.85;

interface Ink {
  x: number;
  y: number;
  colour: RgbTriplet;
}

/** The pixels a text layer lights at `frame`, with their colours, before opacity and shadow. */
function textInk(layer: TextLayer, frame: number, left0: number, top: number): Ink[] {
  const font = SCENE_FONTS[layer.font];
  const colourA = parseRgb(layer.color);
  const colourB = layer.colorB ? parseRgb(layer.colorB) : null;
  const phase = frame / layer.period;
  const height = font.ascent + font.descent;

  let text = layer.text;
  if (layer.effect === 'typewriter') {
    // `period` is frames per character here: the one effect that is a rate
    // rather than a cycle. The text then stays, which is what a title wants.
    text = [...text].slice(0, Math.floor(frame / layer.period) + 1).join('');
  }
  if (layer.effect === 'blink' && Math.floor(phase * 2) % 2 === 1) return [];

  // Aligned against the full text, so a typewriter does not re-centre as each
  // letter arrives.
  const fullWidth = measure(layer.text, font);
  let left = left0;
  if (layer.align === 'center') left = left0 + Math.floor((layer.width - fullWidth) / 2);
  if (layer.align === 'right') left = left0 + layer.width - fullWidth;

  const inBox = (px: number): boolean => px >= left0 && px < left0 + layer.width;
  const charCount = [...text].length;
  const colourAt = (px: number, py: number): RgbTriplet => {
    if (!colourB) return colourA;
    const v = height > 1 ? (py - top) / (height - 1) : 0;
    const t = layer.gradient === 'vertical' ? v : ((px - left) / Math.max(1, fullWidth - 1) + v) / 2;
    return mix(colourA, colourB, t);
  };
  const ink: Ink[] = [];

  if (layer.effect === 'scroll') {
    // Marquee inside the box: the text repeats with a gap, so the loop has no
    // empty moment. One pixel per frame at `period` 1, slower above it.
    const cycle = fullWidth + SCROLL_GAP;
    const offset = Math.floor(frame / layer.period) % cycle;
    for (const start of [left0 - offset, left0 - offset + cycle]) {
      forEachTextPixel(text, font, start, top, (px, py) => {
        if (inBox(px)) ink.push({ x: px, y: py, colour: colourAt(px - start + left, py) });
      });
    }
    return ink;
  }

  forEachTextPixel(text, font, left, top, (px, py, index) => {
    if (!inBox(px)) return;
    let y = py;
    let c = colourAt(px, py);
    if (layer.effect === 'wave') {
      // One pixel up and down, each letter a step behind the one before it.
      y += Math.round(Math.sin(2 * Math.PI * (phase - index / Math.max(1, charCount))));
    }
    if (layer.effect === 'shine') {
      // A diagonal band of light crossing the text once per period.
      const travel = fullWidth + SHINE_WIDTH * 4;
      const bandX = left - SHINE_WIDTH * 2 + (phase - Math.floor(phase)) * travel;
      const d = px - (py - top) / 2 - bandX;
      if (d >= 0 && d < SHINE_WIDTH) c = mix(c, [255, 255, 255], 0.75);
    }
    ink.push({ x: px, y, colour: c });
  });
  return ink;
}

/**
 * The shadow under the ink, as an alpha per panel pixel. Soft shadows are
 * spread with a [1 2 1] kernel in each direction, which gives the 2-3 px fade
 * the official Lunch title has without smearing into the letters' counters.
 */
function shadowAlpha(raster: Raster, ink: Ink[], layer: TextLayer): Float32Array {
  const { width, height } = raster;
  const shadow = layer.shadow!;
  let alpha = new Float32Array(width * height);
  for (const p of ink) {
    const x = p.x + shadow.dx;
    const y = p.y + shadow.dy;
    if (x >= 0 && y >= 0 && x < width && y < height) alpha[y * width + x] = 1;
  }
  if (!shadow.soft) return alpha;

  const blurred = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let weight = 0;
      for (let k = -1; k <= 1; k++) {
        const w = k === 0 ? 2 : 1;
        weight += w;
        if (x + k >= 0 && x + k < width) sum += alpha[y * width + x + k] * w;
      }
      blurred[y * width + x] = sum / weight;
    }
  }
  alpha = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let weight = 0;
      for (let k = -1; k <= 1; k++) {
        const w = k === 0 ? 2 : 1;
        weight += w;
        if (y + k >= 0 && y + k < height) sum += blurred[(y + k) * width + x] * w;
      }
      alpha[y * width + x] = Math.min(1, (sum / weight) * 2) * SOFT_SHADOW_STRENGTH;
    }
  }
  return alpha;
}

function drawText(raster: Raster, layer: TextLayer, frame: number): void {
  const tr = layer.tracks;
  // Rounded: sub-pixel text blurs, and the style guide keeps titles crisp.
  const left0 = Math.round(evaluateTrack(tr.x, frame, layer.x));
  const top = Math.round(evaluateTrack(tr.y, frame, layer.y));
  const opacity = evaluateTrack(tr.opacity, frame, 1);
  if (opacity <= 0) return;

  const ink = textInk(layer, frame, left0, top);
  if (layer.shadow && ink.length > 0) {
    const alpha = shadowAlpha(raster, ink, layer);
    const colour = parseRgb(layer.shadow.color);
    for (let p = 0; p < alpha.length; p++) {
      if (alpha[p] > 0) raster.blend(p % raster.width, Math.floor(p / raster.width), colour, alpha[p] * opacity);
    }
  }
  for (const p of ink) raster.blend(p.x, p.y, p.colour, opacity);
}

// ─── loop ─────────────────────────────────────────────────────────────────────

/**
 * How many pixels jump when the scene loops: the frame that would come after
 * the last, compared with the first. Zero is a seamless loop, which is what
 * the official animations achieve (STYLE-GUIDE.md §6); anything else shows as
 * a twitch every time the animation restarts, and is easy to miss while
 * scrubbing because no single frame looks wrong.
 */
export function loopSeam(scene: Scene): number {
  const first = renderFrame(scene, 0).data;
  const next = renderFrame(scene, scene.frameCount).data;
  let differing = 0;
  for (let p = 0; p < first.length; p += 4) {
    if (first[p] !== next[p] || first[p + 1] !== next[p + 1] || first[p + 2] !== next[p + 2]) differing++;
  }
  return differing;
}
