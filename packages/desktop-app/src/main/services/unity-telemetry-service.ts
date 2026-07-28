import { SettingsRepository } from '../db/repositories/settings-repository';
import { UnitySettingsDTO, UnityTelemetryDTO } from '../../shared/dtos';
import { WebhookServer, UnityHeartbeatPayload, UnityCompilePayload, UnityPlayModePayload } from '../api/webhook-server';

/**
 * Service managing live Unity Editor telemetry status, compile states,
 * heartbeat pings, and companion application audio/alert settings.
 */
export class UnityTelemetryService {
  private settingsRepo: SettingsRepository;
  private listeners: Set<(telemetry: UnityTelemetryDTO) => void> = new Set();

  private telemetryState: UnityTelemetryDTO = {
    activeProjectName: 'No Unity Instance Connected',
    isConnected: false,
    compilationState: 'Idle',
    playModeStatus: 'Editor Idle',
    lastPingUtc: undefined
  };

  constructor(settingsRepo: SettingsRepository, webhookServer?: WebhookServer) {
    if (!settingsRepo) {
      throw new ArgumentNullException('settingsRepo');
    }
    this.settingsRepo = settingsRepo;

    if (webhookServer) {
      webhookServer.onHeartbeatEvent((payload) => this.handleHeartbeat(payload));
      webhookServer.onCompileEvent((payload) => this.handleCompile(payload));
      webhookServer.onPlayModeEvent((payload) => this.handlePlayMode(payload));
    }
  }

  /// <summary>
  /// Retrieves current audio chime and play mode alert settings.
  /// </summary>
  public getSettings(): UnitySettingsDTO {
    return this.settingsRepo.getSetting('unity_settings', {
      buildChime: 'chime_1',
      enableFailureSound: true,
      enablePlayModeDnd: true
    });
  }

  /// <summary>
  /// Persists audio chime and play mode alert settings to SQLite.
  /// </summary>
  public saveSettings(settings: UnitySettingsDTO): void {
    if (!settings) {
      throw new ArgumentNullException('settings');
    }
    this.settingsRepo.setSetting('unity_settings', settings);
  }

  /// <summary>
  /// Retrieves current active Unity Editor connection telemetry status.
  /// </summary>
  public getTelemetry(): UnityTelemetryDTO {
    return { ...this.telemetryState };
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
    this.telemetryState = {
      ...this.telemetryState,
      activeProjectName: payload.projectName,
      isConnected: true,
      compilationState: payload.compiling ? 'Compiling' : 'Idle',
      playModeStatus: payload.playMode ? 'In Play Mode' : 'Editor Idle',
      lastPingUtc: new Date().toISOString()
    };
    this.notifyListeners();
  }

  /// <summary>
  /// Updates compilation telemetry state based on compile events.
  /// </summary>
  public handleCompile(payload: UnityCompilePayload): void {
    if (!payload || !payload.projectName) return;
    this.telemetryState = {
      ...this.telemetryState,
      activeProjectName: payload.projectName,
      isConnected: true,
      compilationState: payload.state === 'started' ? 'Compiling' : 'Idle',
      lastPingUtc: new Date().toISOString()
    };
    this.notifyListeners();
  }

  /// <summary>
  /// Updates play mode telemetry state based on PlayMode events.
  /// </summary>
  public handlePlayMode(payload: UnityPlayModePayload): void {
    if (!payload || !payload.projectName) return;
    this.telemetryState = {
      ...this.telemetryState,
      activeProjectName: payload.projectName,
      isConnected: true,
      playModeStatus: payload.state === 'entered' ? 'In Play Mode' : 'Editor Idle',
      lastPingUtc: new Date().toISOString()
    };
    this.notifyListeners();
  }

  private notifyListeners(): void {
    const data = this.getTelemetry();
    for (const listener of this.listeners) {
      listener(data);
    }
  }
}

class ArgumentNullException extends Error {
  constructor(paramName: string) {
    super(`Argument cannot be null or undefined: ${paramName}`);
    this.name = 'ArgumentNullException';
  }
}
