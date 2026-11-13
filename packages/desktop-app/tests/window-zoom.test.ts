import { describe, expect, it } from 'vitest';
import { enableZoom, zoomLevelFor, ZOOM_MAX, ZOOM_MIN, ZoomKey } from '../src/main/windows/window-zoom';

const key = (k: string, extra: Partial<ZoomKey> = {}): ZoomKey => ({ type: 'keyDown', key: k, control: true, meta: false, alt: false, ...extra });

describe('window zoom (A11)', () => {
  it('ZoomLevelFor_CtrlPlusMinusZero_StepsAndResets', () => {
    expect(zoomLevelFor(key('='), 0)).toBe(0.5);
    expect(zoomLevelFor(key('+'), 1)).toBe(1.5);
    expect(zoomLevelFor(key('-'), 0)).toBe(-0.5);
    expect(zoomLevelFor(key('0'), 2)).toBe(0);
  });

  it('ZoomLevelFor_AtTheLimits_StaysThere', () => {
    expect(zoomLevelFor(key('='), ZOOM_MAX)).toBe(ZOOM_MAX);
    expect(zoomLevelFor(key('-'), ZOOM_MIN)).toBe(ZOOM_MIN);
  });

  it('ZoomLevelFor_NotAZoomKey_IsNull', () => {
    expect(zoomLevelFor(key('k'), 0)).toBeNull();
    expect(zoomLevelFor(key('=', { control: false }), 0)).toBeNull();
    expect(zoomLevelFor(key('=', { alt: true }), 0)).toBeNull();
    expect(zoomLevelFor(key('=', { type: 'keyUp' }), 0)).toBeNull();
  });

  it('EnableZoom_KeyAndWheel_SetTheLevelAndKeepTheKey', () => {
    let level = 0;
    const handlers: Record<string, (...args: never[]) => void> = {};
    enableZoom({
      getZoomLevel: () => level,
      setZoomLevel: next => { level = next; },
      on: (event: string, listener: (...args: never[]) => void) => { handlers[event] = listener; }
    } as never);
    let prevented = false;
    (handlers['before-input-event'] as (e: unknown, i: ZoomKey) => void)({ preventDefault: () => { prevented = true; } }, key('='));
    expect(level).toBe(0.5);
    expect(prevented).toBe(true);
    (handlers['zoom-changed'] as (e: unknown, d: 'in' | 'out') => void)({}, 'out');
    expect(level).toBe(0);
  });

  it('EnableZoom_AnyOtherKey_LeftAlone', () => {
    let level = 0;
    const handlers: Record<string, (...args: never[]) => void> = {};
    enableZoom({
      getZoomLevel: () => level,
      setZoomLevel: next => { level = next; },
      on: (event: string, listener: (...args: never[]) => void) => { handlers[event] = listener; }
    } as never);
    let prevented = false;
    (handlers['before-input-event'] as (e: unknown, i: ZoomKey) => void)({ preventDefault: () => { prevented = true; } }, key('k'));
    expect(prevented).toBe(false);
    expect(level).toBe(0);
  });
});
