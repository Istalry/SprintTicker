import { describe, it, expect } from 'vitest';
import {
  composeNotificationBanner,
  fitToCapacity,
  ROW0_WIDTH_PX,
  ROW1_CAPACITY
} from '../src/shared/notification-text';
import { measureText } from '../src/shared/proportional-text';
import { capacityFor } from '../src/shared/text-capacity';
import { PixelCanvas } from '../src/main/hardware/pixel-canvas';
import { DISPLAY_CONSTANTS } from '../src/shared/render-constants';

/**
 * The banner used to render "[Message] " plus an ellipsis and nothing else.
 *
 * A 55px field holds eleven 4x6 glyphs. The header was
 * `[${channelName}] ${senderName}` and the listener rewrote every Slack or
 * Discord channel label to the literal "Message", so ten of the eleven
 * characters were spent on a word the app icon beside them already said, and
 * the message itself never reached the display.
 *
 * These tests exist to keep the character budget honest: at eleven characters
 * an off-by-one is the difference between a readable word and a truncated one.
 */
describe('composeNotificationBanner', () => {
  const FIELD = DISPLAY_CONSTANTS.LAYOUT_OFFSETS.TEXT_FIELD_WIDTH;
  const MARKER = '\u2026';

  it('ComposeNotificationBanner_AppIconResolved_OmitsTheAppNameEntirely', () => {
    // The whole point of AppIconResolver is that those 256 pixels say "Slack".
    const text = composeNotificationBanner({
      appName: 'Slack',
      title: 'Alice Martin',
      body: 'can you review the PR?',
      iconIdentifiesApp: true
    });

    expect(text.row0).not.toContain('Slack');
    expect(text.row0.startsWith('Alice')).toBe(true);
  });

  it('ComposeNotificationBanner_TitleAndBody_PutsTitleOnRow0AndBodyOnRow1', () => {
    const text = composeNotificationBanner({
      appName: 'Slack',
      title: 'Alice',
      body: 'ship it',
      iconIdentifiesApp: true
    });

    expect(text.row0).toBe('Alice');
    expect(text.row1).toBe('ship it');
  });

  it('ComposeNotificationBanner_NoTitle_StillShowsTheBody', () => {
    // A toast with only a body must not lose it: row 0 falls back to the app
    // name and the body keeps row 1.
    const text = composeNotificationBanner({
      appName: 'Slack',
      body: 'standup in 5',
      iconIdentifiesApp: true
    });

    expect(text.row0).toBe('Slack');
    expect(text.row1).toBe('standup in 5');
  });

  it('ComposeNotificationBanner_GenericBellIcon_PutsTheAppNameOnRow0', () => {
    // A bell names nothing, so the text has to carry the identity instead.
    const text = composeNotificationBanner({
      appName: 'Teams',
      title: 'Bob',
      body: 'hi',
      iconIdentifiesApp: false
    });

    expect(text.row0).toBe('Teams');
    expect(text.row1).toBe('Bob: hi');
  });

  it('ComposeNotificationBanner_Row0LongerThanCapacity_TruncatesIncludingTheMarker', () => {
    const text = composeNotificationBanner({
      title: 'Alexandra Rodriguez',
      body: 'x',
      iconIdentifiesApp: true
    });

    // Measured, not counted: row 0 is proportional, so the same character
    // count can be 9px or 30px wide depending on the letters.
    expect(measureText(text.row0)).toBeLessThanOrEqual(ROW0_WIDTH_PX);
    expect(text.row0.endsWith(MARKER)).toBe(true);
    expect(text.row0).not.toContain(' ' + MARKER);
  });

  it('ComposeNotificationBanner_AccentedText_SanitisesBeforeMeasuring', () => {
    // Transliteration changes length, so measuring first and sanitising second
    // overflows the row that was just fitted.
    const text = composeNotificationBanner({
      title: 'R\u00E9union termin\u00E9e',
      body: '\u00E0 midi',
      iconIdentifiesApp: true
    });

    expect(measureText(text.row0)).toBeLessThanOrEqual(ROW0_WIDTH_PX);
    expect(text.row1).toBe('a midi');
    const withoutMarker = (text.row0 + text.row1).split(MARKER).join('');
    expect(/^[\x20-\x7E]*$/.test(withoutMarker)).toBe(true);
  });

  it('ComposeNotificationBanner_Emoji_DropsThemRatherThanRenderingQuestionMarks', () => {
    // The canvas maps an unknown glyph to '?', so substituting would spend
    // scarce characters saying nothing.
    const text = composeNotificationBanner({
      title: 'Alice',
      body: '\u{1F389}\u{1F389} done',
      iconIdentifiesApp: true
    });

    expect(text.row1).toBe('done');
    expect(text.row1).not.toContain('?');
  });

  it('ComposeNotificationBanner_NoFieldsAtAll_FallsBackToALabelThatFits', () => {
    const text = composeNotificationBanner({ iconIdentifiesApp: true });

    expect(text.row0.length).toBeGreaterThan(0);
    expect(measureText(text.row0)).toBeLessThanOrEqual(ROW0_WIDTH_PX);
    expect(text.row0).not.toContain(MARKER);
  });

  it('ComposeNotificationBanner_BodyOnlyAndNoAppName_PromotesItToTheIdentityRow', () => {
    // Never leave row 0 blank while row 1 carries text.
    const text = composeNotificationBanner({ body: 'build failed', iconIdentifiesApp: true });

    expect(text.row0.startsWith('build')).toBe(true);
    expect(text.row1).toBe('');
  });

  it('ComposeNotificationBanner_LongBody_KeepsTheFullTextForTheRearPanel', () => {
    // The rear panel is 160x80 and has room for what the front cannot show.
    const text = composeNotificationBanner({
      title: 'Alice',
      body: 'the deployment finished successfully',
      iconIdentifiesApp: true
    });

    expect(text.fullText).toContain('the deployment finished successfully');
    expect(text.row1.length).toBe(ROW1_CAPACITY);
  });

  describe('capacity agreement with the canvas', () => {
    // The composer truncates to what it believes fits and the canvas truncates
    // again when it disagrees. These two tests stop that drift: if the budgets
    // ever differ by one, a row is cut twice -- the second time with no marker,
    // mid-word.

    it('ComposeNotificationBanner_Row0AtCapacity_IsNotReTruncatedByTheCanvas', () => {
      const { row0 } = composeNotificationBanner({
        title: 'Alexandra Rodriguez',
        iconIdentifiesApp: true
      });

      const clipped = new PixelCanvas(72, 16);
      clipped.drawTextClipped(row0, 17, 0, '#FFFFFF', FIELD);
      const unclipped = new PixelCanvas(72, 16);
      unclipped.drawText(row0, 17, 0, '#FFFFFF');

      expect(clipped.getPixels()).toEqual(unclipped.getPixels());
    });

    it('ComposeNotificationBanner_Row1AtCapacity_IsNotReTruncatedByTheCanvas', () => {
      const { row1 } = composeNotificationBanner({
        title: 'Alice',
        body: 'the deployment finished successfully',
        iconIdentifiesApp: true
      });

      const clipped = new PixelCanvas(72, 16);
      clipped.drawSmallText(row1, 17, 8, '#FFFFFF', FIELD);
      const unconstrained = new PixelCanvas(72, 16);
      unconstrained.drawSmallText(row1, 17, 8, '#FFFFFF', 1000);

      expect(clipped.getPixels()).toEqual(unconstrained.getPixels());
    });
  });
});

