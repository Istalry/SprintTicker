import React, { useState, useEffect, useRef } from 'react';
import { useAutoSave } from '../../hooks/useAutoSave';
import { AutoSaveIndicator } from '../../components/AutoSaveIndicator';
import {
  Bell,
  Plus,
  Trash2,
  Send,
  Shield,
  Terminal,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import {
  WindowsNotificationSettingsDTO,
  NotificationSourceRule,
  NotificationPriorityMode,
  NotificationLogEntryDTO,
  NotificationListenerStatusDTO,
  BitmapIconId
} from '../../../shared/dtos';
import { createDefaultNotificationSettings } from '../../../shared/notification-defaults';
import { formatClockTime } from '../../utils/formatters';

/**
 * Which part of the view to show. Settings shows the per-app rules under Desk
 * devices and the listener's diagnostics under Developer (S22, S24); `all`
 * is the whole view, as it was before the redesign split it.
 */
export type NotificationSettingsPart = 'all' | 'rules' | 'diagnostics';

export const NotificationSettingsView: React.FC<{ part?: NotificationSettingsPart }> = ({ part = 'all' }) => {
  const showRules = part !== 'diagnostics';
  const showDiagnostics = part !== 'rules';
  // Seeded from the shared defaults rather than a local copy. The copy that
  // used to live here disagreed with the main process on which apps were
  // HIGH_PRIORITY, so the effective default depended on which process wrote to
  // the database first.
  const [settings, setSettings] = useState<WindowsNotificationSettingsDTO>(
    createDefaultNotificationSettings
  );

  const [status, setStatus] = useState<NotificationListenerStatusDTO>({
    isListening: false,
    strategy: 'NONE',
    hasSqlite3: false,
    hasNotifDb: false,
    totalCaptured: 0,
    totalSuppressed: 0
  });

  const [logs, setLogs] = useState<NotificationLogEntryDTO[]>([]);
  const [logFilter, setLogFilter] = useState<string>('ALL');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);

  // With no stored settings to read there is nothing to wait for; loaded
  // is otherwise set once the read settles.
  const [loaded, setLoaded] = useState<boolean>(() => !window.electronAPI?.getNotificationSettings);
  const [newAppId, setNewAppId] = useState<string>('');
  const [newAppName, setNewAppName] = useState<string>('');
  const [newIconId, setNewIconId] = useState<BitmapIconId>('bell');
  const [newPriorityMode, setNewPriorityMode] = useState<NotificationPriorityMode>('DEFAULT');

  const [defaultScore, setDefaultScore] = useState<number>(40);
  const [highScore, setHighScore] = useState<number>(95);

  const logContainerRef = useRef<HTMLDivElement>(null);

  const fetchStatusAndLogs = () => {
    if (window.electronAPI?.getNotificationListenerStatus) {
      window.electronAPI
        .getNotificationListenerStatus()
        .then(res => {
          if (res) {
            if (res.status) setStatus(res.status);
            if (Array.isArray(res.logs)) setLogs(res.logs);
          }
        })
        .catch(err => console.error('[NotificationSettingsView] Error fetching listener status:', err));
    }
  };

  useEffect(() => {
    if (window.electronAPI?.getNotificationSettings) {
      window.electronAPI
        .getNotificationSettings()
        .then(res => {
          if (res && Array.isArray(res.sourceRules)) {
            setSettings(res);
          }
        })
        .catch(err => console.error('[NotificationSettingsView] Error fetching settings:', err))
        // Auto-save is gated on this: the defaults include a full sourceRules
        // table, and writing that over the stored one would discard every
        // per-app priority the user had set.
        .finally(() => setLoaded(true));
    }

    if (window.electronAPI?.getPriorityRules) {
      window.electronAPI
        .getPriorityRules()
        .then(res => {
          const obj = res as unknown as { rules?: Array<{ eventName: string; priority: number }> } & Record<string, number>;
          const list = Array.isArray(res) ? res : Array.isArray(obj?.rules) ? obj.rules : [];
          const msgRule = list.find(r => r.eventName === 'messagingPriority');
          const highRule = list.find(r => r.eventName === 'highNotificationPriority');
          if (msgRule && typeof msgRule.priority === 'number') setDefaultScore(msgRule.priority);
          if (highRule && typeof highRule.priority === 'number') setHighScore(highRule.priority);
        })
        .catch(() => {});
    }

    fetchStatusAndLogs();

    // Subscribe to live log streaming
    let unsubscribeLogs: (() => void) | undefined;
    if (window.electronAPI?.onNotificationLog) {
      unsubscribeLogs = window.electronAPI.onNotificationLog(entry => {
        setLogs(prev => [...prev.slice(-199), entry]);
        // Also refresh status to update captured/suppressed counters & last poll timestamp
        fetchStatusAndLogs();
      });
    }

    // Polling status every 3 seconds for continuous updates
    const intervalId = setInterval(fetchStatusAndLogs, 3000);

    return () => {
      if (unsubscribeLogs) unsubscribeLogs();
      clearInterval(intervalId);
    };
  }, []);

  // Auto scroll terminal log box to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleSave = async () => {
    if (window.electronAPI?.saveNotificationSettings) {
      await window.electronAPI.saveNotificationSettings(settings);
      fetchStatusAndLogs();
    }
  };

  // defaultScore and highScore are read from the priority rules for display
  // only, so they are not part of what this panel owns.
  const saveStatus = useAutoSave(handleSave, [settings], loaded);

  const updateRuleMode = (appId: string, mode: NotificationPriorityMode) => {
    setSettings(prev => ({
      ...prev,
      sourceRules: prev.sourceRules.map(r => (r.appId === appId ? { ...r, priorityMode: mode } : r))
    }));
  };

  /**
   * Sets a per-rule icon override.
   *
   * The listener has always honoured `iconImagePath` ahead of the resolved
   * icon, but nothing could set it, so the feature existed only for someone
   * willing to edit the database by hand. It matters because AppIconResolver
   * matches a Win32 app by Start-Menu shortcut name and can pick the wrong
   * executable -- its own docstring names this override as the remedy.
   */
  const updateRuleIcon = (appId: string, iconImagePath: string) => {
    const trimmed = iconImagePath.trim();
    setSettings(prev => ({
      ...prev,
      sourceRules: prev.sourceRules.map(r =>
        r.appId === appId ? { ...r, iconImagePath: trimmed || undefined } : r
      )
    }));
  };

  /**
   * Toggles whether this source's message body reaches the display.
   *
   * The bar is readable by anyone walking past the desk, so for a chat app the
   * body is the one part worth withholding. The sender or channel still shows,
   * which is what makes the banner worth glancing at at all.
   */
  const updateRulePrivacy = (appId: string, hideMessageBody: boolean) => {
    setSettings(prev => ({
      ...prev,
      sourceRules: prev.sourceRules.map(r =>
        r.appId === appId ? { ...r, hideMessageBody } : r
      )
    }));
  };

  const removeRule = (appId: string) => {
    setSettings(prev => ({
      ...prev,
      sourceRules: prev.sourceRules.filter(r => r.appId !== appId)
    }));
  };

  const addRule = () => {
    if (!newAppId.trim()) return;
    const rule: NotificationSourceRule = {
      appId: newAppId.trim().toLowerCase(),
      appName: newAppName.trim() || newAppId.trim(),
      iconId: newIconId,
      priorityMode: newPriorityMode
    };
    setSettings(prev => ({
      ...prev,
      sourceRules: [...prev.sourceRules.filter(r => r.appId !== rule.appId), rule]
    }));
    setNewAppId('');
    setNewAppName('');
  };

  const handleTestNotification = async (rule: NotificationSourceRule) => {
    if (window.electronAPI?.simulateNotification) {
      await window.electronAPI.simulateNotification({
        appId: rule.appId,
        appName: rule.appName,
        title: `${rule.appName} Alert`,
        body: `Test notification event for ${rule.appName}!`,
        iconId: rule.iconId
      });
      fetchStatusAndLogs();
    }
  };

  const filteredLogs = logs.filter(log => {
    if (logFilter === 'ALL') return true;
    return log.level.toUpperCase() === logFilter;
  });

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Title Header */}
      {part === 'all' && (
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Bell className="w-6 h-6 text-text-primary" />
            <span>WINDOWS NOTIFICATION LISTENER</span>
          </h2>
          <p className="text-xs text-text-secondary mt-1">
            Capture Windows system &amp; application alerts, centered left-icon matrix formatting, and 3-level per-source priority management.
          </p>
        </div>
        <AutoSaveIndicator status={saveStatus} />
      </div>
      )}
      {part !== 'all' && <div className="flex justify-end"><AutoSaveIndicator status={saveStatus} /></div>}

      {/* Main Listener & Settings Card */}
      <div className="bg-dark-800 border border-border-dark rounded-xl p-5 space-y-4">
        {showRules && (
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Shield className="w-5 h-5 text-text-primary" />
            <div>
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <span>Enable Windows User Notification Listener</span>
                {status.isListening && (
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-green opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-green"></span>
                  </span>
                )}
              </h3>
              <p className="text-xs text-text-secondary">Capture Action Center notifications and render formatted 72x16 matrix banners.</p>
            </div>
          </div>
          <button
            onClick={() => setSettings(prev => ({ ...prev, enableListener: !prev.enableListener }))}
            className={`px-4 py-2 text-xs font-bold rounded-lg border transition-all flex items-center space-x-2 ${
              settings.enableListener
                ? 'bg-accent-green/20 border-accent-green/40 text-accent-green'
                : 'bg-dark-700 border-border-dark text-text-secondary'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>{settings.enableListener ? 'LISTENER ENABLED' : 'LISTENER DISABLED'}</span>
          </button>
        </div>

        )}

        {/* Real-Time OS Listener Diagnostics & Status Bar: Developer only. */}
        {showDiagnostics && (
        <div className="bg-dark-900 border border-border-dark/60 rounded-lg p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded bg-dark-800">
              {status.isListening ? (
                <CheckCircle2 className="w-4 h-4 text-accent-green" />
              ) : (
                <XCircle className="w-4 h-4 text-accent-red" />
              )}
            </div>
            <div>
              <div className="text-[10px] text-text-secondary">Listener Status</div>
              <div className={`font-bold ${status.isListening ? 'text-accent-green' : 'text-accent-red'}`}>
                {status.isListening ? 'Active (Listening)' : 'Stopped'}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded bg-dark-800">
              <Activity className="w-4 h-4 text-text-primary" />
            </div>
            <div>
              <div className="text-[10px] text-text-secondary">Capture Strategy</div>
              <div className="font-bold text-white">
                {status.strategy === 'DB_POLLING' ? 'DB Polling (SQLite)' : status.strategy === 'WINRT' ? 'WinRT API' : 'Inactive'}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded bg-dark-800">
              {status.hasSqlite3 && status.hasNotifDb ? (
                <CheckCircle2 className="w-4 h-4 text-accent-green" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-accent-amber" />
              )}
            </div>
            <div>
              <div className="text-[10px] text-text-secondary">DB & SQLite Check</div>
              <div className="font-bold text-white text-[11px]">
                {status.hasSqlite3 ? 'sqlite3 OK' : 'sqlite3 Missing'} | {status.hasNotifDb ? 'wpndb OK' : 'wpndb Missing'}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <div className="p-1.5 rounded bg-dark-800">
              <Bell className="w-4 h-4 text-text-primary" />
            </div>
            <div>
              <div className="text-[10px] text-text-secondary">Processed Stats</div>
              <div className="font-bold text-white">
                <span className="text-accent-green">{status.totalCaptured}</span> Captured / <span className="text-accent-amber">{status.totalSuppressed}</span> Suppressed
              </div>
            </div>
          </div>
        </div>

        )}

        {/* Windows Privacy & Authorization Helper Banner */}
        {showRules && (<>
        <div className="bg-dark-900/80 border border-focus/30 rounded-lg p-3.5 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-select text-text-primary">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-white flex items-center space-x-2">
                <span>Windows Notification Access &amp; System Authorizations</span>
              </div>
              <p className="text-[11px] text-text-secondary mt-0.5">
                Ensure &quot;Allow apps to access notifications&quot; is turned ON in Windows Settings for Action Center capture.
              </p>
            </div>
          </div>
          <button
            onClick={() => window.electronAPI?.openNotificationSettings?.()}
            className="w-full md:w-auto px-4 py-2 bg-primary hover:bg-primary/90 text-dark-900 font-bold text-xs rounded-lg transition-all shadow-md shadow-black/20 flex items-center justify-center space-x-2 whitespace-nowrap cursor-pointer"
          >
            <Shield className="w-4 h-4" />
            <span>GRANT WINDOWS ACCESS</span>
          </button>
        </div>

        {/* Timeout & Polling Interval Controls */}
        <div className="pt-4 border-t border-border-dark grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between bg-dark-900/50 p-3 rounded-lg border border-border-dark/40">
            <div>
              <h4 className="text-xs font-bold text-white">Display Duration</h4>
              <p className="text-[11px] text-text-secondary">Banner auto-dismiss time</p>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                min={3}
                max={60}
                value={settings.notificationTimeoutSeconds || 10}
                onChange={e => setSettings(prev => ({ ...prev, notificationTimeoutSeconds: Math.max(3, Math.min(60, Number(e.target.value))) }))}
                className="w-16 bg-dark-900 text-white font-bold text-xs px-2 py-1 rounded border border-border-dark focus:outline-none focus:border-focus text-center"
              />
              <span className="text-xs text-text-secondary">Sec</span>
            </div>
          </div>

          <div className="flex items-center justify-between bg-dark-900/50 p-3 rounded-lg border border-border-dark/40">
            <div>
              <h4 className="text-xs font-bold text-white">Polling Interval</h4>
              <p className="text-[11px] text-text-secondary">How often Windows&apos; notifications are read</p>
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="number"
                min={1}
                max={10}
                value={settings.pollingIntervalSeconds || 2}
                onChange={e => setSettings(prev => ({ ...prev, pollingIntervalSeconds: Math.max(1, Math.min(10, Number(e.target.value))) }))}
                className="w-16 bg-dark-900 text-white font-bold text-xs px-2 py-1 rounded border border-border-dark focus:outline-none focus:border-focus text-center"
              />
              <span className="text-xs text-text-secondary">Sec</span>
            </div>
          </div>
        </div>
        </>)}
      </div>

      {/* Per-Source Notification Rules */}
      {showRules && (
      <div className="bg-dark-800 border border-border-dark rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-bold text-white">Per-Source Notification Priority Rules</h3>
        <p className="text-xs text-text-secondary">
          Assign priority levels for each application source: <strong className="text-accent-red">Don&apos;t Show</strong> (suppress), <strong className="text-text-primary">Default</strong> (level {defaultScore}), or <strong className="text-accent-amber">High Priority</strong> (level {highScore}).
        </p>

        <div className="space-y-3">
          {settings.sourceRules.map(rule => (
            <div
              key={rule.appId}
              className="p-3 bg-dark-900 border border-border-dark rounded-lg space-y-2"
            >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="text-lg">
                  {rule.iconId === 'discord'
                    ? '💬'
                    : rule.iconId === 'slack'
                    ? '#'
                    : rule.iconId === 'antigravity'
                    ? '🌀'
                    : rule.iconId === 'gmail'
                    ? '✉️'
                    : rule.iconId === 'battery'
                    ? '🔋'
                    : rule.iconId === 'windows'
                    ? '🪟'
                    : '🔔'}
                </span>
                <div>
                  <div className="text-xs font-bold text-white">{rule.appName}</div>
                  <div className="text-[10px] text-text-secondary">{rule.appId}</div>
                </div>
              </div>

              {/* Priority Mode Selector Buttons */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => updateRuleMode(rule.appId, 'DONT_SHOW')}
                  className={`px-3 py-1 text-[11px] font-bold rounded transition-all ${
                    rule.priorityMode === 'DONT_SHOW'
                      ? 'bg-accent-red/20 border border-accent-red/40 text-accent-red'
                      : 'bg-dark-800 text-text-secondary hover:text-white border border-border-dark'
                  }`}
                >
                  Don&apos;t Show
                </button>
                <button
                  onClick={() => updateRuleMode(rule.appId, 'DEFAULT')}
                  className={`px-3 py-1 text-[11px] font-bold rounded transition-all ${
                    rule.priorityMode === 'DEFAULT'
                      ? 'bg-select border border-focus/40 text-text-primary'
                      : 'bg-dark-800 text-text-secondary hover:text-white border border-border-dark'
                  }`}
                >
                  Default
                </button>
                <button
                  onClick={() => updateRuleMode(rule.appId, 'HIGH_PRIORITY')}
                  className={`px-3 py-1 text-[11px] font-bold rounded transition-all ${
                    rule.priorityMode === 'HIGH_PRIORITY'
                      ? 'bg-accent-amber/15 border border-accent-amber/40 text-accent-amber'
                      : 'bg-dark-800 text-text-secondary hover:text-white border border-border-dark'
                  }`}
                >
                  High Priority
                </button>

                <button
                  onClick={() => handleTestNotification(rule)}
                  title="Send Test Notification"
                  className="p-1.5 bg-dark-800 hover:bg-dark-700 text-text-primary rounded border border-border-dark transition-all"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>

                <button
                  onClick={() => removeRule(rule.appId)}
                  title="Remove Rule"
                  className="p-1.5 bg-dark-800 hover:bg-accent-red/20 text-text-secondary hover:text-accent-red rounded border border-border-dark transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

              <label className="flex items-center space-x-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rule.hideMessageBody === true}
                  onChange={e => updateRulePrivacy(rule.appId, e.target.checked)}
                  className="accent-primary"
                />
                <span className="text-[10px] text-text-secondary">
                  Hide message text on the bar (show sender and &quot;New message&quot; only)
                </span>
              </label>

              <div className="flex items-center space-x-2">
                <label className="text-[10px] text-text-secondary whitespace-nowrap">
                  Icon override
                </label>
                <input
                  type="text"
                  value={rule.iconImagePath ?? ''}
                  onChange={e => updateRuleIcon(rule.appId, e.target.value)}
                  placeholder="Optional: a 16×16 PNG to show instead of the app's icon"
                  className="flex-1 px-2 py-1 bg-dark-800 border border-border-dark rounded text-[10px] text-white placeholder:text-text-secondary/50 focus:outline-none focus:border-focus"
                />
              </div>
            </div>
          ))}
        </div>

        {/* Add New Source Rule */}
        <div className="pt-4 border-t border-border-dark">
          <h4 className="text-xs font-bold text-text-secondary mb-3">Add Custom Notification Source</h4>
          <div className="flex items-center space-x-3">
            <input
              type="text"
              placeholder="App ID (e.g. chrome, outlook)"
              value={newAppId}
              onChange={e => setNewAppId(e.target.value)}
              className="bg-dark-900 text-white text-xs px-3 py-2 rounded-lg border border-border-dark focus:outline-none focus:border-focus flex-1"
            />
            <input
              type="text"
              placeholder="Display Name (e.g. Google Chrome)"
              value={newAppName}
              onChange={e => setNewAppName(e.target.value)}
              className="bg-dark-900 text-white text-xs px-3 py-2 rounded-lg border border-border-dark focus:outline-none focus:border-focus flex-1"
            />
            <select
              value={newIconId}
              onChange={e => setNewIconId(e.target.value as BitmapIconId)}
              className="bg-dark-900 text-white text-xs px-3 py-2 rounded-lg border border-border-dark focus:outline-none focus:border-focus"
            >
              <option value="bell">Icon: Bell</option>
              <option value="discord">Icon: Discord</option>
              <option value="slack">Icon: Slack</option>
              <option value="gmail">Icon: Gmail</option>
              <option value="antigravity">Icon: Antigravity</option>
              <option value="battery">Icon: Battery</option>
              <option value="windows">Icon: Windows</option>
            </select>
            <select
              value={newPriorityMode}
              onChange={e => setNewPriorityMode(e.target.value as NotificationPriorityMode)}
              className="bg-dark-900 text-white text-xs px-3 py-2 rounded-lg border border-border-dark focus:outline-none focus:border-focus"
            >
              <option value="DONT_SHOW">Don&apos;t Show</option>
              <option value="DEFAULT">Default</option>
              <option value="HIGH_PRIORITY">High Priority</option>
            </select>
            <button
              onClick={addRule}
              className="flex items-center space-x-1.5 px-4 py-2 bg-dark-700 hover:bg-dark-600 text-white text-xs font-bold rounded-lg border border-border-dark transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Add Source</span>
            </button>
          </div>
        </div>
      </div>

      )}

      {/* Debug Console Log Box */}
      {showDiagnostics && (
      <div className="bg-dark-950 border border-border-dark rounded-xl overflow-hidden shadow-2xl">
        {/* Terminal Header */}
        <div className="bg-dark-900 px-4 py-2.5 border-b border-border-dark flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Terminal className="w-4 h-4 text-text-primary" />
            <span className="text-xs font-bold text-white tracking-wider">NOTIFICATION LISTENER DEBUG LOGS</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-dark-800 text-text-secondary border border-border-dark">
              {logs.length} entries
            </span>
          </div>

          <div className="flex items-center space-x-3">
            {/* Filter Buttons */}
            <div className="flex items-center space-x-1 bg-dark-800 p-0.5 rounded border border-border-dark text-[10px]">
              {['ALL', 'NOTIFICATION', 'INFO', 'WARN', 'ERROR'].map(filterOption => (
                <button
                  key={filterOption}
                  onClick={() => setLogFilter(filterOption)}
                  className={`px-2 py-0.5 rounded font-bold transition-all ${
                    logFilter === filterOption
                      ? 'bg-primary text-dark-900'
                      : 'text-text-secondary hover:text-white'
                  }`}
                >
                  {filterOption}
                </button>
              ))}
            </div>

            {/* Auto Scroll Toggle */}
            <button
              onClick={() => setAutoScroll(prev => !prev)}
              className={`px-2 py-0.5 text-[10px] font-bold rounded border transition-all ${
                autoScroll
                  ? 'bg-accent-green/20 border-accent-green/40 text-accent-green'
                  : 'bg-dark-800 border-border-dark text-text-secondary'
              }`}
            >
              {autoScroll ? 'AUTO-SCROLL ON' : 'PAUSED'}
            </button>

            {/* Refresh / Refresh Status Button */}
            <button
              onClick={fetchStatusAndLogs}
              title="Refresh Logs & Status"
              className="p-1 text-text-secondary hover:text-white transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            {/* Clear Logs Button */}
            <button
              onClick={() => setLogs([])}
              title="Clear Logs"
              className="p-1 text-text-secondary hover:text-accent-red transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Terminal Body Log Box */}
        <div
          ref={logContainerRef}
          className="p-4 text-[11px] leading-relaxed max-h-72 overflow-y-auto space-y-1.5 selection:bg-dark-600 selection:text-white"
        >
          {filteredLogs.length === 0 ? (
            <div className="text-text-secondary/60 italic py-4 text-center">
              No notification logs captured yet. Trigger a system alert or send a test notification above.
            </div>
          ) : (
            filteredLogs.map((log, idx) => {
              const timeStr = log.timestamp ? formatClockTime(new Date(log.timestamp)) : '';
              let badgeColor = 'text-text-primary bg-select border-focus/30';
              if (log.level === 'notification') badgeColor = 'text-accent-green bg-accent-green/10 border-accent-green/30';
              if (log.level === 'warn') badgeColor = 'text-accent-amber bg-accent-amber/10 border-accent-amber/30';
              if (log.level === 'error') badgeColor = 'text-accent-red bg-accent-red/10 border-accent-red/30';

              return (
                <div key={idx} className="flex items-start space-x-2 hover:bg-dark-900/50 p-0.5 rounded">
                  <span className="text-text-secondary/50 text-[10px] shrink-0 font-mono select-none">{timeStr}</span>
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${badgeColor} shrink-0 select-none`}>
                    {log.level}
                  </span>
                  <span className="text-text-primary break-all">{log.message}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
      )}
    </div>
  );
};

export default NotificationSettingsView;
