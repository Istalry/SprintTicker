import { powerMonitor, BrowserWindow } from 'electron';
import { IPCChannel } from '../../shared/ipc-channels';
import { PriorityPreemptionEngine } from './priority-preemption-engine';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { DisplayRenderer } from '../hardware/display-renderer';
import { ScheduleSettingsDTO, ArgumentNullException, ActiveSessionDTO, ResumePromptDTO } from '../../shared/dtos';
import { normalizeScheduleSettings } from '../../shared/schedule-defaults';
import { localDateKey } from '../../shared/local-date';
import { RESUME_PROMPT_EVENT } from '../../shared/priority-defaults';

/** The session lunch stopped, to start again when it ends, and the day it was stopped. */
interface LunchResume {
  taskId: string;
  isAdHoc: boolean;
  customTitle?: string;
  projectId: string;
  taskKey?: string;
  dateKey: string;
}

function isLunchResume(value: unknown): value is LunchResume {
  const v = value as Partial<LunchResume> | null;
  return (
    typeof v === 'object' && v !== null &&
    typeof v.taskId === 'string' && typeof v.projectId === 'string' &&
    typeof v.isAdHoc === 'boolean' && typeof v.dateKey === 'string'
  );
}

/**
 * Service that automatically monitors Windows session locks/sleep events and lunch schedules,
 * switching context modes, auto-pausing active tasks during lunch, and rendering dedicated screens.
 */
export class ContextScheduleService {
  private static readonly CHECK_INTERVAL_MS = 30000; // 30 seconds
  /**
   * The session lunch stopped. In the database rather than in memory: kept in
   * a field, a restart during lunch forgot it, and the task never came back.
   */
  public static readonly LUNCH_RESUME_KEY = 'lunch_resume';
  /** The day the user chose to work through lunch: it does not start again that day. */
  public static readonly LUNCH_SKIPPED_KEY = 'lunch_skipped_date';

  private readonly _priorityEngine: PriorityPreemptionEngine;
  private readonly _settingsRepo: SettingsRepository;
  private readonly _engine: TimeTrackingEngine;
  private readonly _renderer: DisplayRenderer;

  private _getWindow?: () => BrowserWindow | null;
  private _lastEodPromptDateString: string | null = null;
  private _lastStandupPromptDateString: string | null = null;
  private _standupSnoozeUntilTimestamp: number | null = null;
  private _eodSnoozeUntilTimestamp: number | null = null;
  private _isInitialCheck = true;
  /** The lunch resume being asked about: its task is no longer the user's. */
  private _resumePrompt: LunchResume | null = null;
  private _timer?: NodeJS.Timeout;
  private readonly _unsubscribeEngine: () => void;

  constructor(
    priorityEngine: PriorityPreemptionEngine,
    settingsRepo: SettingsRepository,
    engine: TimeTrackingEngine,
    renderer: DisplayRenderer,
    getWindow?: () => BrowserWindow | null
  ) {
    if (!priorityEngine) throw new ArgumentNullException('priorityEngine');
    if (!settingsRepo) throw new ArgumentNullException('settingsRepo');
    if (!engine) throw new ArgumentNullException('engine');
    if (!renderer) throw new ArgumentNullException('renderer');

    this._priorityEngine = priorityEngine;
    this._settingsRepo = settingsRepo;
    this._engine = engine;
    this._renderer = renderer;
    this._getWindow = getWindow;

    this._unsubscribeEngine = engine.subscribe(session => this.onSessionChanged(session));
    this.registerPowerMonitorListeners();
    this.startScheduleTimer();
  }

  /// <summary>
  /// Configures or updates the BrowserWindow getter callback for ceremony IPC messaging.
  /// </summary>
  public setWindowGetter(getWindow: () => BrowserWindow | null): void {
    this._getWindow = getWindow;
  }

