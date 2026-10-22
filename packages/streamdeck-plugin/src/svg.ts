import type { Face, Glyph } from './faces';

/**
 * A face as an SVG key image. Stream Deck takes an SVG string for a key and
 * scales it, so one 144-unit drawing serves the 72 px keys and the 144 px
 * ones alike.
 */

/** The drawing's side; a Mini key is 80 px, a classic one 72, an XL one 96. */
export const KEY_SIZE = 144;

/** The app's dark background. */
const BACKGROUND = '#0F172A';

/** Each line of a label holds about this many capitals at its size. */
const LINE_CHARS = 10;

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
  timer: 'M12 6a7.5 7.5 0 1 0 0 15 7.5 7.5 0 1 0 0-15M12 9.5v4l2.5 1.5M9.5 2.5h5M18 6l1.5-1.5',
  unplugged: 'M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0zM12 16v5M4 4l16 16'
};

/** Escapes text for an SVG text node or attribute. */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!);
}

/** Cuts a line to what fits, with an ellipsis where it was cut. */
export function fitLine(text: string, max: number = LINE_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** A stroked glyph, `size` units across, centred on (cx, cy). */
export function glyphSvg(glyph: Glyph, cx: number, cy: number, size: number, colour: string): string {
  const scale = size / 24;
  const x = cx - size / 2;
  const y = cy - size / 2;
  // `play` and `stop` are filled shapes; the rest are lines.
  const filled = glyph === 'play' || glyph === 'stop';
  const paint = filled
    ? `fill="${colour}" stroke="none"`
    : `fill="none" stroke="${colour}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  return `<path transform="translate(${x} ${y}) scale(${scale})" d="${GLYPH_PATHS[glyph]}" ${paint}/>`;
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

/**
 * The whole key image, drawn on {@link KEY_SIZE} units and sized `size`
 * pixels: the manifest's default images are declared at 72, while a key
 * drawn at run time is scaled by Stream Deck whatever it says.
 */
export function renderFace(face: Face, size: number = KEY_SIZE): string {
  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${KEY_SIZE}" height="${KEY_SIZE}" fill="${BACKGROUND}"/>`);
  parts.push(`<rect x="4" y="4" width="${KEY_SIZE - 8}" height="${KEY_SIZE - 8}" rx="14" fill="none" stroke="${face.accent}" stroke-width="5"/>`);

  // With a large time below, the icon and the label shrink to make room.
  const withBig = Boolean(face.big);
  const iconY = withBig ? 34 : 44;
  const iconSize = withBig ? 36 : 48;
  parts.push(face.pixels ? pixelsSvg(face.pixels, KEY_SIZE / 2, iconY, iconSize) : glyphSvg(face.glyph, KEY_SIZE / 2, iconY, iconSize, face.accent));

  const lines = face.lines.slice(0, withBig ? 1 : 3).map(line => fitLine(line));
  const lineHeight = 21;
  let y = withBig ? 76 : 88;
  for (const line of lines) {
    parts.push(
      `<text x="${KEY_SIZE / 2}" y="${y}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="19" font-weight="700" fill="#FFFFFF">${escapeXml(line)}</text>`
    );
    y += lineHeight;
  }
  if (face.big) {
    parts.push(
      `<text x="${KEY_SIZE / 2}" y="118" text-anchor="middle" font-family="Consolas, Menlo, monospace" font-size="30" font-weight="700" fill="${face.accent}">${escapeXml(face.big)}</text>`
    );
  }

  const body = parts.join('');
  const content = face.dim ? `<g opacity="0.4">${body}</g>` : body;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${KEY_SIZE} ${KEY_SIZE}">${content}</svg>`;
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
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${glyphSvg(glyph, 12, 12, 22, '#FFFFFF')}</svg>`;
}
