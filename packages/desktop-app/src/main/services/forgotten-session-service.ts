import { BrowserWindow } from 'electron';
import { IPCChannel } from '../../shared/ipc-channels';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { PresenceMonitor } from './presence-monitor';
import type { PromptOutlet } from '../windows/prompt-outlet';
import {
  ActiveSessionDTO,
  ArgumentException,
  ArgumentNullException,
  ForgottenSessionResolutionDTO,
  ForgottenSessionReviewDTO,
  ScheduleSettingsDTO
} from '../../shared/dtos';
import { normalizeScheduleSettings } from '../../shared/schedule-defaults';
import { atLocalTime, localDateKey } from '../../shared/local-date';
import {
  FORGOTTEN_MIN_GAP_MS,
  FORGOTTEN_REVIEW_KEY,
  ForgottenCause,
  forgottenHeading,
  PRESENCE_SAMPLE_MS
} from '../../shared/session-review';

interface StoredReview {
  sessionId: string;
  lastPresenceUtc: string;
  /** Decide later: asked as a card, not a dialog (S18, P10b). */
  deferred?: boolean;
  cause?: ForgottenCause;
}

const ACTIONS = new Set(['stop', 'restart', 'discard', 'keep', 'later', 'ask']);

/**
 * Finds a session left running across a change of day, and asks about it.
 *
 * Time is wall clock minus pauses, so a session forgotten on Friday read 62
 * hours on Monday, and stopping it sent all 62 to the provider at once -- the
 * stop sends at once, so there was no moment to catch it.
 *
 * Forgotten means: running, the user's last activity on an earlier day than
 * today, at least two hours ago, and the user back now. Overtime past
 * midnight does not qualify: anyone at the keyboard moves their presence on
 * every minute. The session is paused at the last activity -- so the bar's
 * STOP, the mini timer, anything, ends it there -- and the window asks when
 * the work actually stopped. Nothing is logged until it is answered, and any
 * other action on the session answers it.
 */
export class ForgottenSessionService {
  private readonly _engine: TimeTrackingEngine;
  private readonly _settings: SettingsRepository;
  private readonly _presence: PresenceMonitor;
  private readonly _getWindow?: () => BrowserWindow | null;
  private _outlet: PromptOutlet | null = null;
  private _openDashboard: (() => void) | null = null;
  private readonly _unsubscribe: () => void;
  private _timer?: NodeJS.Timeout;

  constructor(
    engine: TimeTrackingEngine,
    settings: SettingsRepository,
    presence: PresenceMonitor,
    getWindow?: () => BrowserWindow | null
  ) {
    if (!engine) throw new ArgumentNullException('engine');
    if (!settings) throw new ArgumentNullException('settings');
    if (!presence) throw new ArgumentNullException('presence');
    this._engine = engine;
    this._settings = settings;
    this._presence = presence;
    this._getWindow = getWindow;
    this._unsubscribe = engine.subscribe(session => this.onSessionChanged(session));
  }

  /** Samples presence every minute: a machine left on all weekend is caught on Monday's first move. */
  public start(): void {
    if (this._timer) return;
    this._timer = setInterval(() => this.check(), PRESENCE_SAMPLE_MS);
    this._timer.unref?.();
  }

  public dispose(): void {
    if (this._timer) clearInterval(this._timer);
    this._timer = undefined;
    this._unsubscribe();
  }

  /**
   * Looks for a forgotten session, then records the user's presence -- in
   * that order, since the presence before this one is the evidence. At start,
   * on resume and unlock, every minute, and on a press on the bar
   * (`barInput`), which Windows does not see as input.
   *
   * `atStart` also looks for a session SprintTicker was closed under -- a
   * crash, a shutdown -- the same day (S31, P10c). Nothing watched the
   * presence while it was closed, so a long gap there is asked about rather
   * than counted as work, whoever is at the machine now.
   */
  public check(options: { barInput?: boolean; atStart?: boolean } = {}): void {
    try {
      const previous = this._presence.lastPresence();
      if (previous !== null && (options.barInput || this._presence.isPresent())) {
        this.detect(previous);
      }
      if (previous !== null && options.atStart) this.detectClosed(previous);
    } catch (err) {
      console.error('[ForgottenSessionService] Looking for a forgotten session failed:', err);
    } finally {
      try {
        this._presence.record(options.barInput ? Date.now() : undefined);
      } catch (err) {
        // The database closing at quit, most likely; the next sample retries.
        console.warn('[ForgottenSessionService] Could not record presence:', err);
      }
    }
  }

