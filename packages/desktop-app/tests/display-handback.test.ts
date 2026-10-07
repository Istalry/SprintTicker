import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadAnimationSequence } from '../src/main/hardware/animation-sequence';
import { FRONT_ELEMENT_IDS } from '../src/shared/device-constants';
import { ANIMATIONS_DIR, Desk, EventName, advance, expectSettledScreen, realTurns } from './support/desk';

// As in display-stress.test.ts: every `.anim` read once, then from memory, so
// a file read never lands at some arbitrary point of simulated time.
vi.mock('../src/main/hardware/animation-sequence', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/main/hardware/animation-sequence')>();
  const loaded = new Map<string, ReturnType<typeof actual.loadAnimationSequence>>();
  return {
    ...actual,
    loadAnimationSequence: (dir: string, name: string) => {
      const key = path.join(dir, name);
      if (!loaded.has(key)) loaded.set(key, actual.loadAnimationSequence(dir, name));
      return loaded.get(key)!;
    }
  };
});

vi.mock('electron', () => ({
  app: { isPackaged: false },
  powerSaveBlocker: { start: vi.fn().mockReturnValue(1), stop: vi.fn(), isStarted: vi.fn().mockReturnValue(false) }
}));

/** Long enough for a banner (3 s), any scene and the compile grace to end. */
const SETTLE_MS = 8000;

/**
 * Who gets the display back when something ends, scripted from what the
 * stress runs found. Each case was a seed that ended with the panel
 * disagreeing with the state: a build still running under the idle clock,
 * the sandwich up under a lock that said "compiling", the second editor's
 * compile taken down by the first one's end.
 */
