import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadAnimationSequence } from '../src/main/hardware/animation-sequence';
import { FRONT_ELEMENT_IDS } from '../src/shared/device-constants';
import { ANIMATIONS_DIR, Desk, EventName, advance, expectSettledScreen, realTurns } from './support/desk';
import { ACTIVE_TRACKER_EVENT, BAR_MENU_EVENT, RESUME_PROMPT_EVENT } from '../src/shared/priority-defaults';

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

  describe('discarding from the paused menu', () => {
    it('Discard_Confirmed_LeavesTheIdleScreenAndNoScene', async () => {
      await play('startTask', 500, 'pause', 500, 'askDiscard', 500, 'discard', SETTLE_MS);

      expect(desk.device.isShowing(FRONT_ELEMENT_IDS.SCENE)).toBe(false);
      expectSettledScreen(desk);
    });

    it('Discard_RefusedThenResumed_TracksAsBefore', async () => {
      await play('startTask', 500, 'pause', 500, 'askDiscard', 500, 'cancelDiscard', 500, 'resume', SETTLE_MS);

      expect(desk.renderer.getPausedConfirm()).toBeNull();
      expectSettledScreen(desk);
    });
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
      expect(desk.device.isShowing(FRONT_ELEMENT_IDS.SCENE)).toBe(false);
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
      expect(desk.device.isShowing(FRONT_ELEMENT_IDS.SCENE)).toBe(false);
      expect(icon()).toBe('icon_playmode_16x16.anim');
    });
  });

  /**
   * Working through lunch. A session started or resumed during it used to
   * leave the sandwich up over the running session, and the bar's picker was
   * queued under Lunch's lock: START opened a picker nobody could see.
   */
  describe('lunch, and the user working through it', () => {
    const scene = (): boolean => desk.device.isShowing(FRONT_ELEMENT_IDS.SCENE);

    it('Picker_DuringLunch_DrawsOverTheSandwich_BackBringsItBack', async () => {
      await play('lunchStart', 2000);
      expect(scene()).toBe(true);

      await play('openPicker', 1000);
      expect(lock()).toBe(BAR_MENU_EVENT);
      expect(scene()).toBe(false);
      expect(desk.device.has(FRONT_ELEMENT_IDS.FRAME)).toBe(true);

      await play('closePicker', SETTLE_MS);
      expect(lock()).toBe('lunchModePriority');
      expectSettledScreen(desk);
    });

    it('TaskPickedOnTheBar_DuringLunch_TheSessionReplacesTheSandwich', async () => {
      await play('lunchStart', 2000, 'openPicker', 1000, 'startTaskFromBar', SETTLE_MS);

      expect(desk.mode).toBe('WORK');
      expect(scene()).toBe(false);
      expectSettledScreen(desk);
    });

    it('TaskStartedInTheWindow_WhileThePickerIsOpen_TheSessionShows', async () => {
      // Found by a stress seed: the picker kept the display, the session
      // waiting under it until someone pressed BACK on the bar.
      await play('openPicker', 1000, 'startTask', SETTLE_MS);

      expect(desk.isPicking).toBe(false);
      expect(lock()).toBe(ACTIVE_TRACKER_EVENT);
      expectSettledScreen(desk);
    });

    it('PickerOpenedAndClosedUnderAway_IsNotReplayedWhenAwayEnds', async () => {
      // Found by a stress seed: refused under Away, the picker was queued, and
      // replayed when Away ended -- after the user had closed it -- holding
      // the display for a picker the bar had already left.
      await play('awayStart', 1000, 'openPicker', 500, 'closePicker', 500, 'awayEnd', SETTLE_MS);

      expect(lock()).toBeNull();
      expectSettledScreen(desk);
    });

    it('PickerOpenedUnderAway_StillOpenWhenAwayEnds_ComesBack', async () => {
      // Found by stress seeds: refused under Away and never queued, the
      // picker was forgotten when Away ended -- the clock came back while the
      // bar still took presses for a list nobody could see.
      await play('awayStart', 1000, 'openPicker', 1000, 'awayEnd', SETTLE_MS);

      expect(lock()).toBe(BAR_MENU_EVENT);
      expectSettledScreen(desk);
    });

    it.each([
      ['during DONE!', 1000],
      ['after DONE!', SETTLE_MS]
    ])('PickerOpened_%s_ACompileStarts_ThePickerStays', async (_when, wait) => {
      // On the real bar (2026-10-15): FINISH, START with nothing running --
      // the picker -- and Unity began compiling. The gear covered the picker,
      // which outranks it, and the picker never came back.
      await play('startTask', SETTLE_MS, 'finish', wait, 'openPicker', 500, 'compileStart', SETTLE_MS);

      expect(lock()).toBe(BAR_MENU_EVENT);
      expectSettledScreen(desk);
    });

    it('PickerOpenedUnderAway_UnlockedDuringLunch_ThePickerIsOverTheSandwich', async () => {
      // Found by stress seed 1186, once unlocking into lunch let go of Away:
      // the picker (97) outranks Lunch (95) and was not offered the display.
      await play('awayStart', 1000, 'openPicker', 1000, 'awayEndIntoLunch', SETTLE_MS);

      expect(lock()).toBe(BAR_MENU_EVENT);
      expectSettledScreen(desk);

      await play('closePicker', SETTLE_MS);
      expect(lock()).toBe('lunchModePriority');
      expectSettledScreen(desk);
    });

    it('PickerOpenedUnderAway_AwayEndsDuringACompile_ThePickerIsOverTheGear', async () => {
      // Unity registered first, and the display went to the registration
      // order rather than the user's priorities.
      await play('compileStart', 500, 'awayStart', 1000, 'openPicker', 1000, 'awayEnd', SETTLE_MS);

      expect(lock()).toBe(BAR_MENU_EVENT);
      expectSettledScreen(desk);

      await play('closePicker', SETTLE_MS);
      expect(lock()).toBe('unityCompilingPriority');
      expectSettledScreen(desk);
    });

    it('PickerOpenedUnderAway_ABannerQueuedMeanwhile_ThePickerComesFirst', async () => {
      // Found by stress seeds: the queue replayed first, so the banner (70)
      // took the display from the picker (97) when Away ended, and Lunch (95)
      // then took it from the banner.
      await play('awayStart', 1000, 'openPicker', 500, 'highBanner', 500, 'awayEnd', 100, 'lunchStart', SETTLE_MS);

      expect(lock()).toBe(BAR_MENU_EVENT);
      expectSettledScreen(desk);
    });

    it('PausedSessionResumed_DuringLunch_TheSessionReplacesTheSandwich', async () => {
      // Paused before lunch, so lunch had nothing to stop.
      await play('startTask', 500, 'pause', 500, 'lunchStart', 2000, 'resume', SETTLE_MS);

      expect(desk.mode).toBe('WORK');
      expect(scene()).toBe(false);
      expectSettledScreen(desk);
    });

    it('ResumeQuestionAnsweredYes_TheSessionTakesTheDisplay', async () => {
      // As ContextScheduleService answers: the session starts under the
      // question's lock, and the release draws it.
      desk.renderer.renderResumePrompt();
      await advance(1000);
      expect(lock()).toBe(RESUME_PROMPT_EVENT);
      expect(desk.device.has(FRONT_ELEMENT_IDS.FRAME)).toBe(true);

      await play('startTask');
      desk.priority.releaseActiveLock(RESUME_PROMPT_EVENT);
      await advance(SETTLE_MS);

      expect(lock()).toBe(ACTIVE_TRACKER_EVENT);
      expectSettledScreen(desk);
    });

    it('ResumeQuestionAnsweredNo_BackOnTheIdleClock', async () => {
      desk.renderer.renderResumePrompt();
      await advance(1000);

      desk.priority.releaseActiveLock(RESUME_PROMPT_EVENT);
      await advance(SETTLE_MS);

      expect(lock()).toBeNull();
      expectSettledScreen(desk);
    });
  });

  describe('modes', () => {
    it('LunchRefusedDuringAway_BackToWork_IsNotReplayed', async () => {
      // A queued Lunch replayed the moment Away ended: back in WORK, holding
      // a Lunch lock that outranked every notification.
      // Lunch's screen asked for with Away still holding the display, which
      // outranks it. Not by a change of mode: AWAY to LUNCH is the unlock
      // during lunch, which ends Away (see the case below).
      desk.priority.setUserMode('AWAY');
      desk.renderer.setContextMode('AWAY');
      await advance(500);
      desk.renderer.renderLunchMode();
      await advance(500);
      expect(lock()).toBe('awayModePriority');

      desk.priority.setUserMode('WORK');
      desk.renderer.setContextMode('WORK');
      await advance(SETTLE_MS);

      expect(lock()).toBeNull();
      expectSettledScreen(desk);
    });

    it('LunchStopsARunningTask_TheSandwichWithNoStopwatchOverIt', async () => {
      // On the real bar (2026-10-16): lunch stopped the task, the engine's
      // subscriber drew the empty session, and the stopwatch icon went on
      // playing over the sandwich for the whole break.
      await play('startTask', SETTLE_MS);
      // As enterLunchMode does: the session stops, and the subscriber draws it
      // empty, then the mode.
      desk.session = null;
      desk.renderer.renderActiveSession(null);
      await play('lunchStart', SETTLE_MS);

      expect(lock()).toBe('lunchModePriority');
      expectSettledScreen(desk);
    });

    it('IconUpWhenTheBarDrops_AwayMeanwhile_NoIconOverTheCoffeeOnceBack', async () => {
      // Found by stress seed 1026: the gear's removal failed while the bar was
      // away, the reconnect called the icon gone, and it played on over the
      // Away scene.
      await play('startTask', SETTLE_MS, 'compileStart', SETTLE_MS, 'barDrop', 500, 'awayStart', 2000, 'barBack', SETTLE_MS);

      expect(lock()).toBe('awayModePriority');
      expectSettledScreen(desk);
    });

    it('LunchStartsWhileLocked_UnlockedDuringIt_TheSandwichNotTheSession', async () => {
      // Locked when lunch began: the session stops behind Away, and unlocking
      // goes straight to LUNCH, never through an empty WORK screen.
      await play('startTask', SETTLE_MS, 'awayStart', SETTLE_MS, 'lunchStartUnderAway', SETTLE_MS);
      expect(lock()).toBe('awayModePriority');

      await play('awayEndIntoLunch', SETTLE_MS);
      expect(desk.mode).toBe('LUNCH');
      expectSettledScreen(desk);

      await play('lunchEnd', SETTLE_MS);
      expectSettledScreen(desk);
    });
  });

  /**
   * The stand-up: OK on its prompt switches the timer to Daily Standup under
   * the prompt's lock, and its STOP brings the task before back. The prompt's
   * meeting scene, then the session screen with the meeting icon -- it used
   * to be the same scene, and joining looked like nothing happening -- then
   * LOGGED: scenes and frames in turn, which is where the panel rules bite.
   */
  describe('the stand-up', () => {
    it('JoinStandup_FromThePrompt_TheSessionScreenThenTheTaskBack', async () => {
      await play('startTask', SETTLE_MS, 'standupPrompt', SETTLE_MS);
      expect(lock()).toBe('standupPromptPriority');

      await play('joinStandup', SETTLE_MS);
      expect(lock()).toBe('activeTrackerPriority');
      expectSettledScreen(desk);

      await play('standupEnds', SETTLE_MS);
      expect(desk.session?.taskTitle).toBe('Stress the bar');
      expectSettledScreen(desk);
    });

    it('JoinStandup_NothingRunning_TheSessionScreenThenTheIdleClock', async () => {
      await play('standupPrompt', SETTLE_MS, 'joinStandup', SETTLE_MS);
      expectSettledScreen(desk);

      await play('standupEnds', SETTLE_MS);
      expect(desk.session).toBeNull();
      expectSettledScreen(desk);
    });

    it('JoinStandup_InOneTick_NoScreenStuck', async () => {
      // Prompt, OK and STOP faster than any request answers.
      await play('startTask', 'standupPrompt', 'joinStandup', 'standupEnds', SETTLE_MS);
      expectSettledScreen(desk);
    });
  });

  /**
   * The bar going away and coming back. 2026-10-07: it froze on BUILDING 40%,
   * was restarted, and came back showing it -- the clear for the build's end
   * had failed while it was away, and the driver replayed the last frame on
   * its return. It now redraws what is current.
   */
  describe('the bar drops out', () => {
    /** Long enough for the ping loop to notice the outage, and the return. */
    const PING_NOTICE_MS = 4000;

    const outage = async (during: () => Promise<void>, options: { reboot?: boolean } = {}): Promise<void> => {
      desk.device.offline = true;
      if (options.reboot) desk.device.reboot();
      await advance(PING_NOTICE_MS);
      await during();
      desk.device.offline = false;
      await advance(PING_NOTICE_MS);
    };

    it('BuildEndsWhileTheBarIsAway_BackOnTheIdleClock', async () => {
      await play('buildStart', 500);

      await outage(() => play('buildEnd', SETTLE_MS));
      await advance(SETTLE_MS);

      expect(lock()).toBeNull();
      expectSettledScreen(desk);
    });

    it('ShortOutage_AClearAnsweredBeforeThePingSeesTheBar_IsNotSentAgain', async () => {
      // Found by stress seed 1670. Play Mode's screen went unanswered, the bar
      // came back before the next ping, and a build drew and its end cleared
      // the panel, all answered; that ping then forgot what the answers said,
      // and the redraw it asks for removed a frame that was gone and closed a
      // closed screen.
      await play('playEnter', 'playExit', 'barDrop', 1000, 'barBack', 40, 'buildStart', 1000, 'buildEnd', SETTLE_MS);

      expect(lock()).toBeNull();
      expectSettledScreen(desk);
    });

    it('BarRebootsDuringASession_TheSessionComesBack', async () => {
      await play('startTask', 500);

      await outage(() => advance(1000), { reboot: true });
      await advance(SETTLE_MS);

      expectSettledScreen(desk);
      expect(icon()).toBeDefined();
    });

    it('BarRebootsDuringLunch_TheSceneComesBack', async () => {
      await play('lunchStart', 500);

      await outage(() => advance(1000), { reboot: true });
      await advance(SETTLE_MS);

      expectSettledScreen(desk);
    });

    it('BarRebootsUnderABuild_TheBuildComesBack', async () => {
      await play('buildStart', 500);

      await outage(() => advance(1000), { reboot: true });
      await advance(SETTLE_MS);

      expect(lock()).toBe('unityCompilingPriority');
      expect(icon()).toBe('icon_hammer_16x16.anim');
      expectSettledScreen(desk);
    });
  });
});
