import type { TimeTrackingEngine } from '../engine/time-tracking-engine';
import type { DisplayRenderer } from '../hardware/display-renderer';
import type { InputDecoder } from '../hardware/input-decoder';
import type { TaskRepository } from '../db/repositories/task-repository';
import type { PriorityPreemptionEngine } from './priority-preemption-engine';
import type { ContextScheduleService } from './context-schedule-service';
import { completeSession } from './session-commands';
import { ArgumentNullException, ActiveSessionDTO } from '../../shared/dtos';
import {
  DeckErrorCode,
  DeckPrompt,
  DeckRequest,
  DeckResultMessage,
  DeckSession,
  DeckState,
  DeckStateMessage,
  DeckTask,
  DeckTasksMessage,
  deckElapsedSeconds
} from '../../shared/deck-protocol';
import { finishNeedsConfirmation } from '../../shared/task-left';
import { EOD_WRAP_UP_EVENT, RESUME_PROMPT_EVENT, STANDUP_PROMPT_EVENT } from '../../shared/priority-defaults';
import { SettingsReader, readTaskVisibility, visibleTasks } from '../../shared/task-visibility';
import { orderTasksForSelection } from '../../shared/task-order';

/**
 * How often the state is read again while a deck is connected. Most changes
 * arrive as events -- the session, the bar's icon, the mode -- but a prompt
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
    'getCurrentSession' | 'subscribe' | 'pauseSession' | 'resumeSession' | 'stopSession' | 'discardSession' | 'startTask' | 'getProjects' | 'getTasksForProject'
  >;
  renderer: Pick<DisplayRenderer, 'getScreenIcon' | 'onScreenIconChanged' | 'renderTaskCompletionConfetti' | 'renderTaskLogged'>;
  priorityEngine: Pick<PriorityPreemptionEngine, 'getActiveLockEventName' | 'getUserMode' | 'onUserModeChanged'>;
  schedule: Pick<ContextScheduleService, 'enterAwayMode' | 'exitAwayMode'>;
  inputDecoder: Pick<InputDecoder, 'handleHardwareInput' | 'getEodConfirmStep'>;
  taskRepo: Pick<TaskRepository, 'getTaskById' | 'isArchived'>;
  settings: SettingsReader;
  /** Brings the window forward with its task picker open; false when there is no window. */
  openPicker: () => boolean;
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
  private readonly _listeners = new Set<(message: DeckStateMessage) => void>();
  private _unsubscribers: Array<() => void> = [];
  private _timer?: NodeJS.Timeout;
  private _last: { signature: string; message: DeckStateMessage } | null = null;

  constructor(deps: DeckActionServiceDeps) {
    if (!deps) throw new ArgumentNullException('deps');
    for (const name of ['engine', 'renderer', 'priorityEngine', 'schedule', 'inputDecoder', 'taskRepo', 'settings', 'openPicker'] as const) {
      if (!deps[name]) throw new ArgumentNullException(name);
    }
    this._deps = deps;
    this._now = deps.now ?? (() => new Date());
  }

  /** The state the keys show, read now. */
  public getState(): DeckState {
    const { engine, renderer, priorityEngine } = this._deps;
    return {
      session: DeckActionService.toDeckSession(engine.getCurrentSession()),
      icon: renderer.getScreenIcon(),
      prompt: this.currentPrompt(),
      mode: priorityEngine.getUserMode()
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
  public perform(request: DeckRequest): DeckResultMessage | DeckTasksMessage {
    if (!request) throw new ArgumentNullException('request');
    try {
      if (request.action === 'list-tasks') {
        return { type: 'tasks', id: request.id, tasks: this.listTasks() };
      }
      this.act(request);
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

  private act(request: DeckRequest): void {
    const { engine, renderer, schedule, priorityEngine } = this._deps;
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
        completeSession(engine, renderer, undefined, false);
        return;
      case 'finish':
        if (!session) throw new DeckRefusal('no-session', 'No session to finish.');
        // Asked on the deck as in the window and on the bar: the completion
        // transition would move a task that is no longer the user's.
        if (finishNeedsConfirmation(session) && !request.confirmed) {
          throw new DeckRefusal('needs-confirmation', 'The task is no longer yours: confirm to mark it done.');
        }
        completeSession(engine, renderer, undefined, true);
        return;
      case 'discard':
        if (!session) throw new DeckRefusal('no-session', 'No session to discard.');
        // Always asked: nothing is kept, and a key is easy to brush.
        if (!request.confirmed) throw new DeckRefusal('needs-confirmation', 'Confirm to throw the session away.');
        engine.discardSession();
        return;
      case 'start':
        this.start(request.taskId!, session);
        return;
      case 'open-picker':
        if (!this._deps.openPicker()) throw new DeckRefusal('no-window', 'The SprintTicker window is not open.');
        return;
      case 'prompt-yes':
      case 'prompt-no':
        this.answerPrompt(request.action === 'prompt-yes');
        return;
      case 'toggle-away':
        // exitAwayMode, not the window's switch to WORK: unlocked during the
        // lunch hour it goes straight to LUNCH (CLAUDE.md §5).
        if (priorityEngine.getUserMode() === 'AWAY') schedule.exitAwayMode();
        else schedule.enterAwayMode();
        return;
      default:
        throw new DeckRefusal('invalid-request', `Unknown deck action: ${String(request.action)}.`);
    }
  }

  /**
   * A favourite key. Its task is the user's choice, as a pick in the window
   * is, so nothing is asked; but one no list shows any more -- gone, or
   * archived -- is refused rather than started under an id nobody can name.
   * Pressed on the task already running, it changes nothing: switching to it
   * would log a worklog of a few seconds and start another.
   */
  private start(taskId: string, session: ActiveSessionDTO | null): void {
    const { engine, taskRepo } = this._deps;
    const task = taskRepo.getTaskById(taskId);
    if (!task || taskRepo.isArchived(taskId)) {
      throw new DeckRefusal('unknown-task', 'That task is in no list any more: choose another for this key.');
    }
    if (session?.taskId === taskId) {
      if (session.status === 'PAUSED') engine.resumeSession();
      return;
    }
    engine.startTask(task.id);
  }

  /** OK or BACK on the bar, while a prompt holds it: InputDecoder decides what that means. */
  private answerPrompt(yes: boolean): void {
    if (!this.currentPrompt()) throw new DeckRefusal('no-prompt', 'Nothing is waiting for an answer.');
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
    if (lock === RESUME_PROMPT_EVENT) return 'resume';
    return null;
  }

  /** The tasks a favourite can be set to: every list's, filtered and ordered as the window's. */
  private listTasks(): DeckTask[] {
    const { engine, settings } = this._deps;
    const visibility = readTaskVisibility(settings);
    const tasks: DeckTask[] = [];
    for (const project of engine.getProjects()) {
      const shown = orderTasksForSelection(visibleTasks(engine.getTasksForProject(project.id), visibility).visible);
      for (const task of shown) {
        tasks.push({ id: task.id, key: task.key, title: task.title, projectName: project.name });
      }
    }
    return tasks;
  }

  private startListening(): void {
    const { engine, renderer, priorityEngine } = this._deps;
    const refresh = () => this.refresh();
    this._unsubscribers = [
      engine.subscribe(refresh),
      renderer.onScreenIconChanged(refresh),
      priorityEngine.onUserModeChanged(refresh)
    ];
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

  private static signatureOf(state: DeckState): string {
    const session = state.session ? { ...state.session, elapsedSeconds: 0 } : null;
    return JSON.stringify({ ...state, session });
  }

  private static toDeckSession(session: ActiveSessionDTO | null): DeckSession | null {
    if (!session || session.status === 'COMPLETED') return null;
    return {
      taskId: session.taskId,
      taskKey: session.taskKey,
      taskTitle: session.taskTitle,
      isAdHoc: session.isAdHoc,
      status: session.status === 'TRACKING' ? 'tracking' : 'paused',
      elapsedSeconds: session.elapsedSeconds,
      finishNeedsConfirmation: finishNeedsConfirmation(session)
    };
  }
}
