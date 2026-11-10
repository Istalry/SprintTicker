import type { ActiveSessionDTO } from '../../shared/dtos';
import type { StartSideEffectsSetting } from '../../shared/flow-settings';

/**
 * What starting a task does to it at the provider -- In Progress, and taking
 * an unassigned one -- waits until the session has been timed for a while
 * (`start_side_effects.afterSeconds`, two minutes by default): "a glance
 * moves nothing" (S20). A start to look at a task, stopped or switched
 * within seconds, used to move it to In Progress and assign it to the user
 * all the same.
 *
 * Owned by the engine, which hands it every tick. Timed is the session's
 * `elapsedSeconds`, which leaves pauses out; a paused session has no tick,
 * so nothing fires while it waits. A stop or a switch cancels, since the
 * waiting run is tied to its session. Turned off, nothing ever runs.
 *
 * Side effects run from here, never from `startTask` (CLAUDE.md §7).
 */
export class SideEffectScheduler {
  private readonly _setting: () => StartSideEffectsSetting;
  private _pending: { sessionId: string; run: () => void } | null = null;

  constructor(setting: () => StartSideEffectsSetting) {
    this._setting = setting;
  }

  /**
   * Waits to run `run` for this session, replacing whatever waited for
   * another. Runs at once when the setting asks for no wait, or when the
   * session has already been timed that long -- an interruption assigned to
   * a task after ten minutes.
   */
  public schedule(session: Pick<ActiveSessionDTO, 'sessionId' | 'elapsedSeconds' | 'status'>, run: () => void): void {
    const setting = this._setting();
    if (!setting.enabled) {
      this._pending = null;
      return;
    }
    this._pending = { sessionId: session.sessionId, run };
    this.onTick(session);
  }

  /** Drops what waits, for any session or for this one only. */
  public cancel(sessionId?: string): void {
    if (!sessionId || this._pending?.sessionId === sessionId) this._pending = null;
  }

  /** Whether something waits for this session. */
  public isWaiting(sessionId: string): boolean {
    return this._pending?.sessionId === sessionId;
  }

  /** Runs what waits once its session has been timed long enough. */
  public onTick(session: Pick<ActiveSessionDTO, 'sessionId' | 'elapsedSeconds' | 'status'> | null): void {
    const pending = this._pending;
    if (!pending) return;
    if (!session || session.sessionId !== pending.sessionId) {
      // Its session ended or was replaced before the wait was over.
      this._pending = null;
      return;
    }
    if (session.status !== 'TRACKING') return;
    if (session.elapsedSeconds < this._setting().afterSeconds) return;
    this._pending = null;
    pending.run();
  }
}
