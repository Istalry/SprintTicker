import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { ANIMATED_ICONS, FRONT_ANIMATIONS, SCENE_ICONS } from '../src/shared/render-constants';
import {
  BURGER_16X16_BITMAP, CHECKMARK_16X16_BITMAP, COFFEE_16X16_BITMAP, COMPILING_16X16_BITMAP, MEETING_16X16_BITMAP,
  MOON_16X16_BITMAP, STOPWATCH_16X16_BITMAP, STOPWATCH_PAUSED_16X16_BITMAP, getBitmapById
} from '../src/shared/pixel-bitmaps';
import { ActiveSessionDTO, ScreenIconDTO } from '../src/shared/dtos';

/**
 * The icon of the screen on the bar, which the mini timer shows: the one a
 * screen draws at the left of its frame, or the one standing for a scene.
 */
describe('the screen icon', () => {
  let renderer: DisplayRenderer;
  let told: Array<ScreenIconDTO | null>;

  const session = (over: Partial<ActiveSessionDTO> = {}): ActiveSessionDTO => ({
    sessionId: 's-1', taskId: 'T-1', taskKey: 'SPR-142', taskTitle: 'Rework the pause menu',
    status: 'TRACKING', elapsedSeconds: 60, startedAtUtc: new Date().toISOString(), ...over
  } as ActiveSessionDTO);

  beforeEach(() => {
    const driver = {
      sendDisplayPayload: vi.fn().mockResolvedValue('drawn'),
      sendPixelFrame: vi.fn().mockResolvedValue('sent'),
      clearDisplay: vi.fn().mockResolvedValue('cleared'),
      uploadAsset: vi.fn().mockResolvedValue(undefined),
      drawOverlay: vi.fn().mockResolvedValue('drawn'),
      removeDisplayElements: vi.fn().mockResolvedValue(undefined),
      getDeviceStatus: vi.fn(() => ({ connected: true }))
    } as unknown as BusyBarDriver;
    renderer = new DisplayRenderer(driver);
    told = [];
    renderer.onScreenIconChanged(icon => told.push(icon));
  });

  afterEach(() => {
    renderer.dispose();
  });

  it('GetScreenIcon_NothingDrawnYet_IsNull', () => {
    expect(renderer.getScreenIcon()).toBeNull();
  });

  it('RenderActiveSession_EachState_IsTheStopwatchItShows', () => {
    renderer.renderActiveSession(session());
    // With the .anim the bar plays over it, which the Stream Deck plays too.
    expect(renderer.getScreenIcon()).toEqual({ pixels: STOPWATCH_16X16_BITMAP, label: 'SPR-142: Rework the pause menu', animation: ANIMATED_ICONS.stopwatch });

    renderer.renderActiveSession(session({ status: 'PAUSED' }));
    expect(renderer.getScreenIcon()?.pixels).toBe(STOPWATCH_PAUSED_16X16_BITMAP);
    expect(renderer.getScreenIcon()?.animation).toBe(ANIMATED_ICONS.stopwatch_paused);
  });

  it('RenderActiveSession_StandUpRunning_IsTheMeeting', () => {
    renderer.renderActiveSession(session({ taskTitle: 'Daily Standup', isAdHoc: true }));

    expect(renderer.getScreenIcon()).toEqual({ pixels: MEETING_16X16_BITMAP, label: 'Daily Standup', animation: ANIMATED_ICONS.meeting });
  });

  it('RenderActiveSession_EverySecond_ToldOnce', () => {
    // The tracker redraws once a second; the icon has not moved.
    for (let s = 60; s < 65; s++) renderer.renderActiveSession(session({ elapsedSeconds: s }));

    expect(told).toHaveLength(1);
  });

  it('RenderCompilation_IsTheGearWithTheScreensTopRow', () => {
    renderer.renderCompilation('ProjectX');

    const icon = renderer.getScreenIcon();
    expect(icon?.pixels).toBe(COMPILING_16X16_BITMAP);
    expect(icon?.label).toMatch(/COMPILING/);
  });

  it('RenderNotificationBanner_AppsOwnIcon_IsThatIcon', () => {
    const appIcon = getBitmapById('slack').map(row => [...row]);

    renderer.renderNotificationBanner({ appName: 'Slack', title: 'Rin', body: 'Lunch?', customIconData: appIcon });

    expect(renderer.getScreenIcon()?.pixels).toBe(appIcon);
  });

  it('Scenes_EachOne_IsTheIconStandingForIt', () => {
    renderer.renderLunchMode();
    expect(renderer.getScreenIcon()).toEqual({ pixels: BURGER_16X16_BITMAP, label: 'LUNCH' });

    renderer.renderAwayMode();
    expect(renderer.getScreenIcon()).toEqual({ pixels: COFFEE_16X16_BITMAP, label: 'AWAY' });

    renderer.renderEodCompleted();
    expect(renderer.getScreenIcon()).toEqual({ pixels: MOON_16X16_BITMAP, label: 'SEE YOU!' });

    renderer.renderTaskCompletionConfetti();
    expect(renderer.getScreenIcon()).toEqual({ pixels: CHECKMARK_16X16_BITMAP, label: 'DONE!' });
  });

  it('SceneIcons_EveryScene_HasAnIconOfSixteenBySixteen', () => {
    for (const scene of Object.values(FRONT_ANIMATIONS)) {
      const bitmap = getBitmapById(SCENE_ICONS[scene].icon);
      expect(bitmap).toHaveLength(16);
      for (const row of bitmap) {
        expect(row).toHaveLength(16);
        for (const color of row) expect(color === null || /^#[0-9A-F]{6}$/i.test(color)).toBe(true);
      }
    }
  });

  it('RenderActiveSession_IdleClock_NoIconOfOurs', () => {
    renderer.renderActiveSession(session());
    renderer.setShowIdleClockFallback(true);

    renderer.renderActiveSession(null);

    expect(renderer.getScreenIcon()).toBeNull();
    expect(told[told.length - 1]).toBeNull();
  });

  it('RenderActiveSession_UnderLunch_KeepsTheBurger', () => {
    // The tracker's ticks do not draw over a mode's scene, so neither do they
    // move its icon.
    renderer.setContextMode('LUNCH');
    renderer.renderActiveSession(session());

    expect(renderer.getScreenIcon()?.label).toBe('LUNCH');
  });
});
