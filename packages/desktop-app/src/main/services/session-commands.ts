import type { TimeTrackingEngine } from '../engine/time-tracking-engine';
import type { DisplayRenderer } from '../hardware/display-renderer';

/**
 * Ends the session as the window's Stop does: logs it, marks the task done
 * if asked, and plays LOGGED or DONE! on the bar. One function for the
 * window and the Stream Deck, so a key ends a session exactly as a click.
 *
 * The scene only when something was stopped: with no session there is
 * nothing to celebrate, and the scene would take the display for nothing.
 */
export function completeSession(
  engine: Pick<TimeTrackingEngine, 'stopSession'>,
  renderer: Pick<DisplayRenderer, 'renderTaskCompletionConfetti' | 'renderTaskLogged'>,
  comment?: string,
  markDone?: boolean
): { success: boolean; loggedSeconds: number } {
  const res = engine.stopSession(comment, markDone);
  if (res.success) {
    if (markDone) {
      renderer.renderTaskCompletionConfetti();
    } else {
      renderer.renderTaskLogged();
    }
  }
  return res;
}

/**
 * How a session is ended on the user's word -- the window's Stop, Done and
 * Discard, and the deck's keys -- so both reach the same code. Main builds
 * the undoable one (`undoableSessionEnding`); without it, as in a test, the
 * plain one ends sessions as before.
 */
export interface SessionEnding {
  complete(comment?: string, markDone?: boolean): { success: boolean; loggedSeconds: number };
  discard(): { success: boolean; discardedSeconds: number };
}

/** Ends sessions at once, with no undo. */
export function plainSessionEnding(
  engine: Pick<TimeTrackingEngine, 'stopSession' | 'discardSession'>,
  renderer: Pick<DisplayRenderer, 'renderTaskCompletionConfetti' | 'renderTaskLogged'>
): SessionEnding {
  return {
    complete: (comment, markDone) => completeSession(engine, renderer, comment, markDone),
    discard: () => engine.discardSession()
  };
}
