import type { UserMode } from '../../shared/dtos';
import { powerMonitor, BrowserWindow } from 'electron';
import { IPCChannel } from '../../shared/ipc-channels';
import { PriorityPreemptionEngine } from './priority-preemption-engine';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { DisplayRenderer } from '../hardware/display-renderer';
import { ScheduleSettingsDTO, ArgumentException, ArgumentNullException, ActiveSessionDTO, CeremonyPromptDTO, ResumePromptDTO, StandupTaskDTO, WeekEndedDTO } from '../../shared/dtos';
import type { PromptAnnouncement, PromptOutlet } from '../windows/prompt-outlet';
import { FlowSettingKey, readStandupTask } from '../../shared/flow-settings';
import { DAILY_STANDUP_TITLE, normalizeScheduleSettings } from '../../shared/schedule-defaults';
import { addLocalDays, atLocalTime, localDateKey, localMidnight } from '../../shared/local-date';
import { weekStartKey } from '../../shared/working-days';
import { WorkingCalendar } from './working-calendar';
import { RESUME_PROMPT_EVENT } from '../../shared/priority-defaults';
import { WORKLOG_COMMENTS } from '../../shared/worklog-comments';
import { InterruptionSource } from '../../shared/interruption';
import type { InterruptionEnded } from '../engine/time-tracking-engine';

/**
 * The task to come back to after a break, and the day of the break. Lunch
 * and Away pause the session now (redesign P8b, D1): `heldSessionId` names
 * the session paused, which "Back at your desk?" resumes, and `pausedFor`
 * what paused it. An entry without it is a task to start again -- the
 * stand-up's, ended during lunch, or one stored by an earlier version.
 */
