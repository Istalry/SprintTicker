import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Moon, Save, Check, Play, ShieldAlert } from 'lucide-react';
import { ScheduleSettingsDTO } from '../../../shared/dtos';

export const CeremoniesView: React.FC = () => {
  const [standupTime, setStandupTime] = useState<string>('10:05');
  const [lunchStart, setLunchStart] = useState<string>('12:18');
  const [lunchEnd, setLunchEnd] = useState<string>('13:00');
  const [eodTime, setEodTime] = useState<string>('17:30');
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(0);
  const [shutdownByDefault, setShutdownByDefault] = useState<boolean>(false);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
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
          if (sched.shutdownByDefault !== undefined) {
            setShutdownByDefault(sched.shutdownByDefault);
          } else if (sched.eodShutdownByDefault !== undefined) {
            setShutdownByDefault(sched.eodShutdownByDefault);
          }
        }
      }).catch(err => console.error('[CeremoniesView] Error loading schedule settings:', err));
    }
  }, []);

  const handleSave = async () => {
    if (window.electronAPI?.saveScheduleSettings) {
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
        eodShutdownByDefault: shutdownByDefault
      };
      await window.electronAPI.saveScheduleSettings(settings);
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

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

        <button
          onClick={handleSave}
          className="flex items-center space-x-2 px-5 py-2.5 bg-accent-green hover:bg-emerald-600 text-dark-900 font-semibold text-sm rounded-lg shadow-md transition-all"
        >
          {savedSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span>{savedSuccess ? 'Schedule Saved!' : 'Save Ceremonies'}</span>
        </button>
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
              <label className="block text-xs text-text-secondary mb-1">Lunch Start Time</label>
              <input
                type="time"
                value={lunchStart}
                onChange={e => setLunchStart(e.target.value)}
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              />
            </div>

            <div>
              <label className="block text-xs text-text-secondary mb-1">Lunch End Time</label>
              <input
                type="time"
                value={lunchEnd}
                onChange={e => setLunchEnd(e.target.value)}
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              />
            </div>
          </div>
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
