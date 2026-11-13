import type { DeckAction, DeckPrompt, DeckSession, DeckState, DeckStateMessage, DeckTask } from '../../desktop-app/src/shared/deck-protocol';
import { DECK_WORDS, deckElapsedSeconds, deckIconPixels, isPlayableMotion } from '../../desktop-app/src/shared/deck-protocol';
import { AnswerKind, KeyKind, Meaning, RecentKind, isAnswerKind, isRecentKind, recentIndex } from './key-kinds';

/**
 * What each key shows, and what a press on it does: two pure functions of
 * the app's state, so every face and every press is tested without a device.
 *
 * A key always says what it will do. It may change with the state -- the
 * session key pauses a running task and resumes a paused one, and an
 * answer key stands in for whichever answer applies (`resolveKind`). How long it
 * is held changes one thing only, chosen by the user (2026-10-22): holding
 * Session opens the task picker. Never an answer: yes and no are two keys,
 * because a held press is too easy to get wrong for that.
 */

/** How the plugin stands with the app. */
export type LinkStatus =
  /** Not connected yet, or reconnecting: SprintTicker may be closed. */
  | 'offline'
  | 'online'
  /** Connected, but to an app speaking another protocol version. */
  | 'incompatible';

export interface KeyContext {
  link: LinkStatus;
  /** The last state the app pushed; null before the first. */
  message: DeckStateMessage | null;
  now: Date;
  /** This key's first press of a question was made; the next one answers it. */
  armed: boolean;
}

export type Glyph = 'play' | 'pause' | 'stop' | 'check' | 'trash' | 'list' | 'yes' | 'no' | 'timer' | 'zap' | 'back';

/**
 * What a key's look says about it, the design the user chose on Stream
 * Deck Mobile (2026-10-22, "Tile"): the colour is the state.
 */
export type Tone =
  /** It can be pressed: the glyph in its colour, the title in white. */
  | 'ready'
  /** Nothing to do, or the app is not there: all of it grey. */
  | 'idle'
  /** It waits on you -- a question, or a second press: the key filled. */
  | 'ask';

export interface Face {
  /** One large line: what the key does, or the running task. Empty on a blank key. */
  title: string;
  /** One small line under it: what a question's answer means, or why a key is grey. */
  hint?: string;
  /** A time in large digits under the title; a key with one is laid out as the session. */
  big?: string;
  /** The glyph's colour, the fill of an `ask`, the time's and the session's band. */
  accent: string;
  glyph: Glyph;
  /** The bar's own icon, 16x16, drawn in place of the glyph. */
  pixels?: (string | null)[][];
  tone: Tone;
  /**
   * Part-way through the glyph's one-shot, 0 to 1 (see `svg.ts`); absent
   * when it rests. Set by the controller for the frames it plays.
   */
  progress?: number;
}

export type PressPlan =
  | { type: 'request'; action: DeckAction; confirmed?: boolean; index?: number }
  /** The first press of a question: the key asks, and the next press answers. */
  | { type: 'arm' }
  /** Nothing to do: the key says why with an alert. */
  | { type: 'none'; reason: 'offline' | 'nothing' };

/**
 * The window's colours, so a key means what the window means (S29): green
 * says yes and runs, amber waits on the user, red throws away. B -- stops
 * or waits, keeping the time -- is blue-grey, lighter than the idle grey so
 * a key that can be pressed never reads as one that cannot. No blue: the
 * window has none.
 */
export const ACCENTS = {
  green: '#22C55E',
  amber: '#F59E0B',
  slate: '#94A3B8',
  red: '#EF4444',
  grey: '#64748B'
} as const;

/** What each key is called on its face when there is nothing more to say. */
const NAMES: Record<Exclude<Meaning, 'blank'>, string> = {
  session: 'SESSION',
  interrupt: DECK_WORDS.INTERRUPT,
  previous: DECK_WORDS.PREVIOUS,
  'recent-1': DECK_WORDS.START,
  'recent-2': DECK_WORDS.START,
  'recent-3': DECK_WORDS.START,
  'not-done': DECK_WORDS.STOP,
  done: DECK_WORDS.DONE,
  discard: DECK_WORDS.DISCARD,
  yes: 'YES',
  no: 'NO',
  back: DECK_WORDS.BACK,
  'end-standup': DECK_WORDS.END_STAND_UP
};

/**
 * Each kind's glyph, which it keeps grey while it has nothing to do. An
 * answer key's is that of what it means with nothing asked, as it shows
 * offline.
 */
