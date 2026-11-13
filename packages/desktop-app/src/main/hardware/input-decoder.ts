import { BusyBarDriver, HardwareEvent } from './busybar-driver';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { IPriorityPreemptionEngine } from '../services/priority-preemption-engine';
import { DisplayRenderer, MenuConfirm } from './display-renderer';
import { BarMenuEntry, barMenuEntries } from './bar-menu';
import { BAR_MENU_EVENT, NOTHING_TIMING_EVENT, RESUME_PROMPT_EVENT } from '../../shared/priority-defaults';
import { WORKLOG_COMMENTS } from '../../shared/worklog-comments';
import {
  BAR_ANSWER_SETTLE_MS, BAR_INTERRUPTION_AGAIN_MS, BAR_MENU_IDLE_MS, BAR_STOP_AGAIN_MS
} from '../../shared/render-constants';
import { BarWord } from '../../shared/words';
import { finishNeedsConfirmation } from '../../shared/task-left';
import { DECK_MAX_RECENT } from '../../shared/deck-protocol';
import type { ActiveSessionDTO, TaskDTO } from '../../shared/dtos';
import { SessionEnding, plainSessionEnding } from '../services/session-commands';
import type { BarInputDTO, BarInputKind } from '../../shared/bar-input';

export type ActionHandler = (action: string, inputKey: string) => void;

/** Two more than the menu shows: the open task and the previous one are left out. */
const DECK_RECENT_READ = DECK_MAX_RECENT + 2;

/** Ends sessions with no scene, for a decoder with no renderer (tests). */
const NO_SCENES = { renderTaskCompletionConfetti: () => undefined, renderTaskLogged: () => undefined } as unknown as DisplayRenderer;

/** What a press of the bar's inputs is, whatever the firmware calls it. */
type BarInput = BarInputKind;

/** Hears every input the bar sends, with what came of it. */
export type BarInputListener = (input: BarInputDTO) => void;

/** The questions the bar answers, by the lock that holds the display for each. */
type BarQuestion = 'eod' | 'standup' | 'resume' | 'nothing';

/** The wheel's menu while it is open. */
interface OpenMenu {
  entries: BarMenuEntry[];
  index: number;
  /** The DONE or DISCARD asked about, until a second Pause or the click. */
  confirm: MenuConfirm | null;
  /** What the menu was built for: a session started or ended elsewhere closes it. */
  builtFor: string;
  /** Closes it untouched; a turn or a question asked starts it again. */
  idle: ReturnType<typeof setTimeout>;
}

