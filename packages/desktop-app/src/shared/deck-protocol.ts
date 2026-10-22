import { ArgumentException, ScreenIconDTO } from './dtos';

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

/** The app's local HTTP port: Unity's webhooks and the Stream Deck share it. */
export const LOCAL_API_PORT = 39123;

/** Where the plugin opens its WebSocket, on {@link LOCAL_API_PORT}. */
export const DECK_PATH = '/api/v1/deck';

/** Raised on any change a plugin built for the previous one would misread. */
export const DECK_PROTOCOL_VERSION = 1;

/**
 * Largest message the app accepts. A request is an action and an id;
 * anything near this is not a request.
 */
export const DECK_MAX_MESSAGE_BYTES = 4 * 1024;

/** Longest request id accepted: it is echoed back in the answer. */
export const DECK_MAX_ID_LENGTH = 128;

/**
 * What the last key answers, when something is waiting for an answer:
 * - `standup`: the stand-up's prompt; yes joins it.
 * - `wrap-up`: the end-of-day wrap-up's prompt; yes arms it...
 * - `wrap-up-confirm`: ...and a second yes runs it, as two presses do on the bar.
 * - `resume`: after lunch, resume a task that is no longer the user's?
 *
 * Only while that prompt holds the bar's display: covered by a banner, the
 * bar's own OK would answer the banner, and the deck answers what the bar would.
 */
export type DeckPrompt = 'standup' | 'wrap-up' | 'wrap-up-confirm' | 'resume';

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
}

export interface DeckState {
  session: DeckSession | null;
  /** The icon of whatever holds the bar, as the mini timer shows it. */
  icon: ScreenIconDTO | null;
  prompt: DeckPrompt | null;
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
  'prompt-yes',
  'prompt-no'
] as const;

export type DeckAction = (typeof DECK_ACTIONS)[number];

export interface DeckRequest {
  id: string;
  action: DeckAction;
  /** The second press of a question the plugin asked: NOT YOURS?, DISCARD?. */
  confirmed?: boolean;
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
  return request;
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
