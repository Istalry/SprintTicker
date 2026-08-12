import React, { useState, useEffect } from 'react';
import { Gamepad2, Box, Folder, Loader2, CheckCircle, AlertTriangle, Trash2, RefreshCw, Volume2, Bell, Save, Check } from 'lucide-react';
import { UnityProjectInjectionResult, UnityTelemetryDTO } from '../../../shared/dtos';
import { playAudioChimePreview } from '../../utils/audio-chime-synth';

export const UnityEngineView: React.FC = () => {
  // Audio & Play Mode State
  const [buildChime, setBuildChime] = useState<string>('chime_1');
  const [enableFailureSound, setEnableFailureSound] = useState<boolean>(true);
  const [enablePlayModeDnd, setEnablePlayModeDnd] = useState<boolean>(true);
  const [showUnityErrors, setShowUnityErrors] = useState<boolean>(false);
  const [errorDurationSeconds, setErrorDurationSeconds] = useState<number>(5);
  const [isSaved, setIsSaved] = useState<boolean>(false);

  // Live Telemetry State
  const [telemetry, setTelemetry] = useState<UnityTelemetryDTO>({
    activeProjectName: 'MyFantasyGame',
    isConnected: true,
    compilationState: 'Idle',
    playModeStatus: 'Editor Idle'
  });

  // Unity Injector & Gitignore State
  const [isGitignoreConfigured, setIsGitignoreConfigured] = useState<boolean | null>(null);
  const [gitignorePath, setGitignorePath] = useState<string>('');
  const [isSettingUpGitignore, setIsSettingUpGitignore] = useState<boolean>(false);
  const [gitignoreMessage, setGitignoreMessage] = useState<string | null>(null);

  const [scanFolder, setScanFolder] = useState<string>('');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanResults, setScanResults] = useState<UnityProjectInjectionResult[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    if (window.electronAPI?.unityInjector) {
      window.electronAPI.unityInjector.checkGitignore().then(res => {
        setIsGitignoreConfigured(res.configured);
        if (res.path) setGitignorePath(res.path);
      }).catch(err => console.error('[UnityEngineView] Error checking gitignore:', err));
    }

    if (window.electronAPI?.getUnitySettings) {
      window.electronAPI.getUnitySettings().then(s => {
        if (s) {
          setBuildChime(s.buildChime);
          setEnableFailureSound(s.enableFailureSound);
          setEnablePlayModeDnd(s.enablePlayModeDnd);
          if (s.showUnityErrors !== undefined) setShowUnityErrors(s.showUnityErrors);
          if (s.errorDurationSeconds !== undefined) setErrorDurationSeconds(s.errorDurationSeconds);
          if (s.scanFolder) {
            setScanFolder(s.scanFolder);
            if (window.electronAPI?.unityInjector) {
              window.electronAPI.unityInjector.scanAndInject(s.scanFolder).then(res => {
                if (res) setScanResults(res);
              }).catch(() => {});
            }
          }
        }
      }).catch(err => console.error('[UnityEngineView] Error fetching settings:', err));
    }

    if (window.electronAPI?.getUnityTelemetry) {
      window.electronAPI.getUnityTelemetry().then(t => {
        if (t) setTelemetry(t);
      }).catch(err => console.error('[UnityEngineView] Error fetching telemetry:', err));
    }

    if (window.electronAPI?.onUnityTelemetryUpdated) {
      const unsubscribe = window.electronAPI.onUnityTelemetryUpdated(t => {
        if (t) setTelemetry(t);
      });
      return () => unsubscribe();
    }
    return undefined;
  }, []);

  const handleSaveUnitySettings = async () => {
    if (window.electronAPI?.saveUnitySettings) {
      await window.electronAPI.saveUnitySettings({
        buildChime,
        enableFailureSound,
        enablePlayModeDnd,
        showUnityErrors,
        errorDurationSeconds,
        scanFolder
      });
    }
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
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
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setGitignoreMessage(`Error: ${msg}`);
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
        if (window.electronAPI?.saveUnitySettings) {
          await window.electronAPI.saveUnitySettings({
            buildChime,
            enableFailureSound,
            enablePlayModeDnd,
            showUnityErrors,
            errorDurationSeconds,
            scanFolder: selected
          });
        }
      }
    } catch (err) {
      console.error('[UnityEngineView] Error browsing folder:', err);
    }
  };

  const handleScanAndInject = async () => {
    if (!window.electronAPI?.unityInjector) return;
    if (!scanFolder) return;

    setIsScanning(true);
    setScanError(null);

    try {
      if (window.electronAPI?.saveUnitySettings) {
        await window.electronAPI.saveUnitySettings({
          buildChime,
          enableFailureSound,
          enablePlayModeDnd,
          showUnityErrors,
          errorDurationSeconds,
          scanFolder
        });
      }
      const results = await window.electronAPI.unityInjector.scanAndInject(scanFolder);
      setScanResults(results);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setScanError(msg || 'Failed to scan and inject Unity projects.');
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
    } catch (err: unknown) {
      console.error('[UnityEngineView] Error removing injection:', err);
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
    } catch (err: unknown) {
      console.error('[UnityEngineView] Error re-injecting project:', err);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl font-mono">
      {/* View Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Gamepad2 className="w-5 h-5 text-accent-blue" />
            <span>UNITY ENGINE INTEGRATION & INJECTOR</span>
          </h2>
          <p className="text-xs text-text-secondary">Multi-instance compilation progress, Play Mode alerts, global Gitignore, and junction injection.</p>
        </div>
      </div>

      {/* Connected Unity Editor Telemetry Overview */}
      <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-4">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-2">
          <Bell className="w-4 h-4 text-accent-blue" />
          <span>Active Unity Editor C# Plugin Status</span>
        </h3>

        <div className="grid grid-cols-3 gap-4">
          <div className="bg-dark-900 p-4 rounded-lg border border-border-dark space-y-1">
            <div className="text-[11px] text-text-secondary">Active Unity Project</div>
            <div className="text-sm font-bold text-white truncate" title={telemetry.activeProjectName}>{telemetry.activeProjectName}</div>
            <div className={`text-[10px] font-semibold ${telemetry.isConnected ? 'text-accent-green' : 'text-text-secondary'}`}>
              {telemetry.isConnected ? '🟢 Connected (IPC Listening)' : '⚪ Offline / Idle'}
            </div>
          </div>

          <div className="bg-dark-900 p-4 rounded-lg border border-border-dark space-y-1">
            <div className="text-[11px] text-text-secondary">Compilation State</div>
            <div className={`text-sm font-bold ${telemetry.compilationState === 'Compiling' ? 'text-accent-amber animate-pulse' : 'text-accent-blue'}`}>
              {telemetry.compilationState}
            </div>
            <div className="text-[10px] text-text-secondary">Listens to CompilationPipeline</div>
          </div>

          <div className="bg-dark-900 p-4 rounded-lg border border-border-dark space-y-1">
            <div className="text-[11px] text-text-secondary">Play Mode Status</div>
            <div className={`text-sm font-bold ${telemetry.playModeStatus === 'In Play Mode' ? 'text-accent-red font-bold' : 'text-white'}`}>
              {telemetry.playModeStatus}
            </div>
            <div className="text-[10px] text-text-secondary">ON AIR preemption ready</div>
          </div>
        </div>
      </div>

      {/* Audio Chime & Play Mode DND Settings */}
      <div className="bg-dark-800 rounded-xl border border-border-dark p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-2">
            <Volume2 className="w-4 h-4 text-accent-green" />
            <span>Compilation Sounds & Play Mode Alerts</span>
          </h3>

          <button
            onClick={handleSaveUnitySettings}
            className="flex items-center space-x-1.5 px-4 py-1.5 bg-accent-green hover:bg-emerald-600 text-dark-900 font-semibold text-xs rounded-lg transition-all"
          >
            {isSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{isSaved ? 'Settings Saved!' : 'Save Unity Settings'}</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="block text-xs text-text-secondary">Build Completion Audio Chime</label>
              <button
                type="button"
                onClick={() => playAudioChimePreview(buildChime)}
                className="text-[10px] text-accent-blue hover:text-blue-400 font-semibold underline cursor-pointer"
              >
                🔊 Test Sound
              </button>
            </div>
            <select
              value={buildChime}
              onChange={e => setBuildChime(e.target.value)}
              className="w-full bg-dark-900 border border-border-dark rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-accent-blue"
            >
              <option value="chime_1">Success Chime 1 (Subtle Synth)</option>
              <option value="retro_beep">Retro Beep (8-Bit Victory)</option>
              <option value="arcade">Arcade Level Up</option>
              <option value="muted">Muted (Visual LED Only)</option>
            </select>
          </div>

          <div className="space-y-3 pt-4">
            <label className="flex items-center space-x-3 text-xs text-white cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enableFailureSound}
                onChange={e => setEnableFailureSound(e.target.checked)}
                className="rounded bg-dark-900 border-border-dark text-accent-blue focus:ring-0"
              />
              <span>Play Alert Sound on Build Failure / Exception</span>
            </label>

            <label className="flex items-center space-x-3 text-xs text-white cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showUnityErrors}
                onChange={e => setShowUnityErrors(e.target.checked)}
                className="rounded bg-dark-900 border-border-dark text-accent-blue focus:ring-0"
              />
              <span>Show Unity C# Error / Exception Alerts on LED Display</span>
            </label>

            {showUnityErrors && (
              <div className="pl-7 flex items-center space-x-3">
                <span className="text-xs text-text-secondary">Error Alert Display Duration:</span>
                <select
                  value={errorDurationSeconds}
                  onChange={e => setErrorDurationSeconds(Number(e.target.value))}
                  className="bg-dark-900 border border-border-dark rounded-lg px-2.5 py-1 text-xs text-white focus:outline-none focus:border-accent-blue font-mono"
                >
                  <option value={3}>3 Seconds</option>
                  <option value={5}>5 Seconds (Default)</option>
                  <option value={10}>10 Seconds</option>
                  <option value={15}>15 Seconds</option>
                  <option value={30}>30 Seconds</option>
                </select>
              </div>
            )}

            <label className="flex items-center space-x-3 text-xs text-white cursor-pointer select-none">
              <input
                type="checkbox"
                checked={enablePlayModeDnd}
                onChange={e => setEnablePlayModeDnd(e.target.checked)}
                className="rounded bg-dark-900 border-border-dark text-accent-blue focus:ring-0"
              />
              <span>Enable &quot;ON AIR&quot; Display Mode when entering Play Mode</span>
            </label>
          </div>
        </div>
      </div>

      {/* Card A: Global Gitignore Manager */}
      <div className="bg-dark-800 p-6 rounded-xl border border-border-dark space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Box className="w-5 h-5 text-accent-blue" />
            <div>
              <h3 className="text-sm font-bold text-white">Global Gitignore Manager</h3>
              <p className="text-xs text-text-secondary">Globally ignore com.antigravity.busybar in Git to prevent companion files from polluting project repos.</p>
            </div>
          </div>

          {isGitignoreConfigured === true ? (
            <span className="flex items-center space-x-1.5 px-3 py-1 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full text-xs font-semibold">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>Gitignore Configured</span>
            </span>
          ) : (
            <span className="flex items-center space-x-1.5 px-3 py-1 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full text-xs font-semibold">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Not Configured</span>
            </span>
          )}
        </div>

        {gitignorePath && (
          <div className="text-xs text-text-secondary bg-dark-900 p-2.5 rounded-lg border border-border-dark">
            Target File: <span className="text-white">{gitignorePath}</span>
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <button
            onClick={handleConfigureGitignore}
            disabled={isSettingUpGitignore}
            className="flex items-center space-x-2 px-4 py-2 bg-accent-blue hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow transition-all"
          >
            {isSettingUpGitignore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
            <span>Configure Global Gitignore</span>
          </button>

          {gitignoreMessage && (
            <span className="text-xs text-accent-green">{gitignoreMessage}</span>
          )}
        </div>
      </div>

      {/* Card B: Unity Projects Auto-Scan & Injector */}
      <div className="bg-dark-800 p-6 rounded-xl border border-border-dark space-y-4 shadow-xl">
        <div>
          <h3 className="text-sm font-bold text-white">Unity Projects Auto-Scan & Directory Junction Injector</h3>
          <p className="text-xs text-text-secondary mb-3">Scan local directories and inject the BUSY Bar C# plugin into target projects via Directory Junctions without modifying Packages/manifest.json.</p>
        </div>

        <div className="space-y-2">
          <label className="block text-xs text-text-secondary">Root Unity Workspace Directory</label>
          <div className="flex space-x-2">
            <input
              type="text"
              value={scanFolder}
              onChange={e => setScanFolder(e.target.value)}
              placeholder="e.g. C:\Users\username\UnityProjects"
              className="flex-1 bg-dark-900 border border-border-dark rounded-lg px-4 py-2 text-xs text-white focus:outline-none focus:border-accent-blue"
            />
            <button
              onClick={handleBrowseFolder}
              className="flex items-center space-x-1.5 px-3 py-2 bg-dark-900 hover:bg-dark-700 text-text-secondary hover:text-white border border-border-dark text-xs font-medium rounded-lg transition-all"
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
            className="flex items-center space-x-2 px-5 py-2.5 bg-accent-green hover:bg-emerald-600 disabled:opacity-50 text-dark-900 font-semibold text-xs rounded-lg shadow-md transition-all"
          >
            {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span>{isScanning ? 'Scanning & Injecting...' : 'Scan & Inject All Projects'}</span>
          </button>
        </div>

        {scanError && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
            {scanError}
          </div>
        )}

        {/* Scan Results Table */}
        {scanResults.length > 0 && (
          <div className="space-y-2 pt-2">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Detected Unity Projects ({scanResults.length})</h4>

            <div className="bg-dark-900 rounded-lg border border-border-dark overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-dark-800 text-text-secondary border-b border-border-dark">
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
  );
};

export default UnityEngineView;
