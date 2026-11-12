import type { TimeTrackingEngine } from '../engine/time-tracking-engine';
import type { DisplayRenderer } from '../hardware/display-renderer';
import type { InputDecoder } from '../hardware/input-decoder';
import type { PriorityPreemptionEngine } from './priority-preemption-engine';
import type { ContextScheduleService } from './context-schedule-service';
import { plainSessionEnding, SessionEnding } from './session-commands';
import type { DeckIconMotions } from './deck-icon-motion';
import { ArgumentNullException, ActiveSessionDTO, ScreenIconDTO, TaskDTO } from '../../shared/dtos';
import {
  DECK_MAX_RECENT,
  DECK_PROTOCOL_VERSION,
  DeckErrorCode,
  DeckIcon,
  DeckPrompt,
  DeckRequest,
  DeckResultMessage,
  DeckSession,
  DeckState,
  DeckStateMessage,
  DeckTask,
  deckElapsedSeconds
} from '../../shared/deck-protocol';
import { finishNeedsConfirmation } from '../../shared/task-left';
import { EOD_WRAP_UP_EVENT, RESUME_PROMPT_EVENT, STANDUP_PROMPT_EVENT } from '../../shared/priority-defaults';

/**
 * How often the state is read again while a deck is connected. Most changes
 * arrive as events -- the session, the bar's icon -- but a prompt
 * taking or leaving the display has none of its own, so this bounds how long
 * the prompt key can lag the bar. One read a second, the engine's own tick.
 */
export const DECK_STATE_REFRESH_MS = 1000;

/**
 * How far the plugin's own count may drift from the session before the state
 * is pushed again. Pushed on every second instead, the deck would hear the
 * engine's tick: the traffic its own clock exists to avoid. A jump past this
 * -- a forgotten session paused at the user's last activity, the clock set
 * back -- is a change worth telling.
 */
export const DECK_ELAPSED_DRIFT_SECONDS = 2;

export interface DeckActionServiceDeps {
  engine: Pick<
    TimeTrackingEngine,
    | 'getCurrentSession' | 'subscribe' | 'pauseSession' | 'resumeSession' | 'stopSession' | 'discardSession'
    | 'backFromInterruption' | 'getPreviousTask' | 'startTask' | 'getToPlaceSummary'
  >;
  renderer: Pick<DisplayRenderer, 'getScreenIcon' | 'onScreenIconChanged' | 'renderTaskCompletionConfetti' | 'renderTaskLogged'>;
  priorityEngine: Pick<PriorityPreemptionEngine, 'getActiveLockEventName'>;
  inputDecoder: Pick<InputDecoder, 'handleHardwareInput' | 'getEodConfirmStep'>;
  /** Brings the window forward with its task picker open; false when there is no window. */
  openPicker: () => boolean;
  /**
   * Starts an interruption, as the window's button does:
   * `ContextScheduleService.interrupt`, which sets the task aside to ask
   * about. A key with its own copy of that rule would drift (CLAUDE.md §3).
   */
  interrupt: () => void;
  /**
   * The schedule's questions and the stand-up, as the window reads them.
   * Without it the deck knows of no stand-up running and no lunch question.
   */
  schedule?: Pick<ContextScheduleService, 'standupRunning' | 'getResumePrompt' | 'getCeremonyPrompt' | 'answerLunchQuestion'>;
  /** Whether now is in the user's working hours, as the tray reads it; never, without it. */
  isWorkingNow?: () => boolean;
  /** The picker's recent tasks, newest first: what Recent 1-3 start. None, without it. */
  recentTasks?: (limit: number) => TaskDTO[];
  /**
   * The bar's icons in motion, so the Session key moves as the bar does.
   * Without it every icon is sent still.
   */
  iconMotions?: Pick<DeckIconMotions, 'get' | 'onLoaded'>;
  /**
   * How Stop, Done and Discard end the session: main passes the window's,
   * with Undo, so a key ends it as a click does. Without it, at once.
   */
  sessionEnding?: SessionEnding;
  now?: () => Date;
}

class DeckRefusal extends Error {
  constructor(public readonly code: DeckErrorCode, message: string) {
    super(message);
    this.name = 'DeckRefusal';
  }
}

