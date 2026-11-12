import { BusyBarDriver, HardwareEvent } from './busybar-driver';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { IPriorityPreemptionEngine } from '../services/priority-preemption-engine';
import { DisplayRenderer } from './display-renderer';
import { RESUME_PROMPT_EVENT } from '../../shared/priority-defaults';
import { WORKLOG_COMMENTS } from '../../shared/worklog-comments';
import { BAR_ANSWER_SETTLE_MS, BAR_INTERRUPTION_AGAIN_MS, BAR_STOP_AGAIN_MS } from '../../shared/render-constants';
import { BarWord } from '../../shared/words';

export type ActionHandler = (action: string, inputKey: string) => void;

/** What a press of the bar's inputs is, whatever the firmware calls it. */
type BarInput = 'pause' | 'back' | 'click' | 'turn' | 'other';

/** The questions the bar answers, by the lock that holds the display for each. */
type BarQuestion = 'eod' | 'standup' | 'resume';

/** An interruption's return, held to see whether a second Pause comes. */
interface PendingBack {
  sessionId: string;
  pressedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Decodes the bar's inputs (redesign P14b, the user's layout of 2026-11-12,
 * revised the same day after trying it). One meaning per input, in every
 * state, and no menu but the one the wheel will open (P14c):
 *
 * - **Pause** is yes: pause, resume, back to the task an interruption holds,
 *   join, accept, dismiss a notification; with nothing running it opens the
 *   task picker on the computer. **Pause again** within `BAR_STOP_AGAIN_MS`
 *   of pausing stops the session, its time logged; during an interruption,
 *   one Pause goes back to the task and two stop the interruption.
 * - **The wheel's click** is no on a question or a notification, and
 *   Interrupt everywhere else -- Another during one.
 * - **Back** does nothing: the user did not want to use it.
 * - **Turning** does nothing yet.
 *
 * No input is held: the bar never sends a long press. A two-second hold
 * arrives as a press released late (measured on the bar, 2026-11-12). And
 * while the bar shows its own screen -- the firmware's clock, nothing of ours
 * drawn -- the firmware takes Back for itself and leaves its clock app, so
 * nothing here may need Back.
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
  /** The session the bar's Pause just paused, which a second Pause stops until `until`. */
  private _stopArmed: { sessionId: string; until: number } | null = null;
  private _pendingBack: PendingBack | null = null;

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

  /** Drops a return still waiting on a second Pause, for shutdown. */
  public dispose(): void {
    if (this._pendingBack) clearTimeout(this._pendingBack.timer);
    this._pendingBack = null;
  }

  /**
   * Answers the question on the bar, yes or no, as the bar's own presses
   * would: the Stream Deck's answer keys come here, so the wrap-up's two
   * presses and the stand-up's switch stay in one place. No settle: the deck
   * keeps its own (`ANSWER_SETTLE_MS`).
   */
  public answerQuestion(yes: boolean): string {
    const question = this.questionShown();
    if (!question) return 'NONE';
    return this.answer(question, yes, yes ? 'deck-yes' : 'deck-no');
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

    // A return from an interruption waiting on a second Pause: Pause stops
    // the interruption instead, and anything else lets the return happen
    // before it is handled.
    if (this._pendingBack) {
      if (input === 'pause' && this.stillShowing(this._pendingBack.sessionId)) return this.stopPendingInterruption(key);
      this.flushPendingBack();
    }

    const question = this.questionShown();
    if (question !== 'eod') this._eodConfirmStep = 0;
    if (question) {
      if (input !== 'pause' && input !== 'click') return `AWAIT_${question.toUpperCase()}_PROMPT`;
      if (this.settling()) return 'ANSWER_SETTLING';
      return this.answer(question, input === 'pause', key);
    }

    // A notification: Pause accepts it and the click says no, and both put it
    // away; neither reaches the session beneath.
    if ((input === 'pause' || input === 'click') && this._priorityEngine?.hasActiveNotification()) {
      if (this.settling()) return 'ANSWER_SETTLING';
      this._priorityEngine.dismissNotification(false);
      return this.report('DISMISS_NOTIFICATION_ALERT', key);
    }

    switch (input) {
      case 'pause': return this.pause(key);
      // Interrupt is ContextScheduleService's, through the action handlers: it
      // holds the task to ask about when the interruption ends, and during one
      // it is Another. Its start draws the screen.
      case 'click': return this.report('START_INTERRUPTION', key);
      // Back stops nothing and answers nothing: the user does not want to use
      // it, and on the bar's own screen the firmware takes it anyway.
      case 'back': return 'NONE';
      // The wheel's menu is P14c.
      case 'turn': return 'NONE';
      default:
        // The firmware's own keys: reported so the app can follow the bar,
        // never an action of ours.
        if (key === 'apps' || key === 'settings' || key === 'off') return this.report(`SYSTEM_MODE_${key.toUpperCase()}`, key);
        return 'NONE';
    }
  }

  private questionShown(): BarQuestion | null {
    const lock = this._priorityEngine?.getActiveLockEventName();
    if (lock === 'eodWrapUpPriority') return 'eod';
    if (lock === 'standupPromptPriority') return 'standup';
    if (lock === RESUME_PROMPT_EVENT) return 'resume';
    return null;
  }

  /**
   * A press too soon after the screen changed was meant for what was there
   * before: a Pause meant to pause must not join a stand-up that came up
   * under the finger, nor a click meant to interrupt refuse it.
   */
  private settling(): boolean {
    return !!this._renderer && this._renderer.msSinceScreenChange() < BAR_ANSWER_SETTLE_MS;
  }

  private answer(question: BarQuestion, yes: boolean, key: string): string {
    switch (question) {
      case 'eod':
        if (yes) {
          // Two presses: the wrap-up can shut the machine down.
          this._windowFocusCallback?.();
          if (this._eodConfirmStep === 0) {
            this._eodConfirmStep = 1;
            this._renderer?.renderCeremonyPrompt('EOD', BarWord.AGAIN_YES);
            return this.report('CONFIRM_EOD_WRAP_UP_STEP_1', key);
          }
          this._eodConfirmStep = 0;
          this._renderer?.renderCeremonyPrompt('EOD', 'Wrapping Up...');
          return this.report('EXECUTE_EOD_WRAP_UP', key);
        }
        this._eodConfirmStep = 0;
        this._priorityEngine?.releaseActiveLock('eodWrapUpPriority');
        this._renderer?.renderActiveSession(this._engine.getCurrentSession());
        return this.report('DISMISS_EOD_WRAP_UP', key);
      case 'standup':
        // Joining is ContextScheduleService's, through the action handlers:
        // it switches the timer to the stand-up under the prompt's lock and
        // releases it, which draws once. The window is not brought forward:
        // the user is on their way to the meeting (P8c).
        if (yes) return this.report('CONFIRM_STANDUP_PROMPT', key);
        this._priorityEngine?.releaseActiveLock('standupPromptPriority');
        this._renderer?.renderActiveSession(this._engine.getCurrentSession());
        return this.report('DISMISS_STANDUP_PROMPT', key);
      case 'resume':
        // Back to your task? -- after lunch, or after an interruption. The
        // answer goes to ContextScheduleService, which owns the question and
        // its lock.
        return this.report(yes ? 'CONFIRM_RESUME_PROMPT' : 'DISMISS_RESUME_PROMPT', key);
    }
  }

  /** Pause: yes, in whatever the bar shows; again, stop. */
  private pause(key: string): string {
    const session = this._engine.getCurrentSession();
    if (!session) {
      // Choosing a task is the app's; the picker comes up over what the user
      // is doing, as from the deck.
      this._openPickerCallback?.();
      return this.report('OPEN_TASK_PICKER', key);
    }
    if (session.interruption) {
      // One holding no task has nothing to go back to: Pause ends it.
      if (!session.interruption.interruptedSessionId) {
        this._engine.stopInterruption();
        return this.report('STOP_INTERRUPTION', key);
      }
      // One Pause goes back to the task, two stop the interruption: the wait
      // tells them apart, with AGAIN=STOP on the bar meanwhile.
      this._renderer?.showAgainHint(session.sessionId, BAR_INTERRUPTION_AGAIN_MS);
      this._renderer?.renderActiveSession(session);
      this._pendingBack = {
        sessionId: session.sessionId,
        pressedAt: Date.now(),
        timer: setTimeout(() => {
          try {
            this.flushPendingBack();
          } catch (err) {
            // A timer's throw would end the process; the press is lost, the
            // interruption runs on, and the next press acts afresh.
            console.error('[InputDecoder] Going back from the interruption failed:', err);
          }
        }, BAR_INTERRUPTION_AGAIN_MS)
      };
      return 'AWAIT_SECOND_PRESS';
    }
    if (session.status === 'TRACKING') {
      // Shown before the pause, so the paused frame already carries it.
      this._renderer?.showAgainHint(session.sessionId, BAR_STOP_AGAIN_MS);
      this._stopArmed = { sessionId: session.sessionId, until: Date.now() + BAR_STOP_AGAIN_MS };
      this._engine.pauseSession();
      return this.report('PAUSE_SESSION', key);
    }
    const armed = this._stopArmed;
    this._stopArmed = null;
    this._renderer?.clearAgainHint();
    if (armed && armed.sessionId === session.sessionId && Date.now() < armed.until) {
      // Stop means stop: the time is logged and the task stays open. LOGGED
      // says so, before the stop, so the session's end is held behind the
      // scene rather than drawn first. Undo is the app's toast.
      this._renderer?.renderTaskLogged();
      this._engine.stopSession(WORKLOG_COMMENTS.BAR_STOP);
      return this.report('STOP_SESSION', key);
    }
    this._engine.resumeSession();
    return this.report('RESUME_SESSION', key);
  }

  private stillShowing(sessionId: string): boolean {
    return this._engine.getCurrentSession()?.sessionId === sessionId;
  }

  /** The second Pause: the interruption ends where the first was pressed. */
  private stopPendingInterruption(key: string): string {
    const pending = this._pendingBack!;
    clearTimeout(pending.timer);
    this._pendingBack = null;
    this._renderer?.clearAgainHint();
    this._engine.stopInterruption(new Date(pending.pressedAt).toISOString());
    return this.report('STOP_INTERRUPTION', key);
  }

  /** The wait is over, or another input came: back to the task. */
  private flushPendingBack(): void {
    const pending = this._pendingBack;
    if (!pending) return;
    clearTimeout(pending.timer);
    this._pendingBack = null;
    this._renderer?.clearAgainHint();
    // Ended or replaced meanwhile, from the app or the deck: nothing to go
    // back from.
    if (!this._engine.getCurrentSession()?.interruption || !this.stillShowing(pending.sessionId)) return;
    this._engine.backFromInterruption();
    this.report('BACK_FROM_INTERRUPTION', 'start');
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
