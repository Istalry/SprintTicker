import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { ActiveSessionDTO } from '../src/shared/dtos';
import { FRONT_ELEMENT_IDS } from '../src/shared/device-constants';

vi.mock('electron', () => ({
  app: { isPackaged: false },
  powerSaveBlocker: { start: vi.fn().mockReturnValue(1), stop: vi.fn(), isStarted: vi.fn().mockReturnValue(false) }
}));

const ANIMATIONS_DIR = path.resolve(__dirname, '../../../Animations');
const SETTLE_MS = 20;

interface Close {
  /** The element types on the panel at the moment its screen closed. */
  types: string[];
  /** How long before the close the last animation left the panel, or null if none ever did. */
  sinceLastAnimationRemovedMs: number | null;
}

/**
 * The part of firmware 1.2.4's canvas service (`canvas.c`) that decides when
 * the device's screen closes, answering HTTP the way the bar does.
 *
 * - A draw merges by element id and opens the screen if it was closed.
 * - A removal by `element_ids` checks every id before removing any: one
 *   missing id is a 400 and nothing goes. On a closed screen it is a 400.
 * - Whatever empties the element set closes the screen. A full DELETE on a
 *   closed screen does nothing and answers 200.
 * - An upload over an `.anim` an element is playing answers 508.
 *
 * On the real bar, closing the screen after an image and an animation have
 * shared it hangs the device within a few cycles. This records every close so
 * a test can say when, and on what, it happened.
 */
class FirmwareCanvas {
  public readonly elements = new Map<string, { type: string; path?: string }>();
  public readonly closes: Close[] = [];
  public screenOpen = false;
  /** Every element set the panel has shown, for "was it ever empty" checks. */
  public readonly history: string[][] = [];
  private lastAnimationRemovedAt: number | null = null;

  public handle(url: string, init?: RequestInit): Response {
    const method = init?.method ?? 'GET';
    if (url.includes('/api/assets/upload') && method === 'POST') {
      const file = new URL(url).searchParams.get('file');
      const playing = [...this.elements.values()].some(el => el.type === 'animation' && el.path === file);
      return this.answer(playing ? 508 : 200);
    }
    if (url.includes('/api/display/draw')) {
      if (method === 'POST') return this.draw(JSON.parse(String(init?.body)));
      if (method === 'DELETE') {
        return init?.body ? this.remove(JSON.parse(String(init.body)).element_ids as string[]) : this.clear();
      }
    }
    return this.answer(200);
  }

  private draw(payload: { elements: Array<{ id: string; type: string; path?: string }> }): Response {
    this.screenOpen = true;
    for (const el of payload.elements) this.elements.set(el.id, { type: el.type, path: el.path });
    this.snapshot();
    return this.answer(200);
  }

  private remove(ids: string[]): Response {
    if (!this.screenOpen || ids.some(id => !this.elements.has(id))) return this.answer(400);
    for (const id of ids) {
      if (this.elements.get(id)?.type === 'animation') this.lastAnimationRemovedAt = Date.now();
      this.elements.delete(id);
    }
    this.snapshot();
    if (this.elements.size === 0) this.close([]);
    return this.answer(200);
  }

  private clear(): Response {
    if (!this.screenOpen) return this.answer(200);
    const types = [...this.elements.values()].map(el => el.type);
    this.elements.clear();
    this.snapshot();
    this.close(types);
    return this.answer(200);
  }

  private close(types: string[]): void {
    this.closes.push({
      types,
      sinceLastAnimationRemovedMs: this.lastAnimationRemovedAt === null ? null : Date.now() - this.lastAnimationRemovedAt
    });
    this.screenOpen = false;
  }

  private snapshot(): void {
    this.history.push([...this.elements.keys()].sort());
  }

  private answer(code: number): Response {
    return { ok: code >= 200 && code < 300, status: code, json: async () => ({}) } as Response;
  }
}

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
  let canvas: FirmwareCanvas;
  let driver: BusyBarDriver;
  let renderer: DisplayRenderer;
  const originalFetch = globalThis.fetch;

  const paused: ActiveSessionDTO = {
    taskId: 'SPR-1', taskKey: 'SPR-1', taskTitle: 'Pause menu', status: 'PAUSED', elapsedSeconds: 600,
    startedAtUtc: new Date().toISOString()
  } as ActiveSessionDTO;
  const tracking: ActiveSessionDTO = { ...paused, status: 'TRACKING' };

  const shown = (): string[] => [...canvas.elements.keys()].sort();
  const has = (id: string): boolean => canvas.elements.has(id);
  const everEmptiedWhileOpen = (): boolean => canvas.history.slice(1).some(set => set.length === 0);

  beforeEach(async () => {
    canvas = new FirmwareCanvas();
    globalThis.fetch = (async (url: string, init?: RequestInit) => canvas.handle(url, init)) as typeof fetch;
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
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
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
    const uploads = vi.fn();
    const handle = canvas.handle.bind(canvas);
    canvas.handle = (url, init) => {
      const response = handle(url, init);
      if (url.includes('task_done_72x16.anim')) uploads(response.status);
      return response;
    };

    renderer.renderTaskCompletionConfetti(5);
    await sceneShowing();
    renderer.renderTaskCompletionConfetti(5);
    await new Promise(resolve => setTimeout(resolve, 150));

    expect(uploads.mock.calls.map(call => call[0])).not.toContain(508);
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

    renderer.setContextMode('WORK');
    renderer.renderActiveSession(null);
    await waitFor(() => canvas.closes.length >= 1, 'the release');

    expect(canvas.closes.every(close => !close.types.includes('animation'))).toBe(true);
  });

  it('IdleClock_TaskStartedDuringTheRelease_KeepsTheNewScreen', async () => {
    await showPausedTask();
    renderer.setShowIdleClockFallback(true);

    renderer.renderActiveSession(null);
    renderer.renderActiveSession(tracking);
    await new Promise(resolve => setTimeout(resolve, SETTLE_MS * 5));

    expect(has(FRONT_ELEMENT_IDS.FRAME)).toBe(true);
  });
});