  /** The question being asked, for a window opened after it was. */
  public getReview(): ForgottenSessionReviewDTO | null {
    const stored = this.readStored();
    if (!stored) return null;
    const session = this._engine.getCurrentSession();
    if (!ForgottenSessionService.isUnderReview(session, stored)) {
      this.closeReview();
      return null;
    }
    const lastPresence = new Date(stored.lastPresenceUtc);
    let endOfDayUtc: string | null = null;
    try {
      const endOfDay = atLocalTime(lastPresence, this.schedule().eodWrapUpTime ?? '');
      if (endOfDay.getTime() > Date.parse(session.startTimeUtc) && endOfDay.getTime() < Date.now()) {
        endOfDayUtc = endOfDay.toISOString();
      }
    } catch (err) {
      console.warn('[ForgottenSessionService] The end-of-day time is not usable:', err);
    }
    return {
      sessionId: session.sessionId,
      taskKey: session.taskKey,
      taskTitle: session.taskTitle,
      startTimeUtc: session.startTimeUtc,
      lastPresenceUtc: stored.lastPresenceUtc,
      endOfDayUtc,
      pauses: this._engine.getClosedPauses(),
      taskUnlisted: session.taskUnlisted === true,
      deferred: stored.deferred === true,
      cause: stored.cause ?? 'overnight'
    };
  }

  /**
   * Answers the question. False when nothing is being asked any more.
   *
   * @throws ArgumentException for an unknown action, or `stop` / `restart`
   * without an end between the session's start and now.
   */
  public resolve(resolution: ForgottenSessionResolutionDTO): boolean {
    if (!resolution || !ACTIONS.has(resolution.action)) {
      throw new ArgumentException(`Unknown answer: ${String(resolution?.action)}.`, 'action');
    }
    const review = this.getReview();
    if (!review) return false;
    const session = this._engine.getCurrentSession()!;

    // Neither answers: the session stays paused at the last activity, and
    // nothing is logged, until one of the answers below.
    if (resolution.action === 'later' || resolution.action === 'ask') {
      const stored = this.readStored()!;
      this._settings.setSetting(FORGOTTEN_REVIEW_KEY, { ...stored, deferred: resolution.action === 'later' });
      this.send(this.getReview());
      // Answer, from the mini timer or Today: the user asked for the window.
      if (resolution.action === 'ask') this._openDashboard?.();
      return true;
    }

    switch (resolution.action) {
      case 'stop':
      case 'restart':
        if (typeof resolution.endUtc !== 'string') {
          throw new ArgumentException('Logging the session needs the time it ended.', 'endUtc');
        }
        this._engine.stopSessionAt(resolution.endUtc);
        if (resolution.action === 'restart') {
          this._engine.startTask(session.taskId, session.isAdHoc, session.taskTitle, session.projectId, session.taskKey);
        }
        break;
      case 'discard':
        this._engine.discardSession();
        break;
      case 'keep':
        this._engine.withdrawPause();
        break;
    }
    this.closeReview();
    return true;
  }

  private detect(previousPresence: number): void {
    if (this.schedule().askAboutForgottenSessions === false) return;
    if (this.readStored()) return;
    const session = this._engine.getCurrentSession();
    if (!session || session.status !== 'TRACKING') return;

    // A session started after the user left -- from the bar, say -- was not
    // running while they were away.
    const lastActivity = Math.max(previousPresence, Date.parse(session.startTimeUtc));
    const now = Date.now();
    if (localDateKey(new Date(lastActivity)) >= localDateKey(new Date(now))) return;
    if (now - lastActivity < FORGOTTEN_MIN_GAP_MS) return;
    this.ask(session, lastActivity, 'overnight');
  }

