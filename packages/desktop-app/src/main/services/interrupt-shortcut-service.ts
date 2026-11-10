import { ActiveSessionDTO, ArgumentException, ArgumentNullException, InterruptShortcutStatusDTO } from '../../shared/dtos';
import {
  chordProblem,
  DEFAULT_INTERRUPT_SHORTCUT,
  INTERRUPT_SHORTCUT_KEY,
  InterruptShortcutSetting
} from '../../shared/interrupt-shortcut';
import { ToastPresenter } from './toast-presenter';

/** The slice of Electron's `globalShortcut` this uses, so a test registers nothing. */
export interface ShortcutRegistry {
  /** False when another app holds the chord. */
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface InterruptShortcutDeps {
  shortcuts: ShortcutRegistry;
  settings: {
    getSetting<T>(key: string, defaultValue: T): T;
    setSetting<T>(key: string, value: T): void;
  };
  /** `ContextScheduleService.interrupt`: every surface's one rule. */
  interrupt: () => ActiveSessionDTO;
  getCurrentSession: () => ActiveSessionDTO | null;
  /**
   * Whether the press shows anywhere without a toast: the window on screen,
   * the mini timer open, or a bar connected.
   */
  isSeen: () => boolean;
  toasts: ToastPresenter;
}

/**
 * Interrupt from anywhere in Windows, on a chord the user records.
 *
 * Off until the user turns it on (the user's choice, 2026-11-06): a global
 * shortcut takes its chord from every other app. The press is pressed in
 * another app by definition, so with the window hidden and no bar it would
 * change the timer with nothing showing it -- then it is told by a toast,
 * through the app's own toasts, which the notification listener never
 * mirrors to the bar (CLAUDE.md §5).
 */
export class InterruptShortcutService {
  /** The chord registered with Windows now, if any. */
  private _registered: string | null = null;
  private _taken = false;
  private _suspended = false;

  constructor(private readonly deps: InterruptShortcutDeps) {
    if (!deps) throw new ArgumentNullException('deps');
  }

  /** Registers the stored chord when it is on. */
  public start(): void {
    this.apply();
  }

  public getStatus(): InterruptShortcutStatusDTO {
    const setting = this.setting();
    return {
      enabled: setting.enabled,
      accelerator: setting.accelerator,
      registered: this._registered !== null,
      problem: this._taken ? 'taken' : null
    };
  }

  /**
   * Stores the user's choice and registers it, answering what Windows said.
   * A chord another app holds is still stored as on -- it is what the user
   * chose, and the next start tries it again -- but reads `taken`.
   */
  public set(setting: InterruptShortcutSetting): InterruptShortcutStatusDTO {
    if (!setting) throw new ArgumentNullException('setting');
    if (typeof setting.enabled !== 'boolean') throw new ArgumentException('The shortcut is on or off.', 'enabled');
    if (typeof setting.accelerator !== 'string') throw new ArgumentException('The shortcut is a chord.', 'accelerator');
    const problem = chordProblem(setting.accelerator);
    if (problem) throw new ArgumentException(problem, 'accelerator');

    this.deps.settings.setSetting(INTERRUPT_SHORTCUT_KEY, { enabled: setting.enabled, accelerator: setting.accelerator });
    this.apply();
    return this.getStatus();
  }

  /**
   * Lets go of the chord while the window records a new one: registered,
   * Windows would hand the press to this service and never to the window,
   * and recording the same chord again would start an interruption.
   */
  public setRecording(recording: boolean): InterruptShortcutStatusDTO {
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

  private setting(): InterruptShortcutSetting {
    const stored = this.deps.settings.getSetting<Partial<InterruptShortcutSetting> | null>(INTERRUPT_SHORTCUT_KEY, null);
    // A stored chord that no longer passes is the default rather than a
    // registration that throws at every start.
    const accelerator = typeof stored?.accelerator === 'string' && chordProblem(stored.accelerator) === null
      ? stored.accelerator
      : DEFAULT_INTERRUPT_SHORTCUT.accelerator;
    return { enabled: stored?.enabled === true, accelerator };
  }

  private apply(): void {
    this.release();
    const setting = this.setting();
    if (!setting.enabled || this._suspended) return;
    let registered: boolean;
    try {
      registered = this.deps.shortcuts.register(setting.accelerator, () => this.onPress());
    } catch (err) {
      // Electron throws on a chord it cannot parse; `chordProblem` has let
      // through one it does not know. Read as not registered, and said so.
      console.warn(`[InterruptShortcut] Electron refused ${setting.accelerator}:`, err);
      registered = false;
    }
    if (registered) {
      this._registered = setting.accelerator;
    } else {
      this._taken = true;
      console.warn(`[InterruptShortcut] ${setting.accelerator} is held by another app; the shortcut is not active.`);
    }
  }

  private release(): void {
    this._taken = false;
    if (this._registered === null) return;
    this.deps.shortcuts.unregister(this._registered);
    this._registered = null;
  }

  private onPress(): void {
    const before = this.deps.getCurrentSession();
    let failure: string | null = null;
    try {
      this.deps.interrupt();
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
      console.warn('[InterruptShortcut] The interruption did not start:', err);
    }
    if (this.deps.isSeen()) return;
    this.deps.toasts.show(failure
      ? { title: 'No interruption started', body: failure }
      : {
          title: before?.interruption ? 'Another interruption started' : 'Interruption started',
          body: InterruptShortcutService.describeHeld(before)
        });
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
