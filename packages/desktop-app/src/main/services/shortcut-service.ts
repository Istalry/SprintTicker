import { ActiveSessionDTO, ArgumentException, ArgumentNullException, ShortcutsStatusDTO, ShortcutStatusDTO } from '../../shared/dtos';
import { chordProblem, INTERRUPT_SHORTCUT_KEY } from '../../shared/interrupt-shortcut';
import {
  FlowSettingKey,
  readShortcuts,
  SHORTCUT_ACTIONS,
  ShortcutAction,
  ShortcutChord,
  ShortcutsSetting
} from '../../shared/flow-settings';
import { ToastPresenter, ToastRequest } from './toast-presenter';

/** The slice of Electron's `globalShortcut` this uses, so a test registers nothing. */
export interface ShortcutRegistry {
  /** False when another app holds the chord. */
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

/**
 * What each chord does, through the commands every other surface uses --
 * the window, the tray, the deck -- so a chord holds no rule of its own.
 */
export interface ShortcutCommands {
  /** `ContextScheduleService.interrupt`: Another during an interruption. */
  interrupt: () => ActiveSessionDTO;
  /** Ends the interruption and resumes the task it holds. */
  back: () => ActiveSessionDTO | null;
  /** Opens the task picker, as its own window. */
  openPicker: () => void;
  /** Starts the task timed before this one; answers its key, or null when there is none. */
  previous: () => string | null;
}

export interface ShortcutServiceDeps {
  shortcuts: ShortcutRegistry;
  settings: {
    getSetting<T>(key: string, defaultValue: T): T;
    setSetting<T>(key: string, value: T): void;
  };
  commands: ShortcutCommands;
  getCurrentSession: () => ActiveSessionDTO | null;
  /**
   * Whether the press shows anywhere without a toast: the window on screen,
   * the mini timer open, or a bar connected.
   */
  isSeen: () => boolean;
  toasts: ToastPresenter;
}

const LOG = '[Shortcuts]';

/** The words a chord's name takes in a refusal: "already Switch's". */
const ACTION_NAMES: Record<ShortcutAction, string> = {
  interrupt: 'Interrupt',
  switch: 'Switch task',
  previous: 'Previous task',
  back: 'Back'
};

/**
 * The global shortcuts (redesign P12e): Interrupt, Switch, Previous and
 * Back, each on a chord the user may record, from the `shortcuts` setting.
 *
 * On by default (the redesign's decision, 2026-11-09, over the Interrupt
 * chord's earlier off): a chord another app holds is never forced, and
 * reads `taken`. Each press is in another app by definition, so with the
 * window hidden and no bar it would change the timer with nothing showing
 * it -- then a toast says what happened, through the app's own toasts,
 * which the notification listener never mirrors to the bar (CLAUDE.md §5).
 *
 * - **Interrupt** during an interruption is Another (the schedule's rule).
 * - **Back** does nothing outside an interruption holding a task.
 * - **Switch** opens the picker window.
 * - **Previous** switches to the task timed before; nothing during an
 *   interruption, as the tray's.
 */
export class ShortcutService {
  /** The chord each action holds with Windows now. */
  private readonly _registered = new Map<ShortcutAction, string>();
  private readonly _taken = new Set<ShortcutAction>();
  private _suspended = false;

  constructor(private readonly deps: ShortcutServiceDeps) {
    if (!deps) throw new ArgumentNullException('deps');
    if (!deps.commands) throw new ArgumentNullException('deps.commands');
  }

  /** Takes over the Interrupt chord's old setting once, then registers every chord that is on. */
  public start(): void {
    this.adoptInterruptShortcut();
    this.apply();
  }

  public getStatus(): ShortcutsStatusDTO {
    const setting = this.setting();
    const status = (action: ShortcutAction): ShortcutStatusDTO => ({
      enabled: setting[action].enabled,
      accelerator: setting[action].accelerator,
      registered: this._registered.has(action),
      problem: this._taken.has(action) ? 'taken' : null
    });
    return { interrupt: status('interrupt'), switch: status('switch'), previous: status('previous'), back: status('back') };
  }

  /**
   * Stores one chord and registers them all, answering what Windows said.
   * A chord another app holds is still stored as on -- it is what the user
   * chose, and the next start tries it again -- but reads `taken`. A chord
   * another action of this app holds is refused: one press, one action.
   */
  public set(action: ShortcutAction, chord: ShortcutChord): ShortcutsStatusDTO {
    if (!SHORTCUT_ACTIONS.includes(action)) throw new ArgumentException(`Not a shortcut: ${String(action)}.`, 'action');
    if (!chord) throw new ArgumentNullException('chord');
    if (typeof chord.enabled !== 'boolean') throw new ArgumentException('The shortcut is on or off.', 'enabled');
    if (typeof chord.accelerator !== 'string') throw new ArgumentException('The shortcut is a chord.', 'accelerator');
    const problem = chordProblem(chord.accelerator);
    if (problem) throw new ArgumentException(problem, 'accelerator');

    const setting = this.setting();
    const owner = SHORTCUT_ACTIONS.find(other => other !== action && setting[other].accelerator === chord.accelerator);
    if (owner) throw new ArgumentException(`That shortcut is already ${ACTION_NAMES[owner]}'s.`, 'accelerator');

    const next: ShortcutsSetting = { ...setting, [action]: { enabled: chord.enabled, accelerator: chord.accelerator } };
    this.deps.settings.setSetting(FlowSettingKey.SHORTCUTS, next);
    this.apply();
    return this.getStatus();
  }