export const GLYPHS: Record<KeyKind, Glyph> = {
  session: 'timer',
  interrupt: 'zap',
  previous: 'back',
  'answer-a': 'check',
  'answer-b': 'stop',
  'answer-c': 'trash',
  'recent-1': 'play',
  'recent-2': 'play',
  'recent-3': 'play',
  'not-done': 'stop',
  done: 'check',
  discard: 'trash',
  yes: 'yes',
  no: 'no'
};

/** The glyphs of the meanings no fixed key has. */
const MEANING_GLYPHS: Record<'back' | 'end-standup', Glyph> = { back: 'back', 'end-standup': 'back' };

/** What yes and no say on each prompt: the answer, and what it means. */
const PROMPTS: Record<DeckPrompt, Record<'yes' | 'no', [title: string, hint: string]>> = {
  standup: { yes: [DECK_WORDS.JOIN, 'stand-up'], no: [DECK_WORDS.SKIP, 'stand-up'] },
  'wrap-up': { yes: [DECK_WORDS.END_MY_DAY, 'sends the day'], no: [DECK_WORDS.NOT_NOW, 'keep going'] },
  'wrap-up-confirm': { yes: [DECK_WORDS.CONFIRM, 'end my day'], no: [DECK_WORDS.NOT_NOW, 'keep going'] },
  resume: { yes: [DECK_WORDS.RESUME, 'the task'], no: [DECK_WORDS.NOT_NOW, 'leave it'] },
  back: { yes: [DECK_WORDS.BACK, 'to the task'], no: [DECK_WORDS.NOT_NOW, 'leave it'] },
  lunch: { yes: [DECK_WORDS.START_LUNCH, 'ends it'], no: [DECK_WORDS.NOT_NOW, 'work on'] }
};

/** The hint of a key that takes two presses, and of one waiting for its second. */
export const PRESS_TWICE = 'press twice';
export const PRESS_AGAIN = 'press again';

/** `1:24:10`, or `24:10` under an hour. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${minutes}:${two(seconds)}`;
}

/**
 * What an answer key stands for in this state (S29), with one meaning per
 * position: A says yes, B stops or waits keeping the time, C throws away.
 * A key with nothing of its kind to do is blank. With no state -- the app
 * away -- each shows what it means while a task runs, so a deck laid out
 * with SprintTicker closed still reads.
 */
export function answerKind(kind: AnswerKind, state: DeckState | null): Meaning {
  const ends = { 'answer-a': 'done', 'answer-b': 'not-done', 'answer-c': 'discard' } as const;
  if (!state) return ends[kind];
  const session = state.session;
  if (state.prompt) return kind === 'answer-a' ? 'yes' : kind === 'answer-b' ? 'no' : 'blank';
  if (session && state.standupRunning) return kind === 'answer-a' ? 'end-standup' : 'blank';
  if (session?.interruption && kind === 'answer-a') return session.interruption.backToKey !== null ? 'back' : 'blank';
  return session ? ends[kind] : 'blank';
}

/** What a key of `kind` means in this context: itself, or what an answer key stands in for. */
export function resolveKind(kind: KeyKind, ctx: Pick<KeyContext, 'link' | 'message'>): Meaning {
  if (!isAnswerKind(kind)) return kind;
  return answerKind(kind, ctx.link === 'online' ? (ctx.message?.state ?? null) : null);
}

function sessionOf(ctx: KeyContext): DeckSession | null {
  return ctx.message?.state.session ?? null;
}

function glyphOf(meaning: Exclude<Meaning, 'blank'>): Glyph {
  return meaning === 'back' || meaning === 'end-standup' ? MEANING_GLYPHS[meaning] : GLYPHS[meaning];
}

/** A key with nothing to do: its own glyph and name, grey. */
function idle(meaning: Exclude<Meaning, 'blank'>, hint?: string): Face {
  return { title: NAMES[meaning], ...(hint ? { hint } : {}), accent: ACCENTS.grey, glyph: glyphOf(meaning), tone: 'idle' };
}

/** A key with nothing of its kind to do now: its glyph grey, no word (S29's "·"). */
function blank(key: KeyKind): Face {
  return { title: '', accent: ACCENTS.grey, glyph: GLYPHS[key], tone: 'idle' };
}

/** The n-th recent task a Recent key starts, if there is one. */
function recentOf(kind: RecentKind, state: DeckState): DeckTask | null {
  return state.recent?.[recentIndex(kind) - 1] ?? null;
}

