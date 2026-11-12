import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { drawTrayIcon, encodePng, TRAY_COLOURS } from '../src/main/tray/tray-icon';
import { trayBadgeOf, trayMarkOf, TrayMark } from '../src/shared/tray-state';

const requireCjs = createRequire(import.meta.url);

const pixel = (pixels: Uint8Array, size: number, x: number, y: number) => {
  const i = (y * size + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
};
const hex = ([r, g, b]: number[]) => `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase();

/** The tray icon's mark and number (redesign P12b, S26). */
describe('trayMarkOf', () => {
  it.each<[string, Parameters<typeof trayMarkOf>[0], TrayMark]>([
    ['a task timed', { session: { status: 'TRACKING' }, mode: 'WORK', inWorkingHours: true }, 'timing'],
    ['an interruption, over its paused task', { session: { status: 'TRACKING', interruption: {} }, mode: 'WORK', inWorkingHours: true }, 'interruption'],
    ['an interruption during Away', { session: { status: 'TRACKING', interruption: {} }, mode: 'AWAY', inWorkingHours: false }, 'interruption'],
    ['paused', { session: { status: 'PAUSED' }, mode: 'WORK', inWorkingHours: true }, 'paused'],
    ['Lunch, nothing timed', { session: null, mode: 'LUNCH', inWorkingHours: false }, 'paused'],
    ['working through Lunch', { session: { status: 'TRACKING' }, mode: 'LUNCH', inWorkingHours: false }, 'timing'],
    ['nothing timed in working hours', { session: null, mode: 'WORK', inWorkingHours: true }, 'nothing-timing'],
    ['nothing timed outside them', { session: null, mode: 'WORK', inWorkingHours: false }, 'off-hours']
  ])('TrayMarkOf_%s', (_name, input, mark) => {
    expect(trayMarkOf(input)).toBe(mark);
  });

  it.each([[0, null], [-1, null], [1, '1'], [9, '9'], [10, '9+'], [250, '9+']])('TrayBadgeOf_%s_Is_%s', (waiting, badge) => {
    expect(trayBadgeOf(waiting)).toBe(badge);
  });
});

describe('drawTrayIcon', () => {
  it('Colours_AreTheWindowsTokens', () => {
    // A copy, held to the config: the duplicated-constant hazard (CLAUDE.md §3).
    const config = requireCjs('../tailwind.config.js') as { theme: { extend: { colors: Record<string, Record<string, string>> } } };
    const colours = config.theme.extend.colors;
    expect(TRAY_COLOURS.green).toBe(colours.accent.green);
    expect(TRAY_COLOURS.amber).toBe(colours.accent.amber);
    expect(TRAY_COLOURS.grey).toBe(colours.text.secondary);
    expect(TRAY_COLOURS.ink).toBe(colours.dark[900]);
    expect(TRAY_COLOURS.paper).toBe(colours.text.primary);
  });

  it.each<[TrayMark, string]>([
    ['timing', TRAY_COLOURS.green],
    ['interruption', TRAY_COLOURS.amber],
    ['paused', TRAY_COLOURS.amber],
    ['nothing-timing', TRAY_COLOURS.amber]
  ])('Draw_%s_IsADiscInItsColour_WithTheMarkInInk', (mark, colour) => {
    const pixels = drawTrayIcon(mark, null, 32);

    // Left of centre, inside the disc and clear of every mark.
    expect(hex(pixel(pixels, 32, 6, 16))).toBe(colour);
    expect(pixel(pixels, 32, 0, 0)[3]).toBe(0);
  });

  it('Draw_EachMark_IsADifferentShape', () => {
    // A shape as well as a colour: three of the marks share amber.
    const shapes = (['interruption', 'paused', 'nothing-timing'] as TrayMark[]).map(mark =>
      Buffer.from(drawTrayIcon(mark, null, 32)).toString('base64'));

    expect(new Set(shapes).size).toBe(3);
  });

  it('Draw_OffHours_IsARing_EmptyInTheMiddle', () => {
    const pixels = drawTrayIcon('off-hours', null, 32);

    expect(pixel(pixels, 32, 16, 16)[3]).toBe(0);
    expect(hex(pixel(pixels, 32, 2, 16))).toBe(TRAY_COLOURS.grey);
  });

  it('Draw_WithANumber_PutsItBottomRight_PaperOnInk', () => {
    const plain = drawTrayIcon('timing', null, 16);
    const numbered = drawTrayIcon('timing', '3', 16);

    // The plate's corner, and the top-left of the 3 a pixel in.
    expect(hex(pixel(numbered, 16, 15, 15))).toBe(TRAY_COLOURS.ink);
    expect(hex(pixel(numbered, 16, 12, 10))).toBe(TRAY_COLOURS.paper);
    // The rest of the icon is untouched.
    expect(pixel(numbered, 16, 3, 3)).toEqual(pixel(plain, 16, 3, 3));
  });

  it('Draw_NotAnIconSize_Throws', () => {
    expect(() => drawTrayIcon('timing', null, 4)).toThrow(RangeError);
  });
});

describe('encodePng', () => {
  it('EncodePng_RoundTrips_ThePixels', () => {
    const pixels = drawTrayIcon('interruption', '9+', 16);

    const png = encodePng(16, 16, pixels);

    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const idatAt = png.indexOf('IDAT');
    const length = png.readUInt32BE(idatAt - 4);
    const raw = inflateSync(png.subarray(idatAt + 4, idatAt + 4 + length));
    const rows = [...Array(16).keys()].map(y => raw.subarray(y * 65 + 1, (y + 1) * 65));
    expect(Buffer.concat(rows).equals(Buffer.from(pixels))).toBe(true);
  });

  it('EncodePng_WrongLength_Throws', () => {
    expect(() => encodePng(16, 16, new Uint8Array(10))).toThrow(RangeError);
  });
});
