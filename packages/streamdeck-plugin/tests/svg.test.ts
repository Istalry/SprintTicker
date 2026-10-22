import { describe, expect, it } from 'vitest';
import type { Face, Glyph } from '../src/faces';
import { GLYPH_PATHS, KEY_SIZE, along, escapeXml, fitLine, partialStrokes, renderFace, renderListIcon, svgDataUrl } from '../src/svg';

const face = (overrides: Partial<Face> = {}): Face => ({ title: 'DONE', accent: '#22C55E', glyph: 'check', tone: 'ready', ...overrides });

const texts = (svg: string): string[] => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);

describe('escapeXml', () => {
  it('EscapeXml_MarkupCharacters_AreEntities', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
  });
});

describe('fitLine', () => {
  it('FitLine_ShortText_Unchanged', () => {
    expect(fitLine('SPR-1')).toBe('SPR-1');
  });

  it('FitLine_LongText_CutWithAnEllipsisToTheLimit', () => {
    const cut = fitLine('Fix the login page');
    expect(cut).toBe('Fix the l…');
    expect(cut.length).toBe(10);
  });

  it('FitLine_WhitespaceRuns_Collapsed', () => {
    expect(fitLine('  A \n\t B  ')).toBe('A B');
  });

  it('FitLine_CutAfterASpace_DropsTheSpace', () => {
    expect(fitLine('ABCD EFGH', 6)).toBe('ABCD…');
  });
});

describe('renderFace', () => {
  it('RenderFace_Default_IsAnSvgOfTheKeySize', () => {
    const svg = renderFace(face());
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="144" height="144" viewBox="0 0 144 144">.*<\/svg>$/);
    expect(KEY_SIZE).toBe(144);
  });

  it('RenderFace_SizeGiven_KeepsTheViewBox', () => {
    expect(renderFace(face(), 72)).toContain('width="72" height="72" viewBox="0 0 144 144"');
  });

  it('RenderFace_Ready_GlyphInItsColourTitleWhite', () => {
    const svg = renderFace(face());
    expect(svg).toContain('stroke="#22C55E"');
    expect(svg).toMatch(/fill="#FFFFFF">DONE<\/text>/);
    expect(svg).not.toContain('opacity');
  });

  it('RenderFace_Idle_AllGreyWithNoColour', () => {
    const svg = renderFace(face({ tone: 'idle', hint: 'offline' }));
    expect(svg).not.toContain('#22C55E');
    expect(svg).not.toContain('#FFFFFF');
    expect(texts(svg)).toEqual(['DONE', 'offline']);
  });

  it('RenderFace_Ask_FilledDarkerThanTheAccentWithAWhiteGlyph', () => {
    const svg = renderFace(face({ tone: 'ask', title: 'DISCARD?', hint: 'press again', accent: '#EF4444', glyph: 'trash' }));
    expect(svg).toContain('width="144" height="144" fill="#B91C1C"');
    expect(svg).toContain('stroke="#FFFFFF"');
    expect(texts(svg)).toEqual(['DISCARD?', 'press again']);
  });

  it('RenderFace_TaskText_IsEscaped', () => {
    const svg = renderFace(face({ title: '<b>&"x"' }));
    expect(svg).not.toContain('<b>');
    expect(texts(svg)).toEqual(['&lt;b&gt;&amp;&quot;x&quot;']);
  });

  it('RenderFace_LongTitle_FittedToOneLine', () => {
    expect(texts(renderFace(face({ title: 'A VERY LONG TASK KEY' })))).toEqual(['A VERY LO…']);
  });

  it('RenderFace_WithATime_TheSessionLayoutWithTheTimeInTheAccent', () => {
    const svg = renderFace(face({ title: 'SPR-1', big: '1:24:10', accent: '#F59E0B', glyph: 'pause' }));
    expect(texts(svg)).toEqual(['SPR-1', '1:24:10']);
    expect(svg).toMatch(/fill="#F59E0B">1:24:10<\/text>/);
    // The band across the top, in the session's colour.
    expect(svg).toContain('width="144" height="8" fill="#F59E0B"');
  });

  it('RenderFace_Pixels_DrawnInPlaceOfTheGlyph', () => {
    const svg = renderFace(face({ big: '1:00', pixels: [['#FF0000', null, '#00FF00CC']] }));
    expect(svg).not.toContain(GLYPH_PATHS.check);
    expect(svg).toContain('fill="#FF0000"');
    // The alpha is dropped: an SVG fill takes #RRGGBB.
    expect(svg).toContain('fill="#00FF00"');
    expect(svg.match(/<rect /g)).toHaveLength(2 + 2);
  });

  it('RenderFace_PixelNotAColour_IsSkippedNotInjected', () => {
    const svg = renderFace(face({ big: '1:00', pixels: [['red', '#FF0000" onload="x', '#12345']] }));
    expect(svg).not.toContain('onload');
    expect(svg).not.toContain('red');
    expect(svg.match(/<rect /g)).toHaveLength(2);
  });
});

