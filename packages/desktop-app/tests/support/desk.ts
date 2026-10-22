import path from 'path';
import { expect, vi } from 'vitest';
import { BusyBarDriver } from '../../src/main/hardware/busybar-driver';
import { DisplayRenderer } from '../../src/main/hardware/display-renderer';
import { PriorityPreemptionEngine } from '../../src/main/services/priority-preemption-engine';
import { UnityTelemetryService } from '../../src/main/services/unity-telemetry-service';
import { SettingsRepository } from '../../src/main/db/repositories/settings-repository';
import { TimeTrackingEngine } from '../../src/main/engine/time-tracking-engine';
import { ActiveSessionDTO, UserMode } from '../../src/shared/dtos';
import { FRONT_ELEMENT_IDS } from '../../src/shared/device-constants';
import { ACTIVE_TRACKER_EVENT, BAR_MENU_EVENT } from '../../src/shared/priority-defaults';
import { DAILY_STANDUP_TITLE } from '../../src/shared/schedule-defaults';
import { FRONT_ANIMATIONS } from '../../src/shared/render-constants';
import { FirmwareSimulator } from './firmware-simulator';

/**
 * A desk: the whole display stack -- driver, renderer, priority engine, Unity
 * service -- on the firmware simulator, with every source that draws on the
 * bar reachable as a named event.
 *
 * Shared by the generated stress runs and the scripted regressions taken
 * from them. A test file using it must, itself:
 * - `vi.mock` `electron`, and preload the `.anim` files through a cached
 *   `loadAnimationSequence` mock (see display-stress.test.ts): under fake
 *   timers a real file read lands at an arbitrary point of simulated time;
 * - fake every timer but `setImmediate`, which is how file reads get a turn.
 */

export const ANIMATIONS_DIR = path.resolve(__dirname, '../../../../Animations');

/** mulberry32: small, seedable, and the same sequence on every machine. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type UnityEvent = 'compileStart' | 'compileEnd' | 'buildStart' | 'buildEnd' | 'playEnter' | 'playExit' | 'exception';

export type EventName =
  | UnityEvent | `${UnityEvent}B`
  | 'banner' | 'highBanner'
  | 'startTask' | 'startTaskFromBar' | 'pause' | 'resume' | 'tick' | 'stop' | 'finish'
  /** The paused menu's DROP: the question, BACK on it, and the click that confirms. */
  | 'askDiscard' | 'cancelDiscard' | 'discard'
  /** The bar's task picker, opened with nothing running, and BACK out of it. */
  | 'openPicker' | 'closePicker'
  | 'lunchStart' | 'lunchEnd' | 'awayStart' | 'awayEnd'
  /** Lunch beginning under Away, which stops the session and stays Away; and unlocking into it. */
  | 'lunchStartUnderAway' | 'awayEndIntoLunch'
  /** The bar unreachable, back, or rebooted while unreachable. */
  | 'barDrop' | 'barBack' | 'barReboot'
  /** The stand-up's prompt, OK on it -- the timer switches to the stand-up -- and its STOP, which brings the task before it back. */
  | 'standupPrompt' | 'joinStandup' | 'standupEnds';

/** Lets real file reads land: the animation player and icon animator load `.anim` files from disk. */
export async function realTurns(count = 8): Promise<void> {
  for (let i = 0; i < count; i++) await new Promise(resolve => setImmediate(resolve));
}

/** Moves simulated time on, with real turns between slices so disk reads land in about the time they take. */
export async function advance(ms: number): Promise<void> {
  const SLICE_MS = 50;
  let left = ms;
  do {
    const slice = Math.min(left, SLICE_MS);
    await vi.advanceTimersByTimeAsync(slice);
    await realTurns(2);
    left -= slice;
  } while (left > 0);
}

/** The two editors: same service, told apart by instance id, as two open projects are. */
export const EDITORS = {
  A: { instanceId: 'game-1', projectName: 'Game' },
  B: { instanceId: 'tools-2', projectName: 'Tools' }
} as const;

