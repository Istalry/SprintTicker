import { describe, expect, it } from 'vitest';
import type { Face, Glyph } from '../src/faces';
import { GLYPH_PATHS, KEY_SIZE, escapeXml, fitLine, renderFace, renderListIcon, svgDataUrl } from '../src/svg';

const face = (overrides: Partial<Face> = {}): Face => ({ lines: ['DONE'], accent: '#22C55E', glyph: 'check', dim: false, ...overrides });

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

  it('RenderFace_Dim_FadesEverything', () => {
    expect(renderFace(face({ dim: true }))).toMatch(/<svg[^>]*><g opacity="0.4">.*<\/g><\/svg>$/);
    expect(renderFace(face())).not.toContain('opacity');
  });

  it('RenderFace_TaskText_IsEscaped', () => {
    const svg = renderFace(face({ lines: ['<b>&"x"'] }));
    expect(svg).not.toContain('<b>');
    expect(texts(svg)).toEqual(['&lt;b&gt;&amp;&quot;x&quot;']);
  });

  it('RenderFace_ManyLines_DrawsThreeFitted', () => {
    expect(texts(renderFace(face({ lines: ['ONE', 'TWO', 'THREE', 'FOUR'] })))).toEqual(['ONE', 'TWO', 'THREE']);
  });

  it('RenderFace_WithATime_OneLineAndTheTimeInTheAccent', () => {
    const svg = renderFace(face({ lines: ['SPR-1', 'PAUSED'], big: '1:24:10', accent: '#F59E0B' }));
    expect(texts(svg)).toEqual(['SPR-1', '1:24:10']);
    expect(svg).toMatch(/fill="#F59E0B">1:24:10<\/text>/);
  });

  it('RenderFace_Pixels_DrawnInPlaceOfTheGlyph', () => {
    const svg = renderFace(face({ pixels: [['#FF0000', null, '#00FF00CC']] }));
    expect(svg).not.toContain(GLYPH_PATHS.check);
    expect(svg).toContain('fill="#FF0000"');
    // The alpha is dropped: an SVG fill takes #RRGGBB.
    expect(svg).toContain('fill="#00FF00"');
    expect(svg.match(/<rect /g)).toHaveLength(2 + 2);
  });

  it('RenderFace_PixelNotAColour_IsSkippedNotInjected', () => {
    const svg = renderFace(face({ pixels: [['red', '#FF0000" onload="x', '#12345']] }));
    expect(svg).not.toContain('onload');
    expect(svg).not.toContain('red');
    expect(svg.match(/<rect /g)).toHaveLength(2);
  });
});

describe('glyphs', () => {
  it.each(Object.keys(GLYPH_PATHS) as Glyph[])('GlyphPath_%s_IsOnlyPathCommands', glyph => {
    expect(GLYPH_PATHS[glyph]).toMatch(/^M[MLHVCSQTAZmlhvcsqtaz0-9 .,-]+$/);
  });

  it('RenderListIcon_IsWhiteOnNothing', () => {
    const svg = renderListIcon('star', 20);
    expect(svg).toContain('width="20" height="20"');
    expect(svg.match(/#[0-9A-Fa-f]{6}/g)).toEqual(['#FFFFFF']);
    expect(svg).not.toContain('<rect');
  });
});

describe('svgDataUrl', () => {
  it('SvgDataUrl_Face_Base64WithItsType', () => {
    const svg = renderFace(face({ lines: ['CAFÉ #1'] }));
    const url = svgDataUrl(svg);
    expect(url).toMatch(/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(url.split(',')[1], 'base64').toString('utf8')).toBe(svg);
  });
});
