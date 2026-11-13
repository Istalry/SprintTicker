import React, { useState, useEffect, useRef } from 'react';
import { AutoSaveIndicator } from '../../components/AutoSaveIndicator';
import { Bell, Plus, Trash2, Terminal, Activity, CheckCircle2, XCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import {
  NotificationSourceRule,
  NotificationPriorityMode,
  NotificationLogEntryDTO,
  NotificationListenerStatusDTO,
  BitmapIconId
} from '../../../shared/dtos';
import { useNotificationSettings } from '../../hooks/useNotificationSettings';
import { formatClockTime } from '../../utils/formatters';

/**
 * Settings · Developer's notification listener (S24): how Windows is read,
 * what it captured, its logs, and apps added by their id. Which apps show
 * on the bar, and the switch, are Desk devices' (S22): this page and that one
 * are never on screen together, so each keeps its own store.
 */
export const NotificationListenerView: React.FC = () => {
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
  const [newAppId, setNewAppId] = useState<string>('');
  const [newAppName, setNewAppName] = useState<string>('');
  const [newIconId, setNewIconId] = useState<BitmapIconId>('bell');
  const [newPriorityMode, setNewPriorityMode] = useState<NotificationPriorityMode>('DEFAULT');
  const logContainerRef = useRef<HTMLDivElement>(null);

  const fetchStatusAndLogs = () => {
    window.electronAPI?.getNotificationListenerStatus?.()
      .then(res => {
        if (res) {
          if (res.status) setStatus(res.status);
          if (Array.isArray(res.logs)) setLogs(res.logs);
        }
      })
      .catch(err => console.error('[NotificationListenerView] Error fetching listener status:', err));
  };
  const { setSettings, saveStatus } = useNotificationSettings(fetchStatusAndLogs);

  useEffect(() => {
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

  const filteredLogs = logs.filter(log => {
    if (logFilter === 'ALL') return true;
    return log.level.toUpperCase() === logFilter;
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex justify-end"><AutoSaveIndicator status={saveStatus} /></div>

      <div className="bg-dark-800 border border-border-dark rounded-xl p-5 space-y-4">
        {/* Real-Time OS Listener Diagnostics & Status Bar: Developer only. */}
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

        {/* Apps added by their id, for one the listener has not seen. */}
        <div className="pt-4 border-t border-border-dark">
          <h4 className="text-xs font-bold text-text-secondary mb-3">Add Custom Notification Source</h4>
          <div className="flex items-center space-x-3">
            <input
              type="text"
              aria-label="App ID"
              placeholder="App ID (e.g. chrome, outlook)"
              value={newAppId}
              onChange={e => setNewAppId(e.target.value)}
              className="bg-dark-900 text-white text-xs px-3 py-2 rounded-lg border border-border-field focus:outline-none focus:border-focus flex-1"
            />
            <input
              type="text"
              aria-label="Display name"
              placeholder="Display Name (e.g. Google Chrome)"
              value={newAppName}
              onChange={e => setNewAppName(e.target.value)}
              className="bg-dark-900 text-white text-xs px-3 py-2 rounded-lg border border-border-field focus:outline-none focus:border-focus flex-1"
            />
            <select
              aria-label="Icon on the bar"
              value={newIconId}
              onChange={e => setNewIconId(e.target.value as BitmapIconId)}
              className="bg-dark-900 text-white text-xs px-3 py-2 rounded-lg border border-border-field focus:outline-none focus:border-focus"
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
              aria-label="Priority"
              value={newPriorityMode}
              onChange={e => setNewPriorityMode(e.target.value as NotificationPriorityMode)}
              className="bg-dark-900 text-white text-xs px-3 py-2 rounded-lg border border-border-field focus:outline-none focus:border-focus"
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

      {/* Debug Console Log Box */}
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
              aria-label="Refresh the logs"
              className="p-1 text-text-secondary hover:text-white transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            {/* Clear Logs Button */}
            <button
              onClick={() => setLogs([])}
              title="Clear Logs"
              aria-label="Clear the logs"
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
            <div className="text-text-secondary italic py-4 text-center">
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
                  <span className="text-text-secondary text-[10px] shrink-0 font-mono select-none">{timeStr}</span>
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
    </div>
  );
};
