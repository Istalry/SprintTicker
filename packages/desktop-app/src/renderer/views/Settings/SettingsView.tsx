import React, { useState, useEffect } from 'react';
import { CheckSquare } from 'lucide-react';
import { useAutoSave } from '../../hooks/useAutoSave';
import { AutoSaveIndicator } from '../../components/AutoSaveIndicator';
import { OpStatusDTO } from '../../../shared/dtos';
import { TaskScope, TaskScopeValue, TASK_SCOPE_LABELS } from '../../../shared/task-scope';
import { SyncQueuePanel } from '../../components/SyncQueuePanel';

export interface SettingsViewProps {
  initialTab?: string;
}

export const SettingsView: React.FC<SettingsViewProps> = () => {
  const [loaded, setLoaded] = useState<boolean>(false);
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
  const [opTaskScope, setOpTaskScope] = useState<TaskScopeValue>(TaskScope.ASSIGNED_TO_ME);
  const [opTaskQuery, setOpTaskQuery] = useState<string>('');
  const [jiraSite, setJiraSite] = useState<string>('');
  const [jiraEmail, setJiraEmail] = useState<string>('');
  const [jiraApiToken, setJiraApiToken] = useState<string>('');
  const [jiraTaskScope, setJiraTaskScope] = useState<TaskScopeValue>(TaskScope.ASSIGNED_TO_ME);
  const [jiraTaskQuery, setJiraTaskQuery] = useState<string>('');
  const [jiraTransitionInProgress, setJiraTransitionInProgress] = useState<string>('');
  const [jiraTransitionToTest, setJiraTransitionToTest] = useState<string>('');
  const [jiraTransitionToReview, setJiraTransitionToReview] = useState<string>('');
  const [jiraCompletionAction, setJiraCompletionAction] = useState<string>('to_review');

  const [availableStatuses, setAvailableStatuses] = useState<OpStatusDTO[]>([]);
  const [isLoadingStatuses, setIsLoadingStatuses] = useState<boolean>(false);

  // Notification Settings
  const [enableOpenProjectNotifications, setEnableOpenProjectNotifications] = useState<boolean>(true);
  const [openProjectPollingIntervalSeconds, setOpenProjectPollingIntervalSeconds] = useState<number>(60);
  const [isTestLoading, setIsTestLoading] = useState<boolean>(false);

  useEffect(() => {
    // Auto-save stays disabled until both reads settle. Enabling it earlier
    // would let the panel persist its defaults over stored settings.
    const loads: Array<Promise<unknown>> = [];

    if (window.electronAPI?.getProviders) {
      loads.push(window.electronAPI.getProviders().then(res => {
        if (res) {
          if (res.activeProviderId) setProviderId(res.activeProviderId);
          if (res.fallbackTicketKey) setFallbackTicketKey(res.fallbackTicketKey);
          if (res.opDomain) setOpDomain(res.opDomain);
          if (res.opApiKey) setOpApiKey(res.opApiKey);
          if (res.opStatusInProgress) setOpStatusInProgress(res.opStatusInProgress);
          if (res.opStatusToTest) setOpStatusToTest(res.opStatusToTest);
          if (res.opStatusToReview) setOpStatusToReview(res.opStatusToReview);
          if (res.opCompletionAction) setOpCompletionAction(res.opCompletionAction);
          if (res.opTaskScope) setOpTaskScope(res.opTaskScope as TaskScopeValue);
          // No truthiness guard: an empty query is a real value the user can
          // set by clearing the field, and skipping it would resurrect the old
          // one on the next save.
          if (res.opTaskQuery !== undefined) setOpTaskQuery(res.opTaskQuery);
          if (res.jiraSite) setJiraSite(res.jiraSite);
          if (res.jiraEmail) setJiraEmail(res.jiraEmail);
          if (res.jiraApiToken) setJiraApiToken(res.jiraApiToken);
          if (res.jiraTaskScope) setJiraTaskScope(res.jiraTaskScope as TaskScopeValue);
          // Assigned unconditionally, like opTaskQuery: clearing a field is a
          // real value, and a truthiness guard would restore the old one on the
          // next save.
          if (res.jiraTaskQuery !== undefined) setJiraTaskQuery(res.jiraTaskQuery);
          if (res.jiraTransitionInProgress !== undefined) setJiraTransitionInProgress(res.jiraTransitionInProgress);
          if (res.jiraTransitionToTest !== undefined) setJiraTransitionToTest(res.jiraTransitionToTest);
          if (res.jiraTransitionToReview !== undefined) setJiraTransitionToReview(res.jiraTransitionToReview);
          if (res.jiraCompletionAction) setJiraCompletionAction(res.jiraCompletionAction);
        }
      }).catch(err => console.error('[SettingsView] Error loading providers:', err)));
    }
    
    if (window.electronAPI?.getMessagingSettings) {
      loads.push(window.electronAPI.getMessagingSettings().then(s => {
        if (s) {
          setEnableOpenProjectNotifications(s.enableOpenProjectNotifications ?? true);
          setOpenProjectPollingIntervalSeconds(s.openProjectPollingIntervalSeconds ?? 60);
        }
      }).catch(err => console.error('[SettingsView] Error loading messaging settings:', err)));
    }

    void Promise.allSettled(loads).then(() => setLoaded(true));
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
        opCompletionAction,
        opTaskScope,
        opTaskQuery,
        jiraSite,
        jiraEmail,
        jiraApiToken,
        jiraTaskScope,
        jiraTaskQuery,
        jiraTransitionInProgress,
        jiraTransitionToTest,
        jiraTransitionToReview,
        jiraCompletionAction
      });
    }

    if (window.electronAPI?.getMessagingSettings && window.electronAPI?.saveMessagingSettings) {
      const currentMessagingSettings = await window.electronAPI.getMessagingSettings();
      await window.electronAPI.saveMessagingSettings({
        ...(currentMessagingSettings || {}),
        enableOpenProjectNotifications,
        openProjectPollingIntervalSeconds
      });
    }

  };

  const saveStatus = useAutoSave(
    handleSave,
    [
      providerId,
      fallbackTicketKey,
      opDomain,
      opApiKey,
      opStatusInProgress,
      opStatusToTest,
      opStatusToReview,
      opCompletionAction,
      opTaskScope,
      opTaskQuery,
      jiraSite,
      jiraEmail,
      jiraApiToken,
      jiraTaskScope,
      jiraTaskQuery,
      jiraTransitionInProgress,
      jiraTransitionToTest,
      jiraTransitionToReview,
      jiraCompletionAction,
      enableOpenProjectNotifications,
      openProjectPollingIntervalSeconds
    ],
    loaded
  );

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

  const handleTestAlert = async () => {
    if (window.electronAPI?.testMessagingIntegration) {
      setIsTestLoading(true);
      try {
        await window.electronAPI.testMessagingIntegration('OpenProject');
      } catch (err) {
        console.error('[SettingsView] Failed to test messaging integration', err);
      } finally {
        setTimeout(() => setIsTestLoading(false), 1000);
      }
    }
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

        <AutoSaveIndicator status={saveStatus} />
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
            <option value="jira">Jira Cloud (REST API v3)</option>
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
            {/*
              There is no "typed but not saved" state to warn about any more:
              the fields persist as they are edited, so the credentials this
              fetch probes are the ones the provider is about to use (F-56).
            */}

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
              <div>
                <label className="block text-xs font-mono text-text-secondary mb-1">Which Tasks To Show</label>
                <select
                  value={opTaskScope}
                  onChange={e => setOpTaskScope(e.target.value as TaskScopeValue)}
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
                >
                  {Object.values(TaskScope).map(scope => (
                    <option key={scope} value={scope}>{TASK_SCOPE_LABELS[scope]}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-text-secondary">
                  Only open tasks in the selected project are ever listed.
                </p>
              </div>
              {opTaskScope === TaskScope.CUSTOM && (
                <div className="md:col-span-2">
                  <label className="block text-xs font-mono text-text-secondary mb-1">
                    Custom Filter (OpenProject v3 JSON)
                  </label>
                  <textarea
                    value={opTaskQuery}
                    onChange={e => setOpTaskQuery(e.target.value)}
                    rows={3}
                    spellCheck={false}
                    placeholder={'[{"assignee":{"operator":"=","values":["me"]}},{"status":{"operator":"o","values":[]}}]'}
                    className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
                  />
                  <p className="mt-1 text-xs text-text-secondary">
                    Replaces the filter entirely, including the project clause &mdash; so add one
                    yourself unless you mean every project. An invalid filter fails the sync
                    loudly rather than quietly showing no tasks.
                  </p>
                </div>
              )}
            </div>

            {/* Notification Configuration */}
            <div className="mt-6 border-t border-border-dark pt-4">
              <div className="flex justify-between items-center mb-4">
                <label className="block text-xs font-bold font-mono text-white">API Polling Notifications</label>
                <button
                  onClick={handleTestAlert}
                  disabled={isTestLoading}
                  className="px-3 py-1.5 bg-dark-700 text-accent-purple text-xs font-bold rounded hover:bg-dark-600 disabled:opacity-50 transition-colors flex items-center space-x-1"
                >
                  <span>{isTestLoading ? 'Sending...' : 'Test Banner Alert'}</span>
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-mono text-text-secondary mb-1">Polling Interval (Seconds)</label>
                  <input
                    type="number"
                    value={openProjectPollingIntervalSeconds}
                    onChange={e => setOpenProjectPollingIntervalSeconds(Number(e.target.value))}
                    min="10"
                    max="3600"
                    className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
                  />
                </div>
                <div className="flex items-center mt-6">
                  <label className="flex items-center space-x-3 text-xs text-white cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={enableOpenProjectNotifications}
                      onChange={e => setEnableOpenProjectNotifications(e.target.checked)}
                      className="rounded bg-dark-900 border-border-dark text-accent-blue focus:ring-0"
                    />
                    <span>Enable Notification Polling</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {providerId === 'jira' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-mono text-text-secondary mb-1">Jira Site URL</label>
              <input
                type="text"
                value={jiraSite}
                onChange={e => setJiraSite(e.target.value)}
                placeholder="https://your-team.atlassian.net"
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-text-secondary mb-1">Account Email</label>
              <input
                type="text"
                value={jiraEmail}
                onChange={e => setJiraEmail(e.target.value)}
                placeholder="you@your-team.com"
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              />
              <p className="mt-1 text-xs text-text-secondary">
                A Jira API token is the password for an account, so the email is required
                alongside it.
              </p>
            </div>
            <div>
              <label className="block text-xs font-mono text-text-secondary mb-1">API Token</label>
              <input
                type="password"
                value={jiraApiToken}
                onChange={e => setJiraApiToken(e.target.value)}
                placeholder="Create one at id.atlassian.com"
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-text-secondary mb-1">Which Tasks To Show</label>
              <select
                value={jiraTaskScope}
                onChange={e => setJiraTaskScope(e.target.value as TaskScopeValue)}
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              >
                {Object.values(TaskScope).map(scope => (
                  <option key={scope} value={scope}>{TASK_SCOPE_LABELS[scope]}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-text-secondary">
                Issues whose status category is Done are never listed.
              </p>
            </div>
            {jiraTaskScope === TaskScope.CUSTOM && (
              <div>
                <label className="block text-xs font-mono text-text-secondary mb-1">Custom JQL</label>
                <textarea
                  value={jiraTaskQuery}
                  onChange={e => setJiraTaskQuery(e.target.value)}
                  rows={3}
                  spellCheck={false}
                  placeholder="assignee = currentUser() AND labels = urgent"
                  className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
                />
                <p className="mt-1 text-xs text-text-secondary">
                  Replaces the query entirely, including the project clause. Only Jira can
                  validate JQL, so a mistake here fails the sync rather than quietly showing
                  no issues.
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold font-mono text-white mb-1">Transitions</label>
              <p className="mt-1 text-xs text-text-secondary">
                Jira has no writable status field &mdash; an issue moves by running a
                transition. Enter the transition or target status <em>name</em>: an id only
                means anything within one workflow. Leave a field empty and SprintTicker will
                not move the issue.
              </p>
            </div>
            <div>
              <label className="block text-xs font-mono text-text-secondary mb-1">On Task Start</label>
              <input
                type="text"
                value={jiraTransitionInProgress}
                onChange={e => setJiraTransitionInProgress(e.target.value)}
                placeholder="In Progress"
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-text-secondary mb-1">To Test</label>
              <input
                type="text"
                value={jiraTransitionToTest}
                onChange={e => setJiraTransitionToTest(e.target.value)}
                placeholder="Ready for QA"
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-text-secondary mb-1">To Review</label>
              <input
                type="text"
                value={jiraTransitionToReview}
                onChange={e => setJiraTransitionToReview(e.target.value)}
                placeholder="In Review"
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-mono text-text-secondary mb-1">Task Completion Action</label>
              <select
                value={jiraCompletionAction}
                onChange={e => setJiraCompletionAction(e.target.value)}
                className="w-full bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-accent-blue font-mono"
              >
                <option value="to_test">Run the To Test transition</option>
                <option value="to_review">Run the To Review transition</option>
              </select>
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

      {/* Below the credentials deliberately: the queue is the consequence of
          what is configured above, and saving credentials is what un-parks a
          row that failed because they were wrong. */}
      <SyncQueuePanel />
    </div>
  );
};

