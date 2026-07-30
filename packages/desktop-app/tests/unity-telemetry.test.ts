import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnityTelemetryService } from '../src/main/services/unity-telemetry-service';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { UnitySettingsDTO } from '../src/shared/dtos';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { IPriorityPreemptionEngine } from '../src/main/services/priority-preemption-engine';

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

  afterEach(() => {
    if (service) service.dispose();
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
      expect(settingsRepo.setSetting).toHaveBeenCalledWith('unity_settings', expect.objectContaining(dto));
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

    it('HandleHeartbeat_MultipleInstances_AggregatesActiveProjectsAndStates', () => {
      service.handleHeartbeat({ instanceId: 'inst-1', projectName: 'GameOne', compiling: true, savePort: 8081 });
      service.handleHeartbeat({ instanceId: 'inst-2', projectName: 'GameTwo', playMode: true, savePort: 8082 });

      const t = service.getTelemetry();
      expect(t.isConnected).toBe(true);
      expect(t.activeProjectName).toBe('2 Unity Instances Connected');
      expect(t.compilationState).toBe('Compiling');
      expect(t.playModeStatus).toBe('In Play Mode');
      expect(t.instances).toHaveLength(2);
    });

    it('PruneStaleInstances_ExpiredHeartbeat_RemovesStaleInstance', () => {
      service.handleHeartbeat({ instanceId: 'inst-old', projectName: 'OldGame' });
      expect(service.getTelemetry().instances).toHaveLength(1);

      service.pruneStaleInstances(0);
      expect(service.getTelemetry().isConnected).toBe(false);
      expect(service.getTelemetry().instances).toHaveLength(0);
    });

    it('HandleHeartbeat_DuringActiveCompilation_PreservesCompilingState', () => {
      service.handleCompile({ instanceId: 'p1', projectName: 'GameOne', state: 'started' });
      expect(service.getTelemetry().compilationState).toBe('Compiling');

      service.handleHeartbeat({ instanceId: 'p1', projectName: 'GameOne', compiling: false });
      expect(service.getTelemetry().compilationState).toBe('Compiling');

      service.handleCompile({ instanceId: 'p1', projectName: 'GameOne', state: 'finished' });
      service.handleHeartbeat({ instanceId: 'p1', projectName: 'GameOne', compiling: false });
      expect(service.getTelemetry().compilationState).toBe('Idle');
    });

    it('HandleCompile_StartedCompile_TriggersDisplayRendererCompilationWithoutProgressBar', () => {
      const mockRenderer = { renderCompilation: vi.fn(), renderIdle: vi.fn() } as unknown as DisplayRenderer;
      const s = new UnityTelemetryService(settingsRepo, undefined, mockRenderer);
      s.handleCompile({ state: 'started', type: 'compile', projectName: 'CyberGame' });

      expect(mockRenderer.renderCompilation).toHaveBeenCalledWith('CyberGame');
      s.dispose();
    });

    it('HandleCompile_StartedBuild_TriggersDisplayRendererBuilding', () => {
      const mockRenderer = { renderBuilding: vi.fn(), renderIdle: vi.fn() } as unknown as DisplayRenderer;
      const s = new UnityTelemetryService(settingsRepo, undefined, mockRenderer);
      s.handleCompile({ state: 'started', type: 'build', projectName: 'CyberGame', progress: 25 });

      expect(mockRenderer.renderBuilding).toHaveBeenCalledWith('CyberGame', 25);
      
      // Script compile finished should NOT tear down active build display
      s.handleCompile({ state: 'finished', type: 'compile', projectName: 'CyberGame' });
      expect(mockRenderer.renderIdle).not.toHaveBeenCalled();

      // Build finished tears down build display
      s.handleCompile({ state: 'finished', type: 'build', projectName: 'CyberGame' });
      expect(mockRenderer.renderIdle).toHaveBeenCalled();
      s.dispose();
    });

    it('HandleCompile_StartedBake_TriggersDisplayRendererBaking_AndRestoresOnBakeFinished', () => {
      const mockRenderer = { renderBaking: vi.fn(), renderIdle: vi.fn() } as unknown as DisplayRenderer;
      const s = new UnityTelemetryService(settingsRepo, undefined, mockRenderer);
      s.handleCompile({ state: 'started', type: 'bake', projectName: 'CyberGame', progress: 10 });

      expect(mockRenderer.renderBaking).toHaveBeenCalledWith('CyberGame', 10);

      // Bake stopped/finished restores display
      s.handleCompile({ state: 'finished', type: 'bake', projectName: 'CyberGame' });
      expect(mockRenderer.renderIdle).toHaveBeenCalled();
      s.dispose();
    });

    it('HandlePlayMode_Entered_TriggersDisplayRendererPlayMode', () => {
      const mockRenderer = { renderPlayMode: vi.fn(), renderIdle: vi.fn() } as unknown as DisplayRenderer;
      const s = new UnityTelemetryService(settingsRepo, undefined, mockRenderer);
      s.handlePlayMode({ state: 'entered', projectName: 'CyberGame' });

      expect(mockRenderer.renderPlayMode).toHaveBeenCalledWith('CyberGame');
      s.dispose();
    });

    it('HandleConsole_Exception_TriggersDisplayRendererException', () => {
      const mockRenderer = { renderException: vi.fn(), renderIdle: vi.fn() } as unknown as DisplayRenderer;
      const s = new UnityTelemetryService(settingsRepo, undefined, mockRenderer);
      s.handleConsole({ type: 'exception', projectName: 'CyberGame', message: 'NullReferenceException' });

      expect(mockRenderer.renderException).toHaveBeenCalledWith('CyberGame', 'NullReferenceException');
      s.dispose();
    });

    it('SaveSettings_PartialUpdate_PreservesExistingSettings', () => {
      const initialSettings = { buildChime: 'chime_1', enableFailureSound: true, enablePlayModeDnd: true, showUnityErrors: false, errorDurationSeconds: 10, scanFolder: '/path1' };
      settingsRepo.getSetting = vi.fn().mockReturnValue(initialSettings);

      service.saveSettings({ scanFolder: '/path2' });

      expect(settingsRepo.setSetting).toHaveBeenCalledWith('unity_settings', {
        buildChime: 'chime_1',
        enableFailureSound: true,
        enablePlayModeDnd: true,
        showUnityErrors: false,
        errorDurationSeconds: 10,
        scanFolder: '/path2'
      });
    });

    it('HandleConsole_ShowUnityErrorsFalse_DoesNotTriggerExceptionDisplay', () => {
      const mockRenderer = { renderException: vi.fn(), renderIdle: vi.fn() } as unknown as DisplayRenderer;
      settingsRepo.getSetting = vi.fn().mockReturnValue({ showUnityErrors: false, enableFailureSound: true, errorDurationSeconds: 5 });
      const s = new UnityTelemetryService(settingsRepo, undefined, mockRenderer);

      s.handleConsole({ type: 'exception', projectName: 'CyberGame', message: 'NullReferenceException' });

      expect(mockRenderer.renderException).not.toHaveBeenCalled();
      s.dispose();
    });

    it('HandlePlayMode_InPlayMode_AcquiresPriorityLockAndRetainsStatus', () => {
      const mockRenderer = { renderPlayMode: vi.fn(), renderIdle: vi.fn() } as unknown as DisplayRenderer;
      const mockPriorityEngine = {
        evaluateRequest: vi.fn().mockReturnValue({ shouldRender: true, action: 'DISPLAY', evaluatedPriority: 90 }),
        releaseActiveLock: vi.fn()
      };
      const s = new UnityTelemetryService(settingsRepo, undefined, mockRenderer, undefined, mockPriorityEngine as unknown as IPriorityPreemptionEngine);

      s.handlePlayMode({ state: 'entered', projectName: 'CyberGame' });

      expect(mockPriorityEngine.evaluateRequest).toHaveBeenCalledWith('unityPlayModePriority');
      expect(mockRenderer.renderPlayMode).toHaveBeenCalledWith('CyberGame');

      s.handlePlayMode({ state: 'exited', projectName: 'CyberGame' });
      expect(mockPriorityEngine.releaseActiveLock).toHaveBeenCalledWith('unityPlayModePriority');
      s.dispose();
    });

    it('HandlePlayMode_Exited_WithActiveTrackingSession_RestoresActiveSessionDisplay', () => {
      const mockRenderer = { renderPlayMode: vi.fn(), renderActiveSession: vi.fn(), renderIdle: vi.fn() } as unknown as DisplayRenderer;
      const activeSession = { sessionId: 's1', taskId: 't1', taskKey: 'TASK-1', taskTitle: 'My Task', status: 'TRACKING', elapsedSeconds: 60 };
      const mockEngine = { getCurrentSession: vi.fn().mockReturnValue(activeSession) };

      const s = new UnityTelemetryService(settingsRepo, undefined, mockRenderer, mockEngine as any);

      s.handlePlayMode({ state: 'entered', projectName: 'CyberGame' });
      expect(mockRenderer.renderPlayMode).toHaveBeenCalledWith('CyberGame');

      s.handlePlayMode({ state: 'exited', projectName: 'CyberGame' });
      expect(mockRenderer.renderActiveSession).toHaveBeenCalledWith(activeSession);
      expect(mockRenderer.renderIdle).not.toHaveBeenCalled();
      s.dispose();
    });

    it('Dispose_ClearsPruneTimer_DisposesCleanly', () => {
      expect(() => service.dispose()).not.toThrow();
    });
  });
});
