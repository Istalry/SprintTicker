import { BusyBarDriver, HardwareEvent } from './busybar-driver';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { IPriorityPreemptionEngine } from '../services/priority-preemption-engine';
import { DisplayRenderer } from './display-renderer';
import { RESUME_PROMPT_EVENT } from '../../shared/priority-defaults';
import { WORKLOG_COMMENTS } from '../../shared/worklog-comments';
import { BAR_BACK_SETTLE_MS } from '../../shared/render-constants';

export type ActionHandler = (action: string, inputKey: string) => void;

/** What a press of the bar's inputs is, whatever the firmware calls it. */
type BarInput = 'pause' | 'back' | 'click' | 'turn' | 'other';

/**
 * Decodes the bar's inputs (redesign P14b, the user's layout of 2026-11-12).
 * One meaning per input, in every state, and no menu but the one the wheel
 * will open (P14c):
 *
 * - **Pause** is yes: pause, resume, back to the task an interruption holds,
 *   join, accept, dismiss a notification; with nothing running it opens the
 *   task picker on the computer.
 * - **Back** is no, or stop: refuses a question, dismisses a notification,
 *   stops the session (its time logged, the task left open) or the
 *   interruption -- but never within `BAR_BACK_SETTLE_MS` of the screen
 *   changing, so a press meant for a banner that left under the finger does
 *   not stop the task beneath it.
 * - **The wheel's click** interrupts; during an interruption, Another.
 * - **Turning** does nothing yet.
 *
 * No input is held: the bar never sends a long press. A two-second hold
 * arrives as a press released late (measured on the bar, 2026-11-12), so the
 * old "hold BACK = done" never fired from the device. And while the bar
 * shows its own screen -- the firmware's clock, nothing of ours drawn -- the
 * firmware takes Back for itself and leaves its clock app, so nothing here
 * may need Back when SprintTicker is not on the panel.
 */
export class InputDecoder {
  private _driver: BusyBarDriver;
  private _engine: TimeTrackingEngine;
  private _priorityEngine?: IPriorityPreemptionEngine;
  private _renderer?: DisplayRenderer;
  private _windowFocusCallback?: () => void;
  private _openPickerCallback?: () => void;
  private _actionHandlers: Set<ActionHandler> = new Set();
  private _eodConfirmStep: number = 0;

  /// <summary>
  /// Instantiates InputDecoder, binding hardware driver event listeners.
  /// </summary>
  constructor(
    driver: BusyBarDriver,
    engine: TimeTrackingEngine,
    priorityEngine?: IPriorityPreemptionEngine,
    renderer?: DisplayRenderer
  ) {
    this._driver = driver;
    this._engine = engine;
    this._renderer = renderer;
    if (priorityEngine) this.setPriorityEngine(priorityEngine);

    // Guard the listener itself, not just the action handlers. handleHardwareInput
    // calls engine methods that throw on invalid state -- and a throw inside an
    // EventEmitter listener with no error handler terminates the main process,
    // taking the whole app down on a button press.
    this._driver.on('input', (event: HardwareEvent) => {
      try {
        this.handleHardwareInput(event);
      } catch (err) {
        console.error('[InputDecoder] Unhandled error while processing hardware input:', err);
      }
    });
  }

  /// <summary>
  /// Injects PriorityPreemptionEngine reference for notification dismissal checks.
  /// </summary>
  public setPriorityEngine(engine: IPriorityPreemptionEngine): void {
    this._priorityEngine = engine;
  }

  /// <summary>
  /// Injects DisplayRenderer reference for matrix input feedback.
  /// </summary>
  public setRenderer(renderer: DisplayRenderer): void {
    this._renderer = renderer;
  }

  /// <summary>
  /// Sets callback invoked when hardware actions request desktop app window focus.
  /// </summary>
  public setWindowFocusCallback(cb: () => void): void {
    this._windowFocusCallback = cb;
  }

  /**
   * What Pause does with nothing running: the task picker on the computer,
   * raised past the foreground lock (the picker window), since choosing a
   * task is the app's -- the bar has no picker of its own any more.
   */
  public setOpenPickerCallback(cb: () => void): void {
    this._openPickerCallback = cb;
  }

  /// <summary>
  /// Gets current EOD confirmation step.
  /// </summary>
  public getEodConfirmStep(): number {
    return this._eodConfirmStep;
  }

  /// <summary>
  /// Registers an action listener callback invoked when hardware actions execute.
  /// </summary>
  public registerActionHandler(handler: ActionHandler): () => void {
    this._actionHandlers.add(handler);
    return () => this._actionHandlers.delete(handler);
  }

  /** Names the input, from the key and the event's type. */
  private static inputOf(event: HardwareEvent): BarInput {
    const key = (event.key || '').toLowerCase();
    if (event.type === 'rotate_left' || event.type === 'rotate_right') return 'turn';
    if (key === 'rotate_left' || key === 'rotate_right' || key === 'up' || key === 'down') return 'turn';
    if (key === 'start' || key === 'busy' || key === 'custom') return 'pause';
    if (key === 'back' || key === 'back_hold' || key === 'cancel') return 'back';
    if (key === 'ok' || key === 'click') return 'click';
    return 'other';
  }