/** The face of a key of `kind`. */
export function faceFor(key: KeyKind, ctx: KeyContext): Face {
  const meaning = resolveKind(key, ctx);
  // The key keeps its own glyph and name while the app is away, so a deck
  // laid out with SprintTicker closed still reads; the hint says why.
  if (ctx.link !== 'online' || !ctx.message) {
    const hint = ctx.link === 'incompatible' ? 'update app' : 'offline';
    return meaning === 'blank' ? { ...blank(key), hint } : idle(meaning, hint);
  }

  const { state } = ctx.message;
  const session = sessionOf(ctx);
  const interruption = session?.interruption ?? null;
  if (meaning === 'blank') return blank(key);
  if (isRecentKind(meaning)) {
    // Choosing a task does nothing during an interruption (2026-11-12).
    const task = interruption ? null : recentOf(meaning, state);
    if (!task) return blank(key);
    return { title: task.taskKey, hint: DECK_WORDS.START, accent: ACCENTS.slate, glyph: 'play', tone: 'ready' };
  }
  switch (meaning) {
    case 'interrupt': {
      // Ready whatever runs: an interruption starts from any state, and
      // the task it stops is asked about when it ends.
      const toPlace = state.toPlace ?? 0;
      return {
        title: interruption ? DECK_WORDS.ANOTHER : DECK_WORDS.INTERRUPT,
        ...(toPlace > 0 ? { hint: `${toPlace} to place` } : {}),
        accent: ACCENTS.amber,
        glyph: 'zap',
        tone: 'ready'
      };
    }
    case 'previous': {
      // Going back is A during an interruption, never Previous (S29).
      const previous = interruption ? null : state.previousTask ?? null;
      if (!previous) return blank(key);
      return { title: DECK_WORDS.PREVIOUS, hint: previous.taskKey, accent: ACCENTS.slate, glyph: 'back', tone: 'ready' };
    }
    case 'session': {
      if (!session) {
        // Nothing timing in working hours is a question to the user (D4).
        return state.nothingTimingInHours
          ? { title: DECK_WORDS.NOT_TIMING, hint: 'pick a task', accent: ACCENTS.amber, glyph: 'list', tone: 'ready' }
          : { title: DECK_WORDS.START, hint: 'pick a task', accent: ACCENTS.green, glyph: 'list', tone: 'ready' };
      }
      const tracking = session.status === 'tracking';
      const notYours = session.finishNeedsConfirmation && !interruption;
      return {
        // The bolt and the time (S29): the glyph is the bolt, so the title
        // is the name the user gave it, and nothing until they do.
        title: interruption ? (interruption.name ?? '') : notYours ? DECK_WORDS.NOT_YOURS : session.taskKey,
        big: formatDuration(deckElapsedSeconds(ctx.message, ctx.now)),
        accent: interruption || notYours || !tracking ? ACCENTS.amber : ACCENTS.green,
        glyph: interruption ? 'zap' : tracking ? 'play' : 'pause',
        // The bar's icon as the bar plays it, its pose read off the clock.
        ...(state.icon ? { pixels: deckIconPixels(state.icon, ctx.now) } : {}),
        tone: 'ready'
      };
    }
    case 'not-done':
      return session ? { title: DECK_WORDS.STOP, accent: ACCENTS.slate, glyph: 'stop', tone: 'ready' } : idle(meaning);
    case 'done':
      if (!session) return idle(meaning);
      if (ctx.armed) return { title: `${DECK_WORDS.DONE}?`, hint: PRESS_AGAIN, accent: ACCENTS.green, glyph: 'check', tone: 'ask' };
      return {
        title: session.finishNeedsConfirmation ? DECK_WORDS.DONE_ANYWAY : DECK_WORDS.DONE,
        hint: PRESS_TWICE,
        accent: ACCENTS.green,
        glyph: 'check',
        tone: 'ready'
      };
    case 'discard':
      if (!session) return idle(meaning);
      if (ctx.armed) return { title: `${DECK_WORDS.DISCARD}?`, hint: PRESS_AGAIN, accent: ACCENTS.red, glyph: 'trash', tone: 'ask' };
      return {
        // DISCARD names what it throws away: the interruption, not the task.
        title: interruption ? DECK_WORDS.DISCARD_INTERRUPTION : DECK_WORDS.DISCARD,
        hint: PRESS_TWICE,
        accent: ACCENTS.red,
        glyph: 'trash',
        tone: 'ready'
      };
    case 'back':
      return { title: DECK_WORDS.BACK, ...(interruption?.backToKey ? { hint: interruption.backToKey } : {}), accent: ACCENTS.green, glyph: 'back', tone: 'ready' };
    case 'end-standup': {
      const returnsTo = state.standupRunning?.returnsToKey;
      return { title: DECK_WORDS.END_STAND_UP, ...(returnsTo ? { hint: `then ${returnsTo}` } : {}), accent: ACCENTS.green, glyph: 'back', tone: 'ready' };
    }
    case 'yes':
    case 'no': {
      if (!state.prompt) return idle(meaning);
      const [title, hint] = PROMPTS[state.prompt][meaning];
      // The back question names the task it brings back.
      const named = state.prompt === 'back' && meaning === 'yes' && session ? session.taskKey : hint;
      return { title, hint: named, accent: meaning === 'yes' ? ACCENTS.green : ACCENTS.slate, glyph: GLYPHS[meaning], tone: 'ask' };
    }
  }
}

