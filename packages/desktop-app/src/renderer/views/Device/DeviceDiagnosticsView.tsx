import React, { useState, useEffect } from 'react';
import { Monitor, Activity, RefreshCw, Trash2, AlertTriangle, Bell, Keyboard, Download } from 'lucide-react';
import { useDeviceStatus } from '../../hooks/useDeviceStatus';
import { AnimationDebugPanel } from '../../components/AnimationDebugPanel';
import { formatClockTime } from '../../utils/formatters';

/**
 * Which part of the view to show. Settings splits it (S23, S24): logs and
 * erasing under Data, the debug tools under Developer; `all` is both. The
 * bar's own settings are Desk devices' (`DeviceSettings`, S22).
 */
export type DeviceDiagnosticsPart = 'all' | 'data' | 'developer';

export const DeviceDiagnosticsView: React.FC<{ part?: DeviceDiagnosticsPart }> = ({ part = 'all' }) => {
  const show = (...parts: DeviceDiagnosticsPart[]): boolean => part === 'all' || parts.includes(part);
  const deviceStatus = useDeviceStatus();
  const [wipeConfirm, setWipeConfirm] = useState<boolean>(false);
  const [wiping, setWiping] = useState<boolean>(false);
  const [activeTestLog, setActiveTestLog] = useState<string | null>(null);
  const [hardwareLogs, setHardwareLogs] = useState<{ time: string; key: string; action: string }[]>([]);

  const hasBar = deviceStatus.enabled;

  useEffect(() => {
    if (window.electronAPI?.onHardwareInputEvent) {
      const unsubscribe = window.electronAPI.onHardwareInputEvent((event) => {
        const timeStr = formatClockTime(new Date()) + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
        setHardwareLogs((prev) => [...prev, { time: timeStr, key: event.inputKey, action: event.actionAssigned }].slice(-20));
      });
      return () => unsubscribe();
    }
    // React accepts an undefined cleanup; state it explicitly for noImplicitReturns.
    return undefined;
  }, []);

  return (
    <div className="space-y-6 max-w-4xl">
      {part === 'all' && (
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Monitor className="w-5 h-5 text-text-primary" />
            <span>BUSY BAR DEVICE DIAGNOSTICS & TELEMETRY</span>
          </h2>
          <p className="text-xs text-text-secondary">Inspect hardware connection topology, real-time WebSocket latency, battery health, and display properties.</p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={async () => {
              if (window.electronAPI?.exportDiagnosticLogs) {
                await window.electronAPI.exportDiagnosticLogs();
              }
            }}
            className="flex items-center space-x-2 px-4 py-2 bg-dark-800 hover:bg-dark-700 text-text-primary text-xs rounded-lg border border-border-dark transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Logs</span>
          </button>
          <button
            onClick={() => {
              if (window.electronAPI?.getDeviceStatus) {
                window.electronAPI.getDeviceStatus();
              }
            }}
            className="flex items-center space-x-2 px-4 py-2 bg-dark-800 hover:bg-dark-700 text-white text-xs rounded-lg border border-border-dark transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh Status</span>
          </button>
        </div>
      </div>
      )}

      {part === 'data' && (
        <div className="bg-dark-800 border border-border-dark rounded-xl p-6 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-white">Export logs</h3>
            <p className="text-xs text-text-secondary">A file to attach to a bug report. Your tokens are removed from it.</p>
          </div>
          <button
            type="button"
            onClick={() => { void window.electronAPI?.exportDiagnosticLogs?.(); }}
            className="flex items-center space-x-2 px-4 py-2 bg-dark-700 hover:bg-dark-600 text-text-primary text-xs rounded-lg border border-border-dark transition-all shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Logs</span>
          </button>
        </div>
      )}

      {hasBar && (<>
      {/* Display health: what came before every measured hang of the bar. */}
      {show('developer') && (
      <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center space-x-2">
          <Activity className={`w-4 h-4 ${deviceStatus.displayHealth.latencyWarning ? 'text-accent-red' : 'text-accent-green'}`} />
          <span>Display Health</span>
        </h3>
        {deviceStatus.displayHealth.latencyWarning && (
          <p className="text-xs text-accent-red">
            Uploads to the bar are slow. On firmware 1.2.4 they slowed like this before every freeze that was
            measured. If the bar stops answering, export the logs below before restarting it.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="flex items-center justify-between bg-dark-900 p-3 rounded-lg border border-border-dark">
            <span className="text-text-secondary">Upload time (median):</span>
            <span className={`font-bold ${deviceStatus.displayHealth.latencyWarning ? 'text-accent-red' : 'text-white'}`}>
              {deviceStatus.displayHealth.uploadMedianMs === null ? 'No uploads yet' : `${deviceStatus.displayHealth.uploadMedianMs} ms`}
            </span>
          </div>
          <div className="flex items-center justify-between bg-dark-900 p-3 rounded-lg border border-border-dark">
            <span className="text-text-secondary">Screen closes, last hour:</span>
            <span className="font-bold text-white">{deviceStatus.displayHealth.screenClosesLastHour}</span>
          </div>
          <div className="flex items-center justify-between bg-dark-900 p-3 rounded-lg border border-border-dark">
            <span className="text-text-secondary">Requests not needed (skipped):</span>
            <span className="font-bold text-white">{deviceStatus.displayHealth.requestsSkipped}</span>
          </div>
          <div className="flex items-center justify-between bg-dark-900 p-3 rounded-lg border border-border-dark">
            <span className="text-text-secondary">Longest request queue:</span>
            <span className="font-bold text-white">{deviceStatus.displayHealth.maxQueueLength}</span>
          </div>
        </div>
      </div>

      )}

      {show('developer') && (<>
      {activeTestLog && (
        <div className="bg-select border border-focus/40 text-text-primary text-xs p-3 rounded-lg flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Activity className="w-4 h-4 animate-spin" />
            <span className="font-bold">{activeTestLog}</span>
          </div>
          <span className="text-[10px] text-text-secondary">Dispatched to Display Engine</span>
        </div>
      )}

      {/* Notification Debug Panel */}
      <div className="bg-dark-800 border border-border-dark rounded-xl p-6 space-y-4">
        <div className="flex items-center space-x-2 text-text-primary">
          <Bell className="w-5 h-5" />
          <h3 className="text-sm font-bold">Windows Notification Debug Triggers</h3>
        </div>
        <p className="text-xs text-text-secondary">
          Dispatch simulated Windows system &amp; application notifications to verify left-icon centered 15x15 rasterization and priority preemption rules.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button
            onClick={() => {
              setActiveTestLog('Executing Discord Banner Test ([DISCORD] Alice)...');
              if (window.electronAPI?.simulateNotification) {
                window.electronAPI.simulateNotification({
                  appId: 'discord',
                  appName: 'Discord',
                  title: 'Alice',
                  body: 'Hey, build pipeline deployed to production!'
                });
              }
              setTimeout(() => setActiveTestLog(null), 3000);
            }}
            className="flex items-center justify-center space-x-2 px-3 py-2 bg-dark-700 hover:bg-dark-600 text-text-primary text-xs font-bold border border-border-dark rounded-lg transition-all"
          >
            <span>💬 Test Discord</span>
          </button>

          <button
            onClick={() => {
              setActiveTestLog('Executing Slack Banner Test ([SLACK] Bob)...');
              if (window.electronAPI?.simulateNotification) {
                window.electronAPI.simulateNotification({
                  appId: 'slack',
                  appName: 'Slack',
                  title: 'Bob (Core Team)',
                  body: 'Sprint planning review in 10 mins.'
                });
              }
              setTimeout(() => setActiveTestLog(null), 3000);
            }}
            className="flex items-center justify-center space-x-2 px-3 py-2 bg-dark-700 hover:bg-dark-600 text-accent-green text-xs font-bold border border-border-dark rounded-lg transition-all"
          >
            <span># Test Slack</span>
          </button>

          <button
            onClick={() => {
              setActiveTestLog('Executing Antigravity Alert Test ([ANTIGRAVITY] Agentic AI)...');
              if (window.electronAPI?.simulateNotification) {
                window.electronAPI.simulateNotification({
                  appId: 'antigravity',
                  appName: 'Antigravity',
                  title: 'Agentic AI',
                  body: 'Refactoring & Vitest suite complete!'
                });
              }
              setTimeout(() => setActiveTestLog(null), 3000);
            }}
            className="flex items-center justify-center space-x-2 px-3 py-2 bg-dark-700 hover:bg-dark-600 text-text-primary text-xs font-bold border border-border-dark rounded-lg transition-all"
          >
            <span>🌀 Test Antigravity</span>
          </button>

          <button
            onClick={() => {
              setActiveTestLog('Executing System Battery Alert Test ([SYSTEM BATTERY] Low Battery)...');
              if (window.electronAPI?.simulateNotification) {
                window.electronAPI.simulateNotification({
                  appId: 'battery',
                  appName: 'System Battery',
                  title: 'Low Battery Alert',
                  body: 'Battery level 15% - Connect charger!'
                });
              }
              setTimeout(() => setActiveTestLog(null), 3000);
            }}
            className="flex items-center justify-center space-x-2 px-3 py-2 bg-dark-700 hover:bg-dark-600 text-accent-amber text-xs font-bold border border-border-dark rounded-lg transition-all"
          >
            <span>🔋 Test Battery Alert</span>
          </button>

          <button
            onClick={() => {
              setActiveTestLog('Executing Snipping Tool Screenshot Test ([SNIPPING TOOL] Screenshot saved)...');
              if (window.electronAPI?.simulateNotification) {
                window.electronAPI.simulateNotification({
                  appId: 'Microsoft.ScreenSketch_8wekyb3d8bbwe!App',
                  appName: 'Snipping Tool',
                  title: 'Screenshot saved to clipboard',
                  body: 'Select to view screenshot details',
                  iconPath: 'C:\\Program Files\\WindowsApps\\Microsoft.ScreenSketch_11.2602.49.0_x64__8wekyb3d8bbwe\\Assets\\SnippingToolAppList.scale-200.png'
                });
              }
              setTimeout(() => setActiveTestLog(null), 3000);
            }}
            className="flex items-center justify-center space-x-2 px-3 py-2 bg-dark-700 hover:bg-dark-600 text-text-primary text-xs font-bold border border-border-dark rounded-lg transition-all"
          >
            <span>✂️ Test Screenshot</span>
          </button>
        </div>
      </div>

      {/* Animation Debug Panel */}
      <AnimationDebugPanel />

      {/* Hardware Input Stream Console */}
      <div className="bg-dark-800 border border-border-dark rounded-xl p-6 space-y-4">
        <div className="flex items-center space-x-2 text-text-primary">
          <Keyboard className="w-5 h-5" />
          <h3 className="text-sm font-bold">Hardware Input Stream Console</h3>
        </div>
        <p className="text-xs text-text-secondary">
          Live stream of physical hardware button presses received via WebSocket telemetry over USB or Wi-Fi.
        </p>
        <div className="bg-dark-900 border border-dark-700 rounded-lg h-40 overflow-y-auto p-3 text-[11px] space-y-1 shadow-inner">
          {hardwareLogs.length === 0 ? (
            <div className="text-text-muted italic">Waiting for physical hardware inputs... Press a button on the BUSY Bar.</div>
          ) : (
            hardwareLogs.map((log, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="text-text-muted">[{log.time}]</span>
                <span className="px-1.5 py-0.5 rounded bg-select text-text-primary border border-border-dark font-bold">INPUT</span>
                <span className="text-text-primary">Key: <strong className="text-text-primary">{log.key.toUpperCase()}</strong></span>
                <span className="text-text-secondary ml-4">Assigned Action: {log.action}</span>
              </div>
            ))
          )}
        </div>
      </div>

      </>)}
      </>)}

      {/* ⚠️ Danger Zone: Factory Data Wipe */}
      {show('data') && (
      <div className="bg-dark-800 border border-accent-red/30 rounded-xl p-6 space-y-4">
        <div className="flex items-center space-x-2 text-accent-red">
          <AlertTriangle className="w-5 h-5" />
          <h3 className="text-sm font-bold">Danger Zone - Factory Reset</h3>
        </div>
        <p className="text-xs text-text-secondary">
          Permanently delete all projects, tasks, sessions, and worklog history from the local SQLite database.
          <strong className="text-accent-red"> This action cannot be undone.</strong>
        </p>

        {!wipeConfirm ? (
          <button
            onClick={() => setWipeConfirm(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-accent-red/10 hover:bg-accent-red/20 text-accent-red text-xs font-bold border border-accent-red/40 rounded-lg transition-all"
          >
            <Trash2 className="w-4 h-4" />
            <span>Wipe Tasks, Projects &amp; History</span>
          </button>
        ) : (
          <div className="flex items-center space-x-3 p-3 bg-accent-red/10 border border-accent-red/40 rounded-lg">
            <span className="text-xs text-accent-red font-bold">Are you sure? This deletes ALL local data.</span>
            <button
              onClick={async () => {
                setWiping(true);
                try {
                  if (window.electronAPI?.wipeAllData) {
                    await window.electronAPI.wipeAllData();
                  }
                } finally {
                  setWiping(false);
                  setWipeConfirm(false);
                }
              }}
              disabled={wiping}
              className="px-3 py-1.5 bg-accent-red hover:bg-accent-red/90 text-white text-xs font-bold rounded-lg transition-all"
            >
              {wiping ? 'Wiping...' : 'Yes, Wipe Everything'}
            </button>
            <button
              onClick={() => setWipeConfirm(false)}
              className="px-3 py-1.5 bg-dark-700 hover:bg-dark-600 text-text-secondary hover:text-white text-xs font-semibold rounded-lg border border-border-dark transition-all"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      )}
    </div>
  );
};

export default DeviceDiagnosticsView;