describe('capacityFor', () => {
  it('CapacityFor_FieldOfFiftyFivePixelsAtStrideFour_FitsFourteenGlyphs', () => {
    // The last glyph occupies x=69..71 and only its trailing gap falls off the
    // field, which is free. floor(55/4) claims thirteen and wastes a character.
    expect(capacityFor(55, 4)).toBe(14);
  });

  it('CapacityFor_NonPositiveStride_ReturnsZeroRatherThanDividingByIt', () => {
    expect(capacityFor(55, 0)).toBe(0);
  });
});

describe('hidden message bodies', () => {
  // The bar sits on a desk in view of whoever walks past, so for a chat app
  // the body is the one part that should not be readable across a room.
  // The sender stays: a banner nobody can attribute is not worth a glance.
  const SECRET = 'salary review at 4pm';

  it('ComposeNotificationBanner_HideBody_KeepsTheSenderOnRow0', () => {
    const text = composeNotificationBanner({
      appName: 'Slack',
      title: 'Alice',
      body: SECRET,
      iconIdentifiesApp: true,
      hideBody: true
    });

    expect(text.row0).toBe('Alice');
  });

  it('ComposeNotificationBanner_HideBody_ReplacesRow1WithAPlaceholder', () => {
    const text = composeNotificationBanner({
      title: 'Alice',
      body: SECRET,
      iconIdentifiesApp: true,
      hideBody: true
    });

    expect(text.row1).not.toContain(SECRET);
    expect(text.row1.length).toBeGreaterThan(0);
    expect(text.row1.length).toBeLessThanOrEqual(ROW1_CAPACITY);
    // A placeholder that was itself truncated would read as a cut-off message.
    expect(text.row1).not.toContain('…');
  });

  it('ComposeNotificationBanner_HideBody_KeepsTheBodyOutOfTheRearPanelText', () => {
    // fullText feeds the rear elements, which the on-screen emulator draws.
    // Hiding the body on the front while leaking it there would defeat this.
    const text = composeNotificationBanner({
      appName: 'Slack',
      title: 'Alice',
      body: SECRET,
      iconIdentifiesApp: true,
      hideBody: true
    });

    expect(text.fullText).not.toContain(SECRET);
  });

  it('ComposeNotificationBanner_HideBodyWithGenericIcon_DoesNotFallBackToTheSenderName', () => {
    // With a generic bell the app name has to lead. The title may itself be
    // a person, so it must not be promoted into the freed body row.
    const text = composeNotificationBanner({
      appName: 'Signal',
      title: 'Alice',
      body: SECRET,
      iconIdentifiesApp: false,
      hideBody: true
    });

    expect(text.row0).toBe('Signal');
    expect(text.row1).not.toContain(SECRET);
    expect(text.row1).not.toContain('Alice');
  });

  it('ComposeNotificationBanner_HideBodyNotSet_StillShowsTheBody', () => {
    // Absent opt-in must behave exactly as it did before this existed.
    const text = composeNotificationBanner({
      title: 'Alice',
      body: 'ship it',
      iconIdentifiesApp: true
    });

    expect(text.row1).toBe('ship it');
  });
  });

describe('fitToCapacity', () => {
  it('FitToCapacity_TextShorterThanCapacity_ReturnsItUnchanged', () => {
    expect(fitToCapacity('short', 11)).toBe('short');
  });

  it('FitToCapacity_TextLongerThanCapacity_ResultIsExactlyCapacity', () => {
    // Exactly capacity, not capacity+1: the marker replaces a character rather
    // than being appended past the field.
    expect(fitToCapacity('abcdefghijklmnop', 11)).toHaveLength(11);
  });

  it('FitToCapacity_ZeroCapacity_ReturnsEmpty', () => {
    expect(fitToCapacity('anything', 0)).toBe('');
  });
});