describe('Display hand-back: the screen that ends gives the display to the right one', () => {
  let desk: Desk;

  const play = async (...steps: Array<EventName | number>): Promise<void> => {
    for (const step of steps) {
      if (typeof step === 'number') await advance(step);
      else {
        desk.fire(step);
        await realTurns();
      }
    }
  };
  /** The animated icon on the panel, which tells the screens apart: gear, hammer, ON AIR. */
  const icon = (): string | undefined => desk.device.elements.get(FRONT_ELEMENT_IDS.ICON)?.path;
  const lock = (): string | null => desk.priority.getActiveLockEventName();

  beforeAll(async () => {
    const names = fs.readdirSync(ANIMATIONS_DIR).filter(name => fs.statSync(path.join(ANIMATIONS_DIR, name)).isDirectory());
    await Promise.all(names.map(name => loadAnimationSequence(ANIMATIONS_DIR, name)));
  }, 60_000);

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    desk = new Desk(1);
    await desk.connect();
  });

  afterEach(() => {
    desk.device.expectClean();
    desk.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Unity under something else', () => {
    it('Banner_OverABuild_HandsTheDisplayBackToTheBuild', async () => {
      // Seed 1947: the banner's end went to the idle clock, the build still running.
      await play('buildStart', 500, 'banner', SETTLE_MS);

      expect(lock()).toBe('unityCompilingPriority');
      expect(icon()).toBe('icon_hammer_16x16.anim');
      expectSettledScreen(desk);
    });

    it('Banner_CompileStartedUnderIt_ShowsTheGearAfterwards', async () => {
      // Refused while the banner held the display, and never asked again.
      await play('banner', 100, 'compileStart', SETTLE_MS);

      expect(lock()).toBe('unityCompilingPriority');
      expect(icon()).toBe('icon_gear_16x16.anim');
    });

    it('LunchEnds_AnEditorStillCompiling_GearReplacesTheSandwich', async () => {
      // Leaving Lunch drew the gear behind the sandwich still playing: the
      // lock said compiling, the panel showed lunch.
      await play('lunchStart', 500, 'compileStart', 500, 'lunchEnd', SETTLE_MS);

      expect(lock()).toBe('unityCompilingPriority');
      expect(desk.device.has(FRONT_ELEMENT_IDS.SCENE)).toBe(false);
      expect(icon()).toBe('icon_gear_16x16.anim');
    });

    it('CompileEnds_StillInPlayMode_ReturnsToPlayMode', async () => {
      await play('playEnter', 500, 'compileStart', 500, 'compileEnd', SETTLE_MS);

      expect(lock()).toBe('unityPlayModePriority');
      expect(icon()).toBe('icon_playmode_16x16.anim');
    });
  });

  describe('two editors open', () => {
    it('Compile_FirstOfTwoEditorsFinishes_GearStaysForTheOther', async () => {
      await play('compileStart', 100, 'compileStartB', 500, 'compileEnd', SETTLE_MS);

      expect(lock()).toBe('unityCompilingPriority');
      expect(icon()).toBe('icon_gear_16x16.anim');

      await play('compileEndB', SETTLE_MS);
      expect(lock()).toBeNull();
      expectSettledScreen(desk);
    });

    it('Build_OtherEditorsCompileEnds_BuildScreenStays', async () => {
      await play('buildStart', 100, 'compileStartB', 500, 'compileEndB', SETTLE_MS);

      expect(lock()).toBe('unityCompilingPriority');
      expect(icon()).toBe('icon_hammer_16x16.anim');
    });

    it('Build_OtherEditorsBuildEnds_FirstBuildScreenStays', async () => {
      await play('buildStart', 100, 'buildStartB', 500, 'buildEndB', SETTLE_MS);

      expect(lock()).toBe('unityCompilingPriority');
      expect(icon()).toBe('icon_hammer_16x16.anim');
    });

    it('PlayMode_OneEditorExits_OtherStaysOnAir', async () => {
      await play('playEnter', 100, 'playEnterB', 500, 'playExit', SETTLE_MS);

      expect(lock()).toBe('unityPlayModePriority');
      expect(icon()).toBe('icon_playmode_16x16.anim');
    });
  });

  describe('the session and the scenes', () => {
    it('SessionEndsUnderABanner_IdleClockDoesNotWipeTheBanner', async () => {
      await play('startTask', 1000, 'banner', 200);
      const closesBefore = desk.device.closes.length;

      // The engine's subscriber, alone: no scene follows.
      desk.session = null;
      desk.renderer.renderActiveSession(null);
      // Past the clear's settle, still inside the banner's 3 s.
      await advance(1500);

      expect(lock()).toBe('messagingPriority');
      expect(desk.device.has(FRONT_ELEMENT_IDS.FRAME)).toBe(true);
      expect(desk.device.closes.length).toBe(closesBefore);

      // The banner's end then hands back to the idle clock.
      await advance(SETTLE_MS);
      expect(lock()).toBeNull();
      expectSettledScreen(desk);
    });

    it('SessionEnds_TrackersLockGoesWithIt', async () => {
      await play('startTask', 1000);
      expect(lock()).toBe('activeTrackerPriority');

      desk.session = null;
      desk.renderer.renderActiveSession(null);
      await advance(SETTLE_MS);

      expect(lock()).toBeNull();
      expectSettledScreen(desk);
    });

    it('TaskDone_DuringPlayMode_SceneEndsOnPlayMode', async () => {
      // The scene's end went to the session -- none, so the idle clock --
      // with Play Mode still holding the display.
      await play('startTask', 500, 'playEnter', 500, 'finish', SETTLE_MS);

      expect(lock()).toBe('unityPlayModePriority');
      expect(desk.device.has(FRONT_ELEMENT_IDS.SCENE)).toBe(false);
      expect(icon()).toBe('icon_playmode_16x16.anim');
    });
  });

  describe('modes', () => {
    it('LunchRefusedDuringAway_BackToWork_IsNotReplayed', async () => {
      // A queued Lunch replayed the moment Away ended: back in WORK, holding
      // a Lunch lock that outranked every notification.
      // Lunch begins with Away still holding the display, which outranks it.
      desk.priority.setUserMode('AWAY');
      desk.renderer.setContextMode('AWAY');
      await advance(500);
      desk.priority.setUserMode('LUNCH');
      desk.renderer.setContextMode('LUNCH');
      await advance(500);
      expect(lock()).toBe('awayModePriority');

      desk.priority.setUserMode('WORK');
      desk.renderer.setContextMode('WORK');
      await advance(SETTLE_MS);

      expect(lock()).toBeNull();
      expectSettledScreen(desk);
    });
  });
});
