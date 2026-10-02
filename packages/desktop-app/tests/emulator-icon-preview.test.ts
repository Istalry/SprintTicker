import path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { HardwareDisplayStateDTO } from '../src/shared/dtos';

const ANIMATIONS_DIR = path.resolve(__dirname, '..', '..', '..', 'Animations');
const ICON_PREVIEW_ID = 'icon_anim_preview';

/**
 * The on-screen emulator's copy of the animated icon.
 *
 * The device animates the icon itself; the emulator gets its frames from the
 * icon animator's preview timer, laid over the last screen. A screen that
 * replaced the last one without telling the animator -- the idle clock, which
 * clears the bar rather than drawing a frame -- left that timer running, and
 * the emulator showed the icon over an empty panel until the next frame.
 * Found by watching the emulator after an OpenProject banner (2026-10-01).
 */
describe('emulator icon preview', () => {
  let renderer: DisplayRenderer;
  let states: HardwareDisplayStateDTO[];

  beforeEach(() => {
    const driver = {
      sendDisplayPayload: vi.fn().mockResolvedValue('drawn'),
      sendPixelFrame: vi.fn().mockResolvedValue('sent'),
      clearDisplay: vi.fn().mockResolvedValue(undefined),
      uploadAsset: vi.fn().mockResolvedValue(undefined),
      drawOverlay: vi.fn().mockResolvedValue('drawn'),
      removeDisplayElements: vi.fn().mockResolvedValue(undefined),
      isEnabled: () => true
    } as unknown as BusyBarDriver;
    renderer = new DisplayRenderer(driver, undefined, { animationsDir: ANIMATIONS_DIR });
    states = [];
    renderer.onStateChanged(state => states.push({ ...state, frontElements: [...state.frontElements] }));
  });

  afterEach(() => renderer.dispose());

  const showsIcon = (state: HardwareDisplayStateDTO | undefined): boolean =>
    Boolean(state?.frontElements.some(el => el.id === ICON_PREVIEW_ID));

  it('IdleClockAfterABanner_TheAnimatedIconLeavesTheEmulatorToo', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    renderer.renderNotificationBanner({ appName: 'OpenProject', title: 'Alice', body: 'OP-1 Task', iconId: 'openproject' });
    await vi.waitFor(() => expect(showsIcon(states.at(-1))).toBe(true), { timeout: 2000 });

    renderer.setShowIdleClockFallback(true);
    renderer.renderActiveSession(null);
    // Long enough for several preview ticks, at 15 a second.
    await new Promise(resolve => setTimeout(resolve, 250));

    expect(states.at(-1)?.frontElements).toEqual([]);
  });
});
