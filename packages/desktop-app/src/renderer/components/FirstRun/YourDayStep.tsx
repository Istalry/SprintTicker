import React, { useEffect, useState } from 'react';
import { ScheduleSettingsDTO } from '../../../shared/dtos';
import { DEFAULT_SCHEDULE_SETTINGS, checkScheduleSettings, normalizeScheduleSettings } from '../../../shared/schedule-defaults';
import { DEFAULT_WORKING_DAYS, WEEKDAYS_MONDAY_FIRST, checkWorkingDays } from '../../../shared/working-days';
import { KEEP_AS_OWN_ENTRY } from '../../../shared/words';
import { StandupTaskSetting } from '../StandupTaskSetting';
import { useProviderCapabilities } from '../../hooks/useProviderCapabilities';
import { StepFrame, fieldClass, primaryButton, secondaryButton } from './StepFrame';
import { ipcErrorMessage } from '../../utils/formatters';

const warn = (what: string) => (err: unknown) => console.warn(`[FirstRun] ${what} failed:`, err);
const timeField = `${fieldClass} w-28`;

/**
 * S3, your day: the working days, the stand-up and the task it is timed on,
 * lunch and the end of the day, all pre-filled, and how SprintTicker works
 * in four sentences. "Start my first task" saves them and ends on Today with
 * the picker open.
 */
export const YourDayStep: React.FC<{ onBack: () => void; onFinish: () => void }> = ({ onBack, onFinish }) => {
  const [stored, setStored] = useState<ScheduleSettingsDTO>(() => normalizeScheduleSettings({}));
  const [workingDays, setWorkingDays] = useState<number[]>([...DEFAULT_WORKING_DAYS]);
  const [standup, setStandup] = useState<string>(DEFAULT_SCHEDULE_SETTINGS.standupTime);
  const [lunchStart, setLunchStart] = useState<string>(DEFAULT_SCHEDULE_SETTINGS.lunchStartTime);
  const [lunchEnd, setLunchEnd] = useState<string>(DEFAULT_SCHEDULE_SETTINGS.lunchEndTime);
  const [endOfDay, setEndOfDay] = useState<string>(DEFAULT_SCHEDULE_SETTINGS.eodWrapUpTime);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { providerName } = useProviderCapabilities();

  useEffect(() => {
    let live = true;
    window.electronAPI.getScheduleSettings()
      .then(raw => {
        if (!live) return;
        const s = normalizeScheduleSettings(raw);
        setStored(s);
        if (s.workingDays) setWorkingDays(s.workingDays);
        if (s.standupTime) setStandup(s.standupTime);
        if (s.lunchStartTime) setLunchStart(s.lunchStartTime);
        if (s.lunchEndTime) setLunchEnd(s.lunchEndTime);
        if (s.eodWrapUpTime) setEndOfDay(s.eodWrapUpTime);
      })
      .catch(warn('Reading your day'));
    return () => { live = false; };
  }, []);

  const settings: ScheduleSettingsDTO = {
    ...stored,
    workingDays,
    standupTime: standup,
    lunchStartTime: lunchStart,
    lunchStart,
    lunchEndTime: lunchEnd,
    lunchEnd,
    eodWrapUpTime: endOfDay,
    eodTime: endOfDay
  };
  const refusal = checkWorkingDays(workingDays) ?? checkScheduleSettings(settings);

  const finish = async () => {
    setSaving(true);
    setError(null);
    try {
      if (!(await window.electronAPI.saveScheduleSettings(settings))) throw new Error('your day was not saved');
      onFinish();
    } catch (err) {
      setError(`Not saved: ${ipcErrorMessage(err)}. You can change it in Settings › My workday.`);
    } finally {
      setSaving(false);
    }
  };

  const provider = providerName || 'the provider';
  return (
    <StepFrame
      step={3}
      title="Your day"
      intro="Change any of these later in Settings › My workday."
      error={error ?? refusal}
      footer={
        <>
          <button type="button" className={secondaryButton} onClick={onBack}>Back</button>
          <span className="flex-1" />
          <button type="button" className={primaryButton} disabled={saving || refusal !== null} onClick={() => void finish()}>
            Start my first task
          </button>
        </>
      }
    >
      <Row label="Working days">
        <div role="group" aria-label="Working days" className="flex flex-wrap gap-1.5">
          {WEEKDAYS_MONDAY_FIRST.map(({ day, label }) => {
            const on = workingDays.includes(day);
            return (
              <button key={day} type="button" aria-pressed={on}
                onClick={() => setWorkingDays(on ? workingDays.filter(d => d !== day) : [...workingDays, day].sort())}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                  on ? 'bg-select text-text-primary border-focus/40' : 'bg-dark-900 text-text-secondary border-border-dark hover:text-white'
                }`}>
                {on ? `✓ ${label}` : label}
              </button>
            );
          })}
        </div>
      </Row>
      <Row label="Stand-up" hint="A reminder. Join times it on the task you choose here, then goes back to what you were doing.">
        <input type="time" aria-label="Stand-up" className={timeField} value={standup} onChange={e => setStandup(e.target.value)} />
        <StandupTaskSetting providerName={providerName} />
      </Row>
      <Row label="Lunch" hint="Your task pauses. After, you are asked if you are back.">
        <div className="flex items-center gap-2">
          <input type="time" aria-label="Lunch starts" className={timeField} value={lunchStart} onChange={e => setLunchStart(e.target.value)} />
          <span className="text-text-secondary">–</span>
          <input type="time" aria-label="Lunch ends" className={timeField} value={lunchEnd} onChange={e => setLunchEnd(e.target.value)} />
        </div>
      </Row>
      <Row label="End of day" hint="Offers to check today's time and send it.">
        <input type="time" aria-label="End of day" className={timeField} value={endOfDay} onChange={e => setEndOfDay(e.target.value)} />
      </Row>

      <section aria-label="How it works" className="rounded-lg border border-border-dark bg-dark-900/60 p-4 text-xs text-text-secondary leading-relaxed">
        <strong className="text-text-primary">How it works.</strong> One timer runs your task. When something interrupts you,
        ⚡ times it apart, one interruption after another. When it stops you name it and place it on a task, or {KEEP_AS_OWN_ENTRY.toLowerCase()}.
        Time reaches {provider} when you stop, after 10 s to undo.
      </section>
    </StepFrame>
  );
};

const Row: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div className="grid grid-cols-[7rem_1fr] gap-3 border-b border-border-dark/60 pb-3 last:border-0">
    <div>
      <div className="text-xs font-semibold text-white">{label}</div>
      {hint && <div className="mt-0.5 text-[11px] text-text-secondary leading-snug">{hint}</div>}
    </div>
    <div className="space-y-2">{children}</div>
  </div>
);