interface LunchResume {
  taskId: string;
  isAdHoc: boolean;
  customTitle?: string;
  projectId: string;
  taskKey?: string;
  dateKey: string;
  heldSessionId?: string;
  pausedFor?: 'lunch' | 'away';
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
 * What set a task aside to come back when it ends: the stand-up, which
 * restarts it on its own unless it left the user's lists, or an
 * interruption, which always asks.
 */
type SetAsideReason = 'standup' | 'interruption';

/** The task set aside, and the session that replaced it: its end brings the task back. */
interface SetAside extends LunchResume {
  endsWith: string;
  after: SetAsideReason;
}

function isSetAside(value: unknown): value is SetAside {
  const v = value as Partial<SetAside> | null;
  return isLunchResume(value) && typeof v?.endsWith === 'string' && (v.after === 'standup' || v.after === 'interruption');
}

/** The stand-up's entry before the set-aside was shared, under its old key. */
function isLegacyStandupResume(value: unknown): value is LunchResume & { standupSessionId: string } {
  return isLunchResume(value) && typeof (value as { standupSessionId?: unknown }).standupSessionId === 'string';
}

/** The task part of a set-aside entry. */
function taskOf(entry: SetAside): LunchResume {
  return {
    taskId: entry.taskId,
    isAdHoc: entry.isAdHoc,
    customTitle: entry.customTitle,
    projectId: entry.projectId,
    taskKey: entry.taskKey,
    dateKey: entry.dateKey
  };
}

/**
 * The question asked before restarting a task, and what stopped it. After an
 * interruption of this model the task was never stopped: `heldSessionId`
 * names the session held for it, which Yes resumes rather than restarts.
 */
type ResumeQuestion = LunchResume & {
  after: ResumePromptDTO['after'];
  unlisted: boolean;
  heldSessionId?: string;
  interruptionEndedAtUtc?: string;
};

/**
 * Whether the session is the stand-up the app switches to: the local Daily
 * Standup, or the task the user chose for it (P8c2).
 */
function isStandupSession(session: ActiveSessionDTO | null, standupTask: StandupTaskDTO | null = null): boolean {
  if (!session || session.interruption) return false;
  if (standupTask && session.taskId === standupTask.taskId) return true;
  return session.isAdHoc && session.taskTitle === DAILY_STANDUP_TITLE;
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
  /**
   * The task the stand-up or an interruption switched away from, to bring
   * back when the session that replaced it ends. One entry: one session is
   * open at a time, and an interruption of either keeps the first task.
   */
  public static readonly SET_ASIDE_KEY = 'set_aside';
  /** Where the stand-up kept it before the entry was shared; read once, at start. */
  public static readonly LEGACY_STANDUP_RESUME_KEY = 'standup_resume';
  /** The Monday of the last week closed, so a week closes once. */
  public static readonly LAST_WEEK_CLOSED_KEY = 'last_week_closed';
  /** The week just over, until the user has seen it: it survives a restart. */
  public static readonly WEEK_ENDED_KEY = 'week_ended_notice';
  /** The task the stand-up is timed on (D3); unset, the local Daily Standup. */
  public static readonly STANDUP_TASK_KEY = FlowSettingKey.STANDUP_TASK;

  private readonly _priorityEngine: PriorityPreemptionEngine;
  private readonly _settingsRepo: SettingsRepository;
  private readonly _engine: TimeTrackingEngine;
  private readonly _renderer: DisplayRenderer;

  private _getWindow?: () => BrowserWindow | null;
  /** Every window, and a toast when the dashboard is hidden; `_getWindow` alone without it. */
  private _outlet: PromptOutlet | null = null;
  /** The ceremony waiting on an answer: it stays on Today and the mini timer until one. */
  private _ceremonyPrompt: CeremonyPromptDTO | null = null;
  private _lastEodPromptDateString: string | null = null;
  private _lastStandupPromptDateString: string | null = null;
  private _standupSnoozeUntilTimestamp: number | null = null;
  private _eodSnoozeUntilTimestamp: number | null = null;
  private _isInitialCheck = true;
  /** The lunch resume being asked about: its task is no longer the user's. */
  private _resumePrompt: ResumeQuestion | null = null;
  /** The session a task set aside waits on to end; null otherwise. */
  private _setAsideFor: string | null = null;
  /** The session the engine last told us about, to tell a start from a tick. */
  private _lastSeen: { sessionId: string; tracking: boolean } | null = null;
  private _timer?: NodeJS.Timeout;
  private readonly _unsubscribeEngine: () => void;
  private readonly _unsubscribeInterruptions: () => void;
  /** Lunch is ending an interruption: "Back?" is not asked over the break. */
  private _endingForLunch = false;
  private readonly _calendar: WorkingCalendar;
  private readonly _weekEndedListeners = new Set<(week: WeekEndedDTO) => void>();
  private readonly _checkListeners = new Set<() => void>();

  constructor(
    priorityEngine: PriorityPreemptionEngine,
    settingsRepo: SettingsRepository,
    engine: TimeTrackingEngine,
    renderer: DisplayRenderer,
    getWindow?: () => BrowserWindow | null,
    calendar?: WorkingCalendar
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
    // Without a provider to read holidays from, the weekdays alone decide.
    this._calendar = calendar ?? new WorkingCalendar(settingsRepo);

    this.adoptStoredSetAside();
    // A session already running when the service starts was not started now.
    this.noteSeen(engine.getCurrentSession());
    this._unsubscribeEngine = engine.subscribe(session => this.onSessionChanged(session));
    // A test double of the engine may have no interruptions to tell of.
    this._unsubscribeInterruptions = typeof engine.onInterruptionEnded === 'function'
      ? engine.onInterruptionEnded(ended => this.onInterruptionEnded(ended))
      : () => undefined;
    this.registerPowerMonitorListeners();
    this.startScheduleTimer();
  }

  /// <summary>
  /// Configures or updates the BrowserWindow getter callback for ceremony IPC messaging.
  /// </summary>
  public setWindowGetter(getWindow: () => BrowserWindow | null): void {
    this._getWindow = getWindow;
  }

  /**
   * Where the questions go: every window, and a toast while the dashboard is
   * hidden. Never the focus (P8c).
   */
  public setPromptOutlet(outlet: PromptOutlet): void {
    this._outlet = outlet;
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

      // Once a day it reads the holidays; until then, and if it cannot, it
      // answers from what it read before. It never throws.
      void this._calendar.refresh();
      // A weekend or a holiday prompts for nothing: no stand-up, no lunch
      // split, no wrap-up. Time is still tracked, as on any other day.
      const workingToday = this._calendar.isWorkingDay(todayDateString);
      if (workingToday && this._priorityEngine.getUserMode() !== 'AWAY') this.closeLastWeekIfMissed(todayDateString);

      // 1. Evaluate Daily Stand-Up Schedule
      if (workingToday && settings.enableStandupPrompt !== false) {
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
        // Over when lunch is, or when the interruption it was about has ended.
        if (!isLunchTime || !this.interruptionRunning()) this.closeCeremony('LUNCH');
        if (workingToday && isLunchTime && currentMode !== 'LUNCH' && !workingThroughLunch && this.interruptionRunning()) {
          // S25: lunch would end the call the user is in. It asks instead,
          // in WORK and under Away alike, until answered or lunch is over.
          this.askLunch();
        } else if (workingToday && isLunchTime && currentMode !== 'LUNCH' && currentMode !== 'AWAY' && !workingThroughLunch) {
          this.enterLunchMode();
        } else if (workingToday && isLunchTime && currentMode === 'AWAY' && !workingThroughLunch) {
          // Locked when lunch began. Lunch never leaves Away; it takes over
          // Away's pause of the task (an interruption asks, above).
          // Unlocking during the break shows LUNCH.
          this.pauseForBreak('lunch');
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

      if (!workingToday) {
        // Nothing to wrap up on a day off.
      } else if (this._isInitialCheck && currentMinutes > eodStartMins) {
        // Suppress retroactive prompt if app launched after due time
        this._lastEodPromptDateString = todayDateString;
      } else if (currentMinutes >= eodStartMins && this._lastEodPromptDateString !== todayDateString && !isEodSnoozed) {
        this.triggerEodPrompt();
        this._lastEodPromptDateString = todayDateString;
        this._eodSnoozeUntilTimestamp = null;
        // The wrap-up of the week's last working day closes the week.
        if (this._calendar.lastWorkingDayOfWeek(todayDateString) === todayDateString) {
          this.closeWeek(weekStartKey(todayDateString), todayDateString);
        }
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
    // After the day's transitions, so a reminder reads the mode they left.
    for (const listener of this._checkListeners) {
      try {
        listener();
      } catch (err) {
        console.warn('[ContextScheduleService] A check listener failed:', err);
      }
    }
  }

  /** Called after every check, every 30 s: the reminders ride on it (P8d). */
  public onChecked(listener: () => void): () => void {
    this._checkListeners.add(listener);
    return () => this._checkListeners.delete(listener);
  }

  /** Whether the session is the stand-up: the local Daily Standup or its chosen task. */
  public isStandup(session: ActiveSessionDTO): boolean {
    return isStandupSession(session, this.getStandupTask());
  }

  /// <summary>
  /// Broadcasts Stand-Up ceremony prompt to hardware display and renderer window.
  /// </summary>
  public triggerStandupPrompt(): void {
    this._renderer.renderCeremonyPrompt('STANDUP', 'Daily Stand-Up');
    const at = this.schedule().standupTime || '10:00';
    // No show(), no focus() (P8c): the card waits on Today and the mini
    // timer until it is answered, and a toast says so if the window is hidden.
    this.askCeremony({ type: 'STANDUP', title: 'Daily Stand-Up', at }, {
      title: `Stand-up at ${at}`,
      body: 'Click to join or skip.'
    });
  }

  /** The ceremony waiting on an answer, for a window opened after it was asked. */
  public getCeremonyPrompt(): CeremonyPromptDTO | null {
    return this._ceremonyPrompt;
  }

  /**
   * Skip today, from the card or the window: the bar's prompt goes too. Its
   * release hands the display back itself; drawing the session after it was
   * the double render of CLAUDE.md §5.
   */
  public skipStandup(): void {
    this.closeCeremony('STANDUP');
    this._priorityEngine.releaseActiveLock('standupPromptPriority');
  }

  /** The end-of-day prompt is answered: the wrap-up was done, or put off. */
  public closeEodPrompt(): void {
    this.closeCeremony('EOD');
  }

  private askCeremony(prompt: CeremonyPromptDTO, announcement: PromptAnnouncement): void {
    this._ceremonyPrompt = prompt;
    this.send(IPCChannel.ON_CEREMONY_PROMPT, prompt);
    this._outlet?.announce(announcement);
  }

  private closeCeremony(type: CeremonyPromptDTO['type']): void {
    if (this._ceremonyPrompt?.type !== type) return;
    this._ceremonyPrompt = null;
    this.send(IPCChannel.ON_CEREMONY_PROMPT, null);
  }

  /**
   * The user is going to the stand-up: the timer switches to the Daily
   * Standup task, and the task it stopped restarts when the stand-up ends.
   * From the window's Join, or OK on the bar's prompt.
   *
   * The switch happens under the prompt's lock and its release draws it, as
   * the lunch restart does -- one render, not the release's and the
   * session's. A stand-up already running is left as it is.
   */
  public joinStandup(joinedAt?: Date): void {
    this.closeCeremony('STANDUP');
    const standupTask = this.getStandupTask();
    if (!isStandupSession(this._engine.getCurrentSession(), standupTask)) {
      // "Joined 5 min ago": the stand-up starts then, and the minutes come
      // off the task it replaces (P8c2). On the task chosen for it, it is
      // sent like any entry; one no longer listed falls back to the local
      // Daily Standup rather than timing work on someone else's task.
      const options = joinedAt ? { startedAt: joinedAt } : {};
      const onTask = standupTask && this._engine.isTaskListed(standupTask.taskId) ? standupTask : null;
      this.switchSettingAside('standup', () => onTask
        ? this._engine.startTask(onTask.taskId, false, undefined, undefined, undefined, options)
        : this._engine.startNamedAdHocTask(DAILY_STANDUP_TITLE, options));
    }
    this._priorityEngine.releaseActiveLock('standupPromptPriority');
  }

  /** The task the stand-up is timed on, or null for the local Daily Standup. */
  public getStandupTask(): StandupTaskDTO | null {
    return readStandupTask(this._settingsRepo.getSetting<unknown>(ContextScheduleService.STANDUP_TASK_KEY, null));
  }

  /** Chooses the stand-up's task; null keeps it local. */
  public setStandupTask(task: StandupTaskDTO | null): void {
    if (task !== null && readStandupTask(task) === null) {
      throw new ArgumentException('The stand-up\'s task needs an id, a key and a title.', 'task');
    }
    // Stored as read back: extra fields from the window are not kept.
    this._settingsRepo.setSetting(ContextScheduleService.STANDUP_TASK_KEY, task === null ? null : readStandupTask(task));
  }

  /**
   * Interrupt: a timer at once, on a new ad-hoc task the user names or
   * assigns afterwards, and the task it stops asked about when it ends --
   * "back to SCRUM-12?". Every surface calls this -- the window, the mini
   * timer, the tray, the bar's paused menu, the Stream Deck, the shortcut --
   * so none keeps a rule of its own.
   *
   * A paused task is set aside too, unlike for the stand-up: the bar reaches
   * Interrupt through its paused menu, so the task is paused by then.
   */
  public interrupt(source: InterruptionSource = 'window', at?: Date): ActiveSessionDTO {
    // The task is held by the engine now (D2), paused for the interruption,
    // so nothing is set aside: Back resumes it where it was.
    return this._engine.startInterruption(at ?? new Date(), source);
  }

  /**
   * An interruption ended without Back: "Back to MG-12?" when it held a task
   * that was running. Not over lunch -- lunch decides what comes after it --
   * and not for a task that was already paused, which Back would leave paused.
   */
  private onInterruptionEnded(ended: InterruptionEnded): void {
    if (ended.how !== 'stop' && ended.how !== 'discard') return;
    if (!ended.held || ended.fragment.interruptedWasPaused || this._endingForLunch) return;
    if (this._resumePrompt) return;
    const held = ended.held;
    const unlisted = !held.isAdHoc && !this._engine.isTaskListed(held.taskId);
    this._resumePrompt = {
      ...ContextScheduleService.resumeOf(held),
      after: 'interruption',
      unlisted,
      heldSessionId: held.sessionId,
      ...(ended.fragment.endedAtUtc ? { interruptionEndedAtUtc: ended.fragment.endedAtUtc } : {})
    };
    const prompt = ContextScheduleService.toPromptDto(this._resumePrompt);
    this._renderer.renderResumePrompt('interruption', prompt.taskKey, true);
    this.sendResumePrompt(prompt);
  }

  /**
   * Starts the session `start` makes and sets aside the one it replaces,
   * to come back when the new one ends.
   *
   * A session that is itself a set-aside's replacement -- an interruption,
   * the stand-up -- passes on the task it was waiting to bring back: the
   * first task is the one to return to, not the interruption of it. The
   * stop `start` makes is not the end being waited on, so the wait is
   * dropped before it and taken up again after.
   */
  private switchSettingAside(after: SetAsideReason, start: () => ActiveSessionDTO): ActiveSessionDTO {
    const before = this._engine.getCurrentSession();
    const waiting = this.setAsideWaitingOn(before);
    this._setAsideFor = null;
    const next = start();
    const setsAside = before !== null && (before.status === 'TRACKING' || (after === 'interruption' && before.status === 'PAUSED'));
    const task = waiting ?? (setsAside ? ContextScheduleService.resumeOf(before) : null);
    if (!task) {
      this.forgetSetAside();
      return next;
    }
    const entry: SetAside = { ...task, dateKey: localDateKey(new Date()), endsWith: next.sessionId, after };
    this._settingsRepo.setSetting(ContextScheduleService.SET_ASIDE_KEY, entry);
    this._setAsideFor = next.sessionId;
    return next;
  }

  /** The task set aside for `session` to end, when it is the session waited on. */
  private setAsideWaitingOn(session: ActiveSessionDTO | null): LunchResume | null {
    if (!session || session.sessionId !== this._setAsideFor) return null;
    const stored = this._settingsRepo.getSetting<unknown>(ContextScheduleService.SET_ASIDE_KEY, null);
    return isSetAside(stored) ? taskOf(stored) : null;
  }

  /** A session as the entry that starts it again. */
  private static resumeOf(session: ActiveSessionDTO): LunchResume {
    return {
      taskId: session.taskId,
      isAdHoc: session.isAdHoc,
      customTitle: session.taskTitle,
      projectId: session.projectId,
      taskKey: session.taskKey,
      dateKey: localDateKey(new Date())
    };
  }

  /**
   * Ends the day's session for the wrap-up, and every restart waiting on it.
   *
   * The restarts are dropped first: the stop's listeners are what restart a
   * task, and the day's end is not the stand-up's. The wrap-up used to stop
   * the session from the IPC handler, so a stand-up still running at wrap-up
   * time brought the task before it back -- to run all night.
   */
  public stopForWrapUp(): void {
    this._setAsideFor = null;
    this.forgetSetAside();
    this.forgetLunchResume();
    if (this._resumePrompt) this.closeResumePrompt();
    // An interruption first, then the session it held: the day ends both.
    if (this._engine.getCurrentSession()?.interruption) {
      this._endingForLunch = true;
      try {
        this._engine.stopInterruption();
      } finally {
        this._endingForLunch = false;
      }
    }
    if (this._engine.getCurrentSession()) this._engine.stopSession(WORKLOG_COMMENTS.WRAP_UP);
  }

  /**
   * The answers to this service's prompts among the actions InputDecoder
   * decodes: after lunch, resume a task that is no longer the user's?; OK on
   * the stand-up's prompt; and INTERRUPT in the paused menu. The bar's keys
   * and the Stream Deck's both reach the decoder, and the decoder reaches
   * this; anything else is not this service's to answer.
   */
  public answerFromBar(action: string): void {
    if (action === 'CONFIRM_RESUME_PROMPT' || action === 'DISMISS_RESUME_PROMPT') {
      this.answerResumePrompt(action === 'CONFIRM_RESUME_PROMPT');
    }
    if (action === 'CONFIRM_STANDUP_PROMPT') {
      this.joinStandup();
    }
    if (action === 'START_INTERRUPTION') {
      this.interrupt('bar');
    }
  }

  /** The Monday of the last week closed, or null before the first close. */
  public getLastWeekClosed(): string | null {
    return this._settingsRepo.getSetting<string | null>(ContextScheduleService.LAST_WEEK_CLOSED_KEY, null);
  }

  /**
   * When the week starting `monday` closed, or null while it is open (Check
   * my week, P9d). The moment is the wrap-up of its last working day, when
   * the close is due -- the close itself may run later, on a laptop left
   * shut, but whatever changed after that wrap-up changed a week over. A
   * week with no working day closes at its end. Only the Monday of the last
   * close is stored, so the moment is computed, never remembered.
   */
  public weekClosedAt(monday: string): Date | null {
    const closed = this.getLastWeekClosed();
    if (closed === null || monday > closed) return null;
    const end = this._calendar.lastWorkingDayOfWeek(monday);
    if (end === null) return localMidnight(addLocalDays(monday, 7));
    const settings = this.schedule();
    return atLocalTime(localMidnight(end), settings.eodWrapUpTime || settings.eodTime || '18:00');
  }

  /// <summary>
  /// The week just over, until the user has seen it; null otherwise.
  /// </summary>
  public getWeekEnded(): WeekEndedDTO | null {
    return this._settingsRepo.getSetting<WeekEndedDTO | null>(ContextScheduleService.WEEK_ENDED_KEY, null);
  }

  /// <summary>
  /// The user has seen the week's notice: it goes, from every window.
  /// </summary>
  public dismissWeekEnded(): void {
    this._settingsRepo.setSetting(ContextScheduleService.WEEK_ENDED_KEY, null);
    this.sendToWindow(IPCChannel.ON_WEEK_ENDED, null);
  }

  /**
   * Called once per week closed, with the week. Where sending the week to
   * a provider's timesheet would hang; for now the window shows it.
   */
  public onWeekEnded(listener: (week: WeekEndedDTO) => void): () => void {
    this._weekEndedListeners.add(listener);
    return () => this._weekEndedListeners.delete(listener);
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
    this.closeCeremony(type);
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
    const settings = this.schedule();
    const at = settings.eodWrapUpTime || settings.eodTime || '18:00';
    // The window opens the wrap-up where it is, without coming forward (P8c).
    this.askCeremony({ type: 'EOD', title: 'End-of-Day Wrap-Up', at }, {
      title: 'Time to end your day',
      body: 'Click to review today and send it.'
    });
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
    this.closeCeremony('LUNCH');
    const running = this._engine.getCurrentSession();
    this.pauseForBreak('lunch');

    this._priorityEngine.setUserMode('LUNCH');
    this._renderer.setContextMode('LUNCH');
    // Said with a toast only while the window is hidden; Today has its card.
    if (running?.status === 'TRACKING' && !running.interruption) {
      const settings = this.schedule();
      const end = settings.lunchEndTime || settings.lunchEnd || '13:30';
      this._outlet?.announce({
        title: `Lunch -- ${running.taskKey} paused`,
        body: `At ${end} you are asked if you are back. Click to keep working instead.`
      });
    }
  }

  /**
   * Pauses the running session for Lunch or Away (redesign P8b, D1) and
   * keeps which one, to ask "Back at your desk?" after; the mode is the
   * caller's. A pause is excluded from the session, and one of
   * `splitPauseMinutes` or more splits the worklog at the stop, so the
   * provider still gets the morning and the afternoon as two entries --
   * sent at the task's stop rather than at 12:30.
   *
   * An interruption ends at lunch, and the task it held -- running before
   * it -- takes Lunch's pause from now, so the answer resumes it. Away
   * leaves an interruption running: a call goes on away from the desk.
   * Nothing running, or a session paused already, leaves the stored entry
   * alone.
   */
  private pauseForBreak(reason: 'lunch' | 'away'): void {
    let session = this._engine.getCurrentSession();
    if (session?.interruption) {
      if (reason === 'away') return;
      const wasRunning = !session.interruption.interruptedWasPaused;
      this._endingForLunch = true;
      try {
        this._engine.stopInterruption();
      } finally {
        this._endingForLunch = false;
      }
      session = this._engine.getCurrentSession();
      if (session && wasRunning && session.status === 'PAUSED') {
        this._engine.relabelPause('lunch');
        this.keepHeld(session, 'lunch');
      }
      return;
    }
    if (reason === 'lunch' && session && isStandupSession(session, this.getStandupTask())) {
      // The meeting is over at lunch: stopped and logged, and the task it set
      // aside becomes lunch's restart (`resumeAfterSetAside`).
      this._engine.stopSession(WORKLOG_COMMENTS.LUNCH, false);
      return;
    }
    if (session && session.status === 'TRACKING') {
      this._engine.pauseSession(reason);
      this.keepHeld(session, reason);
      return;
    }
    // Away's pause running into lunch is lunch's now: the question after
    // it is lunch's.
    const stored = this._settingsRepo.getSetting<unknown>(ContextScheduleService.LUNCH_RESUME_KEY, null);
    if (reason === 'lunch' && session && isLunchResume(stored) && stored.heldSessionId === session.sessionId) {
      this._settingsRepo.setSetting(ContextScheduleService.LUNCH_RESUME_KEY, { ...stored, pausedFor: 'lunch' });
    }
  }

  /** Stores the session a break paused, to ask about it when the break ends. */
  private keepHeld(session: ActiveSessionDTO, pausedFor: 'lunch' | 'away'): void {
    this._settingsRepo.setSetting(ContextScheduleService.LUNCH_RESUME_KEY, {
      ...ContextScheduleService.resumeOf(session),
      heldSessionId: session.sessionId,
      pausedFor
    });
  }

  /// <summary>
  /// Exits LUNCH mode for WORK, and asks "Back at your desk?" about the task
  /// lunch paused.
  ///
  /// WORK first, then the question or the restart: the session listener
  /// tells the user's own start during lunch from this one by the mode.
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
  public answerResumePrompt(resume: boolean, addGapMinutes = 0, workedThrough = false): boolean {
    const data = this._resumePrompt;
    if (!data) return false;
    this.closeResumePrompt(() => {
      if (!resume) return;
      if (data.heldSessionId) {
        const open = this._engine.getCurrentSession();
        if (open?.sessionId !== data.heldSessionId || open.status !== 'PAUSED' || open.interruption) return;
        if (data.after === 'interruption') {
          // Held, not stopped: Back resumes it, the gap counted as work if asked.
          this._engine.backFromInterruption(addGapMinutes);
        } else if (workedThrough) {
          // "I worked through it": the break's pause is taken back whole.
          this._engine.withdrawPause();
        } else {
          this._engine.resumeSession();
        }
        return;
      }
      if (!this._engine.getCurrentSession()) {
        this._engine.startTask(data.taskId, data.isAdHoc, data.customTitle, data.projectId, data.taskKey);
      }
    });
    return true;
  }

  /// <summary>
  /// The user's own choice of mode -- the mode chip, the tray (P12a): Lunch,
  /// Away, or back to work from either. One place, so the two cannot differ.
  /// </summary>
  public chooseMode(mode: UserMode): void {
    if (mode === 'LUNCH') this.enterLunchMode();
    else if (mode === 'AWAY') this.enterAwayMode();
    else this.exitLunchMode();
  }

  /// <summary>
  /// Manually or automatically triggers transition into AWAY mode.
  /// </summary>
  public enterAwayMode(): void {
    // Paused before the mode, so the paused frame is what Away covers.
    this.pauseForBreak('away');
    this._priorityEngine.setUserMode('AWAY');
    this._renderer.setContextMode('AWAY');
  }

  /// <summary>
  /// Exits AWAY mode when Windows unlocks or resumes.
  ///
  /// Into LUNCH, not WORK, when that is the hour: WORK first and LUNCH at the
  /// next check drew the screen twice, and a session started in between was
  /// read as working through lunch. A session still running -- the machine
  /// slept through lunch's start, so no check stopped it -- stops now.
  /// </summary>
  public exitAwayMode(): void {
    if (this._priorityEngine.getUserMode() === 'AWAY' && this.isLunchHour() && !this.isWorkingThroughLunch()) {
      if (!this.interruptionRunning()) {
        this.enterLunchMode();
        return;
      }
      // Back from Away in an interruption at lunch time: WORK, and the
      // question, rather than ending the call unasked (S25).
      this._priorityEngine.setUserMode('WORK');
      this._renderer.setContextMode('WORK');
      this.askLunch();
      return;
    }
    this._priorityEngine.setUserMode('WORK');
    this._renderer.setContextMode('WORK');
    this.resumeAfterLunch();
  }

  /// <summary>
  /// Disposes background timers and unregisters powerMonitor listeners.
  /// </summary>
  public dispose(): void {
    this._unsubscribeEngine();
    this._unsubscribeInterruptions();
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
  }

  /**
   * After Lunch or Away: asks "Back at your desk?" about the session the
   * break paused -- once, and only while that session is still open and
   * paused; the user resuming it, stopping it or starting another answered
   * already. An entry from another day is dropped: a session paused by Away
   * overnight stays paused, and ends at the evening's lock.
   *
   * An entry with no held session is a task to start again (the stand-up's,
   * ended during lunch, or one an earlier version stopped): it restarts,
   * unless something is open now, and a task that left the user's lists over
   * the break is asked about rather than restarted.
   */
  private resumeAfterLunch(): void {
    if (this._resumePrompt) return;
    const stored = this._settingsRepo.getSetting<unknown>(ContextScheduleService.LUNCH_RESUME_KEY, null);
    if (stored === null) return;
    if (!isLunchResume(stored) || stored.dateKey !== localDateKey(new Date())) {
      this.forgetLunchResume();
      return;
    }
    if (stored.heldSessionId) {
      const open = this._engine.getCurrentSession();
      if (open?.sessionId !== stored.heldSessionId || open.status !== 'PAUSED' || open.interruption) {
        this.forgetLunchResume();
        return;
      }
      // The open session's task is kept listed by the sync; the session says
      // whether it left the user's list.
      const unlisted = open.taskUnlisted === true;
      this._resumePrompt = { ...stored, after: stored.pausedFor ?? 'lunch', unlisted, heldSessionId: stored.heldSessionId };
      const prompt = ContextScheduleService.toPromptDto(this._resumePrompt);
      this._renderer.renderResumePrompt(prompt.after, prompt.taskKey, true);
      this.sendResumePrompt(prompt);
      return;
    }
    if (this._engine.getCurrentSession()) {
      this.forgetLunchResume();
      return;
    }
    if (!stored.isAdHoc && !this._engine.isTaskListed(stored.taskId)) {
      // Kept until answered, so a restart asks again rather than forgetting.
      this.askBeforeResuming(stored, 'lunch', true);
      return;
    }
    this.forgetLunchResume();
    this._engine.startTask(stored.taskId, stored.isAdHoc, stored.customTitle, stored.projectId, stored.taskKey);
  }

  /**
   * Brings back the task the stand-up or an interruption set aside, by the
   * lunch rules: once, the same day, never over a session open now. The
   * stand-up restarts it, asking first only about a task that has left the
   * user's lists; an interruption always asks -- "back to SCRUM-12?" --
   * because the user may be done for now. During lunch it becomes lunch's
   * restart instead: lunch stopped the meeting or the interruption and kept
   * *that* to restart, which is not the work.
   */
  private resumeAfterSetAside(): void {
    const stored = this._settingsRepo.getSetting<unknown>(ContextScheduleService.SET_ASIDE_KEY, null);
    this.forgetSetAside();
    if (!isSetAside(stored) || stored.dateKey !== localDateKey(new Date())) return;
    const task = taskOf(stored);
    if (this.isDuringLunch()) {
      this._settingsRepo.setSetting(ContextScheduleService.LUNCH_RESUME_KEY, task);
      return;
    }
    if (this._engine.getCurrentSession() || this._resumePrompt) return;
    const unlisted = !task.isAdHoc && !this._engine.isTaskListed(task.taskId);
    if (stored.after === 'interruption' || unlisted) {
      this.askBeforeResuming(task, stored.after, unlisted);
      return;
    }
    this._engine.startTask(task.taskId, task.isAdHoc, task.customTitle, task.projectId, task.taskKey);
  }

  private askBeforeResuming(stored: LunchResume, after: ResumePromptDTO['after'], unlisted: boolean): void {
    this._resumePrompt = { ...stored, after, unlisted };
    const prompt = ContextScheduleService.toPromptDto(this._resumePrompt);
    this._renderer.renderResumePrompt(after, prompt.taskKey);
    this.sendResumePrompt(prompt);
  }

  /**
   * Takes back, at start, a set-aside task still waiting: the session that
   * replaced it is open. Anything else stored is from a session that ended
   * while the app was closed, and is not restarted behind the user's back.
   * The stand-up's entry from before the set-aside was shared is read once.
   */
  private adoptStoredSetAside(): void {
    const legacy = this._settingsRepo.getSetting<unknown>(ContextScheduleService.LEGACY_STANDUP_RESUME_KEY, null);
    if (legacy !== null) {
      if (isLegacyStandupResume(legacy)) {
        const entry: SetAside = {
          taskId: legacy.taskId,
          isAdHoc: legacy.isAdHoc,
          customTitle: legacy.customTitle,
          projectId: legacy.projectId,
          taskKey: legacy.taskKey,
          dateKey: legacy.dateKey,
          endsWith: legacy.standupSessionId,
          after: 'standup'
        };
        this._settingsRepo.setSetting(ContextScheduleService.SET_ASIDE_KEY, entry);
      }
      this._settingsRepo.setSetting(ContextScheduleService.LEGACY_STANDUP_RESUME_KEY, null);
    }
    const stored = this._settingsRepo.getSetting<unknown>(ContextScheduleService.SET_ASIDE_KEY, null);
    if (stored === null) return;
    const open = this._engine.getCurrentSession();
    if (isSetAside(stored) && stored.dateKey === localDateKey(new Date()) && open?.sessionId === stored.endsWith) {
      this._setAsideFor = stored.endsWith;
      return;
    }
    this.forgetSetAside();
  }

  /**
   * The interruption was assigned to the very task it set aside: the user is
   * back on it, and asking "back to SCRUM-12?" when it ends would restart the
   * task just logged.
   */
  private dropSetAsideWhenAssignedToIt(session: ActiveSessionDTO | null): void {
    if (!session || session.sessionId !== this._setAsideFor) return;
    const stored = this._settingsRepo.getSetting<unknown>(ContextScheduleService.SET_ASIDE_KEY, null);
    if (!isSetAside(stored) || stored.taskId !== session.taskId) return;
    this._setAsideFor = null;
    this.forgetSetAside();
  }

  /**
   * The session a task was set aside for ended, or the user moved on. Ended
   * -- STOP, FINISH, DROP -- brings the task back, after the listeners have
   * all heard of the end: started from inside this one, every listener after
   * it would still be handed the ended session, and the renderer would draw
   * the idle clock over the restarted task. Any other session is the user's
   * choice, and nothing comes back.
   */
  private followSetAside(session: ActiveSessionDTO | null): void {
    if (!this._setAsideFor || session?.sessionId === this._setAsideFor) return;
    this._setAsideFor = null;
    if (session) {
      this.forgetSetAside();
      return;
    }
    queueMicrotask(() => this.resumeAfterSetAside());
  }

  /**
   * A session started or resumed. During lunch that is the user working
   * through it, from the window, the mini timer or the bar: the lunch screen
   * goes, nothing restarts when lunch ends, and lunch does not start again
   * today. It used to stay LUNCH -- the sandwich over the running session --
   * and the task lunch had stopped came back at the end, over the user's.
   *
   * Only a session *becoming* TRACKING counts: a new one, or one resumed.
   * The engine tells its listeners every second while a session runs, and
   * the schedule is checked every 30 -- so a tick in the first seconds of
   * lunch, read as a start, skipped lunch for the day whenever a session was
   * running. Found on the real bar (2026-10-15).
   */
  private onSessionChanged(session: ActiveSessionDTO | null): void {
    this.followSetAside(session);
    this.dropSetAsideWhenAssignedToIt(session);
    const before = this._lastSeen;
    this.noteSeen(session);
    if (session?.status !== 'TRACKING') return;
    if (before?.sessionId === session.sessionId && before.tracking) return;
    // Resumed, or another started: the break's question is answered.
    this.forgetHeldBreak();
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

  private noteSeen(session: ActiveSessionDTO | null): void {
    this._lastSeen = session ? { sessionId: session.sessionId, tracking: session.status === 'TRACKING' } : null;
  }

  /**
   * LUNCH, or the lunch hours while Away ended and the next check has not yet
   * entered LUNCH: a session started then would be stopped by it.
   */
  private isDuringLunch(): boolean {
    const mode = this._priorityEngine.getUserMode();
    if (mode === 'LUNCH') return true;
    if (mode !== 'WORK') return false;
    return this.isLunchHour();
  }

  /** Whether now falls in the configured lunch window, whatever the mode. */
  private isLunchHour(): boolean {
    const settings = normalizeScheduleSettings(
      this._settingsRepo.getSetting<ScheduleSettingsDTO>('schedule_settings', {})
    );
    const lunch = ContextScheduleService.lunchWindow(settings);
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    return minutes >= lunch.startMins && minutes < lunch.endMins;
  }

  /** The user started work during today's lunch, so it does not start again. */
  private interruptionRunning(): boolean {
    return Boolean(this._engine.getCurrentSession()?.interruption);
  }

  /**
   * "Start lunch? It ends 'Call with Marc'" (S25): asked once, and kept until
   * answered, the interruption ends another way, or lunch is over.
   */
  private askLunch(): void {
    if (this._ceremonyPrompt?.type === 'LUNCH') return;
    const session = this._engine.getCurrentSession();
    const name = session?.taskTitle || 'the interruption';
    const settings = this.schedule();
    const at = settings.lunchStartTime || settings.lunchStart || '12:30';
    this.askCeremony({ type: 'LUNCH', title: 'Lunch time', at, endsInterruption: name }, {
      title: 'Lunch time -- you are in an interruption',
      body: `Start lunch? It ends "${name}", which waits to be placed.`
    });
  }

  /**
   * The answer to "Start lunch?": yes ends the interruption -- it waits to be
   * placed -- and starts Lunch; Not now is working through lunch, as a task
   * started during it is, so it is not asked again today. False when nothing
   * was asked.
   */
  public answerLunchQuestion(start: boolean): boolean {
    if (this._ceremonyPrompt?.type !== 'LUNCH') return false;
    this.closeCeremony('LUNCH');
    if (start) {
      this.enterLunchMode();
    } else {
      this._settingsRepo.setSetting(ContextScheduleService.LUNCH_SKIPPED_KEY, localDateKey(new Date()));
    }
    return true;
  }

  private isWorkingThroughLunch(): boolean {
    return this._settingsRepo.getSetting<string | null>(ContextScheduleService.LUNCH_SKIPPED_KEY, null) === localDateKey(new Date());
  }

  /** Ends the question: the stored resume, the bar's lock and the window's dialog, around `between`. */
  private closeResumePrompt(between?: () => void): void {
    this._resumePrompt = null;
    this.forgetLunchResume();
    this.forgetSetAside();
    // The session starts under the prompt's lock, and its release draws it.
    between?.();
    this._priorityEngine.releaseActiveLock(RESUME_PROMPT_EVENT);
    this.sendResumePrompt(null);
  }

  private forgetLunchResume(): void {
    this._settingsRepo.setSetting(ContextScheduleService.LUNCH_RESUME_KEY, null);
  }

  /** Drops a stored break pause; a task to restart is the lunch rules' to keep. */
  private forgetHeldBreak(): void {
    const stored = this._settingsRepo.getSetting<unknown>(ContextScheduleService.LUNCH_RESUME_KEY, null);
    if (isLunchResume(stored) && stored.heldSessionId) this.forgetLunchResume();
  }

  /**
   * Closes last week if nothing did: its last working day passed with the
   * app closed, or before its wrap-up time -- a Friday off that the
   * calendar did not know of, a laptop left shut. The first working day
   * after catches it. The first run ever closes nothing: there is no week
   * before the app knew to close one.
   */
  private closeLastWeekIfMissed(today: string): void {
    const lastMonday = addLocalDays(weekStartKey(today), -7);
    const closed = this._settingsRepo.getSetting<string | null>(ContextScheduleService.LAST_WEEK_CLOSED_KEY, null);
    if (closed === null) {
      this._settingsRepo.setSetting(ContextScheduleService.LAST_WEEK_CLOSED_KEY, lastMonday);
      return;
    }
    if (closed >= lastMonday) return;
    const end = this._calendar.lastWorkingDayOfWeek(lastMonday);
    if (end === null) {
      // A week off: nothing was worked, so nothing to tell.
      this._settingsRepo.setSetting(ContextScheduleService.LAST_WEEK_CLOSED_KEY, lastMonday);
      return;
    }
    this.closeWeek(lastMonday, end);
  }

  /** Closes the week starting `monday` -- once, whoever asks twice. */
  private closeWeek(monday: string, end: string): void {
    const closed = this._settingsRepo.getSetting<string | null>(ContextScheduleService.LAST_WEEK_CLOSED_KEY, null);
    if (closed !== null && closed >= monday) return;
    this._settingsRepo.setSetting(ContextScheduleService.LAST_WEEK_CLOSED_KEY, monday);

    const week: WeekEndedDTO = { weekStart: monday, weekEnd: end, loggedSeconds: this._engine.getLoggedSeconds(monday, end) };
    console.log(`[ContextScheduleService] Week ${monday} to ${end} closed: ${week.loggedSeconds} s logged.`);
    this._settingsRepo.setSetting(ContextScheduleService.WEEK_ENDED_KEY, week);
    this.sendToWindow(IPCChannel.ON_WEEK_ENDED, week);
    for (const listener of this._weekEndedListeners) {
      try {
        listener(week);
      } catch (err) {
        // The week is closed and shown whatever a listener does with it.
        console.error('[ContextScheduleService] Week-ended listener failed:', err);
      }
    }
  }

  private sendToWindow(channel: IPCChannel, payload: unknown): void {
    this.send(channel, payload);
  }

  /** To every window through the outlet; to the dashboard alone without one. */
  private send(channel: IPCChannel, payload: unknown): void {
    if (this._outlet) {
      this._outlet.send(channel, payload);
      return;
    }
    const win = this._getWindow?.();
    if (!win || win.isDestroyed()) return;
    win.webContents.send(channel, payload);
  }

  private schedule(): ScheduleSettingsDTO {
    return normalizeScheduleSettings(this._settingsRepo.getSetting<ScheduleSettingsDTO>('schedule_settings', {}));
  }

  private forgetSetAside(): void {
    this._settingsRepo.setSetting(ContextScheduleService.SET_ASIDE_KEY, null);
  }

  /**
   * Asks on Today and the mini timer, and with a toast while the window is
   * hidden; null closes the question everywhere. It used to show() the
   * window, which came up over whatever the user was doing (P8c).
   */
  private sendResumePrompt(prompt: ResumePromptDTO | null): void {
    this.send(IPCChannel.ON_RESUME_PROMPT, prompt);
    if (prompt) this._outlet?.announce(ContextScheduleService.announcementOf(prompt));
  }

  /** The toast's words for each question (S26). */
  private static announcementOf(prompt: ResumePromptDTO): PromptAnnouncement {
    if (prompt.held) {
      const what = prompt.after === 'away' ? 'Away' : 'Lunch';
      return { title: `${what} is over. Back at your desk?`, body: `${prompt.taskKey} starts when you say.` };
    }
    if (prompt.after === 'interruption') {
      return { title: `Nothing is running. Back to ${prompt.taskKey}?`, body: 'Click to go back to it, or leave it.' };
    }
    return {
      title: `Resume ${prompt.taskKey}?`,
      body: 'It is no longer assigned to you. Click to resume it anyway, or leave it.'
    };
  }

  /** Unlisted goes without saying after lunch and the stand-up, which ask only then. */
  private static toPromptDto(data: ResumeQuestion): ResumePromptDTO {
    const prompt: ResumePromptDTO = { taskKey: data.taskKey || data.taskId, taskTitle: data.customTitle ?? '', after: data.after };
    if ((data.after === 'interruption' || data.heldSessionId) && data.unlisted) prompt.unlisted = true;
    if (data.heldSessionId && data.after !== 'interruption') prompt.held = true;
    if (data.interruptionEndedAtUtc) prompt.interruptionEndedAtUtc = data.interruptionEndedAtUtc;
    return prompt;
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
