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
 * the bar -- notification banners, the session, the bar's picker, the
 * stand-up, Lunch and Away, the bar itself dropping out -- some landing in the
 * same tick, some seconds apart, on top of a device that takes its time to
 * answer. The whole real stack takes them: renderer, animation player, icon
 * animator, priority engine, driver.
 *
 * No single test would have found the 2026-10-05 hang, because no single
 * source caused it: one event's end rendered twice, the two clears raced, and
 * one closed the screen without the settle. A run of mixed events does find
 * that kind of thing, and the simulator says which rule broke.
 *
 * A failure prints its seed and its script. Replay one with
 * `STRESS_SEED=<seed> pnpm vitest run tests/display-stress.test.ts`; run a
 * longer campaign with `STRESS_RUNS=500`.
 */

const RUNS = Number(process.env.STRESS_RUNS ?? 30);
const EVENTS_PER_RUN = 40;
/** Long enough for every banner, scene and settle to end. */
const QUIESCENCE_MS = 20_000;

/**
 * How often each event is drawn. Ticks and banners dominate a real day.
 * Until 2026-11-09 a Unity editor's compiles were the busiest source; the
 * banners, the session and the picker took their weight, so a run still
 * changes screens about as often as it did. The stand-up and the paused
 * menu's DROP joined the mix the same day, once the settled-screen check
 * knew a prompt left unanswered: they found the picker lost under the
 * prompt's scene and a waiting frame landing over it.
 */
const WEIGHTS: Partial<Record<EventName, number>> = {
  banner: 6, highBanner: 3,
  startTask: 3, startTaskFromBar: 2, pause: 3, resume: 3, tick: 8, stop: 2, finish: 2,
  openPicker: 3, closePicker: 3,
  lunchStart: 1, lunchEnd: 1, awayStart: 1, awayEnd: 1, lunchStartUnderAway: 1, awayEndIntoLunch: 1,
  // The paused menu's DROP: asked, taken back, confirmed.
  askDiscard: 2, cancelDiscard: 1, discard: 1,
  // The stand-up's prompt, joined, and its end bringing the task back.
  standupPrompt: 1, joinStandup: 1, standupEnds: 1,
  // The bar dropping out and coming back, as a Wi-Fi blip or a restart does.
  barDrop: 1, barBack: 2, barReboot: 1
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
  const weight = (name: EventName): number => WEIGHTS[name] ?? 0;
  const total = names.reduce((sum, name) => sum + weight(name), 0);
  const pick = (): EventName => {
    let roll = next() * total;
    for (const name of names) {
      roll -= weight(name);
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
    // Half the days on firmware 1.3, whose `.anim` files are another format.
    const firmware = seed % 2 === 0 ? '1.2.4' : '1.3.1';
    desk = new Desk(seed, firmware);
    await desk.connect();

    for (const step of script) {
      for (const event of step.events) desk.fire(event);
      await realTurns();
      desk.note(step.events.join(' + '));
      await advance(step.gapMs);
    }
    // Back for good, after any reboot under way, so the ping loop notices.
    await advance(QUIESCENCE_MS);
    desk.fire('barBack');
    await advance(QUIESCENCE_MS);

    try {
      desk.device.expectClean();
      expectSettledScreen(desk);
    } catch (err) {
      throw new Error(
        `Seed ${seed} failed, on firmware ${firmware}. Replay with STRESS_SEED=${seed}.\n  Script:\n    ${describeScript(script)}\n\n${(err as Error).message}` +
          // A replay of one seed is someone reading it: give them the requests.
          (process.env.STRESS_SEED
            ? `\n\n  State after each step:\n${desk.timeline.join('\n')}\n\n  Device trace:\n${desk.device.formatTrace()}`
            : ''),
        { cause: err }
      );
    }
  }, 60_000);
});
