/**
 * Every input the bar sends, with what came of it -- the feed behind the
 * window's chart of the bar's inputs (Settings › Desk devices).
 *
 * Every input, not only the ones that did something: `ON_HARDWARE_INPUT_EVENT`
 * carries the actions alone, so a Back -- which does nothing, by the user's
 * choice -- or a Pause held off while the screen settled never reached the
 * window, and a trial of the buttons could not tell "ignored" from "never
 * arrived".
 */

import { END_MY_DAY, Verb } from './words';

/** The bar's inputs as the decoder names them (CLAUDE.md §4: one meaning each). */
export type BarInputKind = 'pause' | 'click' | 'turn' | 'back' | 'other';

export interface BarInputDTO {
  input: BarInputKind;
  /** A turn's direction, one notch: 1 right, -1 left. Null for a press. */
  turn: 1 | -1 | null;
  /** The key as the firmware named it, for the curious. */
  key: string;
  /** The decoder's answer: the action taken, or `NONE`. */
  outcome: string;
  /** When main received it, in ms since the epoch. */
  atMs: number;
}

/** The lanes of the chart, top to bottom, with their names on the bar. */
export const BAR_INPUT_LANES: ReadonlyArray<{ input: BarInputKind; label: string }> = [
  { input: 'pause', label: 'Pause' },
  { input: 'click', label: 'Click' },
  { input: 'turn', label: 'Turn' },
  { input: 'back', label: 'Back' }
];

/**
 * Outcomes that mean the input changed nothing. `AWAIT_<X>_PROMPT` is an
 * input a question does not take; `ANSWER_SETTLING` an answer held off just
 * after the screen changed (`BAR_ANSWER_SETTLE_MS`).
 */
export function barInputDidNothing(outcome: string): boolean {
  return outcome === 'NONE' || outcome === 'ANSWER_SETTLING' || /^AWAIT_.*_PROMPT$/.test(outcome);
}

// The glossary's verbs (words.ts), never spelled here: the bar, the window
// and the deck say the same word for the same act.
const OUTCOME_WORDS: Record<string, string> = {
  NONE: 'Nothing',
  ANSWER_SETTLING: 'Held off: the screen had just changed',
  PAUSE_SESSION: Verb.PAUSE,
  RESUME_SESSION: Verb.RESUME,
  STOP_SESSION: Verb.STOP,
  FINISH_SESSION: Verb.DONE,
  DISCARD_SESSION: Verb.DISCARD,
  START_INTERRUPTION: Verb.INTERRUPT,
  STOP_INTERRUPTION: Verb.STOP,
  BACK_FROM_INTERRUPTION: Verb.BACK,
  OPEN_MENU: 'Menu opened',
  CLOSE_MENU: 'Menu closed',
  DISMISS_NOTIFICATION_ALERT: 'Notification put away',
  CONFIRM_STANDUP_PROMPT: 'Joined the stand-up',
  DISMISS_STANDUP_PROMPT: 'Skipped the stand-up',
  CONFIRM_RESUME_PROMPT: Verb.RESUME,
  DISMISS_RESUME_PROMPT: Verb.NOT_NOW,
  CONFIRM_NOTHING_TIMING: 'Yes',
  DISMISS_NOTHING_TIMING: Verb.NOT_NOW,
  CONFIRM_EOD_WRAP_UP_STEP_1: `${END_MY_DAY}: press again`,
  EXECUTE_EOD_WRAP_UP: END_MY_DAY,
  DISMISS_EOD_WRAP_UP: Verb.NOT_NOW
};

/** What an outcome comes to, in words; a code nobody named reads as itself. */
export function barInputOutcomeWord(outcome: string): string {
  if (OUTCOME_WORDS[outcome]) return OUTCOME_WORDS[outcome];
  if (/^AWAIT_.*_PROMPT$/.test(outcome)) return 'Nothing: a question was showing';
  const words = outcome.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