/** How often the simulated editor pings, well inside the service's 15 s prune. */
const HEARTBEAT_MS = 5000;
/** How long a rebooting bar stays unreachable: several pings, as on the real one. */
const REBOOT_MS = 10_000;

/** The whole display stack, wired as `index.ts` and the IPC registry wire it. */
export class Desk {
  public readonly device: FirmwareSimulator;
  public readonly driver: BusyBarDriver;
  public readonly renderer: DisplayRenderer;
  public readonly priority: PriorityPreemptionEngine;
  public readonly unity: UnityTelemetryService;
  public session: ActiveSessionDTO | null = null;
  public mode: UserMode = 'WORK';
  /** The state after each step, for reading a replayed seed. */
  public readonly timeline: string[] = [];
  private readonly startedAt = Date.now();
  /** What each editor is doing, as its own events say. */
  public readonly editors: Record<string, { compiling: boolean; building: boolean; playing: boolean }> = Object.fromEntries(
    Object.values(EDITORS).map(editor => [editor.instanceId, { compiling: false, building: false, playing: false }])
  );
  private sessionCount = 0;
  private picking = false;
  /** The session the stand-up switched away from, to restart when it ends. */
  private beforeStandup: ActiveSessionDTO | null = null;
  /** Until when the bar is rebooting, and no `barBack` brings it back. */
  private rebootingUntil = 0;
  private readonly next: () => number;
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor(seed: number) {
    this.next = random(seed ^ 0x5eed);
    // Seeded too, so a replay meets the same latencies.
    this.device = new FirmwareSimulator({
      settleMs: 500,
      latencyMs: () => 2 + Math.floor(this.next() * 40),
      timingToleranceMs: 0
    }).install();

    const store = new Map<string, unknown>([
      ['unity_settings', { enablePlayModeDnd: true, showUnityErrors: true, errorDurationSeconds: 2 }]
    ]);
    const settings = {
      getSetting: (key: string, fallback: unknown) => (store.has(key) ? store.get(key) : fallback),
      setSetting: (key: string, value: unknown) => store.set(key, value)
    } as unknown as SettingsRepository;

    this.driver = new BusyBarDriver({ ipAddress: '10.0.4.20', forceMock: false });
    this.driver.startStateStreamListener = () => undefined;
    this.priority = new PriorityPreemptionEngine(settings);
    this.renderer = new DisplayRenderer(this.driver, this.priority, { animationsDir: ANIMATIONS_DIR });
    this.priority.setRenderer(this.renderer);
    // The user's configuration: idle shows the firmware clock, which is the
    // one path that closes the device's screen on purpose.
    this.renderer.setShowIdleClockFallback(true);
    const engine = { getCurrentSession: () => this.session } as unknown as TimeTrackingEngine;
    this.unity = new UnityTelemetryService(settings, undefined, this.renderer, engine, this.priority);
    // An open editor pings every few seconds; without it the service prunes
    // the instance after 15 s and releases on its own -- in the quiet at the
    // end of a run too, which left that release's clear unfinished.
    this.heartbeat = setInterval(() => {
      for (const editor of Object.values(EDITORS)) this.unity.handleHeartbeat({ ...editor });
    }, HEARTBEAT_MS);
    // As InputDecoder does: an open picker is drawn again whenever the
    // display frees. Registered after Unity, so the engine's order by
    // priority is what puts it first.
    this.priority.addBackgroundScreen([BAR_MENU_EVENT], () => {
      if (this.picking) this.renderer.renderTaskSelection('PROJECT', 'Game', { position: { index: 0, count: 2 } });
    });
  }

  public async connect(): Promise<void> {
    const connected = this.driver.connect();
    await advance(200);
    expect(await connected).toBe(true);
  }

