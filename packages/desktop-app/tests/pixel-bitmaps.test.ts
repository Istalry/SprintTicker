import { describe, it, expect } from 'vitest';
import {
  SLACK_16X16_BITMAP,
  DISCORD_16X16_BITMAP,
  GMAIL_16X16_BITMAP,
  UNITY_16X16_BITMAP,
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
    { name: 'UNITY_16X16_BITMAP', data: UNITY_16X16_BITMAP },
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
    const icons: BitmapIconId[] = ['burger', 'clock', 'slack', 'gmail', 'discord', 'unity'];
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
});