  /**
   * The same day, at start: the gap since the last activity was spent with
   * SprintTicker closed, and used to count as work, silently. Across a change
   * of day `detect` asks instead, once someone is there.
   */
  private detectClosed(previousPresence: number): void {
    if (this.schedule().askAboutForgottenSessions === false) return;
    if (this.readStored()) return;
    const session = this._engine.getCurrentSession();
    if (!session || session.status !== 'TRACKING') return;

    const lastActivity = Math.max(previousPresence, Date.parse(session.startTimeUtc));
    const now = Date.now();
    if (localDateKey(new Date(lastActivity)) !== localDateKey(new Date(now))) return;
    if (now - lastActivity < FORGOTTEN_MIN_GAP_MS) return;
    this.ask(session, lastActivity, 'closed');
  }

  /** Pauses the session at the last activity and asks; nothing is logged until it is answered. */
  private ask(session: ActiveSessionDTO, lastActivity: number, cause: ForgottenCause): void {
    const lastPresenceUtc = new Date(lastActivity).toISOString();
    console.log(
      `[ForgottenSessionService] ${session.taskKey} was left running (${cause}) since ${lastPresenceUtc}: ` +
        'paused there, and the user is asked when it ended.'
    );
    this._engine.pauseSessionAt(lastPresenceUtc);
    const stored: StoredReview = { sessionId: session.sessionId, lastPresenceUtc, cause };
    this._settings.setSetting(FORGOTTEN_REVIEW_KEY, stored);
    this.send(this.getReview());
    // The question waits in the window, which no longer comes forward to ask
    // it (P8c); a toast says so while it is hidden.
    this._outlet?.announce({
      title: forgottenHeading(session.taskKey, cause),
      body: `Paused at your last activity, ${localClock(lastPresenceUtc)}. Click to say when you stopped; nothing is logged until you do.`
    });
  }

  /** Anything else done to the session answers the question: a stop, a resume, a discard. */
  private onSessionChanged(session: ActiveSessionDTO | null): void {
    const stored = this.readStored();
    if (stored && !ForgottenSessionService.isUnderReview(session, stored)) this.closeReview();
  }

  private closeReview(): void {
    if (this._settings.getSetting<unknown>(FORGOTTEN_REVIEW_KEY, null) === null) return;
    this._settings.setSetting(FORGOTTEN_REVIEW_KEY, null);
    this.send(null);
  }

  private readStored(): StoredReview | null {
    const value = this._settings.getSetting<Partial<StoredReview> | null>(FORGOTTEN_REVIEW_KEY, null);
    if (!value || typeof value.sessionId !== 'string' || typeof value.lastPresenceUtc !== 'string') return null;
    return {
      sessionId: value.sessionId,
      lastPresenceUtc: value.lastPresenceUtc,
      deferred: value.deferred === true,
      cause: value.cause === 'closed' ? 'closed' : 'overnight'
    };
  }

  private schedule(): ScheduleSettingsDTO {
    return normalizeScheduleSettings(this._settings.getSetting<ScheduleSettingsDTO>('schedule_settings', {}));
  }

  /**
   * Where the question goes, and its toast while the window is hidden (P8c).
   * `openDashboard` is for Answer on a deferred question's card: a click of
   * the user's, so the window may come forward.
   */
  public setPromptOutlet(outlet: PromptOutlet, openDashboard?: () => void): void {
    this._outlet = outlet;
    this._openDashboard = openDashboard ?? null;
  }

  /** Never brings the window forward: it used to show() and focus() it (P8c). */
  private send(review: ForgottenSessionReviewDTO | null): void {
    if (this._outlet) {
      this._outlet.send(IPCChannel.ON_FORGOTTEN_SESSION_REVIEW, review);
      return;
    }
    const win = this._getWindow?.();
    if (!win || win.isDestroyed()) return;
    win.webContents.send(IPCChannel.ON_FORGOTTEN_SESSION_REVIEW, review);
  }

  private static isUnderReview(session: ActiveSessionDTO | null, stored: StoredReview): session is ActiveSessionDTO {
    return session !== null && session.sessionId === stored.sessionId && session.status === 'PAUSED';
  }
}

/** `18:04`, local: the toast's time, in main, which has no regional format. */
function localClock(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}
