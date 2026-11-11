import { ArgumentNullException, MorningDTO, MorningTaskDTO, ScheduleSettingsDTO, TaskDTO } from '../../shared/dtos';
import { localDateKey } from '../../shared/local-date';
import { DEFAULT_SCHEDULE_SETTINGS, normalizeScheduleSettings } from '../../shared/schedule-defaults';
import { TaskOwnership } from '../../shared/task-ownership';
import { isAdHocTaskId } from '../db/id-generator';

/** The setting holding the local day the morning card was last seen or dismissed on. */
export const MORNING_SEEN_KEY = 'morning_seen_date';

/** How many recent tasks are looked through for the last one worth continuing. */
const RECENT_LOOKED_AT = 10;

export interface MorningDeps {
  isWorkingDay: (dateKey: string) => boolean;
  getSetting: <T>(key: string, fallback: T) => T;
  setSetting: (key: string, value: unknown) => void;
  /** Whether a session is open, running or paused. */
  hasSession: () => boolean;
  /** Whether anything is logged on the day. */
  loggedOn: (dateKey: string) => boolean;
  /** The tasks timed last, newest first, listed ones only. */
  recentTasks: (limit: number) => TaskDTO[];
  /** When the task's last entry ended, or null when it has none. */
  lastEndOf: (taskId: string) => string | null;
  /** Every task in the lists. */
  listedTasks: () => TaskDTO[];
  schedule: () => ScheduleSettingsDTO;
  now?: () => Date;
}

const asMorningTask = (task: TaskDTO): MorningTaskDTO => ({ id: task.id, key: task.key, title: task.title });

/** The user's own open work: not ad-hoc, not done, and theirs. */
const isOwnOpenTask = (task: TaskDTO): boolean =>
  !isAdHocTaskId(task.id) && task.status !== 'done' && (task.ownership ?? TaskOwnership.MINE) === TaskOwnership.MINE;

/**
 * The morning card (S4b): the first look at Today on a working day starts
 * with what yesterday left -- the last task, still open, to carry on; the
 * stand-up's time; the user's tasks in progress. The interruptions to place
 * are the window's own list.
 *
 * Asked for, never pushed: Today reads it when it opens. It answers null
 * once the day has begun -- a session open, or anything logged today -- on
 * a day off, and once the card was seen (a start or a dismissal, stored as
 * the day), so it is the day's first look only.
 */
export class MorningService {
  private readonly _deps: MorningDeps;

  constructor(deps: MorningDeps) {
    if (!deps) throw new ArgumentNullException('deps');
    this._deps = deps;
  }

  public getMorning(): MorningDTO | null {
    const now = this._deps.now?.() ?? new Date();
    const dateKey = localDateKey(now);
    if (!this._deps.isWorkingDay(dateKey)) return null;
    if (this._deps.getSetting<string | null>(MORNING_SEEN_KEY, null) === dateKey) return null;
    if (this._deps.hasSession() || this._deps.loggedOn(dateKey)) return null;

    const last = this._deps.recentTasks(RECENT_LOOKED_AT).find(isOwnOpenTask) ?? null;
    const stoppedAtUtc = last ? this._deps.lastEndOf(last.id) : null;
    const inProgress = this._deps.listedTasks()
      .filter(task => task.status === 'in_progress' && isOwnOpenTask(task) && task.id !== last?.id)
      .map(asMorningTask);

    return {
      dateKey,
      lastTask: last && stoppedAtUtc ? { ...asMorningTask(last), stoppedAtUtc } : null,
      standupAt: this.standupLaterToday(now),
      inProgress
    };
  }

  /** The card was seen: a task started, or the user put it away. Once a day. */
  public markSeen(): void {
    const now = this._deps.now?.() ?? new Date();
    this._deps.setSetting(MORNING_SEEN_KEY, localDateKey(now));
  }

  /** "09:30" while the stand-up is still to come today; null when it is off or past. */
  private standupLaterToday(now: Date): string | null {
    // Normalised, so a row written with the short aliases reads the same.
    const settings = normalizeScheduleSettings(this._deps.schedule());
    if (settings.enableStandupPrompt === false) return null;
    const at = settings.standupTime || DEFAULT_SCHEDULE_SETTINGS.standupTime!;
    const [h, m] = at.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return now.getHours() * 60 + now.getMinutes() < h * 60 + m ? at : null;
  }
}
