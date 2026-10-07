import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { PriorityPreemptionEngine } from '../src/main/services/priority-preemption-engine';
import { UnityTelemetryService } from '../src/main/services/unity-telemetry-service';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { ActiveSessionDTO, UserMode } from '../src/shared/dtos';
import { FRONT_ELEMENT_IDS } from '../src/shared/device-constants';
import { FirmwareSimulator, RuleId } from './support/firmware-simulator';
import { loadAnimationSequence } from '../src/main/hardware/animation-sequence';

// Every `.anim` is read from disk once, before any scenario, and handed out
// from memory afterwards. Under fake timers a real file read lands at some
// arbitrary point of simulated time -- often after the scenario is over -- and
// a replayed seed would not replay.
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

/**
 * Generated days at the desk, played against the firmware simulator.
 *
 * Each scenario is a seeded run of events from every source that draws on
 * the bar -- Unity, notification banners, the session, Lunch and Away -- some
 * landing in the same tick, some seconds apart, on top of a device that takes
 * its time to answer. The whole real stack takes them: renderer, animation
 * player, icon animator, priority engine, Unity service, driver.
 *
 * No single test would have found the 2026-10-05 hang, because no single
 * source caused it: a compile end rendered twice, the two clears raced, and
 * one closed the screen without the settle. A run of mixed events does find
 * that kind of thing, and the simulator says which rule broke.
 *
 * A failure prints its seed and its script. Replay one with
 * `STRESS_SEED=<seed> pnpm vitest run tests/display-stress.test.ts`; run a
 * longer campaign with `STRESS_RUNS=500`.
 */

const ANIMATIONS_DIR = path.resolve(__dirname, '../../../Animations');
const RUNS = Number(process.env.STRESS_RUNS ?? 30);
const EVENTS_PER_RUN = 40;
/** Long enough for every banner, scene, exception and grace period to end. */
const QUIESCENCE_MS = 20_000;

/**
 * Rules this run reports without failing on. Each is a known gap, closed by
 * the driver's display queue and ledger; take it off when that lands.
 */
const NOT_YET_ENFORCED: RuleId[] = ['overlapping-display-requests', 'redundant-clear', 'absent-element-removal'];

/** mulberry32: small, seedable, and the same sequence on every machine. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type EventName =
  | 'compileStart' | 'compileEnd' | 'buildStart' | 'buildEnd' | 'playEnter' | 'playExit' | 'exception'
  | 'banner' | 'highBanner'
  | 'startTask' | 'startTaskFromBar' | 'pause' | 'resume' | 'tick' | 'stop' | 'finish'
  | 'lunchStart' | 'lunchEnd' | 'awayStart' | 'awayEnd';

/** How often each event is drawn. Compiles and ticks dominate a real day. */
const WEIGHTS: Record<EventName, number> = {
  compileStart: 6, compileEnd: 6, buildStart: 1, buildEnd: 1, playEnter: 2, playExit: 2, exception: 2,
  banner: 3, highBanner: 1,
  startTask: 2, startTaskFromBar: 1, pause: 2, resume: 2, tick: 6, stop: 1, finish: 1,
  lunchStart: 1, lunchEnd: 1, awayStart: 1, awayEnd: 1
};

/** Gaps between steps, in milliseconds. Zero is the same tick. */
const GAPS = [0, 0, 1, 5, 40, 300, 1000, 1500, 2500, 4000];

interface Step {
  events: EventName[];
  gapMs: number;
}

function generate(seed: number): Step[] {
  const next = random(seed);
  const names = Object.keys(WEIGHTS) as EventName[];
  const total = names.reduce((sum, name) => sum + WEIGHTS[name], 0);
  const pick = (): EventName => {
    let roll = next() * total;
    for (const name of names) {
      roll -= WEIGHTS[name];
      if (roll < 0) return name;
    }
    return names[names.length - 1];
  };
  const steps: Step[] = [];
  let count = 0;
  while (count < EVENTS_PER_RUN) {
    // Now and then several events in one tick: the shape of the 10-05 hang.
    const burst = next() < 0.2 ? 2 + Math.floor(next() * 3) : 1;
    const events = Array.from({ length: burst }, pick);
    steps.push({ events, gapMs: GAPS[Math.floor(next() * GAPS.length)] });
    count += burst;
  }
  return steps;
}

function describeScript(steps: Step[]): string {
  return steps.map(step => `${step.events.join(' + ')} (+${step.gapMs} ms)`).join('\n    ');
}

/** Lets real file reads land: the animation player and icon animator load `.anim` files from disk. */
async function realTurns(count = 8): Promise<void> {
  for (let i = 0; i < count; i++) await new Promise(resolve => setImmediate(resolve));
}

/** Moves simulated time on, with real turns between slices so disk reads land in about the time they take. */
async function advance(ms: number): Promise<void> {
  const SLICE_MS = 50;
  let left = ms;
  do {
    const slice = Math.min(left, SLICE_MS);
    await vi.advanceTimersByTimeAsync(slice);
    await realTurns(2);
    left -= slice;
  } while (left > 0);
}