  /// <summary>
  /// Decodes an input and does what it means in the state the bar shows.
  /// Answers the action taken, for the log and the tests.
  /// </summary>
  public handleHardwareInput(event: HardwareEvent): string {
    const key = (event.key || '').toLowerCase();
    const input = InputDecoder.inputOf(event);
    const activeLock = this._priorityEngine?.getActiveLockEventName();

    // 1. The end-of-day wrap-up: two presses to confirm, Back to dismiss.
    if (activeLock === 'eodWrapUpPriority') {
      // The wheel's click still says yes on a question until the bar's
      // hints name the Pause button (P14e): they say OK=YES today.
      if (input === 'pause' || input === 'click') {
        this._windowFocusCallback?.();
        if (this._eodConfirmStep === 0) {
          this._eodConfirmStep = 1;
          this._renderer?.renderCeremonyPrompt('EOD', 'Press START to Confirm');
          return this.report('CONFIRM_EOD_WRAP_UP_STEP_1', key);
        }
        this._eodConfirmStep = 0;
        this._renderer?.renderCeremonyPrompt('EOD', 'Wrapping Up...');
        return this.report('EXECUTE_EOD_WRAP_UP', key);
      }
      if (input === 'back') {
        this._eodConfirmStep = 0;
        this._priorityEngine?.releaseActiveLock('eodWrapUpPriority');
        this._renderer?.renderActiveSession(this._engine.getCurrentSession());
        return this.report('DISMISS_EOD_WRAP_UP', key);
      }
      return 'AWAIT_EOD_WRAP_UP';
    }
    this._eodConfirmStep = 0;

    // 2. The stand-up's prompt: yes joins, Back refuses.
    if (activeLock === 'standupPromptPriority') {
      if (input === 'pause' || input === 'click') {
        // Joining is ContextScheduleService's, through the action handlers:
        // it switches the timer to the stand-up under the prompt's lock and
        // releases it, which draws once. The window is not brought forward:
        // the user is on their way to the meeting (P8c).
        return this.report('CONFIRM_STANDUP_PROMPT', key);
      }
      if (input === 'back') {
        this._priorityEngine?.releaseActiveLock('standupPromptPriority');
        this._renderer?.renderActiveSession(this._engine.getCurrentSession());
        return this.report('DISMISS_STANDUP_PROMPT', key);
      }
      return 'AWAIT_STANDUP_PROMPT';
    }

    // 3. Back to your task? -- after lunch, or after an interruption. The
    // answer goes to ContextScheduleService, which owns the question and its
    // lock.
    if (activeLock === RESUME_PROMPT_EVENT) {
      if (input === 'pause' || input === 'click') return this.report('CONFIRM_RESUME_PROMPT', key);
      if (input === 'back') return this.report('DISMISS_RESUME_PROMPT', key);
      return 'AWAIT_RESUME_PROMPT';
    }

    switch (input) {
      case 'pause': return this.pause(key);
      case 'back': return this.back(key);
      case 'click': return this.click(key);
      // The wheel's menu is P14c.
      case 'turn': return 'NONE';
      default:
        // The firmware's own keys: reported so the app can follow the bar,
        // never an action of ours.
        if (key === 'apps' || key === 'settings' || key === 'off') return this.report(`SYSTEM_MODE_${key.toUpperCase()}`, key);
        return 'NONE';
    }
  }

  /** Pause: yes, in whatever the bar shows. */
  private pause(key: string): string {
    // A notification first: Pause dismisses it, and does nothing else.
    if (this._priorityEngine?.dismissNotification(false)) return this.report('DISMISS_NOTIFICATION_ALERT', key);

    const session = this._engine.getCurrentSession();
    if (!session) {
      // Choosing a task is the app's; the picker comes up over what the user
      // is doing, as from the deck.
      this._openPickerCallback?.();
      return this.report('OPEN_TASK_PICKER', key);
    }
    if (session.interruption) {
      // Back to the task it holds. One holding nothing has nothing to go back
      // to: Back ends it.
      if (!session.interruption.interruptedSessionId) return 'NONE';
      this._engine.backFromInterruption();
      return this.report('BACK_FROM_INTERRUPTION', key);
    }
    if (session.status === 'TRACKING') {
      this._engine.pauseSession();
      return this.report('PAUSE_SESSION', key);
    }
    this._engine.resumeSession();
    return this.report('RESUME_SESSION', key);
  }

  /** Back: no, or stop. */
  private back(key: string): string {
    if (this._priorityEngine?.dismissNotification(true)) return this.report('DISMISS_NOTIFICATION_ALERT', key);

    // A press meant for what was there a moment ago: a banner that left, a
    // scene that ended. It must not stop what is there now.
    if (this._renderer && this._renderer.msSinceScreenChange() < BAR_BACK_SETTLE_MS) return 'BACK_SETTLING';

    const session = this._engine.getCurrentSession();
    if (!session) return 'NONE';
    if (session.interruption) {
      // Nothing is logged for an interruption, so no LOGGED: it waits to be
      // placed, and main opens the Place window on the computer at its stop.
      this._engine.stopInterruption();
      return this.report('STOP_INTERRUPTION', key);
    }
    // Stop means stop: the time is logged and the task stays open. LOGGED
    // says so, before the stop, so the session's end is held behind the scene
    // rather than drawn first. Undo is the app's toast.
    this._renderer?.renderTaskLogged();
    this._engine.stopSession(WORKLOG_COMMENTS.BAR_STOP);
    return this.report('STOP_SESSION', key);
  }

  /** The wheel's click: Interrupt, or Another during one. */
  private click(key: string): string {
    // A notification on the panel is answered by Pause or Back; a click
    // there does nothing rather than start a timer under it.
    if (this._priorityEngine?.hasActiveNotification()) return 'NONE';
    // Interrupt is ContextScheduleService's, through the action handlers: it
    // holds the task to ask about when the interruption ends, and during one
    // it is Another. Its start draws the screen.
    return this.report('START_INTERRUPTION', key);
  }

  private report(action: string, inputKey: string): string {
    console.log(`[InputDecoder] ${action} (Key: ${inputKey})`);
    for (const handler of this._actionHandlers) {
      try {
        handler(action, inputKey);
      } catch (err) {
        console.error('[InputDecoder] Error in action handler:', err);
      }
    }
    return action;
  }
}