  /// <summary>
  /// Evaluates current local time against configured stand-up, lunch, and End-of-Day schedules.
  /// </summary>
  public evaluateSchedule(): void {
    try {
      // Read through the normaliser so a row written with only the short
      // aliases resolves identically to one written with the canonical names.
      const settings = normalizeScheduleSettings(
        this._settingsRepo.getSetting<ScheduleSettingsDTO>('schedule_settings', {})
      );

      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      // Everything below compares local time -- getHours() -- so this key must
      // be the local day too. It used to come from toISOString(), the UTC day,
      // which changed mid-afternoon west of UTC and re-fired any ceremony
      // already due. See local-date.ts.
      const todayDateString = localDateKey(now);

      // 1. Evaluate Daily Stand-Up Schedule
      if (settings.enableStandupPrompt !== false) {
        const [suH, suM] = (settings.standupTime || '10:00').split(':').map(Number);
        const standupMins = suH * 60 + suM;
        const isSnoozed = this._standupSnoozeUntilTimestamp !== null && Date.now() < this._standupSnoozeUntilTimestamp;

        if (this._isInitialCheck && currentMinutes > standupMins) {
          // Suppress retroactive prompt if app launched after due time
          this._lastStandupPromptDateString = todayDateString;
        } else if (currentMinutes >= standupMins && this._lastStandupPromptDateString !== todayDateString && !isSnoozed) {
          // Stamped only once the prompt has actually gone out. Marking the day
          // first and then throwing -- `requestRender` rethrows when a render
          // fails -- cancelled the ceremony for the rest of the day.
          this.triggerStandupPrompt();
          this._lastStandupPromptDateString = todayDateString;
          this._standupSnoozeUntilTimestamp = null;
        }
      }

      // 2. Evaluate Lunch Schedule
      const lunch = ContextScheduleService.lunchWindow(settings);
      const isLunchTime = currentMinutes >= lunch.startMins && currentMinutes < lunch.endMins;
      const currentMode = this._priorityEngine.getUserMode();
      // The user started work during lunch: entering it again would stop that
      // session, 30 seconds after they started it.
      const workingThroughLunch =
        this._settingsRepo.getSetting<string | null>(ContextScheduleService.LUNCH_SKIPPED_KEY, null) === todayDateString;

      // Isolated from the End-of-Day evaluation below. These are the only calls
      // here that reach the renderer before it, and `requestRender` rethrows a
      // failed render -- so a lunch screen that could not be drawn used to take
      // the End-of-Day prompt down with it, on this tick and every tick after.
      try {
        if (isLunchTime && currentMode !== 'LUNCH' && currentMode !== 'AWAY' && !workingThroughLunch) {
          this.enterLunchMode();
        } else if (!isLunchTime && currentMode === 'LUNCH') {
          this.exitLunchMode();
        } else if (!isLunchTime && currentMode === 'WORK' && currentMinutes >= lunch.endMins) {
          // Lunch ended while nothing was here to end it: the app was closed,
          // or Windows was locked -- Away, which lunch never leaves.
          this.resumeAfterLunch();
        }
      } catch (err) {
        console.error('[ContextScheduleService] Lunch mode transition failed:', err);
      }

      // 3. Evaluate End-of-Day Wrap-Up Schedule
      const eodTimeStr = settings.eodWrapUpTime || settings.eodTime || '18:00';
      const [eodH, eodM] = eodTimeStr.split(':').map(Number);
      const eodStartMins = eodH * 60 + eodM;
      const isEodSnoozed = this._eodSnoozeUntilTimestamp !== null && Date.now() < this._eodSnoozeUntilTimestamp;

      if (this._isInitialCheck && currentMinutes > eodStartMins) {
        // Suppress retroactive prompt if app launched after due time
        this._lastEodPromptDateString = todayDateString;
      } else if (currentMinutes >= eodStartMins && this._lastEodPromptDateString !== todayDateString && !isEodSnoozed) {
        this.triggerEodPrompt();
        this._lastEodPromptDateString = todayDateString;
        this._eodSnoozeUntilTimestamp = null;
      }
    } catch (err) {
      console.warn('[ContextScheduleService] Skipping schedule evaluation due to closed database or system error:', err);
    } finally {
      // In a `finally`, because it used to be the last statement of the `try`.
      // Anything that threw above it -- and the lunch transitions call into the
      // renderer, which rethrows a failed render -- left this `true` forever.
      // Every later tick then took the "suppress retroactive prompt" branch and
      // stamped the day as already prompted, so the End-of-Day prompt silently
      // never fired again until the app was restarted.
      this._isInitialCheck = false;
    }
  }

  /// <summary>
  /// Broadcasts Stand-Up ceremony prompt to hardware display and renderer window.
  /// </summary>
  public triggerStandupPrompt(): void {
    this._renderer.renderCeremonyPrompt('STANDUP', 'Daily Stand-Up');

    if (this._getWindow) {
      const win = this._getWindow();
      if (win && !win.isDestroyed()) {
        if (typeof win.isMinimized === 'function' && win.isMinimized()) {
          win.restore();
        }
        if (typeof win.show === 'function') win.show();
        if (typeof win.focus === 'function') win.focus();

        win.webContents.send(IPCChannel.ON_CEREMONY_PROMPT, {
          type: 'STANDUP',
          title: 'Daily Stand-Up'
        });
      }
    }
  }

  /// <summary>
  /// Updates the text of an actively displaying ceremony prompt.
  /// </summary>
  public updateCeremonyPrompt(type: 'STANDUP' | 'EOD' | 'LUNCH', title: string): void {
    this._renderer.renderCeremonyPrompt(type, title);
  }

