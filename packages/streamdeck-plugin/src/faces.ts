import type { DeckAction, DeckPrompt, DeckSession, DeckStateMessage } from '../../desktop-app/src/shared/deck-protocol';
import { deckElapsedSeconds } from '../../desktop-app/src/shared/deck-protocol';
import type { FavouriteSettings, KeyKind } from './key-kinds';

/**
 * What each key shows, and what a press on it does: two pure functions of
 * the app's state, so every face and every press is tested without a device.
 *
 * A key always says what it will do. It may change with the state -- the
 * session key pauses a running task and resumes a paused one -- but never
 * with how long it is held: a held press is too easy to get wrong (the
 * user, 2026-10-22), so yes and no are two keys.
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
  /** For a favourite key: its task. */
  favourite?: FavouriteSettings;
}

export type Glyph = 'play' | 'pause' | 'stop' | 'check' | 'trash' | 'list' | 'star' | 'yes' | 'no' | 'coffee' | 'timer' | 'unplugged';

export interface Face {
  /** Up to three short lines, top to bottom. */
  lines: string[];
  /** A time in large digits, under the lines. */
  big?: string;
  /** Border and label colour, `#RRGGBB`. */
  accent: string;
  glyph: Glyph;
  /** The bar's own icon, 16x16, drawn in place of the glyph. */
  pixels?: (string | null)[][];
  /** Nothing to do right now: drawn faded. */
  dim: boolean;
}

export type PressPlan =
  | { type: 'request'; action: DeckAction; taskId?: string; confirmed?: boolean }
  /** The first press of a question: the key asks, and the next press answers. */
  | { type: 'arm' }
  /** Nothing to do: the key says why with an alert. */
  | { type: 'none'; reason: 'offline' | 'nothing' | 'unset' };

/** The app's colours, so a key looks like the window and the bar. */
export const ACCENTS = {
  green: '#22C55E',
  amber: '#F59E0B',
  blue: '#3B82F6',
  red: '#EF4444',
  purple: '#A855F7',
  grey: '#64748B'
} as const;

/** What each kind is called on its face when there is nothing more to say. */
const NAMES: Record<KeyKind, string[]> = {
  session: ['SESSION'],
  'not-done': ['NOT', 'DONE'],
  done: ['DONE'],
  discard: ['DISCARD'],
  switch: ['SWITCH', 'TASK'],
  favourite: ['FAVOURITE'],
  yes: ['YES'],
  no: ['NO'],
  away: ['AWAY']
};

const GLYPHS: Record<KeyKind, Glyph> = {
  session: 'timer',
  'not-done': 'stop',
  done: 'check',
  discard: 'trash',
  switch: 'list',
  favourite: 'star',
  yes: 'yes',
  no: 'no',
  away: 'coffee'
};

/** What yes and no say on each prompt. */
const PROMPT_LINES: Record<DeckPrompt, { yes: string[]; no: string[] }> = {
  standup: { yes: ['JOIN', 'STAND-UP'], no: ['SKIP', 'STAND-UP'] },
  'wrap-up': { yes: ['WRAP', 'UP'], no: ['NOT', 'NOW'] },
  'wrap-up-confirm': { yes: ['CONFIRM', 'WRAP-UP'], no: ['NOT', 'NOW'] },
  resume: { yes: ['RESUME', 'IT'], no: ['LEAVE', 'IT'] }
};

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

