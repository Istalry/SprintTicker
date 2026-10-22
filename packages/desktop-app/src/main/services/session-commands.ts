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
