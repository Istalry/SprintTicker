import { ScheduleSettingsDTO } from './dtos';

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
 * Neutral working hours.
 *
 * These were `10:05` and `12:18` -- one developer's actual calendar shipped as
 * every user's default, precise to the minute in a way that only makes sense
 * if you are that developer.
 */
export const DEFAULT_SCHEDULE_SETTINGS: Readonly<Required<Pick<ScheduleSettingsDTO,
  'standupTime' | 'enableStandupPrompt' | 'lunchStartTime' | 'lunchEndTime' |
  'enableLunchMute' | 'eodWrapUpTime' | 'promptTimeoutSeconds'>>> = {
  standupTime: '09:30',
  enableStandupPrompt: true,
  lunchStartTime: '12:30',
  lunchEndTime: '13:30',
  enableLunchMute: true,
  eodWrapUpTime: '17:30',
  // 0 means the prompt waits indefinitely rather than dismissing itself.
  promptTimeoutSeconds: 0
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
