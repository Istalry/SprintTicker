import { ScheduleSettingsDTO } from './dtos';
import { DEFAULT_WORKING_DAYS, checkWorkingDays } from './working-days';
import { DEFAULT_SPLIT_PAUSE_MINUTES, checkSplitPauseMinutes } from './work-split';

/**
 * The seed schedule, and the one place that understands the alias pairs.
 *
 * Two problems lived here, and they compounded.
 *
 * **Duplicate seeds.** `ipc-handler-registry` and `context-schedule-service`
 * each carried their own default object, and they did not agree on key names:
 * one used `lunchStart`/`eodTime`, the other `lunchStartTime`/`eodWrapUpTime`.
 * On a fresh install, which schedule the app believed depended on whether the
 * settings screen or the scheduler read the row first. The notification
 * defaults had already shipped this exact bug, which is why they moved to
 * `src/shared/` too.
 *
 * **Alias pairs.** `ScheduleSettingsDTO` carries both spellings, and the
 * Ceremonies view writes both on every save. That is what keeps them in sync
 * today -- a single component, by hand. A stored row therefore looks like
 * `{"lunchStart":"12:18","lunchStartTime":"12:18", ...}`: the same value twice.
 * Any writer that forgets one half leaves the two readers disagreeing, and
 * nothing would report it.
 *
 * Rather than migrate the stored shape -- which would break a downgrade and
 * gains little -- `normalizeScheduleSettings` is the only thing allowed to
 * resolve the pairs. Read through it, write through it, and the aliases cannot
 * drift apart.
 */

/**
 * The task the stand-up switches to: what the team calls it. Ad-hoc, and one
 * row reused every day rather than a new one each morning. The bar's meeting
 * animation follows any title containing "standup".
 */
export const DAILY_STANDUP_TITLE = 'Daily Standup';

/**
 * Neutral working hours.
 *
 * These were `10:05` and `12:18` -- one developer's actual calendar shipped as
 * every user's default, precise to the minute in a way that only makes sense
 * if you are that developer.
 */
export const DEFAULT_SCHEDULE_SETTINGS: Readonly<Required<Pick<ScheduleSettingsDTO,
  'standupTime' | 'enableStandupPrompt' | 'lunchStartTime' | 'lunchEndTime' |
  'enableLunchMute' | 'eodWrapUpTime' | 'promptTimeoutSeconds' | 'askAboutForgottenSessions'>>> = {
  standupTime: '09:30',
  enableStandupPrompt: true,
  lunchStartTime: '12:30',
  lunchEndTime: '13:30',
  enableLunchMute: true,
  eodWrapUpTime: '17:30',
  // 0 means the prompt waits indefinitely rather than dismissing itself.
  promptTimeoutSeconds: 0,
  askAboutForgottenSessions: true
};

/**
 * Resolves a stored settings object into one where both spellings of every
 * aliased field are present and identical.
 *
 * The canonical spelling wins when the two disagree: it is what
 * `ScheduleSettingsDTO` documents and what the scheduler reads first, so a row
 * where they differ is already being interpreted that way.
 */
export function normalizeScheduleSettings(
  stored?: Partial<ScheduleSettingsDTO> | null
): ScheduleSettingsDTO {
  const s = stored ?? {};

  const lunchStartTime = s.lunchStartTime ?? s.lunchStart ?? DEFAULT_SCHEDULE_SETTINGS.lunchStartTime;
  const lunchEndTime = s.lunchEndTime ?? s.lunchEnd ?? DEFAULT_SCHEDULE_SETTINGS.lunchEndTime;
  const eodWrapUpTime = s.eodWrapUpTime ?? s.eodTime ?? DEFAULT_SCHEDULE_SETTINGS.eodWrapUpTime;
  const promptTimeoutSeconds =
    s.promptTimeoutSeconds ?? s.autoDismissSeconds ?? DEFAULT_SCHEDULE_SETTINGS.promptTimeoutSeconds;

  return {
    ...s,
    standupTime: s.standupTime ?? DEFAULT_SCHEDULE_SETTINGS.standupTime,
    enableStandupPrompt: s.enableStandupPrompt ?? DEFAULT_SCHEDULE_SETTINGS.enableStandupPrompt,
    enableLunchMute: s.enableLunchMute ?? DEFAULT_SCHEDULE_SETTINGS.enableLunchMute,
    askAboutForgottenSessions: s.askAboutForgottenSessions ?? DEFAULT_SCHEDULE_SETTINGS.askAboutForgottenSessions,
    // A stored list the schedule cannot use is the default, not "no day":
    // an empty week would silence every ceremony for good.
    workingDays: checkWorkingDays(s.workingDays) === null ? [...s.workingDays!] : [...DEFAULT_WORKING_DAYS],
    splitPauseMinutes: checkSplitPauseMinutes(s.splitPauseMinutes) === null ? s.splitPauseMinutes : DEFAULT_SPLIT_PAUSE_MINUTES,

    lunchStartTime,
    lunchStart: lunchStartTime,
    lunchEndTime,
    lunchEnd: lunchEndTime,
    eodWrapUpTime,
    eodTime: eodWrapUpTime,
    promptTimeoutSeconds,
    autoDismissSeconds: promptTimeoutSeconds
  };
}

/** `HH:MM`, 00:00 to 23:59, as a time input holds it. */
const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Why a schedule cannot be kept, or null when it can. Shared, so the
 * Ceremonies view refuses what main would.
 *
 * Lunch must start before it ends, on one day. The scheduler compares
 * minutes of the day, so a window across midnight -- or one whose end comes
 * first -- never matched any minute: lunch silently never began.
 */
export function checkScheduleSettings(settings: ScheduleSettingsDTO): string | null {
  const s = normalizeScheduleSettings(settings);
  const times: Array<[string, string | undefined]> = [
    ['Stand-up', s.standupTime], ['Lunch start', s.lunchStartTime], ['Lunch end', s.lunchEndTime], ['End of day', s.eodWrapUpTime]
  ];
  for (const [name, value] of times) {
    if (!value || !CLOCK_TIME.test(value)) return `${name} must be a time of day, HH:MM.`;
  }
  if (s.lunchStartTime! >= s.lunchEndTime!) return 'Lunch must end after it starts, on the same day.';
  if (settings.splitPauseMinutes !== undefined) {
    const refusal = checkSplitPauseMinutes(settings.splitPauseMinutes);
    if (refusal) return refusal;
  }
  if (settings.workingDays !== undefined) return checkWorkingDays(settings.workingDays);
  return null;
}
