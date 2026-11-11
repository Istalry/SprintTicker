import { DECK_WORDS } from './deck-protocol';
import { DISPLAY_CONSTANTS } from './render-constants';
import type { InterruptionSource } from './interruption';

/**
 * The words of the 2026-11 redesign: one meaning per word, one word per
 * action, on every surface (the glossary of
 * `Documentation/design-history/Redesign-2026-11-screens.html`).
 *
 * A view, the tray, the bar and the deck read their words here and never
 * spell one themselves. Copies drifted before: the bar's paused menu says
 * DROP and FINISH where the window says Discard and Done, and the deck's B
 * key says NOT DONE where the screens say STOP. Words of the same action
 * that differ between surfaces read as two different actions.
 *
 * Pure data and pure functions, safe on both sides of the context bridge.
 */

/** The verbs, as the window and the tray write them. */
export const Verb = {
  /** Start a task when nothing runs. */
  START: 'Start',
  /** Change what the timer runs; the task before stops and stays open. */
  SWITCH: 'Switch',
  /** Go back to the task before the one running. */
  PREVIOUS: 'Previous',
  /** Hold the timer on the same entry. */
  PAUSE: 'Pause',
  /** Go on after a pause, Lunch or Away -- never after an interruption, which is Back. */
  RESUME: 'Resume',
  /** End the timer; the task stays open. On a task, Stop is "not done". */
  STOP: 'Stop',
  /** Stop, and move the task to its project's done state at the provider. */
  DONE: 'Done',
  /** Stop, and keep and send nothing. */
  DISCARD: 'Discard',
  /** Time something apart from the task, which waits as it was. */
  INTERRUPT: 'Interrupt',
  /** End the interruption running and start the next one. */
  ANOTHER: 'Another',
  /** End the interruption and return to the task it interrupted. */
  BACK: 'Back',
  /** Put an interruption's time on a task. */
  PLACE: 'Place',
  /** Put an entry already on a task onto another task. */
  MOVE: 'Move',
  /** Leave an interruption to place later. */
  LATER: 'Later',
  /** Answer no to a question; nothing changes. */
  NOT_NOW: 'Not now',
  /** Take back the last action while its sends are held (P5). */
  UNDO: 'Undo'
} as const;

/** Union of the verb strings above. */
export type VerbValue = (typeof Verb)[keyof typeof Verb];

/** What the timer and an entry are doing, as the window writes it. */
export const StateWord = {
  /** Nothing runs and nothing is asked. */
  NOTHING_TIMING: 'Nothing timing',
  RUNNING: 'Running',
  PAUSED: 'Paused',
  /** An interruption whose time is not on a task yet. Never sent. */
  TO_PLACE: 'To place',
  /** Saved here. */
  LOGGED: 'Logged',
  /** Will be sent when the provider answers, or once an overlap is fixed. */
  WAITING: 'Waiting to send',
  /** The provider has it. */
  SENT: 'Sent'
} as const;

/** Union of the state strings above. */
export type StateWordValue = (typeof StateWord)[keyof typeof StateWord];

/**
 * Where an interruption was started, as its row says it (S5): "from the
 * Stream Deck". So a list read at 18:00 still says which one it was. An
 * interruption of the model before has no source to tell.
 */
export const INTERRUPTION_SOURCE_WORDS: Record<InterruptionSource, string | null> = {
  window: 'from the window',
  mini: 'from the mini timer',
  tray: 'from the tray',
  bar: 'from the bar',
  deck: 'from the Stream Deck',
  shortcut: 'from the shortcut',
  notification: 'from a notification',
  legacy: null
};

/**
 * "Keep off Jira": keep an interruption on this computer only, never sent.
 * The provider's own name, from `providerDisplayName`, never a generic one.
 */
export function keepOffLabel(providerName: string): string {
  const name = providerName.trim();
  return name ? `Keep off ${name}` : 'Keep off the provider';
}

/**
 * What the Undo bar says was done, naming the task by its key: "Stopped
 * MG-12 · 1h 05m". `kind` is `UndoKind`, plus `done` for a stop that marked
 * the task done. Main writes it, so the window and the mini timer agree.
 */
