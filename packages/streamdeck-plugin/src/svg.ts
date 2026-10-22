import type { Face, Glyph } from './faces';

/**
 * A face as an SVG key image. Stream Deck takes an SVG string for a key and
 * scales it, so one 144-unit drawing serves the 72 px keys and the 144 px
 * ones alike.
 *
 * The look is "Tile", chosen by the user on Stream Deck Mobile over two
 * others (2026-10-22): no border, a large glyph and title, and the tone
 * in the colours -- a lit glyph can be pressed, a grey key has nothing to
 * do, a filled key waits on you.
 *
 * Only static SVG is drawn here, on purpose: `setImage` shows the first
 * frame of anything animated (measured 2026-10-22), so a one-shot is a few
 * of these images sent in turn, each drawn at a `progress`. Nor is it drawn
 * with clipping or `pathLength`: a stroke drawn part-way is computed here,
 * so nothing depends on how much of SVG Stream Deck's renderer supports.
 */

/** The drawing's side; a Mini key is 80 px, a classic one 72, an XL one 96. */
export const KEY_SIZE = 144;

/** The app's dark background. */
const BACKGROUND = '#0F172A';

/** A grey key's glyph, title and hint: nothing to do there. */
const IDLE_GLYPH = '#334155';
const IDLE_TEXT = '#64748B';

/** A hint under a ready key's title, and under a filled key's. */
const READY_HINT = '#94A3B8';
const ASK_HINT = '#E2E8F0';

/**
 * The fill of a key that waits on you, for each accent: darker than the
 * accent, so white text on it reads at 4.5:1 or better.
 */
const ASK_FILLS: Record<string, string> = {
  '#22C55E': '#15803D',
  '#EF4444': '#B91C1C',
  '#F59E0B': '#B45309',
  '#3B82F6': '#1D4ED8'
};

/** Each title holds about this many capitals at its smallest size. */
const LINE_CHARS = 10;

/** A glyph's stroke, in its 24-unit grid; heavier on a filled key. */
const STROKE = 2.4;
const ASK_STROKE = 2.6;

const SANS = 'Segoe UI, Arial, sans-serif';
const MONO = 'Consolas, Menlo, monospace';

/**
 * The glyphs, drawn on a 24-unit grid and stroked: the same set the action
 * list's monochrome icons are made from (see assets/), so a key and its
 * entry in the list match. Drawn for this plugin, copied from no icon set.
 */
export const GLYPH_PATHS: Record<Glyph, string> = {
  play: 'M8 5v14l11-7z',
  pause: 'M7 5v14M17 5v14',
  stop: 'M6 6h12v12H6z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  trash: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.5M4.5 12h.5M4.5 18h.5',
  yes: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M7.5 12.5l3 3 6-6.5',
  no: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M8.5 8.5l7 7M15.5 8.5l-7 7',
  timer: 'M12 6a7.5 7.5 0 1 0 0 15 7.5 7.5 0 1 0 0-15M12 9.5v4l2.5 1.5M9.5 2.5h5M18 6l1.5-1.5'
};

type Point = readonly [number, number];

const CIRCLE = 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18';

/**
 * The glyphs whose one-shot draws them along their strokes: what stays
 * still, and the strokes drawn in order. Each matches its path above.
 */
const DRAWN: Partial<Record<Glyph, { still?: string; strokes: Point[][] }>> = {
  check: { strokes: [[[5, 12.5], [9.5, 17], [19, 7.5]]] },
  yes: { still: CIRCLE, strokes: [[[7.5, 12.5], [10.5, 15.5], [16.5, 9]]] },
  no: { still: CIRCLE, strokes: [[[8.5, 8.5], [15.5, 15.5]], [[15.5, 8.5], [8.5, 15.5]]] }
};

/** The bin's lid, which lifts and settles, and the rest of it. */
const TRASH_LID = 'M4 7h16M9.5 7V4.5h5V7';
const TRASH_BODY = 'M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5';

/** Escapes text for an SVG text node or attribute. */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!);
}

/** Cuts a line to what fits, with an ellipsis where it was cut. */
export function fitLine(text: string, max: number = LINE_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** The value at `t` of a curve given as `[t, value]` keys, straight between them. */
export function along(t: number, keys: readonly (readonly [number, number])[]): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
    }
  }
  return keys[keys.length - 1][1];
}

/** Starts fast and settles: the style guide's smooth arrival. */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** The first `t` of a set of strokes, by length, as path data; empty at 0. */
export function partialStrokes(strokes: readonly Point[][], t: number): string {
  const length = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const total = strokes.reduce((sum, s) => sum + s.slice(1).reduce((l, p, i) => l + length(s[i], p), 0), 0);
  let budget = Math.min(1, Math.max(0, t)) * total;
  const parts: string[] = [];
  const n = (v: number) => String(Math.round(v * 100) / 100);
  for (const stroke of strokes) {
    if (budget <= 0) break;
    parts.push(`M${n(stroke[0][0])} ${n(stroke[0][1])}`);
    for (let i = 1; i < stroke.length && budget > 0; i++) {
      const [a, b] = [stroke[i - 1], stroke[i]];
      const l = length(a, b);
      const k = Math.min(1, budget / l);
      parts.push(`L${n(a[0] + (b[0] - a[0]) * k)} ${n(a[1] + (b[1] - a[1]) * k)}`);
      budget -= l;
    }
  }
  return parts.join('');
}

/**
 * A glyph, `size` units across, centred on (cx, cy). With `progress`, the
 * glyph's one-shot part-way: the check, yes and no draw themselves, the
 * bin's lid lifts and settles, the stop square presses in. Others rest.
 */
