import type { UndoStateDTO } from '../../shared/dtos';
import { undoCountdown } from '../../shared/words';
import type { ToastPresenter, ToastRequest } from '../services/toast-presenter';

/**
 * What a toast says about an action Undo can still take back (P12c, S26):
 * what was done, what it comes to -- the Undo bar's words, so a discard or
 * an interruption to place never reads as time going out -- and that a
 * click undoes it.
 */
export function describeUndoToast(state: Pick<UndoStateDTO, 'kind' | 'label' | 'outcome'>, seconds: number): ToastRequest {
  return { title: state.label, body: `${undoCountdown(state.outcome ?? 'sent', seconds)}. Click to undo.`, route: 'undo' };
}

export interface UndoToastDeps {
  /** UndoService's `onChanged`: every offer, undo and end of the window. */
  onUndoChanged: (listener: (state: UndoStateDTO | null) => void) => () => void;
  /** True while the dashboard is on screen, where the Undo bar already says it. */
  isDashboardOnScreen: () => boolean;
  toasts: ToastPresenter;
  /** The undo window, in whole seconds, for the toast's words. */
  seconds: number;
}

/**
 * Says an action can be undone when the window is not there to say it
 * (P12c): a Stop from the tray, the deck or the bar with the dashboard
 * hidden left ten seconds to take it back and nothing on screen saying so.
 * The toast's click opens the window on the Undo bar. Nothing when the
 * dashboard is on screen: its Undo bar is the same offer, said once.
 */
export class UndoToasts {
  private _lastOffer: string | null = null;
  private _off: (() => void) | null = null;

  constructor(private readonly deps: UndoToastDeps) {}

  public start(): void {
    if (this._off) return;
    this._off = this.deps.onUndoChanged(state => this.onChanged(state));
  }

  public stop(): void {
    this._off?.();
    this._off = null;
  }

  private onChanged(state: UndoStateDTO | null): void {
    // onChanged also fires on an undo and at the window's end; only a new
    // offer is news. An offer is told by its expiry, which no two share.
    if (!state) return;
    const offer = `${state.kind}:${state.expiresAtUtc}:${state.label}`;
    if (offer === this._lastOffer) return;
    this._lastOffer = offer;
    if (this.deps.isDashboardOnScreen()) return;
    this.deps.toasts.show(describeUndoToast(state, this.deps.seconds));
  }
}
