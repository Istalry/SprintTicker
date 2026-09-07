import { DISPLAY_CONSTANTS } from './render-constants';
import { sanitizeAsciiText } from './text-sanitizer';
import { capacityFor } from './text-capacity';

/**
 * Turns a Windows toast into the two rows a 72x16 banner can actually show.
 *
 * This exists because the composition used to be split across two processes:
 * the listener built a "[channel] title: body" string and the renderer drew it
 * into a single 55px row. That row holds eleven characters, and the channel
 * label alone spent ten of them -- so every Slack notification rendered as
 * "[Message] " plus an ellipsis, and the message itself was never on screen.
 *
 * Keeping it pure and here, rather than in the renderer, is what makes the
 * character budget testable. It is the whole point of the module: the budget is
 * small enough that an off-by-one is the difference between a readable word and
 * a truncated one.
 */

const { LAYOUT_OFFSETS, FONT_METRICS } = DISPLAY_CONSTANTS;

/**
 * Single-character ellipsis. Both bitmap fonts carry a glyph for it, so it
 * costs one stride rather than the three a literal "..." would.
 *
 * It is deliberately appended *after* sanitising: the sanitiser transliterates
 * U+2026 into three dots, so marking first and sanitising second would spend
 * three characters saying what one says, and overflow the row it just fitted.
 */
const TRUNCATION_MARKER = '\u2026';

/** Shown when a toast carries no usable text at all. Must fit row 0. */
const FALLBACK_TEXT = 'Alert';

/**
 * Stands in for the body when a source is marked private.
 *
 * Eleven characters, so it fits row 1 whole -- a placeholder that itself got
 * truncated would look like a message that had been cut off.
 */
const HIDDEN_BODY_TEXT = 'New message';

/** Characters that fit row 0 (4x6 font) and row 1 (3x5 font). */
export const ROW0_CAPACITY = capacityFor(LAYOUT_OFFSETS.TEXT_FIELD_WIDTH, FONT_METRICS.ROW0.STRIDE_X);
export const ROW1_CAPACITY = capacityFor(LAYOUT_OFFSETS.TEXT_FIELD_WIDTH, FONT_METRICS.ROW1.STRIDE_X);

/**
 * Truncates to `capacity` glyphs *including* the marker.
 *
 * The result is never longer than the capacity, which is what stops the canvas
 * truncating a second time: PixelCanvas only cuts when the string exceeds the
 * field, so a string of exactly capacity length passes through untouched.
 */
export function fitToCapacity(text: string, capacity: number): string {
  if (capacity <= 0) return '';
  if (text.length <= capacity) return text;
  if (capacity === 1) return TRUNCATION_MARKER;
  return text.slice(0, capacity - 1).trimEnd() + TRUNCATION_MARKER;
}

export interface NotificationTextInput {
  appName?: string;
  title?: string;
  body?: string;
  /**
   * False when the icon is the generic bell -- i.e. the glyph beside the text
   * does not say which application this came from, so the text has to.
   */
  iconIdentifiesApp: boolean;
  /**
   * Replace the message body with a fixed placeholder.
   *
   * The sender or channel still shows, so the banner is still worth a glance;
   * only what they said is withheld. See NotificationSourceRule.hideMessageBody.
   */
  hideBody?: boolean;
}

export interface NotificationBannerText {
  /** Who it is from. 4x6 font, already truncated to the field. */
  row0: string;
  /** What it says. 3x5 font, already truncated to the field. */
  row1: string;
  /** Untruncated, for the rear panel, which has room for it. */
  fullText: string;
}

/**
 * Composes the two banner rows.
 *
 * The app name is deliberately *omitted* when the icon identifies the app. That
 * is not a space-saving trick -- it is the reason the icon pipeline exists.
 * `AppIconResolver` goes to the trouble of extracting the real executable icon,
 * and `NotificationSourceRule.iconImagePath` lets a user hand-correct one that
 * reduces badly, all so those 256 pixels can say "Slack". Spending ten of
 * eleven characters repeating it is what this function was written to stop.
 */
export function composeNotificationBanner(input: NotificationTextInput): NotificationBannerText {
  if (!input) throw new Error('composeNotificationBanner requires an input object.');

  // Sanitise before measuring, never after. Transliteration changes length --
  // an em dash becomes two hyphens, the eszett becomes two letters -- so a row
  // fitted first and sanitised afterwards overflows the field it just fitted.
  const appName = sanitizeAsciiText(input.appName ?? '').trim();
  const title = sanitizeAsciiText(input.title ?? '').trim();
  // Dropped here rather than further down, so no later branch can fold it into
  // a row and no copy of it survives into `fullText` for the rear panel.
  const body = input.hideBody ? '' : sanitizeAsciiText(input.body ?? '').trim();

  let row0Source: string;
  let row1Source: string;

  if (input.iconIdentifiesApp) {
    // The icon names the app, so row 0 can be the sender.
    row0Source = title || appName;
    row1Source = body;
  } else if (input.hideBody) {
    // A generic icon and a hidden body leave only the app name to identify the
    // source; the title may itself be a person's name, which is the kind of
    // thing hiding the body is meant to keep off the panel.
    row0Source = appName || title;
    row1Source = '';
  } else {
    // A generic bell names nothing, so the app name has to lead and everything
    // else is packed into the body row.
    row0Source = appName || title;
    row1Source = appName ? [title, body].filter(Boolean).join(': ') : body;
  }

  if (input.hideBody) {
    // Applied after the row-0 decision so it cannot be promoted into the
    // identity row by the empty-row0 branch below.
    row1Source = HIDDEN_BODY_TEXT;
  }

  if (!row0Source && !row1Source) {
    row0Source = FALLBACK_TEXT;
  } else if (!row0Source) {
    // Never leave the identity row blank while the body row carries text.
    row0Source = row1Source;
    row1Source = '';
  }

  return {
    row0: fitToCapacity(row0Source, ROW0_CAPACITY),
    row1: fitToCapacity(row1Source, ROW1_CAPACITY),
    fullText: [row0Source, row1Source].filter(Boolean).join(' - ')
  };
}
