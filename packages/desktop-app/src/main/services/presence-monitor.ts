import { SettingsRepository } from '../db/repositories/settings-repository';
import { ArgumentNullException } from '../../shared/dtos';
import { ACTIVE_IDLE_MAX_SECONDS, LAST_PRESENCE_KEY, PRESENCE_WRITE_STEP_MS } from '../../shared/session-review';

/**
 * When the user was last at the machine, kept in the database so it survives
 * the app closing, the machine sleeping or shutting down.
 *
 * "Last at the machine" is now less the system's idle time: the last keyboard
 * or mouse input Windows saw, or a press on the bar. A session left running
 * is told from one worked late by it (`ForgottenSessionService`).
 */
export class PresenceMonitor {
  private readonly _settings: SettingsRepository;
  private readonly _getIdleSeconds: () => number;

  /**
   * @param getIdleSeconds seconds since the last keyboard or mouse input --
   * `powerMonitor.getSystemIdleTime` in the app, a fake in tests.
   */
  constructor(settings: SettingsRepository, getIdleSeconds: () => number) {
    if (!settings) throw new ArgumentNullException('settings');
    if (!getIdleSeconds) throw new ArgumentNullException('getIdleSeconds');
    this._settings = settings;
    this._getIdleSeconds = getIdleSeconds;
  }

  /** The stored presence, in epoch milliseconds; null before the first one. */
  public lastPresence(): number | null {
    const stored = this._settings.getSetting<string | null>(LAST_PRESENCE_KEY, null);
    const at = typeof stored === 'string' ? Date.parse(stored) : NaN;
    return Number.isFinite(at) ? at : null;
  }

  /** Someone is at the machine now. */
  public isPresent(): boolean {
    return this.idleSeconds() <= ACTIVE_IDLE_MAX_SECONDS;
  }

  /**
   * Stores the last input, or `at` -- a press on the bar, which Windows does
   * not count as input. Written only when it moves on by a step, so a machine
   * left alone writes nothing, and the minute samples cost one row update.
   */
  public record(at?: number): void {
    const presence = at ?? Date.now() - this.idleSeconds() * 1000;
    const last = this.lastPresence();
    if (last !== null && presence - last < PRESENCE_WRITE_STEP_MS) return;
    this._settings.setSetting(LAST_PRESENCE_KEY, new Date(presence).toISOString());
  }

  private idleSeconds(): number {
    const seconds = this._getIdleSeconds();
    // A failed read is taken as "just here": it records too late a presence
    // at worst, which errs towards keeping the session running.
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  }
}
