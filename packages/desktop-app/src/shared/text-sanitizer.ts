/**
 * Reduces text to printable ASCII (0x20-0x7E), which is all the display fonts
 * can render -- anything else corrupts the matrix.
 *
 * Order matters here. Everything with a readable ASCII equivalent is
 * transliterated first, and only then does the final pass drop what is left.
 * That pass is a silent delete: whatever reaches it loses a character rather
 * than gaining a substitute.
 *
 * Accents used to reach it. This function already transliterated smart quotes,
 * dashes and ellipses -- clearly intending to preserve meaning -- and then
 * deleted every accented letter, so French notifications arrived at the bar
 * with holes inside their words. "Reunion terminee" rendered as "Runion
 * termine" and "ca va" as "a va". NFD decomposition separates a letter from its
 * mark, so dropping the marks leaves the letter behind.
 *
 * The ligatures and the eszett are handled before that, because they decompose
 * to nothing and would be deleted whole. The non-breaking spaces matter too:
 * they are what Windows puts before ':' and '?' in French, so deleting them
 * would run two words together.
 *
 * Lives in `shared/` rather than beside the driver because the notification
 * text composer has to sanitise *before* it measures a string against a field
 * width. Transliteration changes length -- one em dash becomes two hyphens, the
 * eszett becomes two letters -- so measuring first and sanitising afterwards
 * silently overflows the row it just fitted.
 */
export function sanitizeAsciiText(input: string): string {
  if (!input) return '';
  return input
    // Non-breaking and thin spaces, which French punctuation uses routinely.
    .replace(/[\u00A0\u202F\u2007\u2009\u200A]/g, ' ')
    .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u2014/g, '--')
    .replace(/\u2013/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u20AC/g, 'EUR')
    // These have no base letter to fall back on once marks are stripped.
    .replace(/\u0153/g, 'oe')
    .replace(/\u0152/g, 'OE')
    .replace(/\u00E6/g, 'ae')
    .replace(/\u00C6/g, 'AE')
    .replace(/\u00DF/g, 'ss')
    // e-acute becomes 'e' + combining acute; removing the mark keeps the 'e'.
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^\x20-\x7E]/g, '');
}
