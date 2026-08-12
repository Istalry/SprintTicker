import React, { useState, useEffect } from 'react';
import { CheckSquare, Save, Check } from 'lucide-react';
import { OpStatusDTO } from '../../../shared/dtos';

export interface SettingsViewProps {
  initialTab?: string;
}

export const SettingsView: React.FC<SettingsViewProps> = () => {
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Settings State
  const [fallbackTicketKey, setFallbackTicketKey] = useState<string>('MISC-1');
  const [providerId, setProviderId] = useState<string>('openproject');
  const [opDomain, setOpDomain] = useState<string>('');
  const [opApiKey, setOpApiKey] = useState<string>('');
  const [opStatusInProgress, setOpStatusInProgress] = useState<string>('');
  const [opStatusToTest, setOpStatusToTest] = useState<string>('');
  const [opStatusToReview, setOpStatusToReview] = useState<string>('');
  const [opCompletionAction, setOpCompletionAction] = useState<string>('to_test');

  const [availableStatuses, setAvailableStatuses] = useState<OpStatusDTO[]>([]);
  const [isLoadingStatuses, setIsLoadingStatuses] = useState<boolean>(false);

  useEffect(() => {
    if (window.electronAPI?.getProviders) {
      window.electronAPI.getProviders().then(res => {
        if (res) {
          if (res.activeProviderId) setProviderId(res.activeProviderId);
          if (res.fallbackTicketKey) setFallbackTicketKey(res.fallbackTicketKey);
          if (res.opDomain) setOpDomain(res.opDomain);
          if (res.opApiKey) setOpApiKey(res.opApiKey);
          if (res.opStatusInProgress) setOpStatusInProgress(res.opStatusInProgress);
          if (res.opStatusToTest) setOpStatusToTest(res.opStatusToTest);
          if (res.opStatusToReview) setOpStatusToReview(res.opStatusToReview);
          if (res.opCompletionAction) setOpCompletionAction(res.opCompletionAction);
        }
      }).catch(err => console.error('[SettingsView] Error loading providers:', err));
    }
  }, []);

  const handleSave = async () => {
    if (window.electronAPI?.setActiveProvider) {
      await window.electronAPI.setActiveProvider({
        providerId,
        fallbackTicketKey,
        opDomain,
        opApiKey,
        opStatusInProgress,
        opStatusToTest,
        opStatusToReview,
        opCompletionAction
      });
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleFetchStatuses = async () => {
    if (!opDomain || !opApiKey || !window.electronAPI?.fetchOpenProjectStatuses) return;
    setIsLoadingStatuses(true);
    setFetchError(null);
    try {
      const res = await window.electronAPI.fetchOpenProjectStatuses(opDomain, opApiKey);
      if (res.success && res.data) {
        setAvailableStatuses(res.data);
      } else {
        setAvailableStatuses([]);
        setFetchError(res.error || 'Unknown error occurred while fetching statuses.');
      }
    } catch (err) {
      console.error('[SettingsView] Failed to fetch statuses:', err);
      setFetchError(err instanceof Error ? err.message : 'Unknown exception occurred.');
      setAvailableStatuses([]);
    }
    setIsLoadingStatuses(false);
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
          <p className="text-xs text-text-secondary">Configure OpenProject REST API integration & time tracking synchronization.</p>
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
            <option value="openproject">OpenProject (REST API v3)</option>
            <option value="adhoc">Ad-Hoc / Custom Local Fallback</option>
          </select>
        </div>

        {providerId === 'openproject' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-text-secondary mb-1">OpenProject Domain URL</label>
              <input
                type="text"
                value={opDomain}
                onChange={e => setOpDomain(e.target.value)}
                placeholder="https://openproject.example.com"
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-text-secondary mb-1">API Key</label>
              <input
                type="password"
                value={opApiKey}
                onChange={e => setOpApiKey(e.target.value)}
                placeholder="apikey"
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              />
            </div>
            <div className="flex justify-between items-center mt-4">
              <label className="block text-xs font-bold font-mono text-white mb-1">Status Mappings</label>
              <button 
                onClick={handleFetchStatuses} 
                disabled={isLoadingStatuses || !opDomain || !opApiKey} 
                className="px-3 py-1.5 bg-dark-700 text-white text-xs font-bold rounded hover:bg-dark-600 disabled:opacity-50 transition-colors"
              >
                {isLoadingStatuses ? 'Fetching...' : 'Fetch Statuses from API'}
              </button>
            </div>
            {fetchError && (
              <div className="text-xs text-red-400 mt-2 font-mono bg-red-900/20 p-2 rounded border border-red-900/50">
                Failed to fetch: {fetchError}
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-xs font-mono text-text-secondary mb-1">In Progress Status</label>
                {availableStatuses.length > 0 ? (
                  <select value={opStatusInProgress} onChange={e => setOpStatusInProgress(e.target.value)} className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono">
                    <option value="">Select status...</option>
                    {availableStatuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : (
                  <input type="text" value={opStatusInProgress} onChange={e => setOpStatusInProgress(e.target.value)} placeholder="Status ID" className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono" />
                )}
              </div>
              <div>
                <label className="block text-xs font-mono text-text-secondary mb-1">To Test Status</label>
                {availableStatuses.length > 0 ? (
                  <select value={opStatusToTest} onChange={e => setOpStatusToTest(e.target.value)} className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono">
                    <option value="">Select status...</option>
                    {availableStatuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : (
                  <input type="text" value={opStatusToTest} onChange={e => setOpStatusToTest(e.target.value)} placeholder="Status ID" className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono" />
                )}
              </div>
              <div>
                <label className="block text-xs font-mono text-text-secondary mb-1">To Review Status</label>
                {availableStatuses.length > 0 ? (
                  <select value={opStatusToReview} onChange={e => setOpStatusToReview(e.target.value)} className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono">
                    <option value="">Select status...</option>
                    {availableStatuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : (
                  <input type="text" value={opStatusToReview} onChange={e => setOpStatusToReview(e.target.value)} placeholder="Status ID" className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono" />
                )}
              </div>
              <div>
                <label className="block text-xs font-mono text-text-secondary mb-1">Task Completion Action</label>
                <select value={opCompletionAction} onChange={e => setOpCompletionAction(e.target.value)} className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono">
                  <option value="to_test">Move to To Test</option>
                  <option value="to_review">Move to To Review</option>
                </select>
              </div>
            </div>
          </div>
        )}

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

