import { SettingsRepository } from '../db/repositories/settings-repository';
import { UnitySettingsDTO, UnityTelemetryDTO, UnityInstanceDTO } from '../../shared/dtos';
import { WebhookServer, UnityHeartbeatPayload, UnityCompilePayload, UnityPlayModePayload } from '../api/webhook-server';
import { DisplayRenderer } from '../hardware/display-renderer';
import { TimeTrackingEngine } from './time-tracking-engine';
import { IPriorityPreemptionEngine } from './priority-preemption-engine';
import { ArgumentNullException } from '../../shared/dtos';

/**
 * Service managing live Unity Editor telemetry status, compile states,
 * heartbeat pings, multi-instance connections, and companion application settings.
 */
export class UnityTelemetryService {
  private settingsRepo: SettingsRepository;
  private listeners: Set<(telemetry: UnityTelemetryDTO) => void> = new Set();
  private activeInstances: Map<string, UnityInstanceDTO> = new Map();
  private pruneTimer?: NodeJS.Timeout;
  private renderer?: DisplayRenderer;
  private engine?: TimeTrackingEngine;
  private priorityEngine?: IPriorityPreemptionEngine;

  private telemetryState: UnityTelemetryDTO = {
    activeProjectName: 'No Unity Instance Connected',
    isConnected: false,
    compilationState: 'Idle',
    playModeStatus: 'Editor Idle',
    lastPingUtc: undefined,
    instances: []
  };

  constructor(
    settingsRepo: SettingsRepository,
    webhookServer?: WebhookServer,
    renderer?: DisplayRenderer,
    engine?: TimeTrackingEngine,
    priorityEngine?: IPriorityPreemptionEngine
  ) {
    if (!settingsRepo) {
      throw new ArgumentNullException('settingsRepo');
    }
    this.settingsRepo = settingsRepo;
    this.renderer = renderer;
    this.engine = engine;
    this.priorityEngine = priorityEngine;

    if (webhookServer) {
      webhookServer.onHeartbeatEvent((payload) => this.handleHeartbeat(payload));
      webhookServer.onCompileEvent((payload) => this.handleCompile(payload));
      webhookServer.onPlayModeEvent((payload) => this.handlePlayMode(payload));
      webhookServer.onConsoleEvent((payload) => this.handleConsole(payload));
    }

    // Periodically prune stale Unity instances (every 10 seconds)
    this.pruneTimer = setInterval(() => this.pruneStaleInstances(), 10000);
  }

  private exceptionTimer: ReturnType<typeof setTimeout> | null = null;

  /// <summary>
  /// Retrieves current audio chime and play mode alert settings.
  /// </summary>
  public getSettings(): UnitySettingsDTO {
    return this.settingsRepo.getSetting('unity_settings', {
      buildChime: 'chime_1',
      enableFailureSound: true,
      enablePlayModeDnd: true,
      showUnityErrors: false,
      errorDurationSeconds: 5,
      scanFolder: ''
    });
  }

  /// <summary>
  /// Persists audio chime and play mode alert settings to SQLite. Merges partial settings with existing configuration.
  /// </summary>
  public saveSettings(settings: Partial<UnitySettingsDTO>): void {
    if (!settings) {
      throw new ArgumentNullException('settings');
    }
    const current = this.getSettings();
    const merged = { ...current, ...settings };
    this.settingsRepo.setSetting('unity_settings', merged);
  }

  /// <summary>
  /// Retrieves current active Unity Editor connection telemetry status.
  /// </summary>
  public getTelemetry(): UnityTelemetryDTO {
    this.pruneStaleInstances();
    return { ...this.telemetryState, instances: Array.from(this.activeInstances.values()) };
  }

