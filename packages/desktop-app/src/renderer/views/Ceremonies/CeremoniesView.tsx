import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Moon, Play, ShieldAlert } from 'lucide-react';
import { useAutoSave } from '../../hooks/useAutoSave';
import { AutoSaveIndicator } from '../../components/AutoSaveIndicator';
import { ScheduleSettingsDTO } from '../../../shared/dtos';
import { DEFAULT_SCHEDULE_SETTINGS, checkScheduleSettings } from '../../../shared/schedule-defaults';
import { DEFAULT_WORKING_DAYS, WEEKDAYS_MONDAY_FIRST, checkWorkingDays } from '../../../shared/working-days';
import { DEFAULT_SPLIT_PAUSE_MINUTES, MAX_SPLIT_PAUSE_MINUTES, checkSplitPauseMinutes } from '../../../shared/work-split';

export const CeremoniesView: React.FC = () => {
  const [standupTime, setStandupTime] = useState<string>(DEFAULT_SCHEDULE_SETTINGS.standupTime);
  const [lunchStart, setLunchStart] = useState<string>(DEFAULT_SCHEDULE_SETTINGS.lunchStartTime);
  const [lunchEnd, setLunchEnd] = useState<string>('13:00');
  const [eodTime, setEodTime] = useState<string>('17:30');
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(0);
  const [shutdownByDefault, setShutdownByDefault] = useState<boolean>(false);
  const [askAboutForgotten, setAskAboutForgotten] = useState<boolean>(DEFAULT_SCHEDULE_SETTINGS.askAboutForgottenSessions);
  const [workingDays, setWorkingDays] = useState<number[]>([...DEFAULT_WORKING_DAYS]);
  const [splitPauseMinutes, setSplitPauseMinutes] = useState<number>(DEFAULT_SPLIT_PAUSE_MINUTES);
  // With no stored settings to read there is nothing to wait for; loaded
  // is otherwise set once the read settles.
  const [loaded, setLoaded] = useState<boolean>(() => !window.electronAPI?.getScheduleSettings);
  const [testStatusMessage, setTestStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (window.electronAPI?.getScheduleSettings) {
      window.electronAPI.getScheduleSettings().then(sched => {
        if (sched) {
          if (sched.standupTime) setStandupTime(sched.standupTime);
          if (sched.lunchStart) setLunchStart(sched.lunchStart);
          if (sched.lunchEnd) setLunchEnd(sched.lunchEnd);
          if (sched.eodTime) setEodTime(sched.eodTime);
          if (sched.autoDismissSeconds !== undefined) setTimeoutSeconds(sched.autoDismissSeconds);
          if (sched.askAboutForgottenSessions !== undefined) setAskAboutForgotten(sched.askAboutForgottenSessions);
          if (sched.workingDays) setWorkingDays(sched.workingDays);
          if (sched.splitPauseMinutes !== undefined) setSplitPauseMinutes(sched.splitPauseMinutes);
          if (sched.shutdownByDefault !== undefined) {
            setShutdownByDefault(sched.shutdownByDefault);
          } else if (sched.eodShutdownByDefault !== undefined) {
            setShutdownByDefault(sched.eodShutdownByDefault);
          }
        }
      }).catch(err => console.error('[CeremoniesView] Error loading schedule settings:', err))
        // Auto-save must stay off until the stored schedule has arrived, or
        // the panel would write its defaults over it.
        .finally(() => setLoaded(true));
    }
  }, []);

  const settings: ScheduleSettingsDTO = {
    standupTime,
    lunchStart,
    lunchEnd,
    lunchStartTime: lunchStart,
    lunchEndTime: lunchEnd,
    eodTime,
    eodWrapUpTime: eodTime,
    autoDismissSeconds: timeoutSeconds,
    promptTimeoutSeconds: timeoutSeconds,
    shutdownByDefault,
    eodShutdownByDefault: shutdownByDefault,
    askAboutForgottenSessions: askAboutForgotten,
    workingDays,
    splitPauseMinutes
  };
  // Checked here as main checks it, so a half-typed lunch window is shown as
  // wrong rather than saved and silently never matching any minute.
  const refusal = checkScheduleSettings(settings);
  // Each refusal is shown under the card it is about: the week's and the
  // split's under the working days, anything else under the lunch window.
  const weekRefusal = checkWorkingDays(workingDays);
  const splitRefusal = checkSplitPauseMinutes(splitPauseMinutes);

  const handleSave = async () => {
    if (refusal) throw new Error(refusal);
    if (window.electronAPI?.saveScheduleSettings) {
      await window.electronAPI.saveScheduleSettings(settings);
    }
  };

  const saveStatus = useAutoSave(
    handleSave,
    [standupTime, lunchStart, lunchEnd, eodTime, timeoutSeconds, shutdownByDefault, askAboutForgotten, workingDays, splitPauseMinutes],
    loaded
  );

  const handleTestTriggerEod = async () => {
    if (window.electronAPI?.triggerEodPrompt) {
      setTestStatusMessage('Triggering EOD Wrap-Up prompt wizard...');
      const res = await window.electronAPI.triggerEodPrompt();
      setTestStatusMessage(res.success ? 'EOD prompt triggered!' : 'EOD trigger failed.');
      setTimeout(() => setTestStatusMessage(null), 3000);
    } else if (window.electronAPI?.triggerEodWrapUp) {
      setTestStatusMessage('Triggering EOD Wrap-Up sequence...');
      const res = await window.electronAPI.triggerEodWrapUp();
      setTestStatusMessage(res.success ? 'EOD Wrap-Up completed successfully!' : 'EOD trigger failed.');
      setTimeout(() => setTestStatusMessage(null), 3000);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl font-mono">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Calendar className="w-5 h-5 text-accent-purple" />
            <span>AGILE CEREMONIES, SCHEDULE & PC AUTOMATION</span>
          </h2>
          <p className="text-xs text-text-secondary">Schedule Daily Stand-Up prompts, Lunch quiet hours, dialog timeout limits, and EOD Wrap-Up.</p>
        </div>

        <AutoSaveIndicator status={saveStatus} />
      </div>

      {/* The week: which days prompt at all, and which one closes it. */}
      <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-3">
        <div className="flex items-center space-x-3 text-white font-bold">
          <Calendar className="w-5 h-5 text-accent-purple" />
          <h3 id="working-days">Working Days</h3>
        </div>
        <p className="text-xs text-text-secondary">
          The stand-up, lunch and the wrap-up happen on these days only, and never on a holiday your OpenProject
          instance lists. The wrap-up of the last one in a week closes the week.
        </p>
        <div role="group" aria-labelledby="working-days" className="flex flex-wrap gap-2">
          {WEEKDAYS_MONDAY_FIRST.map(({ day, label }) => {
            const on = workingDays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                onClick={() => setWorkingDays(on ? workingDays.filter(d => d !== day) : [...workingDays, day].sort())}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  on
                    ? 'bg-accent-purple/20 text-accent-purple border-accent-purple/40'
                    : 'bg-dark-900 text-text-secondary border-border-dark hover:text-white'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        {weekRefusal && <p role="alert" className="text-xs text-accent-red">{weekRefusal} Not saved.</p>}
        <div className="pt-2 border-t border-border-dark">
          <label className="flex flex-wrap items-center gap-2 text-xs text-text-primary">
            <span>A pause of</span>
            <input
              type="number"
              min={0}
              max={MAX_SPLIT_PAUSE_MINUTES}
              step={1}
              aria-label="Pause that splits a worklog, in minutes"
              value={Number.isFinite(splitPauseMinutes) ? splitPauseMinutes : ''}
              onChange={e => setSplitPauseMinutes(e.target.value === '' ? Number.NaN : Number(e.target.value))}
              className="w-20 bg-dark-900 border border-border-dark rounded-lg px-2 py-1 text-xs text-white focus:outline-none focus:border-accent-blue font-mono"
            />
            <span>minutes or more starts a new worklog.</span>
          </label>
          <p className="mt-1 text-[11px] text-text-secondary">
            0 keeps a session in one worklog per day. Midnight always starts a new one, so time is filed under the day
            it was worked.
          </p>
          {splitRefusal && <p role="alert" className="text-xs text-accent-red">{splitRefusal} Not saved.</p>}
        </div>
      </div>

      {/* Grid: Ceremonies Configuration Cards */}
      <div className="grid grid-cols-2 gap-6">
        {/* Card 1: Daily Stand-Up Ceremonies */}
        <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-4">
          <div className="flex items-center space-x-3 text-white font-bold">
            <Clock className="w-5 h-5 text-accent-blue" />
            <h3>Daily Stand-Up Ceremonies</h3>
          </div>
          <p className="text-xs text-text-secondary">Pops up a visual notification on your screen and the BUSY Bar to remind you that the Stand-Up is starting.</p>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Stand-Up Start Time</label>
              <input
                type="time"
                value={standupTime}
                onChange={e => setStandupTime(e.target.value)}
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              />
            </div>

            <div className="pt-1 flex items-center justify-between">
              <button
                onClick={async () => {
                  if (window.electronAPI?.triggerStandupPrompt) {
                    await window.electronAPI.triggerStandupPrompt();
                  }
                }}
                className="flex items-center space-x-1.5 px-3 py-2 bg-accent-blue/20 hover:bg-accent-blue/30 text-accent-blue border border-accent-blue/30 rounded-lg text-xs font-semibold transition-all"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Test Trigger Stand-Up</span>
              </button>
            </div>
          </div>
        </div>

        {/* Card 2: Lunch Schedule & Quiet Hours */}
        <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-4">
          <div className="flex items-center space-x-3 text-white font-bold">
            <Moon className="w-5 h-5 text-accent-amber" />
            <h3>Lunch Schedule & Quiet Hours</h3>
          </div>
          <p className="text-xs text-text-secondary">Automatically updates front display status to LUNCH BREAK and silences chat alerts.</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="lunch-start" className="block text-xs text-text-secondary mb-1">Lunch Start Time</label>
              <input
                id="lunch-start"
                type="time"
                value={lunchStart}
                onChange={e => setLunchStart(e.target.value)}
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              />
            </div>

            <div>
              <label htmlFor="lunch-end" className="block text-xs text-text-secondary mb-1">Lunch End Time</label>
              <input
                id="lunch-end"
                type="time"
                value={lunchEnd}
                onChange={e => setLunchEnd(e.target.value)}
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              />
            </div>
          </div>
          {refusal && !weekRefusal && !splitRefusal && <p role="alert" className="text-xs text-accent-red">{refusal} Not saved.</p>}
        </div>

        {/* Card 3: Dialog Prompt Timeout Limits */}
        <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-4">
          <div className="flex items-center space-x-3 text-white font-bold">
            <ShieldAlert className="w-5 h-5 text-accent-purple" />
            <h3>Dialog Prompt Timeout Limit</h3>
          </div>
          <p className="text-xs text-text-secondary">Configures auto-dismiss or auto-execution rules for desktop dialog popups.</p>

          <div>
            <label className="block text-xs text-text-secondary mb-1">Timeout Behavior</label>
            <select
              value={timeoutSeconds}
              onChange={e => setTimeoutSeconds(Number(e.target.value))}
              className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-xs text-white focus:outline-none focus:border-accent-blue font-mono"
            >
              <option value={0}>Wait Indefinitely (Default - Stays open)</option>
              <option value={60}>Auto-Dismiss after 60 seconds</option>
              <option value={120}>Auto-Execute after 120 seconds</option>
            </select>
          </div>
        </div>

        {/* Card 4: End-of-Day Automated Wrap-Up Sequence */}
        <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-4">
          <div className="flex items-center space-x-3 text-white font-bold">
            <Play className="w-5 h-5 text-accent-green" />
            <h3>End-of-Day (EOD) Wrap-Up Sequence</h3>
          </div>
          <p className="text-xs text-text-secondary">Prompts to finalize task sessions, submit worklogs, save Unity scenes & VS Code files.</p>

          <div className="space-y-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1">Scheduled EOD Time</label>
              <input
                type="time"
                value={eodTime}
                onChange={e => setEodTime(e.target.value)}
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              />
            </div>

            <label className="flex items-center space-x-2.5 pt-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={shutdownByDefault}
                onChange={e => setShutdownByDefault(e.target.checked)}
                className="w-4 h-4 rounded text-accent-purple focus:ring-accent-purple bg-dark-900 border-border-dark"
              />
              <span className="text-xs text-text-primary">Shutdown computer by default during EOD wrap-up</span>
            </label>

            <label className="flex items-start space-x-2.5 pt-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={askAboutForgotten}
                onChange={e => setAskAboutForgotten(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded text-accent-purple focus:ring-accent-purple bg-dark-900 border-border-dark"
              />
              <span className="text-xs text-text-primary">
                Ask about a session left running overnight
                <span className="block text-text-secondary">
                  Paused at your last activity until you say when you stopped. Working past midnight is never interrupted.
                </span>
              </span>
            </label>

            <div className="pt-1 flex items-center justify-between">
              <button
                onClick={handleTestTriggerEod}
                className="flex items-center space-x-1.5 px-3 py-2 bg-accent-purple/20 hover:bg-accent-purple/30 text-accent-purple border border-accent-purple/30 rounded-lg text-xs font-semibold transition-all"
              >
                <Play className="w-3.5 h-3.5" />
                <span>Test Trigger EOD Wrap-Up</span>
              </button>

              {testStatusMessage && (
                <span className="text-xs text-accent-green font-bold">{testStatusMessage}</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CeremoniesView;
