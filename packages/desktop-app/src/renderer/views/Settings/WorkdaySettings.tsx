import React, { useEffect, useState } from 'react';
import { couldNot } from '../../utils/formatters';
import { END_MY_DAY } from '../../../shared/words';
import { useAutoSave } from '../../hooks/useAutoSave';
import { ScheduleSettingsDTO } from '../../../shared/dtos';
import { DEFAULT_SCHEDULE_SETTINGS, checkScheduleSettings } from '../../../shared/schedule-defaults';
import { DEFAULT_WORKING_DAYS, WEEKDAYS_MONDAY_FIRST, checkWorkingDays } from '../../../shared/working-days';
import { DEFAULT_SPLIT_PAUSE_MINUTES, checkSplitPauseMinutes } from '../../../shared/work-split';
import { DEFAULT_PROMPT_DELAYS, FlowSettingKey, PromptDelaysSetting } from '../../../shared/flow-settings';
import { useProviderCapabilities } from '../../hooks/useProviderCapabilities';
import { ProviderId } from '../../../shared/provider-names';
import { StandupSetting } from '../../components/StandupSetting';
import { ShutdownAtEndOfDaySetting } from '../../components/ShutdownAtEndOfDaySetting';
import { useAnnounce } from '../../components/LiveAnnouncer';
import {
  SETTING_SELECT_CLASS, SettingButton, SettingProblem, SettingRow, SettingSwitch, SettingsList
} from '../../components/SettingRow';

/** The waits a reminder offers, in minutes; a stored one outside the list still shows as itself. */
const REMINDER_MINUTES = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120];
/** The pauses that start a new entry, in minutes; 0 is never. */
const SPLIT_MINUTES = [0, 5, 10, 15, 30, 60];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The "still...?" reminders (P8d), each a row, in S21's words, and the time-away question. */
const REMINDER_ROWS: ReadonlyArray<{ key: keyof PromptDelaysSetting; title: string; does: string }> = [
  { key: 'nothingTiming', title: 'Nothing timing in working hours', does: 'Asks once, after this long, whether you meant to stop.' },
  { key: 'longPause', title: 'A pause that runs long', does: 'Asks once, after this long, whether you are still paused.' },
  { key: 'standupRunning', title: 'A stand-up still running', does: 'Asks once, after this long, whether it is still going on.' },
  { key: 'interruptionRunning', title: 'An interruption still running', does: 'Asks once, after this long, whether it is still going on.' },
  { key: 'timeAway', title: 'Back after time away', does: 'Locking keeps the task timing. Back after this long, asks once whether the time was on it.' }
];

const withStored = (choices: readonly number[], stored: number): number[] =>
  choices.includes(stored) ? [...choices] : [...choices, stored].sort((a, b) => a - b);

/** The last working day in the week, Monday first: the one whose wrap-up closes the week. */
function closingDay(workingDays: readonly number[]): string | null {
  const last = [...WEEKDAYS_MONDAY_FIRST].reverse().find(({ day }) => workingDays.includes(day));
  return last ? WEEKDAY_NAMES[last.day] : null;
}

/**
 * Settings · My workday (S21), a page of rows: the working days, the
 * stand-up, lunch, the end of day, when the week closes, the four reminders'
 * delays, a timer left overnight, and the pause that starts a new entry.
 *
 * The schedule saves as it is edited, through one `saveScheduleSettings`,
 * and only once valid: checked here as main checks it, so a half-typed lunch
 * is shown as wrong rather than saved and silently never matching a minute.
 * The reminders' delays are their own flow setting and save on change.
 */