  /// <summary>
  /// Postpones ceremony prompt evaluation by specified minutes.
  /// </summary>
  public snoozeCeremony(type: 'STANDUP' | 'EOD', minutes: number = 10): void {
    const until = Date.now() + minutes * 60 * 1000;
    if (type === 'STANDUP') {
      this._standupSnoozeUntilTimestamp = until;
      this._lastStandupPromptDateString = null;
    } else {
      this._eodSnoozeUntilTimestamp = until;
      this._lastEodPromptDateString = null;
    }
  }

  /// <summary>
  /// Broadcasts EOD Wrap-Up ceremony prompt to renderer window.
  /// </summary>
  public triggerEodPrompt(): void {
    this._renderer.renderCeremonyPrompt('EOD', 'End-of-Day Wrap-Up');

    if (this._getWindow) {
      const win = this._getWindow();
      if (win && !win.isDestroyed()) {
        if (typeof win.isMinimized === 'function' && win.isMinimized()) {
          win.restore();
        }
        if (typeof win.show === 'function') win.show();
        if (typeof win.focus === 'function') win.focus();

        win.webContents.send(IPCChannel.ON_CEREMONY_PROMPT, {
          type: 'EOD',
          title: 'End-of-Day Wrap-Up'
        });
      }
    }
  }

  /// <summary>
  /// Manually or automatically triggers transition into LUNCH mode.
  ///
  /// The active session is *stopped*, not paused, and a fresh one is started on
  /// exit. That is deliberate: it produces two separate worklog entries either
  /// side of the break, which tracks time more accurately than one entry with a
  /// pause gap in it. The task itself is reused, so the split does not create a
  /// duplicate ad-hoc task.
  /// </summary>
  ///
  /// With nothing running the resume already stored is left alone: that is a
  /// restart during lunch, or Away ending in the middle of it.
  /// </summary>
  public enterLunchMode(): void {
    const session = this._engine.getCurrentSession();
    if (session && session.status === 'TRACKING') {
      const resume: LunchResume = {
        taskId: session.taskId,
        isAdHoc: session.isAdHoc,
        customTitle: session.taskTitle,
        projectId: session.projectId,
        taskKey: session.taskKey,
        dateKey: localDateKey(new Date())
      };
      this._settingsRepo.setSetting(ContextScheduleService.LUNCH_RESUME_KEY, resume);
      this._engine.stopSession('Auto-completed for Lunch Break split', false);
    }

    this._priorityEngine.setUserMode('LUNCH');
    this._renderer.setContextMode('LUNCH');
  }

  /// <summary>
  /// Exits LUNCH mode and resumes work mode.
  ///
  /// WORK first, then the restart: the session listener tells the user's own
  /// start during lunch from this one by the mode it happens in.
  /// </summary>
  public exitLunchMode(): void {
    this._priorityEngine.setUserMode('WORK');
    this._renderer.setContextMode('WORK');
    this.resumeAfterLunch();
  }

  /// <summary>
  /// The question being asked after lunch, for a window opened after it was.
  /// </summary>
  public getResumePrompt(): ResumePromptDTO | null {
    return this._resumePrompt ? ContextScheduleService.toPromptDto(this._resumePrompt) : null;
  }

  /// <summary>
  /// Answers "resume it anyway?", from the window or the bar. False when
  /// nothing is being asked -- the other one answered first.
  /// </summary>
  public answerResumePrompt(resume: boolean): boolean {
    const data = this._resumePrompt;
    if (!data) return false;
    this.closeResumePrompt(() => {
      if (resume && !this._engine.getCurrentSession()) {
        this._engine.startTask(data.taskId, data.isAdHoc, data.customTitle, data.projectId, data.taskKey);
      }
    });
    return true;
  }

  /// <summary>
  /// Manually or automatically triggers transition into AWAY mode.
  /// </summary>
  public enterAwayMode(): void {
    this._priorityEngine.setUserMode('AWAY');
    this._renderer.setContextMode('AWAY');
  }

  /// <summary>
  /// Exits AWAY mode when Windows unlocks or resumes.
  /// </summary>
  public exitAwayMode(): void {
    this._priorityEngine.setUserMode('WORK');
    this._renderer.setContextMode('WORK');
  }

  /// <summary>
  /// Disposes background timers and unregisters powerMonitor listeners.
  /// </summary>
  public dispose(): void {
    this._unsubscribeEngine();
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
  }

