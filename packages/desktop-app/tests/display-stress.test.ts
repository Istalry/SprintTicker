import { describe, it, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadAnimationSequence } from '../src/main/hardware/animation-sequence';
import { ANIMATIONS_DIR, Desk, EventName, advance, expectSettledScreen, random, realTurns } from './support/desk';

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

const RUNS = Number(process.env.STRESS_RUNS ?? 30);
const EVENTS_PER_RUN = 40;
/** Long enough for every banner, scene, exception and grace period to end. */
const QUIESCENCE_MS = 20_000;


/** How often each event is drawn. Compiles and ticks dominate a real day. */
const WEIGHTS: Record<EventName, number> = {
  compileStart: 6, compileEnd: 6, buildStart: 1, buildEnd: 1, playEnter: 2, playExit: 2, exception: 2,
  // A second editor open on another project, less busy than the first.
  compileStartB: 3, compileEndB: 3, buildStartB: 1, buildEndB: 1, playEnterB: 1, playExitB: 1, exceptionB: 1,
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

const seeds = process.env.STRESS_SEED
  ? [Number(process.env.STRESS_SEED)]
  : Array.from({ length: RUNS }, (_, i) => 1000 + i);

describe('Display stress: generated event mixes against the firmware simulator', () => {
  let desk: Desk | null = null;

  beforeAll(async () => {
    const names = fs.readdirSync(ANIMATIONS_DIR).filter(name => fs.statSync(path.join(ANIMATIONS_DIR, name)).isDirectory());
    await Promise.all(names.map(name => loadAnimationSequence(ANIMATIONS_DIR, name)));
  }, 60_000);

  beforeEach(() => {
    // setImmediate stays real: it is how file reads get their turn.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    // STRESS_LOG=1 lets the app's own log through, for reading one seed.
    if (!process.env.STRESS_LOG) {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
    }
  });

  afterEach(() => {
    desk?.dispose();
    desk = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });


  it.each(seeds)('Scenario_Seed%i_BreaksNoHardwareRule', async seed => {
    const script = generate(seed);
    desk = new Desk(seed);
    await desk.connect();

    for (const step of script) {
      for (const event of step.events) desk.fire(event);
      await realTurns();
      desk.note(step.events.join(' + '));
      await advance(step.gapMs);
    }
    await advance(QUIESCENCE_MS);

    try {
      desk.device.expectClean();
      expectSettledScreen(desk);
    } catch (err) {
      throw new Error(
        `Seed ${seed} failed. Replay with STRESS_SEED=${seed}.\n  Script:\n    ${describeScript(script)}\n\n${(err as Error).message}` +
          // A replay of one seed is someone reading it: give them the requests.
          (process.env.STRESS_SEED
            ? `\n\n  State after each step:\n${desk.timeline.join('\n')}\n\n  Device trace:\n${desk.device.formatTrace()}`
            : ''),
        { cause: err }
      );
    }
  }, 60_000);
});
