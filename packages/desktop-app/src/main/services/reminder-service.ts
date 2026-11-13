import type { ActiveSessionDTO, ResumePromptDTO, ScheduleSettingsDTO, UserMode } from '../../shared/dtos';
import { ArgumentNullException, ReminderDTO } from '../../shared/dtos';
import { IPCChannel } from '../../shared/ipc-channels';
import { FlowSettingKey, PromptDelaysSetting, readPromptDelays } from '../../shared/flow-settings';
import { normalizeScheduleSettings } from '../../shared/schedule-defaults';
import { atLocalTime, localDateKey } from '../../shared/local-date';
import type { PromptOutlet } from '../windows/prompt-outlet';

const MS_PER_MINUTE = 60_000;

/** What the reminders read of the day, each piece a dependency so a test can set it. */
export interface ReminderDeps {
  getSession: () => ActiveSessionDTO | null;
  /** Called with the session whenever the engine says it changed. */
  subscribe: (listener: (session: ActiveSessionDTO | null) => void) => () => void;
  getSetting: <T>(key: string, fallback: T) => T;
  getUserMode: () => UserMode;
  isWorkingDay: (dateKey: string) => boolean;
  /** The stand-up's session -- the local Daily Standup or the task chosen for it. */
  isStandupSession: (session: ActiveSessionDTO) => boolean;
  /** "Back to MG-12?" being asked, if it is: its own question, asked again by toast once. */
  getResumePrompt: () => ResumePromptDTO | null;
  outlet: () => PromptOutlet | null;
  /**
   * Told whenever the reminder asked changes, null when it goes: the bar
   * draws NOTHING TIMING from here and lets go of it (P14e).
   */
  onReminder?: (reminder: ReminderDTO | null) => void;
  now?: () => number;
}

/** The working hours of a day: from the stand-up to the wrap-up, on a working day. */
export function inWorkingHours(now: Date, schedule: ScheduleSettingsDTO, isWorkingDay: (dateKey: string) => boolean): boolean {
  if (!isWorkingDay(localDateKey(now))) return false;
  const s = normalizeScheduleSettings(schedule);
  const start = atLocalTime(now, s.standupTime ?? '09:30').getTime();
  const end = atLocalTime(now, s.eodWrapUpTime ?? '17:30').getTime();
  return now.getTime() >= start && now.getTime() < end;
}

/**
 * The reminder due now, if any (redesign P8d, 13.4): the state the user is
 * in, and since when, against its delay. Pure, for the tests; the service
 * decides whether it was asked already.
 *
 * - **Nothing timing** for `nothingTiming` minutes, counted from the later of
 *   when nothing started running and the day's working hours starting. Not
 *   while "Back to MG-12?" is asked: that question is the reminder.
 * - **Still paused?** after `longPause` minutes of a pause the user took.
 * - **Still on it?** after `interruptionRunning` minutes of an interruption.
 * - **Still in it?** after `standupRunning` minutes of the stand-up.
 */
export function dueReminder(
  session: ActiveSessionDTO | null,
  idleSinceMs: number | null,
  dayStartMs: number,
  nowMs: number,
  delays: PromptDelaysSetting,
  isStandup: (session: ActiveSessionDTO) => boolean,
  resumeAsked: boolean
): ReminderDTO | null {
  const minutesSince = (fromMs: number) => Math.floor((nowMs - fromMs) / MS_PER_MINUTE);
  if (!session) {
    if (idleSinceMs === null || resumeAsked) return null;
    const from = Math.max(idleSinceMs, dayStartMs);
    const minutes = minutesSince(from);
    if (minutes < delays.nothingTiming) return null;
    return { id: `nothing-timing:${new Date(idleSinceMs).toISOString()}`, kind: 'nothing-timing', sinceUtc: new Date(from).toISOString(), minutes };
  }
  if (session.interruption) {
    const since = Date.parse(session.interruption.startedAtUtc);
    const minutes = minutesSince(since);
    if (minutes < delays.interruptionRunning) return null;
    return {
      id: `interruption:${session.interruption.id}`,
      kind: 'interruption-running',
      sinceUtc: session.interruption.startedAtUtc,
      minutes,
      name: session.interruption.title,
      heldTaskKey: session.interruption.interruptedSessionId ? session.interruption.interruptedTaskKey ?? undefined : undefined
    };
  }
  if (session.status === 'PAUSED' && session.lastPauseStartUtc) {
    const minutes = minutesSince(Date.parse(session.lastPauseStartUtc));
    if (minutes < delays.longPause) return null;
    return {
      id: `long-pause:${session.sessionId}:${session.lastPauseStartUtc}`,
      kind: 'long-pause',
      sinceUtc: session.lastPauseStartUtc,
      minutes,
      taskKey: session.taskKey
    };
  }
  if (session.status === 'TRACKING' && isStandup(session)) {
    const minutes = minutesSince(Date.parse(session.startTimeUtc));
    if (minutes < delays.standupRunning) return null;
    return { id: `standup:${session.sessionId}`, kind: 'standup-running', sinceUtc: session.startTimeUtc, minutes, taskKey: session.taskKey };
  }
  return null;
}