/**
 * What a Stream Deck key does, and what the keys show.
 *
 * Every action calls what the window, the mini timer or the bar already
 * calls, so a key cannot follow rules of its own: ending a session is
 * `completeSession`, as the window's Stop; a prompt is answered by OK or
 * BACK through InputDecoder, as the bar's keys -- the wrap-up's two presses,
 * the stand-up's switch and the resume question stay where they are.
 *
 * It never draws on the bar itself. The scenes LOGGED and DONE! are the
 * window's too, and a deck key does what a click does.
 */
export class DeckActionService {
  private readonly _deps: DeckActionServiceDeps;
  private readonly _now: () => Date;
  private readonly _ending: SessionEnding;
  private readonly _listeners = new Set<(message: DeckStateMessage) => void>();
  private _unsubscribers: Array<() => void> = [];
  private _timer?: NodeJS.Timeout;
  private _last: { signature: string; message: DeckStateMessage } | null = null;

  constructor(deps: DeckActionServiceDeps) {
    if (!deps) throw new ArgumentNullException('deps');
    for (const name of ['engine', 'renderer', 'priorityEngine', 'inputDecoder', 'openPicker', 'interrupt'] as const) {
      if (!deps[name]) throw new ArgumentNullException(name);
    }
    this._deps = deps;
    this._now = deps.now ?? (() => new Date());
    this._ending = deps.sessionEnding ?? plainSessionEnding(deps.engine, deps.renderer);
  }

  /** The state the keys show, read now. */
  public getState(): DeckState {
    const { engine, renderer } = this._deps;
    const session = engine.getCurrentSession();
    return {
      session: DeckActionService.toDeckSession(session),
      icon: this.toDeckIcon(renderer.getScreenIcon()),
      prompt: this.currentPrompt(),
      ...this.readProtocol2(session)
    };
  }

  /** What protocol 2 adds to the state: what the keys beyond the session's ends show. */
  private readProtocol2(session: ActiveSessionDTO | null): Required<Pick<
    DeckState, 'toPlace' | 'previousTask' | 'recent' | 'standupRunning' | 'nothingTimingInHours'
  >> {
    const { engine, schedule } = this._deps;
    const open = session && session.status !== 'COMPLETED' ? session : null;
    const previous = open?.interruption ? null : engine.getPreviousTask();
    // One more than shown: the task open now is never offered to start again.
    const recent = (this._deps.recentTasks?.(DECK_MAX_RECENT + 1) ?? [])
      .filter(task => task.id !== open?.taskId)
      .slice(0, DECK_MAX_RECENT)
      .map(DeckActionService.toDeckTask);
    return {
      toPlace: engine.getToPlaceSummary().count,
      previousTask: previous ? DeckActionService.toDeckTask(previous) : null,
      recent,
      standupRunning: schedule?.standupRunning() ?? null,
      nothingTimingInHours: !open && (this._deps.isWorkingNow?.() ?? false)
    };
  }

  /** The state as a message, stamped with when its time was read. */
  public getStateMessage(): DeckStateMessage {
    return { type: 'state', state: this.getState(), at: this._now().toISOString() };
  }

  /**
   * Hears the state each time it changes -- not each second the session
   * runs. Listening starts with the first listener and stops with the last,
   * so the app reads nothing for a deck that is not there.
   */
  public subscribe(listener: (message: DeckStateMessage) => void): () => void {
    if (!listener) throw new ArgumentNullException('listener');
    this._listeners.add(listener);
    if (this._listeners.size === 1) this.startListening();
    return () => {
      if (!this._listeners.delete(listener)) return;
      if (this._listeners.size === 0) this.stopListening();
    };
  }

  /**
   * Carries out one request. A refusal is an answer, never a throw: the
   * plugin shows it on the key that asked.
   */
  public perform(request: DeckRequest, protocol: number = DECK_PROTOCOL_VERSION): DeckResultMessage {
    if (!request) throw new ArgumentNullException('request');
    try {
      this.act(request, protocol);
      return { type: 'result', id: request.id, ok: true };
    } catch (err) {
      const code: DeckErrorCode = err instanceof DeckRefusal ? err.code : 'failed';
      const message = err instanceof Error ? err.message : String(err);
      if (code === 'failed') console.warn(`[Deck] ${request.action} failed:`, message);
      return { type: 'result', id: request.id, ok: false, error: code, message };
    } finally {
      // At once rather than at the next event: a prompt's step has none.
      this.refresh();
    }
  }

  public dispose(): void {
    this._listeners.clear();
    this.stopListening();
  }

