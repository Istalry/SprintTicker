import { describe, it, expect } from 'vitest';
import {
  SLACK_16X16_BITMAP,
  DISCORD_16X16_BITMAP,
  GMAIL_16X16_BITMAP,
  BELL_16X16_BITMAP,
  BURGER_16X16_BITMAP,
  CLOCK_16X16_BITMAP,
  WAVE_16X16_BITMAP,
  getBitmapById
} from '../src/shared/pixel-bitmaps';
import { BitmapIconId } from '../src/shared/dtos';

describe('PixelBitmaps Unit Tests', () => {
  const allBitmaps = [
    { name: 'SLACK_16X16_BITMAP', data: SLACK_16X16_BITMAP },
    { name: 'DISCORD_16X16_BITMAP', data: DISCORD_16X16_BITMAP },
    { name: 'GMAIL_16X16_BITMAP', data: GMAIL_16X16_BITMAP },
    { name: 'BELL_16X16_BITMAP', data: BELL_16X16_BITMAP },
    { name: 'BURGER_16X16_BITMAP', data: BURGER_16X16_BITMAP },
    { name: 'CLOCK_16X16_BITMAP', data: CLOCK_16X16_BITMAP },
    { name: 'WAVE_16X16_BITMAP', data: WAVE_16X16_BITMAP }
  ];

  it('GetBitmapById_ValidIds_ReturnsExpected16x16Matrices', () => {
    allBitmaps.forEach(({ data }) => {
      expect(data).toBeDefined();
      expect(data.length).toBe(16);
      data.forEach(row => {
        expect(row.length).toBe(16);
        row.forEach(pixel => {
          expect(pixel === null || typeof pixel === 'string' || typeof pixel === 'number').toBe(true);
        });
      });
    });
  });

  it('GetBitmapById_EachIconType_ReturnsCorrectMatrixReference', () => {
    const icons: BitmapIconId[] = ['burger', 'clock', 'slack', 'gmail', 'discord', 'bell'];
    icons.forEach(iconId => {
      const bitmap = getBitmapById(iconId);
      expect(bitmap).toBeDefined();
      expect(bitmap.length).toBe(16);
    });
  });

  it('GetBitmapById_WithFrameIndex_ReturnsAnimatedSpriteFrames', () => {
    const icons: BitmapIconId[] = ['clock', 'slack', 'gmail', 'discord'];
    icons.forEach(iconId => {
      const frame0 = getBitmapById(iconId, 0);
      const frame1 = getBitmapById(iconId, 1);
      expect(frame0).toBeDefined();
      expect(frame1).toBeDefined();
      expect(frame0.length).toBe(16);
      expect(frame1.length).toBe(16);
    });
  });

  it('GetBitmapById_UnknownId_ReturnsTheGenericBell', () => {
    expect(getBitmapById('no-such-icon')).toBe(BELL_16X16_BITMAP);
  });

  it.each(['discard', 'previous', 'recent'] as BitmapIconId[])('GetBitmapById_%s_IsItsOwnDrawing_NotTheBell', iconId => {
    // The wheel menu's verbs (2026-11-16): an id getBitmapById does not know
    // falls back to the bell, which would pass any shape check.
    const bitmap = getBitmapById(iconId);

    expect(bitmap).not.toBe(BELL_16X16_BITMAP);
    expect(bitmap).toHaveLength(16);
    bitmap.forEach(row => expect(row).toHaveLength(16));
    expect(bitmap.flat().filter(Boolean).length).toBeGreaterThan(40);
  });
});
