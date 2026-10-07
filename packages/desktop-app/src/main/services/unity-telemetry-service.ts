import { SettingsRepository } from '../db/repositories/settings-repository';
import { UnitySettingsDTO, UnityTelemetryDTO, UnityInstanceDTO } from '../../shared/dtos';
import { WebhookServer, UnityHeartbeatPayload, UnityCompilePayload, UnityPlayModePayload } from '../api/webhook-server';
import { DisplayRenderer } from '../hardware/display-renderer';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { IPriorityPreemptionEngine } from './priority-preemption-engine';
import { ArgumentNullException } from '../../shared/dtos';
import { UNITY_IDLE_RELEASE_GRACE_MS } from '../../shared/render-constants';

/** Unity's two screens that last as long as the editor's state does. */
const COMPILE_EVENT = 'unityCompilingPriority';
const PLAY_MODE_EVENT = 'unityPlayModePriority';

type UnityOperationType = 'compile' | 'build' | 'bake';

/** What one editor is busy with, as its last compile event said. */
interface UnityOperation {
  type: UnityOperationType;
  projectName: string;
  progress: number;
}

/**
 * Service managing live Unity Editor telemetry status, compile states,
 * heartbeat pings, multi-instance connections, and companion application settings.
 */
export class UnityTelemetryService {
  private settingsRepo: SettingsRepository;
  private listeners: Set<(telemetry: UnityTelemetryDTO) => void> = new Set();
  private activeInstances: Map<string, UnityInstanceDTO> = new Map();
  private pruneTimer: NodeJS.Timeout | null = null;
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
    priorityEngine?: IPriorityPreemptionEngine,
    /**
     * Whether there is a bar to show Unity's state on. Without one the editor
     * events are ignored: compile, Play Mode and exceptions exist here to be
     * shown on the bar, and the display locks they take would only compete
     * with the end-of-day prompt for a screen nobody has. Read per event, so
     * adding a bar later takes effect at the next one.
     */
    isBarEnabled: () => boolean = () => true
  ) {
    if (!settingsRepo) {
      throw new ArgumentNullException('settingsRepo');
    }
    this.settingsRepo = settingsRepo;
    this.renderer = renderer;
    this.engine = engine;
    this.priorityEngine = priorityEngine;
    // Unity's screens are states, not alerts: whatever covered them, the
    // display comes back to what the editors are doing by then.
    this.unregisterBackground = priorityEngine?.addBackgroundScreen([COMPILE_EVENT, PLAY_MODE_EVENT], () => {
      this.reclaimDisplay();
    }) ?? null;

    if (webhookServer) {
      webhookServer.onHeartbeatEvent((payload) => { if (isBarEnabled()) this.handleHeartbeat(payload); });
      webhookServer.onCompileEvent((payload) => { if (isBarEnabled()) this.handleCompile(payload); });
      webhookServer.onPlayModeEvent((payload) => { if (isBarEnabled()) this.handlePlayMode(payload); });
      webhookServer.onConsoleEvent((payload) => { if (isBarEnabled()) this.handleConsole(payload); });
    }

    // Periodically prune stale Unity instances (every 10 seconds)
    this.pruneTimer = setInterval(() => this.pruneStaleInstances(), 10000);
  }

  private exceptionTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly unregisterBackground: (() => void) | null;
  /** A compile's end, held back by `UNITY_IDLE_RELEASE_GRACE_MS`. */
  private compileReleaseTimer: ReturnType<typeof setTimeout> | null = null;

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

  /**
   * Each editor's operation, by instance. One global operation used to stand
   * for every editor open: with two projects compiling, the first to finish
   * took the gear down while the other still compiled, and a build ending in
   * one editor removed the build screen of another.
   */
  private readonly operations = new Map<string, UnityOperation>();

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

    const current = this.operations.get(key);
    if (isStarted) {
      // A compile inside a build or a bake is part of it: the build's screen stays.
      if (type !== 'compile' || !current || current.type === 'compile') {
        this.operations.set(key, { type, projectName: payload.projectName, progress: payload.progress ?? 0 });
      }
      // A compile ending a moment ago is still on the display: carry on with it.
      this.cancelCompileRelease();
      // Drawn again on every start, not only the first: a scene (DONE!,
      // LOGGED) may have covered the gear since, and the lock just taken
      // must come with its screen or the scene's end has nothing to return
      // to. Free when the screen is still up -- the frame is deduplicated.
      this.showOperation();
      return;
    }

    // Only the compile that put the gear up takes it down. One inside a
    // build or a bake shares their lock, and releasing it here used to hand
    // the display back from under the build's progress screen.
    if (type === 'compile' && current?.type !== 'compile') return;
    this.operations.delete(key);
    if (this.operations.size > 0) {
      // Another editor is still at it: its screen, not the idle clock.
      if (this.priorityEngine?.getActiveLockEventName() === COMPILE_EVENT) this.drawOperation();
    } else if (type === 'compile') {
      this.scheduleCompileRelease();
    } else {
      this.cancelCompileRelease();
      this.releaseDisplay(COMPILE_EVENT);
    }
  }

  /** The operation the compile screen shows: a build or a bake before a compile, the latest among equals. */
  private dominantOperation(): UnityOperation | null {
    let dominant: UnityOperation | null = null;
    for (const operation of this.operations.values()) {
      if (!dominant || dominant.type === 'compile' || operation.type !== 'compile') dominant = operation;
    }
    return dominant;
  }

  /** Takes the display for the editors' operations, if they have one and it is Unity's to take. */
  private showOperation(): boolean {
    if (!this.dominantOperation()) return false;
    const evalResult = this.priorityEngine?.evaluateRequest(COMPILE_EVENT);
    if (evalResult && !evalResult.shouldRender) return false;
    this.drawOperation();
    return true;
  }

  private drawOperation(): void {
    const operation = this.dominantOperation();
    if (!operation || !this.renderer) return;
    if (operation.type === 'build') this.renderer.renderBuilding(operation.projectName, operation.progress);
    else if (operation.type === 'bake') this.renderer.renderBaking(operation.projectName, operation.progress);
    else this.renderer.renderCompilation(operation.projectName);
  }

  private scheduleCompileRelease(): void {
    this.cancelCompileRelease();
    this.compileReleaseTimer = setTimeout(() => {
      this.compileReleaseTimer = null;
      this.releaseDisplay(COMPILE_EVENT);
    }, UNITY_IDLE_RELEASE_GRACE_MS);
  }

  private cancelCompileRelease(): void {
    if (this.compileReleaseTimer) {
      clearTimeout(this.compileReleaseTimer);
      this.compileReleaseTimer = null;
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
        this.exceptionTimer = null;
        this.releaseDisplay('unityBuildFailurePriority');
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
      // While an editor compiles or builds, its screen outranks Play Mode;
      // the compile's end comes back to Play Mode through the reclaim.
      if (this.dominantOperation()) return;
      const evalResult = this.priorityEngine?.evaluateRequest(PLAY_MODE_EVENT);
      if (evalResult && !evalResult.shouldRender) {
        return;
      }
      this.renderer?.renderPlayMode(payload.projectName);
    } else {
      // Another editor still in Play Mode takes the display straight back,
      // through the reclaim.
      this.releaseDisplay(PLAY_MODE_EVENT);
    }
  }

  /**
   * Ends a Unity screen: one render, and only if that screen still holds the
   * display.
   *
   * The priority engine hands the display back to the user's mode itself when
   * it frees the lock (`setContextMode`). This used to render the idle or
   * session screen again straight after, so every compile, Play Mode exit and
   * exception end rendered twice -- and idle, twice is two clears of the
   * device's screen in the same millisecond, which is how the bar hung on
   * 2026-10-05. It also rendered when the lock was not Unity's to give back,
   * wiping a banner that had taken the display in the meantime.
   */
  private releaseDisplay(eventName: string): void {
    // The release offers the free display to the editors' state, through the
    // reclaim this service registered: Play Mode in another editor, a compile
    // still running in a second project.
    this.priorityEngine?.releaseActiveLock(eventName);
    // With no engine there is nobody to hand the display back; do it here.
    if (!this.priorityEngine && !this.reclaimDisplay()) this.renderUserContext();
  }

  /**
   * Draws what the editors are doing now, if anything: an operation's screen,
   * else Play Mode. The engine calls it whenever the display frees, which is
   * how Unity's screen comes back after a banner, a scene, Lunch, or the end
   * of another editor's compile. Answers whether it drew.
   *
   * It used to run only after Unity's own releases, and took the lock at a
   * forced 90 first, so the render's own request -- at 50 -- was refused by
   * Unity's own lock: Play Mode never came back after a compile, an
   * exception or a banner, and a build a banner covered never came back at
   * all.
   */
  private reclaimDisplay(): boolean {
    if (this.showOperation()) return true;
    if (!this.renderer || !this.getSettings().enablePlayModeDnd) return false;
    const playModeInstance = Array.from(this.activeInstances.values()).find(
      i => i.playModeStatus === 'In Play Mode'
    );
    if (!playModeInstance) return false;
    // `renderPlayMode` asks the engine itself, at the configured priority.
    this.renderer.renderPlayMode(playModeInstance.projectName);
    return !this.priorityEngine || this.priorityEngine.getActiveLockEventName() === PLAY_MODE_EVENT;
  }

  private renderUserContext(): void {
    if (!this.renderer) return;
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

    let lostOperation = false;
    let lostPlayMode = false;
    for (const [key, instance] of this.activeInstances.entries()) {
      const age = now - new Date(instance.lastPingUtc).getTime();
      if (age >= maxAgeMs) {
        this.activeInstances.delete(key);
        // The editor went away mid-operation and will send no end of its own.
        lostOperation = this.operations.delete(key) || lostOperation;
        lostPlayMode = lostPlayMode || instance.playModeStatus === 'In Play Mode';
        hasChanges = true;
      }
    }

    if (hasChanges) {
      this.recomputeTelemetryState();
      
      if (lostOperation && this.operations.size === 0) {
        this.cancelCompileRelease();
        this.releaseDisplay(COMPILE_EVENT);
      } else if (lostOperation && this.priorityEngine?.getActiveLockEventName() === COMPILE_EVENT) {
        this.drawOperation();
      }
      // An editor closed in Play Mode sends no exit: its ON AIR would stay up.
      if (lostPlayMode) this.releaseDisplay(PLAY_MODE_EVENT);
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
      this.pruneTimer = null;
    }
    if (this.exceptionTimer) {
      clearTimeout(this.exceptionTimer);
      this.exceptionTimer = null;
    }
    this.cancelCompileRelease();
    this.unregisterBackground?.();
  }
}

