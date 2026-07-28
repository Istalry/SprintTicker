import React, { useState, useEffect } from 'react';
import { CheckSquare, Save, Check } from 'lucide-react';

export interface SettingsViewProps {
  initialTab?: string;
}

export const SettingsView: React.FC<SettingsViewProps> = () => {
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  // Settings State
  const [fallbackTicketKey, setFallbackTicketKey] = useState<string>('MISC-1');
  const [providerId, setProviderId] = useState<string>('jira');
  const [jiraDomain, setJiraDomain] = useState<string>('https://antigravity.atlassian.net');

  useEffect(() => {
    if (window.electronAPI?.getProviders) {
      window.electronAPI.getProviders().then(res => {
        if (res) {
          if (res.activeProviderId) setProviderId(res.activeProviderId);
          if (res.fallbackTicketKey) setFallbackTicketKey(res.fallbackTicketKey);
          if (res.jiraDomain) setJiraDomain(res.jiraDomain);
        }
      }).catch(err => console.error('[SettingsView] Error loading providers:', err));
    }
  }, []);

  const handleSave = async () => {
    if (window.electronAPI?.setActiveProvider) {
      await window.electronAPI.setActiveProvider({
        providerId,
        jiraDomain,
        fallbackTicketKey
      });
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  return (
    <div className="space-y-6 max-w-4xl font-mono">
      {/* View Title */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center space-x-2">
            <CheckSquare className="w-5 h-5 text-accent-blue" />
            <span>TASK PROVIDERS & ACCOUNT CONFIGURATION</span>
          </h2>
          <p className="text-xs text-text-secondary">Configure active time tracking integrations (Jira, Notion, Google Sheets, Ad-Hoc).</p>
        </div>

        <button
          onClick={handleSave}
          className="flex items-center space-x-2 px-5 py-2.5 bg-accent-green hover:bg-emerald-600 text-dark-900 font-semibold text-sm rounded-lg shadow-md transition-all"
        >
          {savedSuccess ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          <span>{savedSuccess ? 'Settings Saved!' : 'Save Settings'}</span>
        </button>
      </div>

      {/* Settings Form Container */}
      <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-6 max-w-xl">
        <h3 className="text-md font-bold text-white font-mono border-b border-border-dark pb-3">Provider Selection & Credentials</h3>

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
    </div>
  );
};