/** What the menu needs beyond the engine, wired by main. */
export interface BarMenuDeps {
  /** How the user's Stop, Done and Discard end a session, with the app's Undo. */
  sessionEnding?: SessionEnding;
  /** The picker's recent tasks, newest first, as the deck's Recent keys read them. */
  recentTasks?: (limit: number) => TaskDTO[];
  /** The dashboard, raised past the foreground lock. */
  openApp?: () => void;
}

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
 * - **Turning** opens the menu (P14c): one entry per screen, Pause picks, the
 *   click or `BAR_MENU_IDLE_MS` untouched closes it. DONE and DISCARD ask a
 *   second Pause.
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
  private _inputListeners: Set<BarInputListener> = new Set();
  private _eodConfirmStep: number = 0;
  /** The session the bar's Pause just paused, which a second Pause stops until `until`. */
  private _stopArmed: { sessionId: string; until: number } | null = null;
  private _pendingBack: PendingBack | null = null;
  private _menu: OpenMenu | null = null;
  private _menuDeps: BarMenuDeps = {};
  private _unregisterMenu: (() => void) | null = null;

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
      let outcome = 'ERROR';
      try {
        outcome = this.handleHardwareInput(event);
      } catch (err) {
        console.error('[InputDecoder] Unhandled error while processing hardware input:', err);
      }
      this.tellInput(event, outcome);
    });

    // A task started or ended elsewhere -- the window, the deck -- while the
    // menu is open: its entries are about a state that is gone. Left open,
    // the old picker held the display over the new session (2026-10).
    this._engine.subscribe(session => {
      if (this._menu && this._menu.builtFor !== InputDecoder.menuKey(session)) this.closeMenu();
    });
  }

  /// <summary>
  /// Injects PriorityPreemptionEngine reference for notification dismissal checks.
  /// </summary>
  public setPriorityEngine(engine: IPriorityPreemptionEngine): void {
    this._unregisterMenu?.();
    this._priorityEngine = engine;
    // The open menu is the user's hand on the bar, a state rather than an
    // alert (CLAUDE.md §5): whenever the display frees, it is drawn again if
    // it is still open. Never queued, it would otherwise be refused under
    // Away and then forgotten -- open, invisible, still taking presses.
    // A test double without background screens has nothing to register with.
    this._unregisterMenu = typeof engine.addBackgroundScreen === 'function'
      ? engine.addBackgroundScreen([BAR_MENU_EVENT], () => {
        if (this._menu) this.drawMenu();
      })
      : null;
  }

  /** The commands the menu's entries reach; see `BarMenuDeps`. */
  public setMenuDeps(deps: BarMenuDeps): void {
    this._menuDeps = deps;
  }

  /** Whether the wheel's menu is open. */
  public isMenuOpen(): boolean {
    return this._menu !== null;
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

  /**
   * Hears every input from the bar with its outcome -- `NONE` included,
   * which the action handlers never hear: the window's chart of the inputs
   * shows a Back or a held-off answer as having arrived and done nothing.
   */
  public onInput(listener: BarInputListener): () => void {
    this._inputListeners.add(listener);
    return () => this._inputListeners.delete(listener);
  }

  private tellInput(event: HardwareEvent, outcome: string): void {
    const input = InputDecoder.inputOf(event);
    const dto: BarInputDTO = {
      input,
      turn: input === 'turn' ? InputDecoder.turnOf(event) : null,
      key: (event.key || event.type || '').toLowerCase(),
      outcome,
      atMs: Date.now()
    };
    for (const listener of this._inputListeners) {
      try {
        listener(dto);
      } catch (err) {
        // A listener is the window's chart: its failure must not reach the
        // driver's emitter, where a throw would end the main process.
        console.error('[InputDecoder] Error in input listener:', err);
      }
    }
  }

  /** Drops a return still waiting on a second Pause and the menu's timers, for shutdown. */
  public dispose(): void {
    if (this._pendingBack) clearTimeout(this._pendingBack.timer);
    this._pendingBack = null;
    if (this._menu) clearTimeout(this._menu.idle);
    this._menu = null;
    this._unregisterMenu?.();
    this._unregisterMenu = null;
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

    if (this._menu) return this.inMenu(input, event, key);

    switch (input) {
      case 'pause': return this.pause(key);
      // Interrupt is ContextScheduleService's, through the action handlers: it
      // holds the task to ask about when the interruption ends, and during one
      // it is Another. Its start draws the screen.
      case 'click': return this.report('START_INTERRUPTION', key);
      // Back stops nothing and answers nothing: the user does not want to use
      // it, and on the bar's own screen the firmware takes it anyway.
      case 'back': return 'NONE';
      case 'turn': return this.openMenu(InputDecoder.turnOf(event), key);
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
    if (lock === NOTHING_TIMING_EVENT) return 'nothing';
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
          this._renderer?.renderCeremonyPrompt('EOD', 'Ending the day...');
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
      case 'nothing':
        // NOTHING TIMING (P14e): yes is the picker on the computer, as Pause
        // with nothing running; no is not now. Either answer puts the
        // reminder away, which lets go of the screen (main's, through the
        // reminder service), and the firmware's clock comes back.
        if (yes) this._openPickerCallback?.();
        return this.report(yes ? 'CONFIRM_NOTHING_TIMING' : 'DISMISS_NOTHING_TIMING', key);
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
      // Stop means stop: the time is logged and the task stays open, with
      // LOGGED on the bar -- through the window's own Stop, so Undo offers
      // it back.
      this.ending().complete(WORKLOG_COMMENTS.BAR_STOP, false);
      return this.report('STOP_SESSION', key);
    }
    this._engine.resumeSession();
    return this.report('RESUME_SESSION', key);
  }

  /** +1 for a notch right (or down), -1 left (or up). */
  private static turnOf(event: HardwareEvent): 1 | -1 {
    const key = (event.key || '').toLowerCase();
    return event.type === 'rotate_left' || key === 'rotate_left' || key === 'up' ? -1 : 1;
  }

  /** What the menu is about: the session open, or the interruption running. */
  private static menuKey(session: ActiveSessionDTO | null): string {
    if (!session || session.status === 'COMPLETED') return 'none';
    return `${session.sessionId}|${session.interruption ? 'interruption' : 'task'}`;
  }

  private ending(): SessionEnding {
    return this._menuDeps.sessionEnding ?? plainSessionEnding(this._engine, this._renderer ?? NO_SCENES);
  }

  /** The first notch opens it: right on the first entry, left on the last. */
  private openMenu(direction: 1 | -1, key: string): string {
    const session = this._engine.getCurrentSession();
    const entries = barMenuEntries({
      session,
      previous: session?.interruption ? null : this._engine.getPreviousTask(),
      recent: this._menuDeps.recentTasks?.(DECK_RECENT_READ) ?? []
    });
    this._menu = {
      entries,
      index: direction === 1 ? 0 : entries.length - 1,
      confirm: null,
      builtFor: InputDecoder.menuKey(session),
      idle: this.idleTimer()
    };
    this.drawMenu();
    return this.report('OPEN_MENU', key);
  }

  private idleTimer(): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      try {
        this.closeMenu();
      } catch (err) {
        // A timer's throw would end the process; the menu stays open until
        // the next press closes it.
        console.error('[InputDecoder] Closing the menu failed:', err);
      }
    }, BAR_MENU_IDLE_MS);
  }

  /** A press while the menu is open: turn moves, Pause picks, the click says no. */
  private inMenu(input: BarInput, event: HardwareEvent, key: string): string {
    const menu = this._menu!;
    clearTimeout(menu.idle);
    menu.idle = this.idleTimer();
    switch (input) {
      case 'turn': {
        const next = Math.min(menu.entries.length - 1, Math.max(0, menu.index + InputDecoder.turnOf(event)));
        if (next === menu.index && menu.confirm === null) return 'NONE';
        menu.index = next;
        menu.confirm = null;
        this.drawMenu();
        return 'MOVE_MENU';
      }
      case 'click':
        if (menu.confirm !== null) {
          menu.confirm = null;
          this.drawMenu();
          return this.report('MENU_CONFIRM_REFUSED', key);
        }
        this.closeMenu();
        return this.report('CLOSE_MENU', key);
      case 'pause':
        return this.pick(menu, key);
      default:
        return 'NONE';
    }
  }

  private pick(menu: OpenMenu, key: string): string {
    const entry = menu.entries[menu.index];
    const session = this._engine.getCurrentSession();
    switch (entry.action) {
      case 'DONE':
      case 'DISCARD': {
        if (menu.confirm === null) {
          // One changes the ticket, the other loses the time: a second Pause.
          menu.confirm = entry.action === 'DISCARD' ? 'DISCARD' : finishNeedsConfirmation(session) ? 'DONE_UNLISTED' : 'DONE';
          this.drawMenu();
          return this.report(`ASK_${entry.action}`, key);
        }
        const unlisted = menu.confirm === 'DONE_UNLISTED';
        this.closeMenu();
        if (entry.action === 'DISCARD') {
          this.ending().discard();
          return this.report('DISCARD_SESSION', key);
        }
        this.ending().complete(unlisted ? WORKLOG_COMMENTS.BAR_FINISH_CONFIRMED : WORKLOG_COMMENTS.BAR_FINISH, true);
        return this.report('FINISH_SESSION', key);
      }
      case 'PREVIOUS':
      case 'RECENT': {
        // The engine's listeners close the menu as the task starts (above),
        // and the release hands the display to the session just started.
        const task = entry.task!;
        this._engine.startTask(task.id, false, task.title);
        if (this._menu) this.closeMenu();
        return this.report(entry.action === 'PREVIOUS' ? 'START_PREVIOUS' : 'START_RECENT', key);
      }
      case 'OPEN_APP':
        this.closeMenu();
        this._menuDeps.openApp?.();
        return this.report('OPEN_APP', key);
    }
  }

  private drawMenu(): void {
    const menu = this._menu;
    if (!menu) return;
    const entry = menu.entries[menu.index];
    this._renderer?.renderBarMenu({
      icon: entry.icon,
      label: entry.label,
      detail: entry.detail,
      position: { index: menu.index, count: menu.entries.length },
      ...(menu.confirm ? { confirm: menu.confirm } : {})
    });
  }

  /** Lets go of the display, which hands it back to the mode: one render, the engine's. */
  private closeMenu(): void {
    const menu = this._menu;
    if (!menu) return;
    clearTimeout(menu.idle);
    this._menu = null;
    this._priorityEngine?.releaseActiveLock(BAR_MENU_EVENT);
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