  private act(request: DeckRequest, protocol: number): void {
    const { engine } = this._deps;
    const session = engine.getCurrentSession();
    switch (request.action) {
      case 'pause':
        if (session?.status !== 'TRACKING') throw new DeckRefusal('no-session', 'Nothing is running to pause.');
        engine.pauseSession();
        return;
      case 'resume':
        if (session?.status !== 'PAUSED') throw new DeckRefusal('no-session', 'Nothing is paused to resume.');
        engine.resumeSession();
        return;
      case 'stop':
        if (!session) throw new DeckRefusal('no-session', 'No session to stop.');
        this._ending.complete(undefined, false);
        return;
      case 'finish':
        if (!session) throw new DeckRefusal('no-session', 'No session to finish.');
        // DONE changes the task at the provider, so protocol 2 asks it
        // always (S29): a habit learned on BACK, the same key, must never
        // mark a ticket done. Protocol 1 asks only when the task is no
        // longer the user's, as plugin 0.5 expects -- it would read any
        // other refusal as NOT YOURS.
        if (!request.confirmed && (protocol >= DECK_PROTOCOL_VERSION || finishNeedsConfirmation(session))) {
          throw new DeckRefusal('needs-confirmation', finishNeedsConfirmation(session)
            ? 'The task is no longer yours: confirm to mark it done.'
            : 'Confirm to mark the task done.');
        }
        this._ending.complete(undefined, true);
        return;
      case 'discard':
        if (!session) throw new DeckRefusal('no-session', 'No session to discard.');
        // Always asked: nothing is kept, and a key is easy to brush.
        if (!request.confirmed) throw new DeckRefusal('needs-confirmation', 'Confirm to throw the session away.');
        this._ending.discard();
        return;
      case 'open-picker':
        if (!this._deps.openPicker()) throw new DeckRefusal('no-window', 'The SprintTicker window is not open.');
        return;
      case 'interrupt':
        // Whatever runs, or nothing: an interruption starts from any state.
        this._deps.interrupt();
        return;
      case 'prompt-yes':
      case 'prompt-no':
        this.answerPrompt(request.action === 'prompt-yes');
        return;
      case 'back': {
        const held = session?.interruption;
        if (!held) throw new DeckRefusal('no-session', 'No interruption to go back from.');
        if (!held.interruptedSessionId) throw new DeckRefusal('no-task', 'The interruption holds no task to go back to.');
        engine.backFromInterruption();
        return;
      }
      case 'another':
        if (!session?.interruption) throw new DeckRefusal('no-session', 'No interruption running to follow.');
        // Interrupt during an interruption is Another, decided where it starts.
        this._deps.interrupt();
        return;
      case 'previous': {
        // Going back is A during an interruption, never Previous (S29).
        if (session?.interruption) throw new DeckRefusal('no-task', 'During an interruption, Back goes to the task.');
        const previous = engine.getPreviousTask();
        if (!previous) throw new DeckRefusal('no-task', 'No task was timed before this one.');
        engine.startTask(previous.id, false, previous.title);
        return;
      }
      case 'start-recent': {
        const task = this.readProtocol2(session).recent[(request.index ?? 0) - 1];
        if (!task) throw new DeckRefusal('no-task', `No recent task ${String(request.index)}.`);
        engine.startTask(task.taskId, false, task.taskTitle);
        return;
      }
      case 'end-standup':
        if (!this._deps.schedule?.standupRunning()) throw new DeckRefusal('no-session', 'No stand-up is running.');
        // As the mini timer's End stand-up: its session's Stop, which brings
        // back the task it set aside.
        this._ending.complete(undefined, false);
        return;
      default:
        throw new DeckRefusal('invalid-request', `Unknown deck action: ${String(request.action)}.`);
    }
  }

  /**
   * OK or BACK on the bar, while a prompt holds it: InputDecoder decides
   * what that means. Lunch's question is the window's, answered as there.
   */
  private answerPrompt(yes: boolean): void {
    const prompt = this.currentPrompt();
    if (!prompt) throw new DeckRefusal('no-prompt', 'Nothing is waiting for an answer.');
    if (prompt === 'lunch') {
      if (!this._deps.schedule?.answerLunchQuestion(yes)) throw new DeckRefusal('no-prompt', 'Lunch was answered already.');
      return;
    }
    this._deps.inputDecoder.handleHardwareInput({
      key: yes ? 'ok' : 'back',
      type: 'press',
      timestamp: this._now().toISOString()
    });
  }

