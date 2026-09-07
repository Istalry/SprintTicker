/**
 * How many glyphs of a given stride fit a field, in characters.
 *
 * Shared by the notification text composer and by PixelCanvas, and that sharing
 * is the point: the composer truncates a row to what it believes fits, and the
 * canvas truncates again when it disagrees. Two private copies of this formula
 * meant a row could be cut twice -- once with an ellipsis and once without --
 * landing mid-word with no indication that anything was missing.
 *
 * The +1 is not a fudge. A glyph's stride is its width plus one pixel of gap,
 * but the last glyph on a row does not need its trailing gap: it may hang off
 * the end of the field. At stride 4 in a 55px field that is fourteen glyphs,
 * the last occupying x=69..71, where floor(55/4) claims thirteen and silently
 * wastes a character on a display that only has eleven to spare.
 */
export function capacityFor(fieldWidthPx: number, strideX: number): number {
  if (strideX <= 0) return 0;
  return Math.max(0, Math.floor((fieldWidthPx + 1) / strideX));
}
