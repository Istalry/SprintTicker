import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { ActiveSessionDTO } from '../src/shared/dtos';
import { DEVICE_APPLICATION_NAME, FRONT_ELEMENT_IDS } from '../src/shared/device-constants';
import { FirmwareSimulator, RuleId } from './support/firmware-simulator';

vi.mock('electron', () => ({
  app: { isPackaged: false },
  powerSaveBlocker: { start: vi.fn().mockReturnValue(1), stop: vi.fn(), isStarted: vi.fn().mockReturnValue(false) }
}));

const ANIMATIONS_DIR = path.resolve(__dirname, '../../../Animations');
const SETTLE_MS = 20;

async function waitFor(condition: () => boolean, what: string, timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/**
 * The whole path -- renderer, animation player, icon animator, driver -- run
 * against the firmware's screen rules, with real `.anim` files.
 *
 * The rule under test: changing screens never empties the panel, so it never
 * closes the device's screen. Starting a full-panel scene used to clear the
 * display first, from a frame that could carry an animated icon, which is the
 * sequence that hung the bar on 2026-09-30.
 */
describe('Front display screen lifecycle', () => {
  let canvas: FirmwareSimulator;
  let driver: BusyBarDriver;
  let renderer: DisplayRenderer;
  /** Every request the device was sent, as `METHOD /path body`. */
  let requests: string[];
  /** Rules a test breaks on purpose; every other one fails it. */
  let allowed: RuleId[];

  const paused: ActiveSessionDTO = {
    taskId: 'SPR-1', taskKey: 'SPR-1', taskTitle: 'Pause menu', status: 'PAUSED', elapsedSeconds: 600,
    startedAtUtc: new Date().toISOString()
  } as ActiveSessionDTO;
  const tracking: ActiveSessionDTO = { ...paused, status: 'TRACKING' };

  const shown = (): string[] => [...canvas.elements.keys()].sort();
  const has = (id: string): boolean => canvas.elements.has(id);
  const everEmptiedWhileOpen = (): boolean => canvas.history.slice(1).some(set => set.length === 0);

  beforeEach(async () => {
    canvas = new FirmwareSimulator({ settleMs: SETTLE_MS }).install();
    requests = canvas.requests;
    allowed = [];
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    driver = new BusyBarDriver({ ipAddress: '10.0.4.20', forceMock: false, animationTeardownSettleMs: SETTLE_MS });
    driver.startStateStreamListener = () => undefined;
    await driver.connect();
    renderer = new DisplayRenderer(driver, undefined, { animationsDir: ANIMATIONS_DIR });
  });

  afterEach(() => {
    renderer.dispose();
    driver.disconnect();
    canvas.uninstall();
    vi.restoreAllMocks();
    canvas.expectClean({ allow: allowed });
  });

  /** A paused task: a frame with the animated paused stopwatch over it. */
  async function showPausedTask(): Promise<void> {
    renderer.renderActiveSession(paused);
    await waitFor(() => has(FRONT_ELEMENT_IDS.FRAME) && has(FRONT_ELEMENT_IDS.ICON), 'the paused screen');
  }

  async function sceneShowing(): Promise<void> {
    await waitFor(() => shown().join() === FRONT_ELEMENT_IDS.SCENE, 'the scene alone on the panel');
  }

  it('Scene_FromAScreenWithAnAnimatedIcon_NeverClosesTheScreen', async () => {
    await showPausedTask();

    renderer.setContextMode('LUNCH');
    await sceneShowing();

    expect(canvas.closes).toEqual([]);
    expect(everEmptiedWhileOpen()).toBe(false);
  });

  it('Scene_BackToWork_FrameCoversTheSceneThenTheSceneGoes', async () => {
    await showPausedTask();
    renderer.setContextMode('LUNCH');
    await sceneShowing();

    renderer.setContextMode('WORK');
    await waitFor(() => has(FRONT_ELEMENT_IDS.FRAME) && !has(FRONT_ELEMENT_IDS.SCENE), 'the scene retired');

    expect(canvas.closes).toEqual([]);
    expect(everEmptiedWhileOpen()).toBe(false);
  });

  it('Scene_BackToWork_AnimatedIconReturns', async () => {
    await showPausedTask();
    renderer.setContextMode('LUNCH');
    await sceneShowing();

    renderer.setContextMode('WORK');
    await waitFor(() => shown().join() === [FRONT_ELEMENT_IDS.ICON, FRONT_ELEMENT_IDS.FRAME].sort().join(), 'frame and icon');

    expect(canvas.closes).toEqual([]);
  });

  it('Scene_StraightIntoAnotherScene_ReplacesItInPlace', async () => {
    await showPausedTask();
    renderer.setContextMode('LUNCH');
    await sceneShowing();

    renderer.setContextMode('AWAY');
    await waitFor(() => canvas.elements.get(FRONT_ELEMENT_IDS.SCENE)?.path === 'away_coffee_72x16.anim', 'the away scene');

    expect(shown()).toEqual([FRONT_ELEMENT_IDS.SCENE]);
    expect(canvas.closes).toEqual([]);
    expect(everEmptiedWhileOpen()).toBe(false);
  });

  it('Scene_RepeatedManyTimes_NeverClosesTheScreen', async () => {
    // The real bar hung on the third or fourth close. Ten round trips here.
    for (let round = 0; round < 10; round++) {
      await showPausedTask();
      renderer.setContextMode(round % 2 === 0 ? 'LUNCH' : 'AWAY');
      await sceneShowing();
      renderer.setContextMode('WORK');
      await waitFor(() => has(FRONT_ELEMENT_IDS.FRAME) && !has(FRONT_ELEMENT_IDS.SCENE), `round ${round} back to work`);
    }

    expect(canvas.closes).toEqual([]);
    expect(everEmptiedWhileOpen()).toBe(false);
  });

  it('TaskDone_OneShotSceneAndBack_NeverClosesTheScreen', async () => {
    renderer.renderActiveSession(tracking);
    await waitFor(() => has(FRONT_ELEMENT_IDS.FRAME), 'the tracker');

    renderer.renderTaskCompletionConfetti(0.3);
    await sceneShowing();
    await waitFor(() => has(FRONT_ELEMENT_IDS.FRAME) && !has(FRONT_ELEMENT_IDS.SCENE), 'the celebration over');

    expect(canvas.closes).toEqual([]);
  });

  it('TaskDone_TwiceInARow_DoesNotUploadOverThePlayingScene', async () => {
    // An upload over an .anim the device is playing answers 508, which would
    // drop the second celebration to frame streaming.
    renderer.renderActiveSession(tracking);
    await waitFor(() => has(FRONT_ELEMENT_IDS.FRAME), 'the tracker');

    renderer.renderTaskCompletionConfetti(5);
    await sceneShowing();
    renderer.renderTaskCompletionConfetti(5);
    await new Promise(resolve => setTimeout(resolve, 150));

    expect(canvas.violationsOf('upload-over-playing-anim')).toEqual([]);
    expect(shown()).toEqual([FRONT_ELEMENT_IDS.SCENE]);
  });

  it('IdleClock_ReleasingTheDisplay_TakesTheAnimationDownFirstAndLetsItSettle', async () => {
    // The one deliberate close. It must not find an animation on the panel,
    // and the device gets time between the removal and the close.
    await showPausedTask();
    renderer.setShowIdleClockFallback(true);

    renderer.renderActiveSession(null);
    await waitFor(() => canvas.closes.length === 1, 'the release');

    const [close] = canvas.closes;
    expect(close.types).not.toContain('animation');
    expect(close.sinceLastAnimationRemovedMs).toBeGreaterThanOrEqual(SETTLE_MS - 2);
  });

  it('IdleClock_AfterAScene_TakesTheSceneDownFirst', async () => {
    await showPausedTask();
    renderer.setContextMode('LUNCH');
    await sceneShowing();
    renderer.setShowIdleClockFallback(true);

    const release = vi.spyOn(driver, 'clearDisplay');
    renderer.setContextMode('WORK');
    renderer.renderActiveSession(null);
    await waitFor(() => canvas.closes.length >= 1, 'the release');
    // Removing the scene empties the panel before the release's own DELETE,
    // which is still in its settle wait. Left running, it lands on the next
    // test's fake device, through the shared fetch, and wipes that test's
    // screen.
    await release.mock.results[0].value;
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS * 3));

    // The scene alone closing the screen as it goes is the measured-safe case;
    // an animation sharing the close with anything else is not.
    expect(canvas.violationsOf('close-with-image-and-animation')).toEqual([]);
    // The icon animator still wanted the paused stopwatch: nothing had told it
    // the idle clock was not a frame. It drew the icon back, alone, over the
    // panel the release had just emptied.
    expect(shown()).toEqual([]);
  });

  it('IdleClock_TaskStartedDuringTheRelease_KeepsTheNewScreen', async () => {
    await showPausedTask();
    renderer.setShowIdleClockFallback(true);

    renderer.renderActiveSession(null);
    renderer.renderActiveSession(tracking);
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS * 5));

    expect(has(FRONT_ELEMENT_IDS.FRAME)).toBe(true);
  });

  describe('clears', () => {
    const clears = (): string[] => requests.filter(r => r === 'DELETE /api/display/draw');

    it('ClearDisplay_SecondAskedWhileTheFirstSettles_WaitsAndDoesNotCloseEarly', async () => {
      // 2026-10-05: one Unity compile end asked for three clears at once. A
      // clear arriving after the first had removed the animation found none
      // left, skipped the settle and closed the screen straight away -- the
      // remove-then-close sequence that hangs the bar. It hung twice that day.
      await showPausedTask();

      const first = driver.clearDisplay();
      await waitFor(() => !has(FRONT_ELEMENT_IDS.ICON), 'the animation removed');
      const second = driver.clearDisplay();

      expect(await Promise.all([first, second])).toEqual(['cleared', 'cleared']);
      expect(canvas.closes).toHaveLength(1);
      expect(canvas.closes[0].sinceLastAnimationRemovedMs).toBeGreaterThanOrEqual(SETTLE_MS - 2);
      expect(clears()).toHaveLength(1);
    });

    it('ClearDisplay_ManyAtOnce_RemoveTheAnimationOnceAndCloseOnce', async () => {
      await showPausedTask();

      await Promise.all([driver.clearDisplay(), driver.clearDisplay(), driver.clearDisplay()]);

      expect(requests.filter(r => r.startsWith('DELETE /api/display/draw {'))).toHaveLength(1);
      expect(clears()).toHaveLength(1);
      expect(canvas.closes).toHaveLength(1);
    });

    it('ClearDisplay_PanelAlreadyEmptied_SendsNothing', async () => {
      await showPausedTask();
      await driver.clearDisplay();
      const sent = requests.length;

      expect(await driver.clearDisplay()).toBe('cleared');

      expect(requests).toHaveLength(sent);
    });

    it('ClearDisplay_DrawnSinceTheLastClear_ClearsAgain', async () => {
      await showPausedTask();
      await driver.clearDisplay();
      // The clear went round the renderer, which still believes its frame is up.
      renderer.invalidateFrameCache();
      await showPausedTask();

      await driver.clearDisplay();

      expect(clears()).toHaveLength(2);
      expect(canvas.closes).toHaveLength(2);
      expect(canvas.closes.every(close => !close.types.includes('animation'))).toBe(true);
    });

    it('ClearDisplay_FirstSinceStart_SendsEvenWithNothingDrawn', async () => {
      // A previous run of the app may have left a screen this one never drew.
      expect(await driver.clearDisplay()).toBe('cleared');

      expect(clears()).toHaveLength(1);
    });

    it('ClearDisplay_DrawWhileWaitingItsTurn_IsAbandoned', async () => {
      await showPausedTask();
      const first = driver.clearDisplay();
      const second = driver.clearDisplay();

      // Lands while the first clear settles, after both took their version.
      expect(await driver.sendPixelFrame(Buffer.from('next screen'))).toBe('sent');

      expect(await Promise.all([first, second])).toEqual(['superseded', 'superseded']);
      expect(has(FRONT_ELEMENT_IDS.FRAME)).toBe(true);
      expect(canvas.closes).toEqual([]);
      expect(clears()).toEqual([]);
    });

    it('RemoveDisplayElements_OneAbsentId_IsLoggedAsAlreadyGone', async () => {
      allowed = ['absent-element-removal'];
      await showPausedTask();
      await driver.removeDisplayElements(DEVICE_APPLICATION_NAME, [FRONT_ELEMENT_IDS.ICON]).catch(() => undefined);
      const warn = vi.mocked(console.warn);
      warn.mockClear();

      await expect(driver.removeDisplayElements(DEVICE_APPLICATION_NAME, [FRONT_ELEMENT_IDS.ICON])).rejects.toThrow();

      expect(warn.mock.calls.flat().join(' ')).not.toContain('returned 400');
      expect(vi.mocked(console.log).mock.calls.flat().join(' ')).toContain('already gone');
    });

    it('RemoveDisplayElements_SeveralIdsOneAbsent_StillWarns', async () => {
      // On several ids a 400 means none were removed: not "already gone".
      allowed = ['absent-element-removal'];
      await showPausedTask();
      const warn = vi.mocked(console.warn);
      warn.mockClear();

      await expect(driver.removeDisplayElements(DEVICE_APPLICATION_NAME, [FRONT_ELEMENT_IDS.ICON, 'absent'])).rejects.toThrow();

      expect(warn.mock.calls.flat().join(' ')).toContain('returned 400');
    });
  });

  /**
   * The driver's display queue and ledger: the rules hold whoever asks for
   * what, and in whatever order.
   */
  describe('display queue', () => {
    /** A device that takes its time, so requests could overlap if anything let them. */
    function slowDevice(): void {
      canvas.uninstall();
      canvas = new FirmwareSimulator({ settleMs: SETTLE_MS, latencyMs: 5 }).install();
      requests = canvas.requests;
    }

    const iconElement = {
      id: FRONT_ELEMENT_IDS.ICON, type: 'animation', path: 'icon_gear_16x16.anim',
      x: 0, y: 0, display: 'front', loop: true, z_index: 2
    };

    it('DisplayRequests_FrameOverlayAndClearAtOnce_NeverOverlap', async () => {
      slowDevice();

      await Promise.all([
        driver.sendPixelFrame(Buffer.from('frame')),
        driver.drawOverlay(DEVICE_APPLICATION_NAME, [iconElement]),
        driver.clearDisplay()
      ]);

      expect(canvas.maxInFlight).toBe(1);
    });

    it('StopWithTheIdleClock_ClearAndSceneInOneTick_NeverCloseOnTheScene', async () => {
      // Found by the stress test (seed 1025): the clear checked "nothing drawn
      // since" before the LOGGED scene's draw had answered, then closed the
      // screen on the frame and the scene together.
      slowDevice();
      renderer.setShowIdleClockFallback(true);
      renderer.renderActiveSession(tracking);
      await waitFor(() => has(FRONT_ELEMENT_IDS.FRAME), 'the tracker');

      renderer.renderActiveSession(null);
      renderer.renderTaskLogged(1);
      await waitFor(() => has(FRONT_ELEMENT_IDS.SCENE), 'the LOGGED scene');
      await new Promise(resolve => setTimeout(resolve, SETTLE_MS * 3));

      expect(canvas.violationsOf('close-with-image-and-animation')).toEqual([]);
    });

    it('RemoveDisplayElements_KnownAbsentAfterAClear_SendsNothing', async () => {
      await showPausedTask();
      await driver.clearDisplay();
      const sent = requests.length;

      await driver.removeDisplayElements(DEVICE_APPLICATION_NAME, [FRONT_ELEMENT_IDS.ICON]);

      expect(requests).toHaveLength(sent);
    });

    it('UploadAsset_OverTheAnimationPlaying_IsNotSent', async () => {
      // The device answers 508 and holds the file already.
      await showPausedTask();
      const playing = String(canvas.elements.get(FRONT_ELEMENT_IDS.ICON)?.path);
      const sent = requests.length;

      await driver.uploadAsset(DEVICE_APPLICATION_NAME, playing, Buffer.from('anim'));

      expect(requests).toHaveLength(sent);
    });

    it('RemoveDisplayElements_LastElementSoonAfterAnAnimationLeft_WaitsForTheSettle', async () => {
      // Emptying the panel closes the screen, whichever call does it: the
      // settle is not only the clear's.
      await showPausedTask();
      await driver.removeDisplayElements(DEVICE_APPLICATION_NAME, [FRONT_ELEMENT_IDS.ICON]);

      await driver.removeDisplayElements(DEVICE_APPLICATION_NAME, [FRONT_ELEMENT_IDS.FRAME]);

      expect(canvas.closes).toHaveLength(1);
      expect(canvas.closes[0].sinceLastAnimationRemovedMs).toBeGreaterThanOrEqual(SETTLE_MS - 2);
    });
  });
});