  public fire(event: EventName): void {
    const editor = event.endsWith('B') ? EDITORS.B : EDITORS.A;
    const unityEvent = event.replace(/B$/, '');
    const state = this.editors[editor.instanceId];
    switch (unityEvent) {
      case 'compileStart':
        // A compile inside a build is part of the build, and ends with it.
        state.compiling = state.compiling || !state.building;
        return this.unity.handleCompile({ ...editor, state: 'started', type: 'compile' });
      case 'compileEnd':
        state.compiling = false;
        return this.unity.handleCompile({ ...editor, state: 'finished', type: 'compile' });
      case 'buildStart':
        // A build takes over a compile already running in that editor.
        state.building = true;
        state.compiling = false;
        return this.unity.handleCompile({ ...editor, state: 'started', type: 'build', progress: 30 });
      case 'buildEnd':
        state.building = false;
        state.compiling = false;
        return this.unity.handleCompile({ ...editor, state: 'finished', type: 'build' });
      case 'playEnter':
        state.playing = true;
        return this.unity.handlePlayMode({ ...editor, state: 'entered' });
      case 'playExit':
        state.playing = false;
        return this.unity.handlePlayMode({ ...editor, state: 'exited' });
      case 'exception': return this.unity.handleConsole({ ...editor, type: 'exception', message: 'NullReferenceException' });
    }
    switch (event) {
      case 'banner':
      case 'highBanner':
        this.renderer.renderNotificationBanner({
          appName: 'Slack', title: 'Ana', body: 'Lunch?', iconId: 'slack',
          eventName: event === 'banner' ? 'messagingPriority' : 'highNotificationPriority',
          timeoutMs: 3000
        });
        return;
      case 'startTask':
      case 'startTaskFromBar': {
        this.session = this.newSession();
        // The engine's listeners in the order they subscribed: the decoder's
        // closes a picker left open, ContextScheduleService's leaves Lunch.
        // From the bar, the picker is closed after GO!, not by the listener.
        const fromThePicker = event === 'startTaskFromBar' && this.picking;
        if (!fromThePicker && this.picking) this.closePicker();
        this.workThroughLunch();
        // From the app the IPC registry's subscriber renders the session; from
        // the bar the picker plays GO! first, then lets go of the display.
        if (event === 'startTaskFromBar') {
          this.renderer.renderTaskStarted(this.session);
          if (fromThePicker) this.closePicker();
        } else this.renderer.renderActiveSession(this.session);
        return;
      }
      case 'openPicker':
        // As InputDecoder does: START or a click with nothing running.
        if (this.session || this.picking) return;
        this.picking = true;
        this.renderer.renderTaskSelection('PROJECT', 'Game', { position: { index: 0, count: 2 } });
        return;
      case 'closePicker':
        if (!this.picking) return;
        this.closePicker();
        this.renderer.renderIdle();
        return;
      case 'pause':
      case 'resume':
        if (!this.session) return;
        this.session = { ...this.session, status: event === 'pause' ? 'PAUSED' : 'TRACKING' };
        if (event === 'resume') this.workThroughLunch();
        this.renderer.renderActiveSession(this.session);
        return;
      case 'tick':
        if (!this.session) return;
        this.session = { ...this.session, elapsedSeconds: this.session.elapsedSeconds + 61 };
        this.renderer.renderActiveSession(this.session);
        return;
      case 'askDiscard':
        if (this.session?.status !== 'PAUSED') return;
        this.renderer.selectPausedChoice('DISCARD');
        this.renderer.askPausedConfirm('DISCARD');
        return;
      case 'cancelDiscard':
        this.renderer.clearPausedConfirm();
        return;
      case 'discard':
        if (!this.session) return;
        this.session = null;
        // As InputDecoder does it: the question goes without a redraw, and the
        // engine's subscriber draws the empty session. No scene: nothing was kept.
        this.renderer.clearPausedConfirm({ redraw: false });
        this.renderer.renderActiveSession(null);
        return;
      case 'stop':
      case 'finish':
        if (!this.session) return;
        this.session = null;
        // The engine's subscriber first, then the IPC handler's scene.
        this.renderer.renderActiveSession(null);
        if (event === 'stop') this.renderer.renderTaskLogged();
        else this.renderer.renderTaskCompletionConfetti();
        return;
      // As ContextScheduleService does them.
      case 'barDrop':
        this.device.offline = true;
        return;
      case 'barBack':
        if (Date.now() >= this.rebootingUntil) this.device.offline = false;
        return;
      case 'barReboot':
        // An outage first, the driver seeing a dropped link, and one that
        // lasts: a bar back in the same tick would be a reboot no ping saw.
        this.device.offline = true;
        this.device.reboot();
        this.rebootingUntil = Date.now() + REBOOT_MS;
        return;
      case 'standupPrompt':
        this.renderer.renderCeremonyPrompt('STANDUP', 'Daily Stand-Up');
        return;
      case 'joinStandup': {
        // As ContextScheduleService.joinStandup does: the engine stops the
        // session and starts the stand-up under the prompt's lock, its
        // subscriber drawing each, and the prompt's release draws once more.
        if (this.session?.taskTitle === DAILY_STANDUP_TITLE) return;
        this.beforeStandup = this.session?.status === 'TRACKING' ? this.session : null;
        if (this.session) {
          this.session = null;
          this.renderer.renderActiveSession(null);
        }
        this.session = { ...this.newSession(), taskTitle: DAILY_STANDUP_TITLE, isAdHoc: true };
        this.renderer.renderActiveSession(this.session);
        this.priority.releaseActiveLock('standupPromptPriority');
        return;
      }
      case 'standupEnds': {
        if (this.session?.taskTitle !== DAILY_STANDUP_TITLE) return;
        // STOP: the engine's subscriber and the LOGGED scene, as 'stop';
        // then, once every listener has heard, the task before comes back.
        this.session = null;
        this.renderer.renderActiveSession(null);
        this.renderer.renderTaskLogged();
        const before = this.beforeStandup;
        this.beforeStandup = null;
        if (before) {
          this.session = { ...this.newSession(), taskId: before.taskId, taskKey: before.taskKey, taskTitle: before.taskTitle };
          this.renderer.renderActiveSession(this.session);
        }
        return;
      }
      case 'lunchStart': return this.enterMode('LUNCH');
      case 'lunchStartUnderAway':
        if (this.mode !== 'AWAY' || this.session?.status !== 'TRACKING') return;
        // The engine's subscriber draws the empty session; no scene, since
        // the user did not stop it.
        this.session = null;
        this.renderer.renderActiveSession(null);
        return;
      case 'awayEndIntoLunch':
        if (this.mode !== 'AWAY') return;
        return this.enterMode('LUNCH');
      case 'awayStart': return this.enterMode('AWAY');
      case 'lunchEnd':
      case 'awayEnd':
        if (this.mode !== (event === 'lunchEnd' ? 'LUNCH' : 'AWAY')) return;
        return this.enterMode('WORK');
    }
  }

