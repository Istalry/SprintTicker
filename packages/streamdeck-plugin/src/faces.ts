import type { DeckAction, DeckPrompt, DeckSession, DeckStateMessage } from '../../desktop-app/src/shared/deck-protocol';
import { deckElapsedSeconds } from '../../desktop-app/src/shared/deck-protocol';
import type { KeyKind } from './key-kinds';

/**
 * What each key shows, and what a press on it does: two pure functions of
 * the app's state, so every face and every press is tested without a device.
 *
 * A key always says what it will do. It may change with the state -- the
 * session key pauses a running task and resumes a paused one. How long it
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

export type Glyph = 'play' | 'pause' | 'stop' | 'check' | 'trash' | 'list' | 'yes' | 'no' | 'timer';

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
  /** One large line: what the key does, or the running task. */
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
  | { type: 'request'; action: DeckAction; confirmed?: boolean }
  /** The first press of a question: the key asks, and the next press answers. */
  | { type: 'arm' }
  /** Nothing to do: the key says why with an alert. */
  | { type: 'none'; reason: 'offline' | 'nothing' };

/** The app's colours, so a key looks like the window and the bar. */
export const ACCENTS = {
  green: '#22C55E',
  amber: '#F59E0B',
  blue: '#3B82F6',
  red: '#EF4444',
  grey: '#64748B'
} as const;

/** What each kind is called on its face when there is nothing more to say. */
const NAMES: Record<KeyKind, string> = {
  session: 'SESSION',
  'not-done': 'NOT DONE',
  done: 'DONE',
  discard: 'DISCARD',
  yes: 'YES',
  no: 'NO'
};

/** Each kind's glyph, which it keeps grey while it has nothing to do. */
export const GLYPHS: Record<KeyKind, Glyph> = {
  session: 'timer',
  'not-done': 'stop',
  done: 'check',
  discard: 'trash',
  yes: 'yes',
  no: 'no'
};

/** What yes and no say on each prompt: the answer, and what it means. */
const PROMPTS: Record<DeckPrompt, Record<'yes' | 'no', [title: string, hint: string]>> = {
  standup: { yes: ['JOIN', 'stand-up'], no: ['SKIP', 'stand-up'] },
  'wrap-up': { yes: ['WRAP UP', 'end the day'], no: ['NOT NOW', 'keep going'] },
  'wrap-up-confirm': { yes: ['CONFIRM', 'wrap-up'], no: ['NOT NOW', 'keep going'] },
  resume: { yes: ['RESUME', 'the task'], no: ['LEAVE IT', 'stopped'] }
};

/** The hint of a key waiting for its second press. */
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

function sessionOf(ctx: KeyContext): DeckSession | null {
  return ctx.message?.state.session ?? null;
}

/** A key with nothing to do: its own glyph and name, grey. */
function idle(kind: KeyKind, hint?: string): Face {
  return { title: NAMES[kind], ...(hint ? { hint } : {}), accent: ACCENTS.grey, glyph: GLYPHS[kind], tone: 'idle' };
}

/** The face of a key of `kind`. */
export function faceFor(kind: KeyKind, ctx: KeyContext): Face {
  // The key keeps its own glyph and name while the app is away, so a deck
  // laid out with SprintTicker closed still reads; the hint says why.
  if (ctx.link !== 'online' || !ctx.message) return idle(kind, ctx.link === 'incompatible' ? 'update app' : 'offline');

  const { state } = ctx.message;
  const session = sessionOf(ctx);
  switch (kind) {
    case 'session': {
      if (!session) return { title: 'START', hint: 'pick a task', accent: ACCENTS.blue, glyph: 'list', tone: 'ready' };
      const tracking = session.status === 'tracking';
      return {
        title: session.taskKey,
        big: formatDuration(deckElapsedSeconds(ctx.message, ctx.now)),
        accent: tracking ? ACCENTS.green : ACCENTS.amber,
        glyph: tracking ? 'play' : 'pause',
        ...(state.icon ? { pixels: state.icon.pixels } : {}),
        tone: 'ready'
      };
    }
    case 'not-done':
      return session ? { title: NAMES['not-done'], accent: ACCENTS.blue, glyph: 'stop', tone: 'ready' } : idle(kind);
    case 'done':
      if (!session) return idle(kind);
      if (ctx.armed) return { title: 'NOT YOURS', hint: PRESS_AGAIN, accent: ACCENTS.amber, glyph: 'check', tone: 'ask' };
      return { title: NAMES.done, accent: ACCENTS.green, glyph: 'check', tone: 'ready' };
    case 'discard':
      if (!session) return idle(kind);
      if (ctx.armed) return { title: 'DISCARD?', hint: PRESS_AGAIN, accent: ACCENTS.red, glyph: 'trash', tone: 'ask' };
      return { title: NAMES.discard, accent: ACCENTS.red, glyph: 'trash', tone: 'ready' };
    case 'yes':
    case 'no': {
      if (!state.prompt) return idle(kind);
      const [title, hint] = PROMPTS[state.prompt][kind];
      return { title, hint, accent: kind === 'yes' ? ACCENTS.green : ACCENTS.red, glyph: GLYPHS[kind], tone: 'ask' };
    }
  }
}

/**
 * What a press on a key of `kind` does; `held` when it was held past
 * `LONG_PRESS_MS`, which only Session reads (see {@link hasLongPress}).
 */
export function planPress(kind: KeyKind, ctx: KeyContext, held: boolean = false): PressPlan {
  if (ctx.link !== 'online' || !ctx.message) return { type: 'none', reason: 'offline' };
  const { state } = ctx.message;
  const session = sessionOf(ctx);
  switch (kind) {
    case 'session':
      if (held || !session) return { type: 'request', action: 'open-picker' };
      return { type: 'request', action: session.status === 'tracking' ? 'pause' : 'resume' };
    case 'not-done':
      return session ? { type: 'request', action: 'stop' } : { type: 'none', reason: 'nothing' };
    case 'done':
      if (!session) return { type: 'none', reason: 'nothing' };
      // Armed first: the app can ask when the state had not said it would
      // (the task left the list since), and the key is armed from its answer.
      if (ctx.armed) return { type: 'request', action: 'finish', confirmed: true };
      return session.finishNeedsConfirmation ? { type: 'arm' } : { type: 'request', action: 'finish' };
    case 'discard':
      if (!session) return { type: 'none', reason: 'nothing' };
      return ctx.armed ? { type: 'request', action: 'discard', confirmed: true } : { type: 'arm' };
    case 'yes':
      return state.prompt ? { type: 'request', action: 'prompt-yes' } : { type: 'none', reason: 'nothing' };
    case 'no':
      return state.prompt ? { type: 'request', action: 'prompt-no' } : { type: 'none', reason: 'nothing' };
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
 * Whether a press that sends `action` plays its key's one-shot -- the
 * check drawing itself, the bin's lid, the stop square: the press is the
 * event, so the key answers at once, before the app does.
 */
export function playsOnPress(action: DeckAction): boolean {
  return action === 'finish' || action === 'discard' || action === 'stop';
}

/** Kinds that play their one-shot when a question arrives: its answers. */
export function playsOnQuestion(kind: KeyKind): boolean {
  return kind === 'yes' || kind === 'no';
}
