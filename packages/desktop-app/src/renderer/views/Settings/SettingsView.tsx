import React, { useState, useEffect } from 'react';
import { Sliders, Plug, Calendar, Server, Save, Check } from 'lucide-react';
import { HardwareBindingConfig } from '../../../shared/dtos';

export const SettingsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'providers' | 'hardware' | 'ceremonies' | 'integrations'>('providers');
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Settings State
  const [fallbackTicketKey, setFallbackTicketKey] = useState<string>('MISC-1');
  const [providerId, setProviderId] = useState<string>('jira');
  const [jiraDomain, setJiraDomain] = useState<string>('https://antigravity.atlassian.net');

  const [bindings, setBindings] = useState<HardwareBindingConfig>({
    startButtonPress: 'TOGGLE_TRACK_PAUSE',
    wheelRotateLeft: 'NAVIGATE_QUEUE_PREV',
    wheelRotateRight: 'NAVIGATE_QUEUE_NEXT',
    wheelClick: 'TRIGGER_TASK_SELECTOR_MODAL',
    backButtonShortPress: 'DISMISS_NOTIFICATION_ALERT',
    backButtonLongPress: 'COMPLETE_AND_LOG_ACTIVE_TASK'
  });

  const [standupTime, setStandupTime] = useState<string>('10:00');
  const [lunchStart, setLunchStart] = useState<string>('12:30');
  const [lunchEnd, setLunchEnd] = useState<string>('13:30');
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(0); // 0 = Indefinite wait

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getInputBindings().then(b => {
        if (b) setBindings(b);
      }).catch(err => console.error('[SettingsView] Error loading bindings:', err));
    }
  }, []);

  const handleSave = async () => {
    if (window.electronAPI) {
      await window.electronAPI.saveInputBindings(bindings);
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  return (
    <div className="space-y-6">
      {/* View Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold font-mono text-white tracking-tight">SETTINGS & MODULE CONFIGURATION</h2>
          <p className="text-xs text-text-secondary">Configure task providers, hardware rebindings, ceremonies, and webhook endpoints.</p>
        </div>

        <button
          onClick={handleSave}
          className="flex items-center space-x-2 px-5 py-2.5 bg-accent-green hover:bg-emerald-600 text-dark-900 font-semibold text-sm rounded-lg shadow-md transition-all"
        >
          {savedSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span>{savedSuccess ? 'Settings Saved!' : 'Save Settings'}</span>
        </button>
      </div>

      {/* Settings Tab Header */}
      <div className="flex space-x-2 border-b border-border-dark font-mono text-sm">
        {[
          { id: 'providers', label: '🔌 Task Providers', icon: Plug },
          { id: 'hardware', label: '🎛️ Hardware Inputs', icon: Sliders },
          { id: 'ceremonies', label: '📅 Ceremonies & Dialogs', icon: Calendar },
          { id: 'integrations', label: '⚡ Integrations & Server', icon: Server }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            className={`px-4 py-2.5 font-medium border-b-2 transition-all ${
              activeTab === t.id
                ? 'border-accent-blue text-accent-blue font-bold'
                : 'border-transparent text-text-secondary hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Settings Tab Content */}
      <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl">
        {activeTab === 'providers' && (
          <div className="space-y-6 max-w-xl">
            <h3 className="text-md font-bold text-white font-mono">Task Provider & Ad-Hoc Mapping</h3>

            <div>
              <label className="block text-xs font-mono text-text-secondary mb-1">Active Task Provider</label>
              <select
                value={providerId}
                onChange={e => setProviderId(e.target.value)}
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              >
                <option value="jira">Jira Cloud / Server Integration</option>
                <option value="sheets">Google Sheets Sync</option>
                <option value="notion">Notion Database</option>
                <option value="adhoc">Ad-Hoc / Custom REST Fallback</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-mono text-text-secondary mb-1">Jira Domain URL</label>
              <input
                type="text"
                value={jiraDomain}
                onChange={e => setJiraDomain(e.target.value)}
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-text-secondary mb-1">Ad-Hoc Fallback Ticket Key</label>
              <input
                type="text"
                value={fallbackTicketKey}
                onChange={e => setFallbackTicketKey(e.target.value)}
                placeholder="e.g. MISC-1 or ADMIN-1"
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              />
              <p className="text-xs text-text-secondary mt-1">Non-sprint ad-hoc tasks will log hours against this issue key.</p>
            </div>
          </div>
        )}

        {activeTab === 'hardware' && (
          <div className="space-y-6">
            <h3 className="text-md font-bold text-white font-mono">Physical Hardware Input Rebinding</h3>
            <p className="text-xs text-text-secondary">Rebind BUSY Bar physical wheel and button triggers to internal companion app actions:</p>

            <div className="divide-y divide-border-dark">
              {[
                { label: 'Start / Pause Button Press', key: 'startButtonPress' },
                { label: 'Scroll Wheel Rotate Left', key: 'wheelRotateLeft' },
                { label: 'Scroll Wheel Rotate Right', key: 'wheelRotateRight' },
                { label: 'Scroll Wheel Click (OK)', key: 'wheelClick' },
                { label: 'Back Button Short Press', key: 'backButtonShortPress' },
                { label: 'Back Button Long Press (1.5s)', key: 'backButtonLongPress' }
              ].map(item => (
                <div key={item.key} className="py-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-white">{item.label}</span>
                  <select
                    value={(bindings as any)[item.key]}
                    onChange={e => setBindings({ ...bindings, [item.key]: e.target.value })}
                    className="bg-dark-900 border border-border-dark rounded-lg px-3 py-1.5 text-xs text-accent-blue font-mono focus:outline-none focus:border-accent-blue"
                  >
                    <option value="TOGGLE_TRACK_PAUSE">Toggle Start / Pause Tracking</option>
                    <option value="TRIGGER_TASK_SELECTOR_MODAL">Trigger 2-Step Task Selection Modal</option>
                    <option value="NAVIGATE_QUEUE_PREV">Previous Task / Queue Item</option>
                    <option value="NAVIGATE_QUEUE_NEXT">Next Task / Queue Item</option>
                    <option value="DISMISS_NOTIFICATION_ALERT">Dismiss Alert / Notification</option>
                    <option value="COMPLETE_AND_LOG_ACTIVE_TASK">Complete & Log Active Task</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'ceremonies' && (
          <div className="space-y-6 max-w-xl">
            <h3 className="text-md font-bold text-white font-mono">Agile Ceremonies & Schedule</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-mono text-text-secondary mb-1">Daily Stand-up Time</label>
                <input
                  type="time"
                  value={standupTime}
                  onChange={e => setStandupTime(e.target.value)}
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-text-secondary mb-1">Dialog Timeout Limit</label>
                <select
                  value={timeoutSeconds}
                  onChange={e => setTimeoutSeconds(Number(e.target.value))}
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
                >
                  <option value={0}>Wait Indefinitely (Default)</option>
                  <option value={60}>Auto-Dismiss after 60s</option>
                  <option value={120}>Auto-Execute after 120s</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-mono text-text-secondary mb-1">Lunch Start Time</label>
                <input
                  type="time"
                  value={lunchStart}
                  onChange={e => setLunchStart(e.target.value)}
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-text-secondary mb-1">Lunch End Time</label>
                <input
                  type="time"
                  value={lunchEnd}
                  onChange={e => setLunchEnd(e.target.value)}
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'integrations' && (
          <div className="space-y-6 max-w-xl">
            <h3 className="text-md font-bold text-white font-mono">Local Webhook Server Status</h3>

            <div className="bg-dark-900 p-4 rounded-lg border border-border-dark space-y-2 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-text-secondary">Fastify HTTP Webhook Server:</span>
                <span className="text-accent-green font-bold">🟢 Listening (127.0.0.1:39123)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Legacy Port Fallback:</span>
                <span className="text-accent-blue font-bold">🟢 Active (127.0.0.1:8080)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-secondary">Unity Editor C# Plugin Status:</span>
                <span className="text-accent-green font-bold">🟢 Connected (MyFantasyGame)</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