export function undoLabel(
  kind: 'stop' | 'done' | 'discard' | 'correct' | 'move' | 'delete' | 'place' | 'end-day',
  taskKey: string,
  duration?: string
): string {
  const withTime = (text: string) => (duration ? `${text} · ${duration}` : text);
  switch (kind) {
    case 'stop':
      return withTime(`Stopped ${taskKey}`);
    case 'done':
      return withTime(`${Verb.DONE} ${taskKey}`);
    case 'discard':
      return withTime(`Discarded ${taskKey}`);
    case 'correct':
      return withTime(`Corrected ${taskKey}`);
    case 'move':
      return withTime(`Moved to ${taskKey}`);
    case 'delete':
      return withTime(`Deleted ${taskKey}`);
    case 'place':
      return withTime(`Placed on ${taskKey}`);
    case 'end-day':
      return 'Day ended';
  }
}

/** "3 to place", for the window, the tray and the mini timer. */
export function toPlaceLabel(count: number): string {
  return `${wholeCount(count)} to place`;
}

/**
 * Which row of the bar a word is drawn in, and how wide its field is. The
 * width test (`words.test.ts`) measures every word against its field in that
 * row's font, so a word that stops fitting fails there and not on the bar.
 */
export interface BarWordField {
  readonly row: 0 | 1;
  readonly widthPx: number;
}

/** Row 0 beside the 16 px icon: the panel less the icon and its gutter. */
export const BAR_FIELD_BESIDE_ICON: BarWordField = { row: 0, widthPx: DISPLAY_CONSTANTS.LAYOUT_OFFSETS.TEXT_FIELD_WIDTH };
/** Row 0 across the whole panel, with no icon. */
export const BAR_FIELD_FULL_WIDTH: BarWordField = { row: 0, widthPx: DISPLAY_CONSTANTS.FRONT_GRID_WIDTH };

/**
 * The bar's words. Printable ASCII only (CLAUDE.md §4), capitals, and each
 * fits {@link BAR_FIELD_BESIDE_ICON} unless {@link BAR_WORD_FIELDS} says
 * otherwise. The shorter forms of D5 (REDESIGN-PLAN §2) are chosen here:
 * "3 TO PLACE", not "3 TO PLACE IN APP"; NOTHING TIMING without the icon.
 */
export const BarWord = {
  START: 'START',
  SWITCH: 'SWITCH',
  PREVIOUS: 'PREV',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  STOP: 'STOP',
  DONE: 'DONE',
  DISCARD: 'DISCARD',
  INTERRUPT: 'INTERRUPT',
  ANOTHER: 'ANOTHER',
  BACK: 'BACK',
  LATER: 'LATER',
  NOT_NOW: 'NOT NOW',
  NOTHING_TIMING: 'NOTHING TIMING',
  STAND_UP: 'STAND-UP',
  NOT_YOURS: 'NOT YOURS',
  DONE_ANYWAY: 'DONE ANYWAY',
  OK_YES: 'OK=YES',
  OK_JOIN: 'OK=JOIN',
  OK_END: 'OK=END',
  OK_PICK: 'OK=PICK',
  OK_APP: 'OK=APP'
} as const;

/** Union of the bar's word strings. */
export type BarWordValue = (typeof BarWord)[keyof typeof BarWord];

/** The words whose field is not {@link BAR_FIELD_BESIDE_ICON}. */
export const BAR_WORD_FIELDS: Partial<Record<keyof typeof BarWord, BarWordField>> = {
  // 63 px in row 0: it does not fit beside the icon, so it is drawn alone (D5).
  NOTHING_TIMING: BAR_FIELD_FULL_WIDTH
};

/** The field a bar word is measured against. */
export function barWordField(word: keyof typeof BarWord): BarWordField {
  return BAR_WORD_FIELDS[word] ?? BAR_FIELD_BESIDE_ICON;
}

/** Largest count the bar writes; more reads as this many and a plus. */
export const BAR_MAX_COUNT = 99;

/** "3 TO PLACE" on the bar; "99+ TO PLACE" beyond {@link BAR_MAX_COUNT}. */
export function barToPlaceLabel(count: number): string {
  const n = wholeCount(count);
  return n > BAR_MAX_COUNT ? `${BAR_MAX_COUNT}+ TO PLACE` : `${n} TO PLACE`;
}

/** The deck's words; they live in `deck-protocol.ts`, the one file the plugin may import. */
export { DECK_WORDS };

function wholeCount(count: number): number {
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}
