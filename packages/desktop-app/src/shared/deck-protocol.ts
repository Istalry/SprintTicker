import { ArgumentException } from './dtos';

/**
 * What SprintTicker and its Stream Deck plugin say to each other, over a
 * WebSocket on the app's local port. The one file the plugin imports: the
 * app and the plugin are built separately, so a message shape kept in two
 * places would drift with nothing failing (CLAUDE.md §3).
 *
 * The app pushes the state when it changes, never once a second: the plugin
 * ticks the time itself from `elapsedSeconds` and `at`. The plugin sends
 * requests, each with an id its answer carries back.
 */

/** The app's local HTTP port: remote key presses and the Stream Deck share it. */
export const LOCAL_API_PORT = 39123;

/** Where the plugin opens its WebSocket, on {@link LOCAL_API_PORT}. */
export const DECK_PATH = '/api/v1/deck';

/**
 * Raised on any change a plugin built for the previous one would misread.
 * 2 (plugin 0.6.0, redesign P13): the interruption, to place, previous and
 * recent tasks, the stand-up running and nothing timing in the state; the
 * prompts `back` and `lunch`; DONE asked always.
 */
export const DECK_PROTOCOL_VERSION = 2;

/**
 * The oldest protocol the app still speaks: plugin 0.5's, so a user who
 * updates the app before the plugin keeps a working deck.
 */
export const DECK_OLDEST_PROTOCOL = 1;

/**
 * The query parameter a plugin names its protocol in, on {@link DECK_PATH}.
 * Plugin 0.5 names none, which is how the app knows it speaks 1: it only
 * reads the hello, and refuses any version but its own.
 */
export const DECK_PROTOCOL_PARAM = 'protocol';

/**
 * The protocol to speak with a plugin that connected at `url`: the one it
 * names, or the newest this app has when it names a newer one -- its hello
 * then tells that plugin to wait for an update. None, or nonsense, is 1.
 */
export function deckProtocolOfUrl(url: string | undefined): number {
  const query = (url ?? '').split('?')[1] ?? '';
  const named = new URLSearchParams(query).get(DECK_PROTOCOL_PARAM);
  const version = named !== null && /^\d{1,4}$/.test(named) ? Number(named) : DECK_OLDEST_PROTOCOL;
  return Math.min(Math.max(version, DECK_OLDEST_PROTOCOL), DECK_PROTOCOL_VERSION);
}

/** Where a plugin speaking `protocol` connects, on the app's port. */
export function deckUrl(protocol: number = DECK_PROTOCOL_VERSION): string {
  return `ws://127.0.0.1:${LOCAL_API_PORT}${DECK_PATH}?${DECK_PROTOCOL_PARAM}=${protocol}`;
}

/** How many recent tasks the state carries, for the Recent 1-3 keys. */
export const DECK_MAX_RECENT = 3;

/**
 * Largest message the app accepts. A request is an action and an id;
 * anything near this is not a request.
 */
export const DECK_MAX_MESSAGE_BYTES = 4 * 1024;

/** Longest request id accepted: it is echoed back in the answer. */
export const DECK_MAX_ID_LENGTH = 128;

/**
 * The words the keys write, from the redesign's glossary. They live here,
 * not in `words.ts`, because this is the one file the plugin imports;
 * `words.ts` re-exports them for the app. Not part of the wire format:
 * changing one changes what a key says, never what a message means.
 *
 * DISCARD ⚡ is C during an interruption: it discards the interruption, not
 * the task. A key draws in SVG, so it is not held to the bar's ASCII.
 */