/**
 * What a press on a key of `kind` does; `held` when it was held past
 * `LONG_PRESS_MS`, which only Session reads (see {@link hasLongPress}).
 */
export function planPress(key: KeyKind, ctx: KeyContext, held: boolean = false): PressPlan {
  if (ctx.link !== 'online' || !ctx.message) return { type: 'none', reason: 'offline' };
  const meaning = resolveKind(key, ctx);
  const { state } = ctx.message;
  const session = sessionOf(ctx);
  const nothing: PressPlan = { type: 'none', reason: 'nothing' };
  if (meaning === 'blank') return nothing;
  if (isRecentKind(meaning)) {
    return !session?.interruption && recentOf(meaning, state)
      ? { type: 'request', action: 'start-recent', index: recentIndex(meaning) }
      : nothing;
  }
  switch (meaning) {
    case 'interrupt':
      return { type: 'request', action: session?.interruption ? 'another' : 'interrupt' };
    case 'previous':
      return !session?.interruption && state.previousTask ? { type: 'request', action: 'previous' } : nothing;
    case 'session':
      // During an interruption it does nothing, held or not: pausing would
      // end it, and choosing a task waits for its end (the user's choice,
      // 2026-11-12). A, B and C end it.
      if (session?.interruption) return nothing;
      if (held || !session) return { type: 'request', action: 'open-picker' };
      return { type: 'request', action: session.status === 'tracking' ? 'pause' : 'resume' };
    case 'not-done':
      return session ? { type: 'request', action: 'stop' } : nothing;
    case 'done':
      if (!session) return nothing;
      // Always two presses (S29): DONE changes the task at the provider, and
      // a habit learned on BACK, the same key, must never mark a ticket done.
      return ctx.armed ? { type: 'request', action: 'finish', confirmed: true } : { type: 'arm' };
    case 'discard':
      if (!session) return nothing;
      return ctx.armed ? { type: 'request', action: 'discard', confirmed: true } : { type: 'arm' };
    case 'back':
      return { type: 'request', action: 'back' };
    case 'end-standup':
      return { type: 'request', action: 'end-standup' };
    case 'yes':
      return state.prompt ? { type: 'request', action: 'prompt-yes' } : nothing;
    case 'no':
      return state.prompt ? { type: 'request', action: 'prompt-no' } : nothing;
  }
}

/**
 * Kinds whose press waits for the key to come up, to tell a held press from
 * a short one. Every other key acts as it goes down.
 */
export function hasLongPress(kind: KeyKind): boolean {
  return kind === 'session';
}

/** Kinds whose face moves with the clock: redrawn each second while a session runs. */
export function ticksWithTheClock(kind: KeyKind): boolean {
  return kind === 'session';
}

/**
 * How often a key that ticks with the clock is redrawn in this state, or
 * null when nothing on it moves: each second while a session runs, and at
 * the icon's own rate while the bar's icon moves -- paused too, since the
 * paused stopwatch blinks. A redraw that changes nothing sends nothing.
 */
export function tickPeriodMs(message: DeckStateMessage | null, second: number): number | null {
  const session = message?.state.session;
  if (!session) return null;
  const motion = message.state.icon?.motion;
  if (isPlayableMotion(motion)) return Math.round(1000 / motion.fps);
  return session.status === 'tracking' ? second : null;
}

/**
 * Whether a press that sends `action` plays its key's one-shot -- the
 * check drawing itself, the bin's lid, the stop square, the bolt: the press
 * is the event, so the key answers at once, before the app does.
 */
export function playsOnPress(action: DeckAction): boolean {
  return action === 'finish' || action === 'discard' || action === 'stop' || action === 'interrupt' || action === 'another';
}

/**
 * Kinds that play their one-shot when a question arrives: its answers, and
 * the answer keys that become them -- the movement says the key changed.
 */
export function playsOnQuestion(kind: KeyKind): boolean {
  return kind === 'yes' || kind === 'no' || kind === 'answer-a' || kind === 'answer-b';
}