  /** The bar's picker is open: it holds the display until BACK or a pick. */
  public get isPicking(): boolean {
    return this.picking;
  }

  public note(what: string): void {
    const lock = this.priority.getActiveLockEventName();
    this.timeline.push(
      `${String(Date.now() - this.startedAt).padStart(6)} ms  ${what.padEnd(40)} lock ${String(lock)}, ` +
        `session ${this.session?.status ?? 'none'}, mode ${this.mode}, panel [${this.device.shown().join(', ')}]`
    );
  }

  public dispose(): void {
    clearInterval(this.heartbeat);
    this.unity.dispose();
    this.renderer.dispose();
    this.driver.disconnect();
    this.device.uninstall();
  }

  /**
   * A session starting or resuming during lunch is the user working through
   * it: ContextScheduleService's session listener, which runs before the IPC
   * registry's render of the session, leaves Lunch.
   */
  private workThroughLunch(): void {
    if (this.mode === 'LUNCH') this.enterMode('WORK');
  }

  private closePicker(): void {
    this.picking = false;
    this.priority.releaseActiveLock(BAR_MENU_EVENT);
  }

  private enterMode(mode: UserMode): void {
    this.mode = mode;
    this.priority.setUserMode(mode);
    this.renderer.setContextMode(mode);
  }

