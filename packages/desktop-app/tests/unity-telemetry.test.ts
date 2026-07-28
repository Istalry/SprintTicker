import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnityTelemetryService } from '../src/main/services/unity-telemetry-service';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { UnitySettingsDTO } from '../src/shared/dtos';

describe('UnityTelemetryService', () => {
  let settingsRepo: SettingsRepository;
  let service: UnityTelemetryService;

  beforeEach(() => {
    settingsRepo = {
      getSetting: vi.fn((_key: string, defaultVal: unknown) => defaultVal),
      setSetting: vi.fn()
    } as unknown as SettingsRepository;

    service = new UnityTelemetryService(settingsRepo);
  });

  describe('constructor', () => {
    it('Constructor_NullSettingsRepo_ThrowsException', () => {
      expect(() => new UnityTelemetryService(null as unknown as SettingsRepository)).toThrow();
    });
  });

  describe('getSettings & saveSettings', () => {
    it('GetSettings_Default_ReturnsDefaultAudioSettings', () => {
      const s = service.getSettings();
      expect(s).toBeDefined();
      expect(s.buildChime).toBe('chime_1');
      expect(s.enableFailureSound).toBe(true);
      expect(s.enablePlayModeDnd).toBe(true);
    });

    it('SaveSettings_ValidDTO_SavesToSettingsRepo', () => {
      const dto = { buildChime: 'retro_beep', enableFailureSound: false, enablePlayModeDnd: true };
      service.saveSettings(dto);
      expect(settingsRepo.setSetting).toHaveBeenCalledWith('unity_settings', dto);
    });

    it('SaveSettings_Null_ThrowsException', () => {
      expect(() => service.saveSettings(null as unknown as UnitySettingsDTO)).toThrow();
    });
  });

  describe('telemetry state & callbacks', () => {
    it('GetTelemetry_InitialState_ReturnsIdleTelemetry', () => {
      const t = service.getTelemetry();
      expect(t.isConnected).toBe(false);
      expect(t.compilationState).toBe('Idle');
    });

    it('HandleHeartbeat_ValidPing_UpdatesTelemetryStateAndNotifiesListeners', () => {
      const listener = vi.fn();
      service.onTelemetryUpdated(listener);

      service.handleHeartbeat({ projectName: 'RPGGame', compiling: true, playMode: false });

      const t = service.getTelemetry();
      expect(t.activeProjectName).toBe('RPGGame');
      expect(t.isConnected).toBe(true);
      expect(t.compilationState).toBe('Compiling');
      expect(t.playModeStatus).toBe('Editor Idle');
      expect(listener).toHaveBeenCalled();
    });

    it('HandleCompile_Started_UpdatesCompilationState', () => {
      service.handleCompile({ state: 'started', projectName: 'CyberGame' });

      const t = service.getTelemetry();
      expect(t.activeProjectName).toBe('CyberGame');
      expect(t.compilationState).toBe('Compiling');
    });

    it('HandlePlayMode_Entered_UpdatesPlayModeStatus', () => {
      service.handlePlayMode({ state: 'entered', projectName: 'CyberGame' });

      const t = service.getTelemetry();
      expect(t.activeProjectName).toBe('CyberGame');
      expect(t.playModeStatus).toBe('In Play Mode');
    });
  });
});