  /**
   * Restarts the session lunch stopped -- once, and only if it is still
   * wanted. Anything open now is the user's choice and wins; an entry from
   * another day is dropped; and a task that left the user's lists over the
   * break is asked about rather than restarted.
   */
  private resumeAfterLunch(): void {
    if (this._resumePrompt) return;
    const stored = this._settingsRepo.getSetting<unknown>(ContextScheduleService.LUNCH_RESUME_KEY, null);
    if (stored === null) return;
    if (!isLunchResume(stored) || stored.dateKey !== localDateKey(new Date()) || this._engine.getCurrentSession()) {
      this.forgetLunchResume();
      return;
    }
    if (!stored.isAdHoc && !this._engine.isTaskListed(stored.taskId)) {
      // Kept until answered, so a restart asks again rather than forgetting.
      this._resumePrompt = stored;
      this._renderer.renderResumePrompt();
      this.sendResumePrompt(ContextScheduleService.toPromptDto(stored));
      return;
    }
    this.forgetLunchResume();
    this._engine.startTask(stored.taskId, stored.isAdHoc, stored.customTitle, stored.projectId, stored.taskKey);
  }

  /**
   * A session started or resumed. During lunch that is the user working
   * through it, from the window, the mini timer or the bar: the lunch screen
   * goes, nothing restarts when lunch ends, and lunch does not start again
   * today. It used to stay LUNCH -- the sandwich over the running session --
   * and the task lunch had stopped came back at the end, over the user's.
   */
  private onSessionChanged(session: ActiveSessionDTO | null): void {
    if (session?.status !== 'TRACKING') return;
    if (this._resumePrompt) {
      // Something else started while the question was up: it is moot.
      this.closeResumePrompt();
      return;
    }
    if (!this.isDuringLunch()) return;
    this.forgetLunchResume();
    this._settingsRepo.setSetting(ContextScheduleService.LUNCH_SKIPPED_KEY, localDateKey(new Date()));
    if (this._priorityEngine.getUserMode() === 'LUNCH') {
      this._priorityEngine.setUserMode('WORK');
      this._renderer.setContextMode('WORK');
    }
  }

  /**
   * LUNCH, or the lunch hours while Away ended and the next check has not yet
   * entered LUNCH: a session started then would be stopped by it.
   */
  private isDuringLunch(): boolean {
    const mode = this._priorityEngine.getUserMode();
    if (mode === 'LUNCH') return true;
    if (mode !== 'WORK') return false;
    const settings = normalizeScheduleSettings(
      this._settingsRepo.getSetting<ScheduleSettingsDTO>('schedule_settings', {})
    );
    const lunch = ContextScheduleService.lunchWindow(settings);
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    return minutes >= lunch.startMins && minutes < lunch.endMins;
  }

  /** Ends the question: the stored resume, the bar's lock and the window's dialog, around `between`. */
  private closeResumePrompt(between?: () => void): void {
    this._resumePrompt = null;
    this.forgetLunchResume();
    // The session starts under the prompt's lock, and its release draws it.
    between?.();
    this._priorityEngine.releaseActiveLock(RESUME_PROMPT_EVENT);
    this.sendResumePrompt(null);
  }

  private forgetLunchResume(): void {
    this._settingsRepo.setSetting(ContextScheduleService.LUNCH_RESUME_KEY, null);
  }

  /** Brings the window up to ask, as the ceremonies do; null closes the dialog. */
  private sendResumePrompt(prompt: ResumePromptDTO | null): void {
    const win = this._getWindow?.();
    if (!win || win.isDestroyed()) return;
    if (prompt) {
      if (typeof win.isMinimized === 'function' && win.isMinimized()) win.restore();
      if (typeof win.show === 'function') win.show();
    }
    win.webContents.send(IPCChannel.ON_RESUME_PROMPT, prompt);
  }

  private static toPromptDto(data: LunchResume): ResumePromptDTO {
    return { taskKey: data.taskKey || data.taskId, taskTitle: data.customTitle ?? '' };
  }

  private static lunchWindow(settings: ScheduleSettingsDTO): { startMins: number; endMins: number } {
    const [startH, startM] = (settings.lunchStartTime || settings.lunchStart || '12:30').split(':').map(Number);
    const [endH, endM] = (settings.lunchEndTime || settings.lunchEnd || '13:30').split(':').map(Number);
    return { startMins: startH * 60 + startM, endMins: endH * 60 + endM };
  }

  private registerPowerMonitorListeners(): void {
    try {
      if (typeof powerMonitor !== 'undefined' && powerMonitor && typeof powerMonitor.on === 'function') {
        powerMonitor.on('lock-screen', () => this.enterAwayMode());
        powerMonitor.on('suspend', () => this.enterAwayMode());
        powerMonitor.on('unlock-screen', () => this.exitAwayMode());
        powerMonitor.on('resume', () => this.exitAwayMode());
      }
    } catch {
      // Suppress when running in headless test environments without powerMonitor
    }
  }

  private startScheduleTimer(): void {
    this._timer = setInterval(() => this.evaluateSchedule(), ContextScheduleService.CHECK_INTERVAL_MS);
  }
}