export const DECK_WORDS = {
  NOT_TIMING: 'NOT TIMING',
  INTERRUPT: 'INTERRUPT',
  ANOTHER: 'ANOTHER',
  BACK: 'BACK',
  DONE: 'DONE',
  STOP: 'STOP',
  DISCARD: 'DISCARD',
  DISCARD_INTERRUPTION: 'DISCARD ⚡',
  RESUME: 'RESUME',
  LATER: 'LATER',
  NOT_NOW: 'NOT NOW',
  JOIN: 'JOIN',
  SKIP: 'SKIP',
  END_STAND_UP: 'END STAND-UP',
  NOT_YOURS: 'NOT YOURS',
  DONE_ANYWAY: 'DONE ANYWAY',
  START: 'START',
  PREVIOUS: 'PREV',
  START_LUNCH: 'START LUNCH',
  END_MY_DAY: 'END MY DAY',
  CONFIRM: 'CONFIRM'
} as const;

/**
 * What the last key answers, when something is waiting for an answer:
 * - `standup`: the stand-up's prompt; yes joins it.
 * - `wrap-up`: the end-of-day wrap-up's prompt; yes arms it...
 * - `wrap-up-confirm`: ...and a second yes runs it, as two presses do on the bar.
 * - `resume`: after lunch, Away or the stand-up, resume the task it holds?
 * - `back`: after an interruption, "Back to MG-12?" (protocol 2; `resume` in 1).
 * - `lunch`: lunch's hour found an interruption running -- start lunch,
 *   ending it? Asked in the window, never on the bar (protocol 2; none in 1).
 *
 * The bar's prompts only while they hold its display: covered by a banner,
 * the bar's own OK would answer the banner, and the deck answers what the
 * bar would. `lunch` is the window's question, and is asked while no bar
 * prompt is.
 */
export type DeckPrompt = 'standup' | 'wrap-up' | 'wrap-up-confirm' | 'resume' | 'back' | 'lunch';

/** A task a key can start: Previous, Recent 1-3. */
export interface DeckTask {
  taskId: string;
  taskKey: string;
  taskTitle: string;
}

/** The interruption running, as the keys show it (protocol 2). */
export interface DeckInterruption {
  /** The name the user gave it, or null while it has the one the app made up. */
  name: string | null;
  /** The task Back resumes, or null when it holds none -- then A has no Back. */
  backToKey: string | null;
}

/** The session as the keys show it. */
export interface DeckSession {
  taskId: string;
  taskKey: string;
  taskTitle: string;
  isAdHoc: boolean;
  status: 'tracking' | 'paused';
  /** Worked time when the state was read, at {@link DeckStateMessage.at}. */
  elapsedSeconds: number;
  /**
   * Finishing it as done asks first -- NOT YOURS? -- because the task left
   * the user's list: `finishNeedsConfirmation` in task-left.ts, as in the
   * window and on the bar.
   */
  finishNeedsConfirmation: boolean;
  /** An interruption runs, and this session is its timer (protocol 2). */
  interruption?: DeckInterruption;
  /** Who has the task now, when it is someone else's and their name is known (protocol 2). */
  ownerName?: string;
}

/**
 * How often an icon's motion is sampled for a key, and the most a key is
 * redrawn for it: `setImage` never plays an animated image (Stream Deck
 * Mobile, 2026-10-22), so a moving icon is the plugin sending frames, and
 * ten a second is what the phone was measured keeping up with.
 */
export const DECK_ICON_FPS = 10;

/** Bounds on a motion, so a state message stays a few kilobytes. */
export const DECK_MAX_ICON_POSES = 64;
export const DECK_MAX_ICON_STEPS = 600;

/**
 * The motion of the bar's icon, as the bar plays it: its distinct poses,
 * and which one each step shows. Sent once with the icon, so the plugin
 * plays it with no message per frame; most icons have a handful of poses.
 */
export interface DeckIconMotion {
  /** Steps a second, at most {@link DECK_ICON_FPS}. */
  fps: number;
  /** Each pose as the icon's pixels: 16 rows of `#RRGGBB`, or null for an unlit LED. */
  poses: (string | null)[][][];
  /** Which pose each step shows, in play order; it loops. */
  sequence: number[];
}

/** The icon of whatever holds the bar, as the mini timer shows it; with its motion when it moves. */
export interface DeckIcon {
  pixels: (string | null)[][];
  label: string;
  /** Absent for a still icon -- and from an app older than this field, which still works. */
  motion?: DeckIconMotion;
}

