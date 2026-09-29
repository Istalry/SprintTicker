import {
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
  }
}

/** 0 → 1 → 0 over one period: a loop that has no seam. */
function triangle(phase: number): number {
  const p = phase - Math.floor(phase);
  return p < 0.5 ? p * 2 : 2 - p * 2;
}

// ─── plate ────────────────────────────────────────────────────────────────────

/**
 * Whether (px, py), relative to the plate, is inside its rounded outline.
 *
 * A pixel's centre is tested against a corner circle of radius `r - 0.5`
 * centred `r` in from each edge. The half-pixel is what makes a radius of 1
 * clip exactly the corner pixel -- the look of the official plates, whose
 * corners lose one or two pixels rather than a quarter-circle. With the full
 * radius, the corner pixel's centre (0.71 from the circle's) would survive
 * and radius 1 would round nothing.
 */
export function insideRoundedRect(px: number, py: number, w: number, h: number, r: number): boolean {
  if (px < 0 || py < 0 || px >= w || py >= h) return false;
  if (r <= 0) return true;
  const cx = px < r ? r : px >= w - r ? w - r : px + 0.5;
  const cy = py < r ? r : py >= h - r ? h - r : py + 0.5;
  const dx = px + 0.5 - cx;
  const dy = py + 0.5 - cy;
  const reach = r - 0.5;
  return dx * dx + dy * dy <= reach * reach;
}

function drawPlate(raster: Raster, layer: PlateLayer, frame: number): void {
  const a = parseRgb(layer.colorA);
  const b = parseRgb(layer.colorB);
  const outline = layer.outline ? parseRgb(layer.outline) : null;
  const phase = frame / layer.period;
  const inside = (px: number, py: number): boolean =>
    insideRoundedRect(px, py, layer.width, layer.height, layer.radius);

  for (let py = 0; py < layer.height; py++) {
    for (let px = 0; px < layer.width; px++) {
      if (!inside(px, py)) continue;

      const onEdge =
        outline !== null && (!inside(px - 1, py) || !inside(px + 1, py) || !inside(px, py - 1) || !inside(px, py + 1));
      let colour: RgbTriplet;
      if (onEdge && outline) {
        colour = outline;
      } else {
        const span = layer.direction === 'horizontal' ? layer.width - 1 : layer.height - 1;
        const pos = layer.direction === 'horizontal' ? px : py;
        let t = span > 0 ? pos / span : 0;
        // `slide` moves the gradient along itself and back, so the loop point
        // is invisible whatever the scene length.
        if (layer.motion === 'slide') t = triangle(t / 2 + phase);
        colour = mix(a, b, t);
      }
      if (layer.motion === 'pulse') {
        // A gentle breath between 70% and 100%, not a flash: the official
        // plates barely move, and anything more reads as an alert.
        colour = scale(colour, 0.7 + 0.3 * (0.5 + 0.5 * Math.cos(2 * Math.PI * phase)));
      }
      raster.set(layer.x + px, layer.y + py, colour);
    }
  }
}

// ─── sprite ───────────────────────────────────────────────────────────────────

function drawSprite(raster: Raster, layer: SpriteLayer, frame: number): void {
  const { sprite } = layer;
  const current = sprite.frames[spriteFrameIndexAt(layer, frame)];
  const colours = new Map(Object.entries(sprite.palette).map(([k, v]) => [k, parseRgb(v)]));
  current.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const key = row[x];
      if (key === TRANSPARENT) continue;
      const colour = colours.get(key);
      if (colour) raster.set(layer.x + x, layer.y + y, colour);
    }
  });
}

// ─── text ─────────────────────────────────────────────────────────────────────

/** Gap between repeats of scrolling text, in pixels. */
const SCROLL_GAP = 12;
/** Width of the shine band, and how far it travels off each side. */
const SHINE_WIDTH = 3;

function drawText(raster: Raster, layer: TextLayer, frame: number): void {
  const font = SCENE_FONTS[layer.font];
  const colour = parseRgb(layer.color);
  const phase = frame / layer.period;

  let text = layer.text;
  if (layer.effect === 'typewriter') {
    // `period` is frames per character here: the one effect that is a rate
    // rather than a cycle. The text then stays, which is what a title wants.
    text = [...text].slice(0, Math.floor(frame / layer.period) + 1).join('');
  }
  if (layer.effect === 'blink' && Math.floor(phase * 2) % 2 === 1) return;

  // Aligned against the full text, so a typewriter does not re-centre as each
  // letter arrives.
  const fullWidth = measure(layer.text, font);
  let left = layer.x;
  if (layer.align === 'center') left = layer.x + Math.floor((layer.width - fullWidth) / 2);
  if (layer.align === 'right') left = layer.x + layer.width - fullWidth;

  const inBox = (px: number): boolean => px >= layer.x && px < layer.x + layer.width;
  const charCount = [...text].length;

  if (layer.effect === 'scroll') {
    // Marquee inside the box: the text repeats with a gap, so the loop has no
    // empty moment. One pixel per frame at `period` 1, slower above it.
    const cycle = fullWidth + SCROLL_GAP;
    const offset = Math.floor(frame / layer.period) % cycle;
    for (const start of [layer.x - offset, layer.x - offset + cycle]) {
      forEachTextPixel(text, font, start, layer.y, (px, py) => {
        if (inBox(px)) raster.set(px, py, colour);
      });
    }
    return;
  }

  forEachTextPixel(text, font, left, layer.y, (px, py, index) => {
    if (!inBox(px)) return;
    let y = py;
    let c = colour;
    if (layer.effect === 'wave') {
      // One pixel up and down, each letter a step behind the one before it.
      y += Math.round(Math.sin(2 * Math.PI * (phase - index / Math.max(1, charCount))));
    }
    if (layer.effect === 'shine') {
      // A diagonal band of light crossing the text once per period.
      const travel = fullWidth + SHINE_WIDTH * 4;
      const bandX = left - SHINE_WIDTH * 2 + (phase - Math.floor(phase)) * travel;
      const d = px - (py - layer.y) / 2 - bandX;
      if (d >= 0 && d < SHINE_WIDTH) c = mix(colour, [255, 255, 255], 0.75);
    }
    raster.set(px, y, c);
  });
}