/** The whole display stack, wired as `index.ts` and the IPC registry wire it. */
class Desk {
  public readonly device: FirmwareSimulator;
  public readonly driver: BusyBarDriver;
  public readonly renderer: DisplayRenderer;
  public readonly priority: PriorityPreemptionEngine;
  public readonly unity: UnityTelemetryService;
  public session: ActiveSessionDTO | null = null;
  public mode: UserMode = 'WORK';
  private sessionCount = 0;
  private readonly next: () => number;

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
  }

  public async connect(): Promise<void> {
    const connected = this.driver.connect();
    await advance(200);
    expect(await connected).toBe(true);
  }

  public fire(event: EventName): void {
    // An open editor pings every few seconds; without it the service prunes
    // the instance after 15 s and releases on its own.
    this.unity.handleHeartbeat({ projectName: 'Game' });
    switch (event) {
      case 'compileStart': return this.unity.handleCompile({ projectName: 'Game', state: 'started', type: 'compile' });
      case 'compileEnd': return this.unity.handleCompile({ projectName: 'Game', state: 'finished', type: 'compile' });
      case 'buildStart': return this.unity.handleCompile({ projectName: 'Game', state: 'started', type: 'build', progress: 30 });
      case 'buildEnd': return this.unity.handleCompile({ projectName: 'Game', state: 'finished', type: 'build' });
      case 'playEnter': return this.unity.handlePlayMode({ projectName: 'Game', state: 'entered' });
      case 'playExit': return this.unity.handlePlayMode({ projectName: 'Game', state: 'exited' });
      case 'exception': return this.unity.handleConsole({ projectName: 'Game', type: 'exception', message: 'NullReferenceException' });
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
        // From the app the engine's subscriber renders the session; from the
        // bar the picker plays GO! first.
        if (event === 'startTaskFromBar') this.renderer.renderTaskStarted(this.session);
        else this.renderer.renderActiveSession(this.session);
        return;
      }
      case 'pause':
      case 'resume':
        if (!this.session) return;
        this.session = { ...this.session, status: event === 'pause' ? 'PAUSED' : 'TRACKING' };
        this.renderer.renderActiveSession(this.session);
        return;
      case 'tick':
        if (!this.session) return;
        this.session = { ...this.session, elapsedSeconds: this.session.elapsedSeconds + 61 };
        this.renderer.renderActiveSession(this.session);
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
      case 'lunchStart': return this.enterMode('LUNCH');
      case 'awayStart': return this.enterMode('AWAY');
      case 'lunchEnd':
      case 'awayEnd':
        if (this.mode !== (event === 'lunchEnd' ? 'LUNCH' : 'AWAY')) return;
        return this.enterMode('WORK');
    }
  }

  public dispose(): void {
    this.unity.dispose();
    this.renderer.dispose();
    this.driver.disconnect();
    this.device.uninstall();
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

const seeds = process.env.STRESS_SEED
  ? [Number(process.env.STRESS_SEED)]
  : Array.from({ length: RUNS }, (_, i) => 1000 + i);

/** Totals across the run, for the rules not yet enforced. */
const reported = new Map<RuleId, number>();

describe('Display stress: generated event mixes against the firmware simulator', () => {
  let desk: Desk | null = null;

  beforeAll(async () => {
    const names = fs.readdirSync(ANIMATIONS_DIR).filter(name => fs.statSync(path.join(ANIMATIONS_DIR, name)).isDirectory());
    await Promise.all(names.map(name => loadAnimationSequence(ANIMATIONS_DIR, name)));
  }, 60_000);

  beforeEach(() => {
    // setImmediate stays real: it is how file reads get their turn.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    desk?.dispose();
    desk = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    if (reported.size === 0) return;
    const lines = [...reported].map(([rule, count]) => `${rule}: ${count}`).join(', ');
    process.stdout.write(`[display-stress] reported, not yet enforced -- ${lines}\n`);
  });

  it.each(seeds)('Scenario_Seed%i_BreaksNoHardwareRule', async seed => {
    const script = generate(seed);
    desk = new Desk(seed);
    await desk.connect();

    for (const step of script) {
      for (const event of step.events) desk.fire(event);
      await realTurns();
      await advance(step.gapMs);
    }
    await advance(QUIESCENCE_MS);

    for (const rule of NOT_YET_ENFORCED) {
      const count = desk.device.violationsOf(rule).length;
      if (count > 0) reported.set(rule, (reported.get(rule) ?? 0) + count);
    }
    try {
      desk.device.expectClean({ allow: NOT_YET_ENFORCED });
      expectSettledScreen(desk);
    } catch (err) {
      throw new Error(
        `Seed ${seed} failed. Replay with STRESS_SEED=${seed}.\n  Script:\n    ${describeScript(script)}\n\n${(err as Error).message}` +
          // A replay of one seed is someone reading it: give them the requests.
          (process.env.STRESS_SEED ? `\n\n  Device trace:\n${desk.device.formatTrace()}` : ''),
        { cause: err }
      );
    }
  }, 60_000);
});

/**
 * Once everything has timed out, the panel shows what the state says it
 * should: no screen stuck from an event long over.
 */
function expectSettledScreen(desk: Desk): void {
  const shown = desk.device.shown();
  const lock = desk.priority.getActiveLockEventName();
  const context = `mode ${desk.mode}, lock ${String(lock)}, session ${desk.session?.status ?? 'none'}, panel [${shown.join(', ')}]`;
  if (desk.mode === 'LUNCH' || desk.mode === 'AWAY') {
    if (!desk.device.has(FRONT_ELEMENT_IDS.SCENE)) throw new Error(`Expected the ${desk.mode} scene: ${context}`);
    return;
  }
  if (lock !== null || desk.session) {
    if (!desk.device.has(FRONT_ELEMENT_IDS.FRAME)) throw new Error(`Expected a frame: ${context}`);
    return;
  }
  // Idle, with the firmware clock: the app has handed the display back.
  if (shown.length > 0) throw new Error(`Expected an empty panel for the idle clock: ${context}`);
}