export interface DeckState {
  session: DeckSession | null;
  icon: DeckIcon | null;
  prompt: DeckPrompt | null;
  /*
   * Protocol 2. Optional so a state of protocol 1 is the same type with
   * fewer fields: an app of protocol 2 always sends them.
   */
  /** Interruptions that ended and wait to be placed, in the app. */
  toPlace?: number;
  /** What Previous starts; null during an interruption, where going back is A. */
  previousTask?: DeckTask | null;
  /** Recent tasks but the one open, newest first, at most {@link DECK_MAX_RECENT}. */
  recent?: DeckTask[];
  /** The stand-up runs, and ending it brings back the task it set aside. */
  standupRunning?: { returnsToKey: string | null } | null;
  /** Nothing is timing in working hours: Session turns amber (D4). */
  nothingTimingInHours?: boolean;
}

export const DECK_ACTIONS = [
  'pause',
  'resume',
  /** Ends the session, task left open: the bar's STOP, the window's Not done. */
  'stop',
  /** Ends it and marks the task done; `confirmed` when it is no longer the user's. */
  'finish',
  /** Keeps nothing; always `confirmed`, since it cannot be undone. */
  'discard',
  /** Brings the window forward with its task picker open. */
  'open-picker',
  /**
   * Starts an interruption: a timer at once, the task it stops asked about
   * when it ends. Added after protocol 1 without raising it -- an older
   * plugin never sends it, and an older app answers `invalid-request`.
   */
  'interrupt',
  'prompt-yes',
  'prompt-no',
  /* Protocol 2. */
  /** Ends the interruption and resumes the task it holds: A's BACK. */
  'back',
  /** Ends the interruption and starts the next: Interrupt's ANOTHER. */
  'another',
  /** Starts the task timed before this one; refused during an interruption. */
  'previous',
  /** Starts the `index`-th recent task, from 1. */
  'start-recent',
  /** Ends the stand-up; the task it set aside starts again. */
  'end-standup'
] as const;

export type DeckAction = (typeof DECK_ACTIONS)[number];

export interface DeckRequest {
  id: string;
  action: DeckAction;
  /** The second press of a question the plugin asked: DONE?, DISCARD?. */
  confirmed?: boolean;
  /** For `start-recent`: which recent task, from 1 to {@link DECK_MAX_RECENT}. */
  index?: number;
}

export type DeckErrorCode =
  /** Not a request this protocol knows. */
  | 'invalid-request'
  /** Nothing is running, or nothing paused, to act on. */
  | 'no-session'
  /** A question must be asked first, and answered with `confirmed`. */
  | 'needs-confirmation'
  /** Nothing is waiting for an answer. */
  | 'no-prompt'
  /** The window the picker lives in is not there. */
  | 'no-window'
  /** No such task to start: no previous one, no n-th recent one (protocol 2). */
  | 'no-task'
  /** The app tried and failed; `message` says why. */
  | 'failed';

export interface DeckHelloMessage {
  type: 'hello';
  protocol: number;
}

export interface DeckStateMessage {
  type: 'state';
  state: DeckState;
  /** When `elapsedSeconds` was read, ISO 8601. */
  at: string;
}

export type DeckResultMessage =
  | { type: 'result'; id: string; ok: true }
  | { type: 'result'; id: string; ok: false; error: DeckErrorCode; message: string };

export type DeckServerMessage = DeckHelloMessage | DeckStateMessage | DeckResultMessage;

const KNOWN_ACTIONS: ReadonlySet<string> = new Set(DECK_ACTIONS);

function isShortId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= DECK_MAX_ID_LENGTH;
}

/**
 * A request from its parsed JSON, or an ArgumentException saying what is
 * wrong with it. Unknown fields are dropped, so nothing the plugin adds
 * reaches the app by accident.
 */