/** The face of a key of `kind`. */
export function faceFor(kind: KeyKind, ctx: KeyContext): Face {
  if (ctx.link !== 'online' || !ctx.message) {
    // The key keeps its own look, faded, so a deck laid out while the app is
    // closed still reads; the bottom line says why nothing works.
    const named = kind === 'favourite' && ctx.favourite?.taskKey ? [ctx.favourite.taskKey] : NAMES[kind];
    return {
      lines: [...named, ctx.link === 'incompatible' ? 'UPDATE APP' : 'OFFLINE'],
      accent: ACCENTS.grey,
      glyph: ctx.link === 'incompatible' ? GLYPHS[kind] : 'unplugged',
      dim: true
    };
  }

  const { state } = ctx.message;
  const session = sessionOf(ctx);
  switch (kind) {
    case 'session': {
      if (!session) return { lines: ['START', 'A TASK'], accent: ACCENTS.blue, glyph: 'list', dim: false };
      const tracking = session.status === 'tracking';
      return {
        lines: tracking ? [session.taskKey] : [session.taskKey, 'PAUSED'],
        big: formatDuration(deckElapsedSeconds(ctx.message, ctx.now)),
        accent: tracking ? ACCENTS.green : ACCENTS.amber,
        glyph: tracking ? 'play' : 'pause',
        ...(state.icon ? { pixels: state.icon.pixels } : {}),
        dim: false
      };
    }
    case 'not-done':
      return { lines: NAMES['not-done'], accent: ACCENTS.blue, glyph: 'stop', dim: !session };
    case 'done':
      if (session && ctx.armed) return { lines: ['NOT YOURS?', 'PRESS', 'AGAIN'], accent: ACCENTS.amber, glyph: 'check', dim: false };
      return { lines: NAMES.done, accent: ACCENTS.green, glyph: 'check', dim: !session };
    case 'discard':
      if (session && ctx.armed) return { lines: ['DISCARD?', 'PRESS', 'AGAIN'], accent: ACCENTS.red, glyph: 'trash', dim: false };
      return { lines: NAMES.discard, accent: ACCENTS.red, glyph: 'trash', dim: !session };
    case 'switch':
      return { lines: session ? NAMES.switch : ['START', 'A TASK'], accent: ACCENTS.blue, glyph: 'list', dim: false };
    case 'favourite': {
      const fav = ctx.favourite;
      if (!fav?.taskId) return { lines: ['SET A', 'TASK'], accent: ACCENTS.grey, glyph: 'star', dim: true };
      const mine = session?.taskId === fav.taskId ? session : null;
      return {
        lines: [fav.taskKey ?? fav.taskId, ...(fav.taskTitle ? [fav.taskTitle] : [])],
        accent: !mine ? ACCENTS.blue : mine.status === 'tracking' ? ACCENTS.green : ACCENTS.amber,
        glyph: 'star',
        dim: false
      };
    }
    case 'yes':
    case 'no': {
      if (!state.prompt) return { lines: NAMES[kind], accent: ACCENTS.grey, glyph: GLYPHS[kind], dim: true };
      return {
        lines: PROMPT_LINES[state.prompt][kind],
        accent: kind === 'yes' ? ACCENTS.green : ACCENTS.red,
        glyph: GLYPHS[kind],
        dim: false
      };
    }
    case 'away':
      return state.mode === 'AWAY'
        ? { lines: ['BACK', 'TO WORK'], accent: ACCENTS.amber, glyph: 'coffee', dim: false }
        : { lines: NAMES.away, accent: ACCENTS.purple, glyph: 'coffee', dim: false };
  }
}

/** What a press on a key of `kind` does. */
export function planPress(kind: KeyKind, ctx: KeyContext): PressPlan {
  if (ctx.link !== 'online' || !ctx.message) return { type: 'none', reason: 'offline' };
  const { state } = ctx.message;
  const session = sessionOf(ctx);
  switch (kind) {
    case 'session':
      if (!session) return { type: 'request', action: 'open-picker' };
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
    case 'switch':
      return { type: 'request', action: 'open-picker' };
    case 'favourite':
      return ctx.favourite?.taskId
        ? { type: 'request', action: 'start', taskId: ctx.favourite.taskId }
        : { type: 'none', reason: 'unset' };
    case 'yes':
      return state.prompt ? { type: 'request', action: 'prompt-yes' } : { type: 'none', reason: 'nothing' };
    case 'no':
      return state.prompt ? { type: 'request', action: 'prompt-no' } : { type: 'none', reason: 'nothing' };
    case 'away':
      return { type: 'request', action: 'toggle-away' };
  }
}

/** Kinds whose face moves with the clock: redrawn each second while a session runs. */
export function ticksWithTheClock(kind: KeyKind): boolean {
  return kind === 'session';
}