export const WorkdaySettings: React.FC = () => {
  const { capabilities, providerName } = useProviderCapabilities();
  const [standupTime, setStandupTime] = useState<string>(DEFAULT_SCHEDULE_SETTINGS.standupTime);
  const [lunchStart, setLunchStart] = useState<string>(DEFAULT_SCHEDULE_SETTINGS.lunchStartTime);
  const [lunchEnd, setLunchEnd] = useState<string>('13:00');
  const [eodTime, setEodTime] = useState<string>('17:30');
  const [askAboutForgotten, setAskAboutForgotten] = useState<boolean>(DEFAULT_SCHEDULE_SETTINGS.askAboutForgottenSessions);
  const [workingDays, setWorkingDays] = useState<number[]>([...DEFAULT_WORKING_DAYS]);
  const [splitPauseMinutes, setSplitPauseMinutes] = useState<number>(DEFAULT_SPLIT_PAUSE_MINUTES);
  // With no stored settings to read there is nothing to wait for; loaded
  // is otherwise set once the read settles.
  const [loaded, setLoaded] = useState<boolean>(() => !window.electronAPI?.getScheduleSettings);
  const [delays, setDelays] = useState<PromptDelaysSetting | null>(null);
  const [delayProblem, setDelayProblem] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  useAnnounce(shown, shown ?? '');

  useEffect(() => {
    if (window.electronAPI?.getScheduleSettings) {
      window.electronAPI.getScheduleSettings().then(sched => {
        if (sched) {
          if (sched.standupTime) setStandupTime(sched.standupTime);
          if (sched.lunchStart) setLunchStart(sched.lunchStart);
          if (sched.lunchEnd) setLunchEnd(sched.lunchEnd);
          if (sched.eodTime) setEodTime(sched.eodTime);
          if (sched.askAboutForgottenSessions !== undefined) setAskAboutForgotten(sched.askAboutForgottenSessions);
          if (sched.workingDays) setWorkingDays(sched.workingDays);
          if (sched.splitPauseMinutes !== undefined) setSplitPauseMinutes(sched.splitPauseMinutes);
        }
      }).catch(err => console.error('[WorkdaySettings] Error loading schedule settings:', err))
        // Auto-save must stay off until the stored schedule has arrived, or
        // the page would write its defaults over it.
        .finally(() => setLoaded(true));
    }
    window.electronAPI?.getFlowSetting?.(FlowSettingKey.PROMPT_DELAYS)
      .then(setDelays, (err: unknown) => setDelayProblem(couldNot('change the reminders', err)));
  }, []);

  const settings: ScheduleSettingsDTO = {
    standupTime,
    lunchStart,
    lunchEnd,
    lunchStartTime: lunchStart,
    lunchEndTime: lunchEnd,
    eodTime,
    eodWrapUpTime: eodTime,
    askAboutForgottenSessions: askAboutForgotten,
    workingDays,
    splitPauseMinutes
  };
  const refusal = checkScheduleSettings(settings);
  // Each refusal is shown under the row it is about: the week's under the
  // working days, the split's under its row, anything else under lunch.
  const weekRefusal = checkWorkingDays(workingDays);
  const splitRefusal = checkSplitPauseMinutes(splitPauseMinutes);

  const handleSave = async () => {
    if (refusal) throw new Error(refusal);
    await window.electronAPI?.saveScheduleSettings?.(settings);
  };

  const saveStatus = useAutoSave(
    handleSave,
    [standupTime, lunchStart, lunchEnd, eodTime, askAboutForgotten, workingDays, splitPauseMinutes],
    loaded
  );

  const saveDelay = (key: keyof PromptDelaysSetting, minutes: number): void => {
    if (!delays) return;
    const next = { ...delays, [key]: minutes };
    setDelays(next);
    setDelayProblem(null);
    window.electronAPI.saveFlowSetting(FlowSettingKey.PROMPT_DELAYS, next)
      .then(setDelays, (err: unknown) => setDelayProblem(couldNot('change the reminders', err)));
  };

  const showStandup = (): void => {
    window.electronAPI?.triggerStandupPrompt?.()
      .then(res => setShown(res.success ? 'The stand-up reminder is up, on Today and the bar.' : 'Could not show the stand-up reminder.'),
        (err: unknown) => setShown(couldNot('show it', err)));
  };

  const showEndOfDay = (): void => {
    window.electronAPI?.triggerEodPrompt?.()
      .then(res => setShown(res.success ? 'The end-of-day prompt is up.' : 'Could not show the end-of-day prompt.'),
        (err: unknown) => setShown(couldNot('show it', err)));
  };

  const closes = closingDay(workingDays);
  const timesheet = capabilities?.providerId === ProviderId.ADHOC ? 'your history' : `${providerName}'s timesheet`;
  // Holidays are known only from a provider that lists them.
  const holidays = capabilities?.hasHolidays ? `, nor on a holiday ${providerName} lists` : '';

  return (
    <div className="space-y-4">
      <SettingsList label="My workday">
        <SettingRow
          title="Working days"
          description={`No reminders on other days${holidays}.`}
          control={
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS_MONDAY_FIRST.map(({ day, label }) => {
                const on = workingDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setWorkingDays(on ? workingDays.filter(d => d !== day) : [...workingDays, day].sort())}
                    className={`rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
                      on ? 'border-focus/40 bg-select text-text-primary' : 'border-border-dark bg-dark-900 text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          }
        >
          {weekRefusal && <SettingProblem>{weekRefusal} Not saved.</SettingProblem>}
        </SettingRow>

        <StandupSetting providerName={providerName} time={standupTime} onTimeChange={setStandupTime} onShowMe={showStandup} />

        <SettingRow
          title="Lunch"
          description="Your task pauses. After, you are asked if you are back."
          control={
            <>
              <input type="time" aria-label="Lunch starts" value={lunchStart} onChange={e => setLunchStart(e.target.value)}
                className={`${SETTING_SELECT_CLASS} font-mono`} />
              <span className="text-xs text-text-secondary">–</span>
              <input type="time" aria-label="Lunch ends" value={lunchEnd} onChange={e => setLunchEnd(e.target.value)}
                className={`${SETTING_SELECT_CLASS} font-mono`} />
            </>
          }
        >
          {refusal && !weekRefusal && !splitRefusal && <SettingProblem>{refusal} Not saved.</SettingProblem>}
        </SettingRow>

        <SettingRow
          title={END_MY_DAY}
          description="Offers to check today's time and send it."
          control={
            <>
              <input type="time" aria-label="End of day" value={eodTime} onChange={e => setEodTime(e.target.value)}
                className={`${SETTING_SELECT_CLASS} font-mono`} />
              <SettingButton tone="ghost" title="Shows the prompt now. Nothing ends unless you confirm it." onClick={showEndOfDay}>
                Show me
              </SettingButton>
            </>
          }
        />

        <ShutdownAtEndOfDaySetting />

        <SettingRow
          title="My week closes"
          description="At the end of your last working day. It shows the week, with anything still to place. Changing a closed week warns first, once per week."
          control={<span className="text-xs text-text-primary">{closes ? `${closes}, end of day` : 'No working day'}</span>}
        />

        {REMINDER_ROWS.map(({ key, title, does }) => (
          <SettingRow
            key={key}
            title={title}
            description={does}
            control={
              <select
                aria-label={title}
                value={delays?.[key] ?? DEFAULT_PROMPT_DELAYS[key]}
                disabled={!delays}
                onChange={e => saveDelay(key, Number(e.target.value))}
                className={SETTING_SELECT_CLASS}
              >
                {withStored(REMINDER_MINUTES, delays?.[key] ?? DEFAULT_PROMPT_DELAYS[key]).map(m => (
                  <option key={m} value={m}>{m} min</option>
                ))}
              </select>
            }
          />
        ))}

        <SettingRow
          title="A timer left running overnight"
          description="Asks how long you really worked. Not at the PC during the day still counts as work — a meeting, a coffee, a break — and nothing pauses; only an absence across midnight is asked about, from your last activity."
          control={<SettingSwitch label="A timer left running overnight" checked={askAboutForgotten} onChange={setAskAboutForgotten} />}
        />

        <SettingRow
          title="A long pause starts a new entry"
          description={splitPauseMinutes > 0
            ? `From ${splitPauseMinutes} minutes on, so ${timesheet} shows the gap. Midnight always starts a new one, so time is filed under the day it was worked.`
            : 'Never: one entry per day. Midnight always starts a new one, so time is filed under the day it was worked.'}
          control={
            <select
              aria-label="A long pause starts a new entry"
              value={splitPauseMinutes}
              onChange={e => setSplitPauseMinutes(Number(e.target.value))}
              className={SETTING_SELECT_CLASS}
            >
              {withStored(SPLIT_MINUTES, splitPauseMinutes).map(m => (
                <option key={m} value={m}>{m === 0 ? 'never' : `${m} min`}</option>
              ))}
            </select>
          }
        >
          {splitRefusal && <SettingProblem>{splitRefusal} Not saved.</SettingProblem>}
        </SettingRow>
      </SettingsList>

      {shown && <p className="text-xs text-text-secondary">{shown}</p>}
      {delayProblem && <SettingProblem>{delayProblem}</SettingProblem>}
      {saveStatus === 'error' && !refusal && <SettingProblem>Could not save your workday. Nothing changed.</SettingProblem>}
    </div>
  );
};
