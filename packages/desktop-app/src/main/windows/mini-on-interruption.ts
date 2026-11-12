import type { ActiveSessionDTO } from '../../shared/dtos';
import type { InterruptionSource } from '../../shared/interruption';

/**
 * Where an interruption starts with nothing on screen to name it: the bar,
 * the Stream Deck and the global shortcut. The window, the mini timer and
 * the tray are on screen already, or open the window themselves.
 */
export const OFF_SCREEN_SOURCES: readonly InterruptionSource[] = ['bar', 'deck', 'shortcut'];

export interface MiniOnInterruptionDeps {
  /** The engine's session notifications. */
  subscribe: (listener: (session: ActiveSessionDTO | null) => void) => () => void;
  /** True while the dashboard is on screen: its session card has the name field. */
  isDashboardOnScreen: () => boolean;
  /** Opens the mini timer without taking the focus. */
  openMini: () => void;
}

/**
 * Puts the mini timer on screen when an interruption starts from the bar,
 * the deck or the shortcut (P12d, S25): its name field and "started now ▾"
 * are there to fill in, or to leave for later. It never takes the focus --
 * the user may be typing elsewhere, and the name can wait. Once per
 * interruption: closed by the user, it stays closed.
 */
export class MiniOnInterruption {
  private _lastInterruptionId: string | null = null;
  private _off: (() => void) | null = null;

  constructor(private readonly deps: MiniOnInterruptionDeps) {}

  public start(): void {
    if (this._off) return;
    this._off = this.deps.subscribe(session => this.onSession(session));
  }

  public stop(): void {
    this._off?.();
    this._off = null;
  }

  private onSession(session: ActiveSessionDTO | null): void {
    const interruption = session?.interruption;
    if (!interruption || interruption.id === this._lastInterruptionId) return;
    this._lastInterruptionId = interruption.id;
    if (!OFF_SCREEN_SOURCES.includes(interruption.source)) return;
    if (this.deps.isDashboardOnScreen()) return;
    try {
      this.deps.openMini();
    } catch (err) {
      // The interruption runs either way; only the name field is not on screen.
      console.warn('[MiniOnInterruption] Could not open the mini timer:', err);
    }
  }
}