export function glyphSvg(glyph: Glyph, cx: number, cy: number, size: number, colour: string, weight: number = STROKE, progress?: number): string {
  const place = `translate(${cx - size / 2} ${cy - size / 2}) scale(${size / 24})`;
  const stroked = `fill="none" stroke="${colour}" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round"`;
  const filled = `fill="${colour}" stroke="none"`;
  const path = (d: string, paint: string, transform = '') => `<path${transform ? ` transform="${transform}"` : ''} d="${d}" ${paint}/>`;
  const group = (body: string) => `<g transform="${place}">${body}</g>`;

  if (progress !== undefined) {
    const drawn = DRAWN[glyph];
    if (drawn) {
      const d = partialStrokes(drawn.strokes, easeOut(progress));
      return group(`${drawn.still ? path(drawn.still, stroked) : ''}${d ? path(d, stroked) : ''}`);
    }
    if (glyph === 'trash') {
      const angle = along(progress, [[0, 0], [0.35, -14], [0.7, 2], [1, 0]]);
      const lift = along(progress, [[0, 0], [0.35, -3], [0.7, 0], [1, 0]]);
      return group(path(TRASH_LID, stroked, `translate(0 ${lift.toFixed(2)}) rotate(${angle.toFixed(2)} 20 7)`) + path(TRASH_BODY, stroked));
    }
    if (glyph === 'stop') {
      const scale = along(progress, [[0, 1], [0.4, 0.78], [1, 1]]);
      return group(path(GLYPH_PATHS.stop, filled, `translate(12 12) scale(${scale.toFixed(3)}) translate(-12 -12)`));
    }
  }
  // `play` and `stop` are filled shapes; the rest are lines.
  return group(path(GLYPH_PATHS[glyph], glyph === 'play' || glyph === 'stop' ? filled : stroked));
}

/** The bar's 16x16 icon as lit LEDs, `size` units across, centred on (cx, cy). */
function pixelsSvg(pixels: (string | null)[][], cx: number, cy: number, size: number): string {
  const cell = size / 16;
  const left = cx - size / 2;
  const top = cy - size / 2;
  const leds: string[] = [];
  pixels.forEach((row, y) =>
    row.forEach((colour, x) => {
      if (!colour || !/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(colour)) return;
      leds.push(`<rect x="${(left + x * cell).toFixed(2)}" y="${(top + y * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="${colour.slice(0, 7)}"/>`);
    })
  );
  return leds.join('');
}

/** The title's size: as large as its length lets it be across the key. */
function titleSize(title: string): number {
  if (title.length <= 4) return 26;
  if (title.length <= 6) return 24;
  if (title.length <= 8) return 22;
  return 20;
}

function text(content: string, y: number, size: number, colour: string, weight = 700, family = SANS): string {
  return `<text x="${KEY_SIZE / 2}" y="${y}" text-anchor="middle" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${colour}">${escapeXml(content)}</text>`;
}

/**
 * The whole key image, drawn on {@link KEY_SIZE} units and sized `size`
 * pixels: the manifest's default images are declared at 72, while a key
 * drawn at run time is scaled by Stream Deck whatever it says.
 */
export function renderFace(face: Face, size: number = KEY_SIZE): string {
  const mid = KEY_SIZE / 2;
  const title = fitLine(face.title);
  const parts: string[] = [`<rect x="0" y="0" width="${KEY_SIZE}" height="${KEY_SIZE}" fill="${BACKGROUND}"/>`];

  if (face.big) {
    // The session: a band in its colour, the bar's icon, the task, the time.
    parts.push(`<rect x="0" y="0" width="${KEY_SIZE}" height="8" fill="${face.accent}"/>`);
    parts.push(face.pixels ? pixelsSvg(face.pixels, mid, 46, 56) : glyphSvg(face.glyph, mid, 46, 48, face.accent));
    parts.push(text(title, 96, 20, '#FFFFFF'));
    parts.push(text(face.big, 130, 32, face.accent, 700, MONO));
  } else if (face.tone === 'ask') {
    parts.push(`<rect x="0" y="0" width="${KEY_SIZE}" height="${KEY_SIZE}" fill="${ASK_FILLS[face.accent] ?? face.accent}"/>`);
    parts.push(glyphSvg(face.glyph, mid, 46, 52, '#FFFFFF', ASK_STROKE, face.progress));
    parts.push(text(title, 106, titleSize(title), '#FFFFFF'));
    if (face.hint) parts.push(text(face.hint, 128, 15, ASK_HINT, 600));
  } else {
    const idle = face.tone === 'idle';
    const glyphColour = idle ? IDLE_GLYPH : face.accent;
    if (face.hint) {
      parts.push(glyphSvg(face.glyph, mid, 54, 60, glyphColour, STROKE, face.progress));
      parts.push(text(title, 112, titleSize(title), idle ? IDLE_TEXT : '#FFFFFF'));
      parts.push(text(face.hint, 132, 15, idle ? IDLE_TEXT : READY_HINT, 600));
    } else {
      parts.push(glyphSvg(face.glyph, mid, 58, 64, glyphColour, STROKE, face.progress));
      parts.push(text(title, 124, titleSize(title), idle ? IDLE_TEXT : '#FFFFFF'));
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${KEY_SIZE} ${KEY_SIZE}">${parts.join('')}</svg>`;
}

/**
 * A key image as Stream Deck is handed it: base64 with its type declared.
 * The SDK also takes a bare SVG string, but every face carries `#` in its
 * colours, which anything reading the image as a URL takes for a fragment;
 * base64 is the documented form with nothing to misread.
 */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

/**
 * A white glyph on nothing, for the action list and the category: Stream
 * Deck wants those monochrome, `#FFFFFF` on transparent.
 */
export function renderListIcon(glyph: Glyph, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${glyphSvg(glyph, 12, 12, 22, '#FFFFFF', 2)}</svg>`;
}