describe('one-shot frames', () => {
  const at = (glyph: Glyph, progress: number) => renderFace(face({ glyph, progress }));

  it.each<[Glyph, string]>([
    ['check', 'M5 12.5L9.5 17L19 7.5'],
    ['yes', 'M7.5 12.5L10.5 15.5L16.5 9'],
    ['no', 'M8.5 8.5L15.5 15.5M15.5 8.5L8.5 15.5']
  ])('Progress_%s_DrawsItselfFromNothingToTheWholeGlyph', (glyph, whole) => {
    // The circle of yes and no stays; what is drawn is the rest.
    const drawn = (svg: string) => [...svg.matchAll(/ d="([^"]*)"/g)].map(m => m[1]).filter(d => d !== 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18');
    expect(drawn(at(glyph, 0))).toEqual([]);
    expect(drawn(at(glyph, 0.5))).toHaveLength(1);
    expect(drawn(at(glyph, 0.5))[0]).not.toBe(whole);
    expect(drawn(at(glyph, 1))).toEqual([whole]);
  });

  it('PartialStrokes_CutsByLengthAcrossStrokes', () => {
    expect(partialStrokes([[[0, 0], [10, 0]]], 0)).toBe('');
    expect(partialStrokes([[[0, 0], [10, 0]]], 0.5)).toBe('M0 0L5 0');
    expect(partialStrokes([[[0, 0], [10, 0]], [[0, 5], [10, 5]]], 0.75)).toBe('M0 0L10 0M0 5L5 5');
  });

  it('Progress_Trash_TheLidLiftsAndComesBackToRest', () => {
    expect(at('trash', 0.35)).toContain('rotate(-14.00 20 7)');
    expect(at('trash', 1)).toContain('translate(0 0.00) rotate(0.00 20 7)');
  });

  it('Progress_Stop_PressesInAndComesBack', () => {
    expect(at('stop', 0.4)).toContain('scale(0.780)');
    expect(at('stop', 1)).toContain('scale(1.000)');
  });

  it('Progress_GlyphWithNoOneShot_DrawnAtRest', () => {
    expect(at('list', 0.5)).toBe(renderFace(face({ glyph: 'list' })));
  });

  it('Along_BetweenAndBeyondItsKeys', () => {
    const keys = [[0, 0], [0.5, 10], [1, 0]] as const;
    expect([-1, 0.25, 0.5, 0.75, 2].map(t => along(t, keys))).toEqual([0, 5, 10, 5, 0]);
  });
});

describe('glyphs', () => {
  it.each(Object.keys(GLYPH_PATHS) as Glyph[])('GlyphPath_%s_IsOnlyPathCommands', glyph => {
    expect(GLYPH_PATHS[glyph]).toMatch(/^M[MLHVCSQTAZmlhvcsqtaz0-9 .,-]+$/);
  });

  it('RenderListIcon_IsWhiteOnNothing', () => {
    const svg = renderListIcon('check', 20);
    expect(svg).toContain('width="20" height="20"');
    expect(svg.match(/#[0-9A-Fa-f]{6}/g)).toEqual(['#FFFFFF']);
    expect(svg).not.toContain('<rect');
  });
});

describe('svgDataUrl', () => {
  it('SvgDataUrl_Face_Base64WithItsType', () => {
    const svg = renderFace(face({ title: 'CAFÉ #1' }));
    const url = svgDataUrl(svg);
    expect(url).toMatch(/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(url.split(',')[1], 'base64').toString('utf8')).toBe(svg);
  });
});