export function parseDeckRequest(raw: unknown): DeckRequest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ArgumentException('A deck request is a JSON object.', 'request');
  }
  const r = raw as Record<string, unknown>;
  if (!isShortId(r.id)) {
    throw new ArgumentException(`A deck request needs an id of 1 to ${DECK_MAX_ID_LENGTH} characters.`, 'id');
  }
  if (typeof r.action !== 'string' || !KNOWN_ACTIONS.has(r.action)) {
    throw new ArgumentException(`Unknown deck action: ${String(r.action)}.`, 'action');
  }
  const action = r.action as DeckAction;
  if (r.confirmed !== undefined && typeof r.confirmed !== 'boolean') {
    throw new ArgumentException('`confirmed` is true or false.', 'confirmed');
  }
  const request: DeckRequest = { id: r.id, action };
  if (r.confirmed === true) request.confirmed = true;
  if (action === 'start-recent') {
    if (typeof r.index !== 'number' || !Number.isInteger(r.index) || r.index < 1 || r.index > DECK_MAX_RECENT) {
      throw new ArgumentException(`\`start-recent\` needs an index from 1 to ${DECK_MAX_RECENT}.`, 'index');
    }
    request.index = r.index;
  }
  return request;
}

/**
 * The state as a plugin speaking `protocol` reads it. Protocol 1 knows none
 * of the new fields -- it would ignore them, but sending them says nothing
 * -- and none of the new prompts: its faces look a prompt up in a table of
 * four, and an unknown one would break every key. `back` is the question
 * 1 called `resume`; `lunch` it never had, and it stays in the window.
 */
export function deckStateForProtocol(state: DeckState, protocol: number): DeckState {
  if (protocol >= DECK_PROTOCOL_VERSION) return state;
  const prompt = state.prompt === 'back' ? 'resume' : state.prompt === 'lunch' ? null : state.prompt;
  const session: DeckSession | null = state.session
    ? {
        taskId: state.session.taskId,
        taskKey: state.session.taskKey,
        taskTitle: state.session.taskTitle,
        isAdHoc: state.session.isAdHoc,
        status: state.session.status,
        elapsedSeconds: state.session.elapsedSeconds,
        finishNeedsConfirmation: state.session.finishNeedsConfirmation
      }
    : null;
  return { session, icon: state.icon, prompt };
}

/**
 * The session's worked time at `now`, from a state message: the plugin's
 * tick. A paused session does not move.
 */
export function deckElapsedSeconds(message: DeckStateMessage, now: Date): number {
  const session = message.state.session;
  if (!session) return 0;
  if (session.status !== 'tracking') return session.elapsedSeconds;
  const since = Math.floor((now.getTime() - Date.parse(message.at)) / 1000);
  return session.elapsedSeconds + Math.max(0, since);
}

/** Whether a motion can be played as it came: bounded, and every step names a pose. */
export function isPlayableMotion(motion: unknown): motion is DeckIconMotion {
  if (!motion || typeof motion !== 'object') return false;
  const { fps, poses, sequence } = motion as Partial<DeckIconMotion>;
  return (
    typeof fps === 'number' && fps > 0 && fps <= DECK_ICON_FPS &&
    Array.isArray(poses) && poses.length > 0 && poses.length <= DECK_MAX_ICON_POSES && poses.every(Array.isArray) &&
    Array.isArray(sequence) && sequence.length > 0 && sequence.length <= DECK_MAX_ICON_STEPS &&
    sequence.every(i => Number.isInteger(i) && i >= 0 && i < poses.length)
  );
}

/**
 * The icon's pixels at `now`: its pose of the moment when it moves, its
 * still pixels otherwise. Read from the wall clock, so every key and every
 * redraw agree without keeping a frame count.
 */
export function deckIconPixels(icon: DeckIcon, now: Date): (string | null)[][] {
  const motion = icon.motion;
  if (!isPlayableMotion(motion)) return icon.pixels;
  const step = Math.floor(now.getTime() / (1000 / motion.fps)) % motion.sequence.length;
  return motion.poses[motion.sequence[step]];
}