/** The toast's words for a reminder, said only while the window is hidden. */
function announcementOf(reminder: ReminderDTO): { title: string; body: string } {
  switch (reminder.kind) {
    case 'nothing-timing':
      return { title: `Nothing timing for ${reminder.minutes} min`, body: 'Click to start a task, or leave it.' };
    case 'long-pause':
      return { title: `${reminder.minutes} min paused on ${reminder.taskKey}`, body: 'Still paused? Click to resume it, or leave it.' };
    case 'interruption-running':
      return { title: `${reminder.minutes} min on "${reminder.name}"`, body: 'Still on it? Click to go back, or carry on.' };
    case 'standup-running':
      return { title: `${reminder.minutes} min in the stand-up`, body: 'Still in it? Click to end it, or carry on.' };
  }
}

/**
 * The "still...?" questions (redesign P8d): each asked **once** per
 * occurrence, in working hours only, on Today, the mini timer and -- while
 * the window is hidden -- a toast. It goes when answered ("Not now" is final
 * for that occurrence) or when the state it is about ends: resuming, going
 * back, starting a task. Evaluated on the schedule's 30 s tick.
 *
 * Also "Back to MG-12?" left unanswered for `nothingTiming` minutes: a toast
 * asks it once more (S10); the question itself is the schedule service's.
 */
export class ReminderService {
  private readonly _deps: ReminderDeps;
  private readonly _asked = new Set<string>();
  private _current: ReminderDTO | null = null;
  /** When nothing started running, as this service saw it; null while something runs. */
  private _idleSinceMs: number | null;
  private readonly _unsubscribe: () => void;

  constructor(deps: ReminderDeps) {
    if (!deps) throw new ArgumentNullException('deps');
    this._deps = deps;
    this._idleSinceMs = deps.getSession() ? null : this.now();
    this._unsubscribe = deps.subscribe(session => this.onSessionChanged(session));
  }

  /** The reminder being asked, for a window opened after it was. */
  public getReminder(): ReminderDTO | null {
    return this._current;
  }

  /** Not now, Still paused, Still on it, Still in it: final for this occurrence. */
  public dismiss(id: string): boolean {
    if (this._current?.id !== id) return false;
    this.close();
    return true;
  }

  /** Every 30 s, from the schedule's check. */
  public evaluate(): void {
    const nowMs = this.now();
    const now = new Date(nowMs);
    const schedule = this._deps.getSetting<ScheduleSettingsDTO>('schedule_settings', {});
    const inHours = this._deps.getUserMode() === 'WORK' && inWorkingHours(now, schedule, this._deps.isWorkingDay);
    const resume = this._deps.getResumePrompt();
    if (!inHours) {
      this.close();
      return;
    }
    this.askBackAgain(resume, nowMs);

    const s = normalizeScheduleSettings(schedule);
    const dayStartMs = atLocalTime(now, s.standupTime ?? '09:30').getTime();
    const delays = readPromptDelays(this._deps.getSetting<unknown>(FlowSettingKey.PROMPT_DELAYS, null));
    const due = dueReminder(this._deps.getSession(), this._idleSinceMs, dayStartMs, nowMs, delays,
      this._deps.isStandupSession, resume !== null);

    if (this._current && this._current.id !== due?.id) this.close();
    if (!due || this._asked.has(due.id)) return;
    this._asked.add(due.id);
    this._current = due;
    this._deps.outlet()?.send(IPCChannel.ON_REMINDER, due);
    this._deps.onReminder?.(due);
    this._deps.outlet()?.announce(announcementOf(due));
  }

  public dispose(): void {
    this._unsubscribe();
  }

  /** The state a reminder is about may have ended: it goes at once, not at the next tick. */
  private onSessionChanged(session: ActiveSessionDTO | null): void {
    if (session && this._idleSinceMs !== null) this._idleSinceMs = null;
    if (!session && this._idleSinceMs === null) this._idleSinceMs = this.now();
    if (!this._current) return;
    const still = dueReminder(session, this._idleSinceMs, 0, this.now(), ZERO_DELAYS, this._deps.isStandupSession, false);
    if (still?.id !== this._current.id) this.close();
  }

  /** "Back to MG-12?" unanswered a while: a toast asks once more (S10). */
  private askBackAgain(resume: ResumePromptDTO | null, nowMs: number): void {
    if (resume?.after !== 'interruption' || !resume.interruptionEndedAtUtc) return;
    const id = `back:${resume.interruptionEndedAtUtc}`;
    if (this._asked.has(id)) return;
    const delays = readPromptDelays(this._deps.getSetting<unknown>(FlowSettingKey.PROMPT_DELAYS, null));
    if (nowMs - Date.parse(resume.interruptionEndedAtUtc) < delays.nothingTiming * MS_PER_MINUTE) return;
    this._asked.add(id);
    this._deps.outlet()?.announce({
      title: `Nothing is running. Back to ${resume.taskKey}?`,
      body: 'Click to go back to it, or leave it.'
    });
  }

  private close(): void {
    if (!this._current) return;
    this._current = null;
    this._deps.outlet()?.send(IPCChannel.ON_REMINDER, null);
    this._deps.onReminder?.(null);
  }

  private now(): number {
    return this._deps.now ? this._deps.now() : Date.now();
  }
}

/** Matches the state alone, whatever the delays: whether the occurrence still holds. */
const ZERO_DELAYS: PromptDelaysSetting = { nothingTiming: 0, longPause: 0, standupRunning: 0, interruptionRunning: 0 };