  private currentPrompt(): DeckPrompt | null {
    const lock = this._deps.priorityEngine.getActiveLockEventName();
    if (lock === EOD_WRAP_UP_EVENT) return this._deps.inputDecoder.getEodConfirmStep() === 1 ? 'wrap-up-confirm' : 'wrap-up';
    if (lock === STANDUP_PROMPT_EVENT) return 'standup';
    const schedule = this._deps.schedule;
    if (lock === RESUME_PROMPT_EVENT) return schedule?.getResumePrompt()?.after === 'interruption' ? 'back' : 'resume';
    if (schedule?.getCeremonyPrompt()?.type === 'LUNCH') return 'lunch';
    return null;
  }

  private startListening(): void {
    const { engine, renderer } = this._deps;
    const refresh = () => this.refresh();
    this._unsubscribers = [engine.subscribe(refresh), renderer.onScreenIconChanged(refresh)];
    // A motion read for the first time arrives after the icon it belongs to.
    if (this._deps.iconMotions) this._unsubscribers.push(this._deps.iconMotions.onLoaded(refresh));
    this._timer = setInterval(refresh, DECK_STATE_REFRESH_MS);
    // A deck must never keep the app open at quit.
    this._timer.unref?.();
    this._last = null;
    this.refresh();
  }

  private stopListening(): void {
    for (const unsubscribe of this._unsubscribers) unsubscribe();
    this._unsubscribers = [];
    if (this._timer) clearInterval(this._timer);
    this._timer = undefined;
    this._last = null;
  }

  /** Pushes the state if it differs from the last one pushed, the time aside unless it drifted. */
  private refresh(): void {
    if (this._listeners.size === 0) return;
    let message: DeckStateMessage;
    try {
      message = this.getStateMessage();
    } catch (err) {
      // The database closing under a quit, most likely: the next read tries again.
      console.warn('[Deck] Could not read the state:', err);
      return;
    }
    const signature = DeckActionService.signatureOf(message.state);
    const last = this._last;
    if (last && last.signature === signature) {
      const expected = deckElapsedSeconds(last.message, this._now());
      const actual = message.state.session?.elapsedSeconds ?? 0;
      if (Math.abs(expected - actual) <= DECK_ELAPSED_DRIFT_SECONDS) return;
    }
    this._last = { signature, message };
    for (const listener of this._listeners) {
      try {
        listener(message);
      } catch (err) {
        console.error('[Deck] Error in a state listener:', err);
      }
    }
  }

  /**
   * The icon as the deck gets it: the name of its `.anim` stays here, and
   * its motion goes instead, once read.
   */
  private toDeckIcon(icon: ScreenIconDTO | null): DeckIcon | null {
    if (!icon) return null;
    const motion = icon.animation ? this._deps.iconMotions?.get(icon.animation) ?? null : null;
    return { pixels: icon.pixels, label: icon.label, ...(motion ? { motion } : {}) };
  }

  private static signatureOf(state: DeckState): string {
    const session = state.session ? { ...state.session, elapsedSeconds: 0 } : null;
    // A motion is the same for the same icon: whether there is one is all
    // that can change, and the poses would be kilobytes to compare each second.
    const icon = state.icon ? { ...state.icon, motion: Boolean(state.icon.motion) } : null;
    return JSON.stringify({ ...state, session, icon });
  }

  private static toDeckTask(task: TaskDTO): DeckTask {
    return { taskId: task.id, taskKey: task.key, taskTitle: task.title };
  }

  private static toDeckSession(session: ActiveSessionDTO | null): DeckSession | null {
    if (!session || session.status === 'COMPLETED') return null;
    const running = session.interruption;
    return {
      taskId: session.taskId,
      taskKey: session.taskKey,
      taskTitle: session.taskTitle,
      isAdHoc: session.isAdHoc,
      status: session.status === 'TRACKING' ? 'tracking' : 'paused',
      elapsedSeconds: session.elapsedSeconds,
      finishNeedsConfirmation: finishNeedsConfirmation(session),
      ...(running
        ? { interruption: { title: running.title, backToKey: running.interruptedSessionId ? running.interruptedTaskKey ?? '' : null } }
        : {}),
      ...(session.taskOwnerName ? { ownerName: session.taskOwnerName } : {})
    };
  }
}
