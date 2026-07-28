import React, { useState } from 'react';
import { Monitor, Wifi, Cpu, Battery, Activity, HardDrive, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
import { useDeviceStatus } from '../../hooks/useDeviceStatus';
import { AnimationDebugPanel } from '../../components/AnimationDebugPanel';

export const DeviceDiagnosticsView: React.FC = () => {
  const deviceStatus = useDeviceStatus();
  const [wipeConfirm, setWipeConfirm] = useState<boolean>(false);
  const [wiping, setWiping] = useState<boolean>(false);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold font-mono text-white tracking-tight flex items-center space-x-2">
            <Monitor className="w-5 h-5 text-accent-blue" />
            <span>BUSY BAR DEVICE DIAGNOSTICS & TELEMETRY</span>
          </h2>
          <p className="text-xs text-text-secondary">Inspect hardware connection topology, real-time WebSocket latency, battery health, and display properties.</p>
        </div>

        <button
          onClick={() => {
            if (window.electronAPI?.getDeviceStatus) {
              window.electronAPI.getDeviceStatus();
            }
          }}
          className="flex items-center space-x-2 px-4 py-2 bg-dark-800 hover:bg-dark-700 text-white font-mono text-xs rounded-lg border border-border-dark transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Refresh Status</span>
        </button>
      </div>

      {/* Grid Status Cards */}
      <div className="grid grid-cols-4 gap-4 font-mono">
        <div className="bg-dark-800 p-4 rounded-xl border border-border-dark space-y-2 shadow-lg">
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>Status</span>
            <Wifi className={`w-4 h-4 ${deviceStatus.connected ? 'text-accent-green' : 'text-accent-red'}`} />
          </div>
          <div className="text-lg font-bold text-white">
            {deviceStatus.connected ? 'Connected' : 'Offline'}
          </div>
          <div className="text-[11px] text-text-secondary">IP: {deviceStatus.ipAddress}</div>
        </div>

        <div className="bg-dark-800 p-4 rounded-xl border border-border-dark space-y-2 shadow-lg">
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>Latency</span>
            <Activity className={`w-4 h-4 ${deviceStatus.connected ? 'text-accent-green' : 'text-text-secondary'}`} />
          </div>
          <div className={`text-lg font-bold ${deviceStatus.connected ? 'text-accent-green' : 'text-text-secondary'}`}>
            {deviceStatus.connected ? `${deviceStatus.webSocketPingMs} ms` : 'N/A'}
          </div>
          <div className="text-[11px] text-text-secondary">WebSocket Ping</div>
        </div>

        <div className="bg-dark-800 p-4 rounded-xl border border-border-dark space-y-2 shadow-lg">
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>Battery Level</span>
            <Battery className={`w-4 h-4 ${deviceStatus.connected ? 'text-accent-blue' : 'text-text-secondary'}`} />
          </div>
          <div className={`text-lg font-bold ${deviceStatus.connected ? 'text-white' : 'text-text-secondary'}`}>
            {deviceStatus.connected ? `${deviceStatus.batteryPercent}%` : 'N/A'}
          </div>
          <div className="text-[11px] text-text-secondary">Mode: {deviceStatus.connectionType.toUpperCase()}</div>
        </div>

        <div className="bg-dark-800 p-4 rounded-xl border border-border-dark space-y-2 shadow-lg">
          <div className="flex items-center justify-between text-xs text-text-secondary">
            <span>Firmware</span>
            <Cpu className={`w-4 h-4 ${deviceStatus.connected ? 'text-accent-purple' : 'text-text-secondary'}`} />
          </div>
          <div className={`text-lg font-bold ${deviceStatus.connected ? 'text-white' : 'text-text-secondary'}`}>
            {deviceStatus.connected ? `v${deviceStatus.firmwareVersion}` : 'N/A'}
          </div>
          <div className="text-[11px] text-text-secondary">{deviceStatus.connected ? 'Build 2026.07' : 'Disconnected'}</div>
        </div>
      </div>

      {/* Hardware Telemetry Detail Panel */}
      <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-4">
        <h3 className="text-sm font-bold text-white font-mono uppercase tracking-wider flex items-center space-x-2">
          <HardDrive className="w-4 h-4 text-accent-blue" />
          <span>Display Configuration & Debug Output Strategy</span>
        </h3>

        <div className="space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between bg-dark-900 p-3 rounded-lg border border-border-dark">
            <span className="text-text-secondary">Front OLED Display Brightness:</span>
            <span className={`font-bold ${deviceStatus.connected ? 'text-accent-blue' : 'text-text-secondary'}`}>
              {deviceStatus.connected ? `${deviceStatus.frontBrightness}%` : 'Off (Disconnected)'}
            </span>
          </div>

          <div className="flex items-center justify-between bg-dark-900 p-3 rounded-lg border border-border-dark">
            <span className="text-text-secondary">Rear Diagnostic LED Matrix Brightness:</span>
            <span className={`font-bold ${deviceStatus.connected ? 'text-accent-purple' : 'text-text-secondary'}`}>
              {deviceStatus.connected ? `${deviceStatus.backBrightness}%` : 'Off (Disconnected)'}
            </span>
          </div>

          <div className="flex items-center justify-between bg-dark-900 p-3 rounded-lg border border-border-dark">
            <span className="text-text-secondary">Rear 160×80 OLED Display Strategy:</span>
            <select
              onChange={(e) => {
                if (window.electronAPI?.setRearOledMode) {
                  window.electronAPI.setRearOledMode(e.target.value);
                }
              }}
              className="bg-dark-800 text-accent-green font-bold text-xs px-2 py-1 rounded border border-border-dark focus:outline-none"
            >
              <option value="DIAGNOSTICS">Mode A: Diagnostics & IP Metrics</option>
              <option value="PERFORMANCE_MONITOR">Mode B: System Performance Graph</option>
              <option value="STEALTH_CLOCK">Mode C: Power-Saving Stealth Clock</option>
            </select>
          </div>

          <div className="flex items-center justify-between bg-dark-900 p-3 rounded-lg border border-border-dark">
            <span className="text-text-secondary">Front 72×16 LED Matrix Color Theme:</span>
            <select
              onChange={(e) => {
                if (window.electronAPI?.setColorTheme) {
                  window.electronAPI.setColorTheme(e.target.value);
                }
              }}
              className="bg-dark-800 text-accent-blue font-bold text-xs px-2 py-1 rounded border border-border-dark focus:outline-none"
            >
              <option value="emerald">Emerald Developer (#10B981)</option>
              <option value="cyberpunk">Cyberpunk Neon (#8B5CF6)</option>
              <option value="retro_arcade">Retro Arcade (#F59E0B)</option>
              <option value="nordic_cyan">Nordic Cyan (#06B6D4)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Animation Debug Panel */}
      <AnimationDebugPanel />

      {/* ⚠️ Danger Zone: Factory Data Wipe */}
      <div className="bg-dark-800 border border-accent-red/30 rounded-xl p-6 space-y-4">
        <div className="flex items-center space-x-2 text-accent-red">
          <AlertTriangle className="w-5 h-5" />
          <h3 className="text-sm font-bold font-mono uppercase tracking-wider">Danger Zone - Factory Reset</h3>
        </div>
        <p className="text-xs text-text-secondary">
          Permanently delete all projects, tasks, sessions, and worklog history from the local SQLite database. Default projects (PROJ, UNITY, ADMIN) will be restored.
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
              className="px-3 py-1.5 bg-accent-red hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-all"
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
    </div>
  );
};

export default DeviceDiagnosticsView;
