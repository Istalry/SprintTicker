import React, { useState, useEffect } from 'react';
import { Sliders, Plug, Calendar, Server, Save, Check, Box, Folder, Loader2, CheckCircle, AlertTriangle, Trash2, RefreshCw } from 'lucide-react';
import { HardwareBindingConfig, UnityProjectInjectionResult } from '../../../shared/dtos';

export const SettingsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'providers' | 'hardware' | 'ceremonies' | 'integrations' | 'unity'>('providers');
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

  // Unity Injector & Gitignore State
  const [isGitignoreConfigured, setIsGitignoreConfigured] = useState<boolean | null>(null);
  const [gitignorePath, setGitignorePath] = useState<string>('');
  const [isSettingUpGitignore, setIsSettingUpGitignore] = useState<boolean>(false);
  const [gitignoreMessage, setGitignoreMessage] = useState<string | null>(null);

  const [scanFolder, setScanFolder] = useState<string>('C:\\Users\\jbgeron\\Documents');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanResults, setScanResults] = useState<UnityProjectInjectionResult[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getInputBindings().then(b => {
        if (b) setBindings(b);
      }).catch(err => console.error('[SettingsView] Error loading bindings:', err));

      if (window.electronAPI.unityInjector) {
        window.electronAPI.unityInjector.checkGitignore().then(res => {
          setIsGitignoreConfigured(res.configured);
          if (res.path) setGitignorePath(res.path);
        }).catch(err => console.error('[SettingsView] Error checking gitignore:', err));
      }
    }
  }, []);

  const handleSave = async () => {
    if (window.electronAPI) {
      await window.electronAPI.saveInputBindings(bindings);
    }
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleConfigureGitignore = async () => {
    if (!window.electronAPI?.unityInjector) return;
    setIsSettingUpGitignore(true);
    setGitignoreMessage(null);

    try {
      const res = await window.electronAPI.unityInjector.setupGitignore();
      if (res.success) {
        setIsGitignoreConfigured(true);
        if (res.path) setGitignorePath(res.path);
        setGitignoreMessage(res.message);
      } else {
        setGitignoreMessage(res.message);
      }
    } catch (err: any) {
      setGitignoreMessage(`Error: ${err?.message || err}`);
    } finally {
      setIsSettingUpGitignore(false);
      setTimeout(() => setGitignoreMessage(null), 4000);
    }
  };

  const handleBrowseFolder = async () => {
    if (!window.electronAPI?.unityInjector) return;
    try {
      const selected = await window.electronAPI.unityInjector.openFolderPicker();
      if (selected) {
        setScanFolder(selected);
      }
    } catch (err) {
      console.error('[SettingsView] Error browsing folder:', err);
    }
  };

  const handleScanAndInject = async () => {
    if (!window.electronAPI?.unityInjector) return;
    if (!scanFolder) return;

    setIsScanning(true);
    setScanError(null);

    try {
      const results = await window.electronAPI.unityInjector.scanAndInject(scanFolder);
      setScanResults(results);
    } catch (err: any) {
      setScanError(err?.message || 'Failed to scan and inject Unity projects.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleRemoveInjection = async (projectPath: string) => {
    if (!window.electronAPI?.unityInjector) return;
    try {
      const success = await window.electronAPI.unityInjector.removeInjection(projectPath);
      if (success) {
        setScanResults(prev => prev.map(r => r.projectPath === projectPath ? { ...r, status: 'failed', error: 'Removed injection junction' } : r));
      }
    } catch (err: any) {
      console.error('[SettingsView] Error removing injection:', err);
    }
  };

  const handleReInject = async (projectPath: string) => {
    if (!window.electronAPI?.unityInjector) return;
    try {
      const results = await window.electronAPI.unityInjector.scanAndInject(projectPath);
      if (results && results.length > 0) {
        const updated = results[0];
        setScanResults(prev => prev.map(r => r.projectPath === projectPath ? updated : r));
      }
    } catch (err: any) {
      console.error('[SettingsView] Error re-injecting project:', err);
    }
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
          { id: 'integrations', label: '⚡ Integrations & Server', icon: Server },
          { id: 'unity', label: '🎮 Unity Plugin Injector', icon: Box }
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

        {activeTab === 'unity' && (
          <div className="space-y-6 max-w-3xl">
            {/* Card A: Global Gitignore Manager */}
            <div className="bg-dark-900 p-5 rounded-xl border border-border-dark space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Box className="w-5 h-5 text-accent-blue" />
                  <div>
                    <h3 className="text-sm font-bold text-white font-mono">Global Gitignore Manager</h3>
                    <p className="text-xs text-text-secondary">Globally ignore com.antigravity.busybar in Git to prevent local companion files from polluting project repositories.</p>
                  </div>
                </div>

                {isGitignoreConfigured === true ? (
                  <span className="flex items-center space-x-1.5 px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full text-xs font-mono font-semibold">
                    <CheckCircle className="w-3.5 h-3.5" />
                    <span>Gitignore Configured</span>
                  </span>
                ) : (
                  <span className="flex items-center space-x-1.5 px-3 py-1 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full text-xs font-mono font-semibold">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Not Configured</span>
                  </span>
                )}
              </div>

              {gitignorePath && (
                <div className="text-xs font-mono text-text-secondary bg-dark-800 p-2.5 rounded-lg border border-border-dark">
                  Target File: <span className="text-white">{gitignorePath}</span>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={handleConfigureGitignore}
                  disabled={isSettingUpGitignore}
                  className="flex items-center space-x-2 px-4 py-2 bg-accent-blue hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-mono font-semibold rounded-lg shadow transition-all"
                >
                  {isSettingUpGitignore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                  <span>Configure Global Gitignore</span>
                </button>

                {gitignoreMessage && (
                  <span className="text-xs font-mono text-accent-green">{gitignoreMessage}</span>
                )}
              </div>
            </div>

            {/* Card B: Unity Projects Auto-Scan & Injector */}
            <div className="bg-dark-900 p-5 rounded-xl border border-border-dark space-y-4">
              <div>
                <h3 className="text-sm font-bold text-white font-mono">Unity Projects Auto-Scan & Injector</h3>
                <p className="text-xs text-text-secondary mb-3">Scan local directories and inject the BUSY Bar C# plugin into target projects via Directory Junctions without modifying Packages/manifest.json.</p>
              </div>

              {/* Directory Selection Row */}
              <div className="space-y-2">
                <label className="block text-xs font-mono text-text-secondary">Root Unity Workspace Directory</label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={scanFolder}
                    onChange={e => setScanFolder(e.target.value)}
                    placeholder="e.g. C:\Users\username\UnityProjects"
                    className="flex-1 bg-dark-800 border border-border-dark rounded-lg px-4 py-2 text-xs text-white focus:outline-none focus:border-accent-blue font-mono"
                  />
                  <button
                    onClick={handleBrowseFolder}
                    className="flex items-center space-x-1.5 px-3 py-2 bg-dark-800 hover:bg-dark-700 text-text-secondary hover:text-white border border-border-dark text-xs font-mono font-medium rounded-lg transition-all"
                  >
                    <Folder className="w-3.5 h-3.5" />
                    <span>Browse Folder...</span>
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleScanAndInject}
                  disabled={isScanning || !scanFolder}
                  className="flex items-center space-x-2 px-5 py-2.5 bg-accent-green hover:bg-emerald-600 disabled:opacity-50 text-dark-900 font-semibold text-xs font-mono rounded-lg shadow-md transition-all"
                >
                  {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  <span>{isScanning ? 'Scanning & Injecting...' : 'Scan & Inject All Projects'}</span>
                </button>
              </div>

              {scanError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs font-mono text-red-400">
                  {scanError}
                </div>
              )}

              {/* Scan Results Table */}
              {scanResults.length > 0 && (
                <div className="space-y-2 pt-2">
                  <h4 className="text-xs font-bold text-white font-mono uppercase tracking-wider">Detected Unity Projects ({scanResults.length})</h4>

                  <div className="bg-dark-800 rounded-lg border border-border-dark overflow-hidden">
                    <table className="w-full text-left font-mono text-xs">
                      <thead className="bg-dark-900 text-text-secondary border-b border-border-dark">
                        <tr>
                          <th className="px-4 py-2.5">Project Name</th>
                          <th className="px-4 py-2.5">Path</th>
                          <th className="px-4 py-2.5">Status</th>
                          <th className="px-4 py-2.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-dark text-white">
                        {scanResults.map((item, idx) => (
                          <tr key={idx} className="hover:bg-dark-700/50 transition-all">
                            <td className="px-4 py-2.5 font-bold text-accent-blue">{item.projectName}</td>
                            <td className="px-4 py-2.5 text-text-secondary truncate max-w-xs" title={item.projectPath}>{item.projectPath}</td>
                            <td className="px-4 py-2.5">
                              {item.status === 'injected' && (
                                <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded text-[10px] font-bold">
                                  Injected
                                </span>
                              )}
                              {item.status === 'already_exists' && (
                                <span className="px-2.5 py-0.5 bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded text-[10px] font-bold">
                                  Already Linked
                                </span>
                              )}
                              {item.status === 'failed' && (
                                <span className="px-2.5 py-0.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded text-[10px] font-bold" title={item.error}>
                                  Failed
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              {item.status === 'injected' || item.status === 'already_exists' ? (
                                <button
                                  onClick={() => handleRemoveInjection(item.projectPath)}
                                  className="flex items-center space-x-1 ml-auto px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-[10px] font-semibold rounded transition-all"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  <span>Remove Injection</span>
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleReInject(item.projectPath)}
                                  className="flex items-center space-x-1 ml-auto px-2.5 py-1 bg-accent-blue/10 hover:bg-accent-blue/20 text-accent-blue border border-accent-blue/30 text-[10px] font-semibold rounded transition-all"
                                >
                                  <RefreshCw className="w-3 h-3" />
                                  <span>Re-Inject</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