  private newSession(): ActiveSessionDTO {
    this.sessionCount++;
    return {
      sessionId: `s${this.sessionCount}`, projectId: 'p', taskId: `T-${this.sessionCount}`, taskKey: `T-${this.sessionCount}`,
      taskTitle: 'Stress the bar', isAdHoc: false, status: 'TRACKING', startTimeUtc: new Date().toISOString(),
      totalPausedSeconds: 0, elapsedSeconds: 0
    };
  }
}

/**
 * Once everything has timed out, the panel shows what the state says it
 * should: no screen stuck from an event long over.
 */
export function expectSettledScreen(desk: Desk): void {
  const shown = desk.device.shown();
  const lock = desk.priority.getActiveLockEventName();
  const context = `mode ${desk.mode}, lock ${String(lock)}, session ${desk.session?.status ?? 'none'}, panel [${shown.join(', ')}]`;
  // The picker outranks Lunch, not Away; under Away it waits, and comes
  // back as a background screen when Away ends.
  // Lunch can begin under Away here, as the 'modes' case scripts it, and
  // Away's lock then stays.
  const away = desk.mode === 'AWAY' || lock === 'awayModePriority';
  if (away || (desk.mode === 'LUNCH' && !desk.isPicking)) {
    if (!desk.device.isShowing(FRONT_ELEMENT_IDS.SCENE)) throw new Error(`Expected the ${desk.mode} scene: ${context}`);
    // Which scene, not just a scene: unlocked into lunch, the mode said
    // LUNCH while Away's lock kept the coffee cup up (real bar, 2026-10-15).
    const scene = desk.device.elements.get(FRONT_ELEMENT_IDS.SCENE)?.path ?? '';
    const expected = desk.mode === 'LUNCH' ? FRONT_ANIMATIONS.LUNCH : FRONT_ANIMATIONS.AWAY;
    if (!scene.startsWith(expected)) throw new Error(`Expected ${expected}, the panel plays ${scene}: ${context}`);
    // Nothing over it: the tracker's stopwatch went on playing over the
    // sandwich when lunch stopped a running task (real bar, 2026-10-16).
    if (desk.device.isShowing(FRONT_ELEMENT_IDS.ICON)) throw new Error(`Expected no icon over the ${desk.mode} scene: ${context}`);
    return;
  }
  // The user's hand on the bar: it stays over everything else until BACK.
  if (desk.isPicking) {
    if (lock !== BAR_MENU_EVENT || !desk.device.has(FRONT_ELEMENT_IDS.FRAME)) {
      throw new Error(`Expected the bar's picker, which is open: ${context}`);
    }
    return;
  }
  // Nothing outranks Unity once every banner and scene is over, so an editor
  // still busy holds the display: a compile or a build has the gear, Play
  // Mode the ON AIR screen. Whichever editor finished first must not take
  // the other's screen down with it.
  const editors = Object.values(desk.editors);
  if (editors.some(e => e.compiling || e.building) && lock !== 'unityCompilingPriority') {
    throw new Error(`Expected Unity's compile screen, an editor is still compiling: ${context}`);
  }
  if (!editors.some(e => e.compiling || e.building) && editors.some(e => e.playing) && lock !== 'unityPlayModePriority') {
    throw new Error(`Expected Play Mode, an editor is still in it: ${context}`);
  }
  // The stand-up tracks on the session screen, with the meeting icon -- not
  // under the prompt's scene, which made joining look like nothing happened.
  if (lock === ACTIVE_TRACKER_EVENT && desk.session?.status === 'TRACKING' && desk.session.taskTitle === DAILY_STANDUP_TITLE) {
    if (!desk.device.has(FRONT_ELEMENT_IDS.FRAME) || desk.device.isShowing(FRONT_ELEMENT_IDS.SCENE)) {
      throw new Error(`Expected the session screen, not the meeting scene: ${context}`);
    }
    return;
  }
  if (lock !== null || desk.session) {
    if (!desk.device.has(FRONT_ELEMENT_IDS.FRAME)) throw new Error(`Expected a frame: ${context}`);
    return;
  }
  // Idle, with the firmware clock: the app has handed the display back.
  if (shown.length > 0) throw new Error(`Expected an empty panel for the idle clock: ${context}`);
}