  /**
   * Lets go of every chord while the window records a new one: registered,
   * Windows would hand the press to this service and never to the window,
   * and recording a chord already in use would run its action.
   */
  public setRecording(recording: boolean): ShortcutsStatusDTO {
    if (typeof recording !== 'boolean') throw new ArgumentException('Recording is on or off.', 'recording');
    this._suspended = recording;
    this.apply();
    return this.getStatus();
  }

  /** At quit, synchronously: `will-quit` handlers are not awaited. */
  public dispose(): void {
    this._suspended = true;
    this.release();
  }

  private setting(): ShortcutsSetting {
    return readShortcuts(this.deps.settings.getSetting<unknown>(FlowSettingKey.SHORTCUTS, null));
  }

  /**
   * The Interrupt chord the app offered before P12e, under its own key and
   * off by default. A choice the user made there -- on, off, another chord
   * -- carries over, once; with nothing stored there, the new defaults hold.
   */
  private adoptInterruptShortcut(): void {
    const legacy = this.deps.settings.getSetting<{ enabled?: unknown; accelerator?: unknown } | null>(INTERRUPT_SHORTCUT_KEY, null);
    if (legacy === null) return;
    const stored = this.deps.settings.getSetting<unknown>(FlowSettingKey.SHORTCUTS, null);
    if (stored === null && typeof legacy === 'object') {
      const setting = this.setting();
      const accelerator = typeof legacy.accelerator === 'string' && chordProblem(legacy.accelerator) === null
        ? legacy.accelerator
        : setting.interrupt.accelerator;
      const clash = SHORTCUT_ACTIONS.some(other => other !== 'interrupt' && setting[other].accelerator === accelerator);
      this.deps.settings.setSetting(FlowSettingKey.SHORTCUTS, {
        ...setting,
        interrupt: {
          enabled: typeof legacy.enabled === 'boolean' ? legacy.enabled : setting.interrupt.enabled,
          accelerator: clash ? setting.interrupt.accelerator : accelerator
        }
      });
    }
    this.deps.settings.setSetting(INTERRUPT_SHORTCUT_KEY, null);
  }

  private apply(): void {
    this.release();
    if (this._suspended) return;
    const setting = this.setting();
    for (const action of SHORTCUT_ACTIONS) {
      const { enabled, accelerator } = setting[action];
      if (!enabled) continue;
      let registered: boolean;
      try {
        registered = this.deps.shortcuts.register(accelerator, () => this.onPress(action));
      } catch (err) {
        // Electron throws on a chord it cannot parse; `chordProblem` has let
        // through one it does not know. Read as not registered, and said so.
        console.warn(`${LOG} Electron refused ${accelerator}:`, err);
        registered = false;
      }
      if (registered) {
        this._registered.set(action, accelerator);
      } else {
        this._taken.add(action);
        console.warn(`${LOG} ${accelerator} is held by another app; ${ACTION_NAMES[action]} has no shortcut.`);
      }
    }
  }

  private release(): void {
    this._taken.clear();
    for (const accelerator of this._registered.values()) this.deps.shortcuts.unregister(accelerator);
    this._registered.clear();
  }

  private onPress(action: ShortcutAction): void {
    let toast: ToastRequest | null;
    try {
      toast = this.run(action);
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      console.warn(`${LOG} ${ACTION_NAMES[action]} failed:`, err);
      toast = { title: ShortcutService.failureTitle(action), body: why, route: 'today' };
    }
    if (!toast || this.deps.isSeen()) return;
    this.deps.toasts.show(toast);
  }

  /** Runs the action; answers what a toast says of it while nothing shows it, or null. */
  private run(action: ShortcutAction): ToastRequest | null {
    const before = this.deps.getCurrentSession();
    switch (action) {
      case 'interrupt':
        this.deps.commands.interrupt();
        return {
          title: before?.interruption ? 'Another interruption started' : 'Interruption started',
          body: ShortcutService.describeHeld(before),
          route: 'today'
        };
      case 'back': {
        const held = before?.interruption?.interruptedSessionId ? before.interruption.interruptedTaskKey : null;
        if (!held) return null;
        this.deps.commands.back();
        return { title: `Back on ${held}`, body: 'The interruption waits on Today to be placed.', route: 'today' };
      }
      case 'switch':
        // The picker is a window of its own, and shows itself.
        this.deps.commands.openPicker();
        return null;
      case 'previous': {
        if (before?.interruption) return null;
        const key = this.deps.commands.previous();
        return key ? { title: `Back on ${key}`, body: 'The task timed before this one.', route: 'today' } : null;
      }
    }
  }

  private static failureTitle(action: ShortcutAction): string {
    switch (action) {
      case 'interrupt': return 'No interruption started';
      case 'back': return 'Not back on the task';
      case 'switch': return 'The task picker did not open';
      case 'previous': return 'The previous task did not start';
    }
  }

  /**
   * What the interruption holds (P6): the task waits, paused, and nothing
   * is logged until the interruption is placed.
   */
  private static describeHeld(before: ActiveSessionDTO | null): string {
    const later = 'Place it on a task when it ends.';
    if (!before) return later;
    if (before.interruption) {
      const held = before.interruption.interruptedTaskKey;
      return held ? `${held} still waits, paused. ${later}` : later;
    }
    const name = before.isAdHoc ? before.taskTitle : before.taskKey;
    return before.status === 'TRACKING' ? `${name} is paused until you are back. ${later}` : `${name} stays paused. ${later}`;
  }
}