  /// <summary>
  /// Registers a callback for real-time Unity telemetry updates.
  /// </summary>
  public onTelemetryUpdated(cb: (telemetry: UnityTelemetryDTO) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /// <summary>
  /// Processes incoming Unity Editor heartbeat ping payloads.
  /// </summary>
  public handleHeartbeat(payload: UnityHeartbeatPayload): void {
    if (!payload || !payload.projectName) return;
    const key = payload.instanceId || payload.projectName;
    const nowIso = new Date().toISOString();
    const existing = this.activeInstances.get(key);

    const compilationState = payload.compiling
      ? 'Compiling'
      : existing?.compilationState === 'Compiling'
      ? 'Compiling'
      : 'Idle';

    const playModeStatus = payload.playMode
      ? 'In Play Mode'
      : existing?.playModeStatus === 'In Play Mode'
      ? 'In Play Mode'
      : 'Editor Idle';

    const instance: UnityInstanceDTO = {
      instanceId: key,
      projectName: payload.projectName,
      unityVersion: payload.unityVersion || existing?.unityVersion,
      compilationState,
      playModeStatus,
      savePort: payload.savePort || existing?.savePort || 8081,
      lastPingUtc: nowIso
    };

    this.activeInstances.set(key, instance);
    this.recomputeTelemetryState();
  }

  private activeOperation: 'none' | 'compile' | 'build' | 'bake' = 'none';

  /// <summary>
  /// Updates compilation telemetry state based on compile events.
  /// </summary>
  public handleCompile(payload: UnityCompilePayload): void {
    if (!payload || !payload.projectName) return;
    const key = payload.instanceId || payload.projectName;
    const nowIso = new Date().toISOString();
    const existing = this.activeInstances.get(key);
    const isStarted = payload.state === 'started';
    const type = payload.type || 'compile';

    const instance: UnityInstanceDTO = {
      instanceId: key,
      projectName: payload.projectName,
      unityVersion: payload.unityVersion || existing?.unityVersion,
      compilationState: isStarted ? 'Compiling' : 'Idle',
      playModeStatus: existing?.playModeStatus || 'Editor Idle',
      savePort: existing?.savePort || 8081,
      lastPingUtc: nowIso
    };

    this.activeInstances.set(key, instance);
    this.recomputeTelemetryState();

    if (isStarted) {
      const evalResult = this.priorityEngine?.evaluateRequest('unityCompilingPriority');
      if (evalResult && !evalResult.shouldRender) {
        return;
      }

      if (type === 'build') {
        this.activeOperation = 'build';
        this.renderer?.renderBuilding(payload.projectName, payload.progress ?? 0);
      } else if (type === 'bake') {
        this.activeOperation = 'bake';
        this.renderer?.renderBaking(payload.projectName, payload.progress ?? 0);
      } else {
        if (this.activeOperation === 'none') {
          this.activeOperation = 'compile';
          this.renderer?.renderCompilation(payload.projectName);
        }
      }
    } else {
      this.priorityEngine?.releaseActiveLock('unityCompilingPriority');
      if (type === 'compile') {
        if (this.activeOperation === 'compile') {
          this.activeOperation = 'none';
          this.restoreDisplayState();
        }
      } else {
        this.activeOperation = 'none';
        this.restoreDisplayState();
      }
    }
  }

  /// <summary>
  /// Renders Unity C# Exception or Console Error alert views and handles timeout restoration.
  /// </summary>
  public handleConsole(payload: { projectName: string; type: string; message: string }): void {
    if (!payload || !payload.projectName) return;
    const settings = this.getSettings();
    const shouldShow = settings.showUnityErrors ?? true;
    if (shouldShow && (payload.type === 'exception' || payload.type === 'error')) {
      const evalResult = this.priorityEngine?.evaluateRequest('unityBuildFailurePriority');
      if (evalResult && !evalResult.shouldRender) {
        return;
      }

      this.renderer?.renderException(payload.projectName, payload.message || 'Unity Exception Detected');

      if (this.exceptionTimer) {
        clearTimeout(this.exceptionTimer);
      }
      const durationSeconds = settings.errorDurationSeconds ?? 5;
      this.exceptionTimer = setTimeout(() => {
        this.priorityEngine?.releaseActiveLock('unityBuildFailurePriority');
        this.restoreDisplayState();
      }, durationSeconds * 1000);
    }
  }

  /// <summary>
  /// Updates play mode telemetry state based on PlayMode events.
  /// </summary>
  public handlePlayMode(payload: UnityPlayModePayload): void {
    if (!payload || !payload.projectName) return;
    const key = payload.instanceId || payload.projectName;
    const nowIso = new Date().toISOString();
    const existing = this.activeInstances.get(key);
    const isInPlayMode = payload.state === 'entered';

    const instance: UnityInstanceDTO = {
      instanceId: key,
      projectName: payload.projectName,
      unityVersion: existing?.unityVersion,
      compilationState: existing?.compilationState || 'Idle',
      playModeStatus: isInPlayMode ? 'In Play Mode' : 'Editor Idle',
      savePort: existing?.savePort || 8081,
      lastPingUtc: nowIso
    };

    this.activeInstances.set(key, instance);
    this.recomputeTelemetryState();

    const settings = this.getSettings();
    if (isInPlayMode && settings.enablePlayModeDnd) {
      const evalResult = this.priorityEngine?.evaluateRequest('unityPlayModePriority');
      if (evalResult && !evalResult.shouldRender) {
        return;
      }
      this.renderer?.renderPlayMode(payload.projectName);
    } else {
      this.priorityEngine?.releaseActiveLock('unityPlayModePriority');
      this.restoreDisplayState();
    }
  }

  private restoreDisplayState(): void {
    if (!this.renderer) return;

    // Check if any connected Unity instance is currently in Play Mode
    const settings = this.getSettings();
    if (settings.enablePlayModeDnd) {
      const playModeInstance = Array.from(this.activeInstances.values()).find(
        i => i.playModeStatus === 'In Play Mode'
      );
      if (playModeInstance) {
        this.priorityEngine?.evaluateRequest('unityPlayModePriority', 90);
        this.renderer.renderPlayMode(playModeInstance.projectName);
        return;
      }
    }

    if (this.engine) {
      const session = this.engine.getCurrentSession();
      if (session && (session.status === 'TRACKING' || session.status === 'PAUSED')) {
        this.renderer.renderActiveSession(session);
        return;
      }
    }
    if (typeof this.renderer.renderIdle === 'function') {
      this.renderer.renderIdle();
    } else if (typeof this.renderer.renderActiveSession === 'function') {
      this.renderer.renderActiveSession(null);
    }
  }

  /// <summary>
  /// Prunes instances that have not sent a heartbeat ping within 15 seconds.
  /// </summary>
  public pruneStaleInstances(maxAgeMs = 15000): void {
    const now = Date.now();
    let hasChanges = false;

    for (const [key, instance] of this.activeInstances.entries()) {
      const age = now - new Date(instance.lastPingUtc).getTime();
      if (age >= maxAgeMs) {
        this.activeInstances.delete(key);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      this.recomputeTelemetryState();
      
      if (this.telemetryState.compilationState === 'Idle' && this.activeOperation !== 'none') {
        this.activeOperation = 'none';
        this.restoreDisplayState();
      }
    }
  }

  private recomputeTelemetryState(): void {
    const instancesList = Array.from(this.activeInstances.values());

    if (instancesList.length === 0) {
      this.telemetryState = {
        activeProjectName: 'No Unity Instance Connected',
        isConnected: false,
        compilationState: 'Idle',
        playModeStatus: 'Editor Idle',
        lastPingUtc: undefined,
        instances: []
      };
    } else if (instancesList.length === 1) {
      const single = instancesList[0];
      this.telemetryState = {
        activeProjectName: single.projectName,
        isConnected: true,
        compilationState: single.compilationState,
        playModeStatus: single.playModeStatus,
        lastPingUtc: single.lastPingUtc,
        instances: instancesList
      };
    } else {
      const isAnyCompiling = instancesList.some((i) => i.compilationState === 'Compiling');
      const isAnyInPlayMode = instancesList.some((i) => i.playModeStatus === 'In Play Mode');
      const latestPing = instancesList.reduce((max, i) => (i.lastPingUtc > max ? i.lastPingUtc : max), '');

      this.telemetryState = {
        activeProjectName: `${instancesList.length} Unity Instances Connected`,
        isConnected: true,
        compilationState: isAnyCompiling ? 'Compiling' : 'Idle',
        playModeStatus: isAnyInPlayMode ? 'In Play Mode' : 'Editor Idle',
        lastPingUtc: latestPing,
        instances: instancesList
      };
    }

    this.notifyListeners();
  }

  private notifyListeners(): void {
    const data = this.getTelemetry();
    for (const listener of this.listeners) {
      listener(data);
    }
  }

  public dispose(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = undefined;
    }
    if (this.exceptionTimer) {
      clearTimeout(this.exceptionTimer);
      this.exceptionTimer = undefined;
    }
  }
}

