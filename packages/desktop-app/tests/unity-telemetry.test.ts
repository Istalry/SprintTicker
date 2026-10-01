import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
      settingsRepo.getSetting = vi.fn().mockReturnValue({ showUnityErrors: true });
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

      const s = new UnityTelemetryService(settingsRepo, undefined, mockRenderer, mockEngine as unknown as TimeTrackingEngine);

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

/**
 * What the bar shows while Unity works, stated as behaviour: which screen is
 * up, and whether it comes down again. Every one of these paths ends with the
 * bar either showing the right thing or stuck on a stale Unity screen.
 */
describe('UnityTelemetryService display behaviour', () => {
  type Renderer = Record<'renderCompilation' | 'renderBuilding' | 'renderBaking' | 'renderPlayMode' | 'renderException' | 'renderIdle' | 'renderActiveSession', ReturnType<typeof vi.fn>>;
  let renderer: Renderer;
  let priority: { evaluateRequest: ReturnType<typeof vi.fn>; releaseActiveLock: ReturnType<typeof vi.fn> };
  let stored: Record<string, unknown>;
  let telemetry: UnityTelemetryService;

  const repo = () => ({
    getSetting: vi.fn((key: string, defaultValue: unknown) => stored[key] ?? defaultValue),
    setSetting: vi.fn()
  }) as unknown as SettingsRepository;

  const make = (webhook?: unknown) =>
    new UnityTelemetryService(repo(), webhook as never, renderer as unknown as DisplayRenderer, undefined, priority as unknown as IPriorityPreemptionEngine);

  beforeEach(() => {
    vi.useFakeTimers();
    stored = {};
    renderer = {
      renderCompilation: vi.fn(), renderBuilding: vi.fn(), renderBaking: vi.fn(), renderPlayMode: vi.fn(),
      renderException: vi.fn(), renderIdle: vi.fn(), renderActiveSession: vi.fn()
    };
    priority = {
      evaluateRequest: vi.fn().mockReturnValue({ shouldRender: true, action: 'DISPLAY', evaluatedPriority: 55 }),
      releaseActiveLock: vi.fn()
    };
    telemetry = make();
  });

  afterEach(() => {
    telemetry.dispose();
    vi.useRealTimers();
  });

  it('WebhookEvents_FromTheEditor_ReachTheService', () => {
    const handlers: Record<string, (p: unknown) => void> = {};
    const webhook = {
      onHeartbeatEvent: (cb: (p: unknown) => void) => { handlers.heartbeat = cb; },
      onCompileEvent: (cb: (p: unknown) => void) => { handlers.compile = cb; },
      onPlayModeEvent: (cb: (p: unknown) => void) => { handlers.playMode = cb; },
      onConsoleEvent: (cb: (p: unknown) => void) => { handlers.console = cb; }
    };
    stored.unity_settings = { showUnityErrors: true, enablePlayModeDnd: true };
    telemetry.dispose();
    telemetry = make(webhook);

    handlers.heartbeat({ projectName: 'Game' });
    handlers.compile({ projectName: 'Game', state: 'started' });
    handlers.console({ projectName: 'Game', type: 'error', message: 'boom' });
    handlers.playMode({ projectName: 'Game', state: 'entered' });

    expect(telemetry.getTelemetry().isConnected).toBe(true);
    expect(renderer.renderCompilation).toHaveBeenCalledWith('Game');
    expect(renderer.renderException).toHaveBeenCalledWith('Game', 'boom');
    expect(renderer.renderPlayMode).toHaveBeenCalledWith('Game');
  });

  it('WebhookEvents_NoBar_AreIgnoredUntilOneIsAdded', () => {
    // Unity's states exist to be shown on the bar; without one they would
    // only take display locks that compete with the end-of-day prompt.
    const handlers: Record<string, (p: unknown) => void> = {};
    const webhook = {
      onHeartbeatEvent: (cb: (p: unknown) => void) => { handlers.heartbeat = cb; },
      onCompileEvent: (cb: (p: unknown) => void) => { handlers.compile = cb; },
      onPlayModeEvent: (cb: (p: unknown) => void) => { handlers.playMode = cb; },
      onConsoleEvent: (cb: (p: unknown) => void) => { handlers.console = cb; }
    };
    let barEnabled = false;
    telemetry.dispose();
    telemetry = new UnityTelemetryService(
      repo(), webhook as never, renderer as unknown as DisplayRenderer, undefined,
      priority as unknown as IPriorityPreemptionEngine, () => barEnabled
    );

    handlers.heartbeat({ projectName: 'Game' });
    handlers.compile({ projectName: 'Game', state: 'started' });

    expect(telemetry.getTelemetry().isConnected).toBe(false);
    expect(renderer.renderCompilation).not.toHaveBeenCalled();

    barEnabled = true;
    handlers.compile({ projectName: 'Game', state: 'started' });

    expect(renderer.renderCompilation).toHaveBeenCalledWith('Game');
  });

  it.each(['handleHeartbeat', 'handleCompile', 'handleConsole', 'handlePlayMode'] as const)(
    '%s_NoProjectName_IsIgnored',
    method => {
      (telemetry[method] as (p: unknown) => void)({ state: 'started', type: 'error', message: 'x' });

      expect(telemetry.getTelemetry().isConnected).toBe(false);
      expect(Object.values(renderer).every(fn => fn.mock.calls.length === 0)).toBe(true);
    }
  );

  it('PruneTimer_EditorStopsPinging_DisconnectsWithoutBeingAsked', () => {
    const listener = vi.fn();
    telemetry.onTelemetryUpdated(listener);
    telemetry.handleHeartbeat({ projectName: 'Game' });
    listener.mockClear();

    vi.advanceTimersByTime(20_000);

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ isConnected: false }));
  });

  it('PruneTimer_EditorVanishesMidCompile_TakesTheCompilingScreenDown', () => {
    // Unity crashing or being closed mid-compile sends no "finished". Without
    // this the bar would say COMPILING until something else drew over it.
    telemetry.handleCompile({ projectName: 'Game', state: 'started' });

    vi.advanceTimersByTime(20_000);

    expect(telemetry.getTelemetry().compilationState).toBe('Idle');
    expect(renderer.renderIdle).toHaveBeenCalled();
  });

  it('OnTelemetryUpdated_Unsubscribed_HearsNothingMore', () => {
    const listener = vi.fn();
    const unsubscribe = telemetry.onTelemetryUpdated(listener);

    unsubscribe();
    telemetry.handleHeartbeat({ projectName: 'Game' });

    expect(listener).not.toHaveBeenCalled();
  });

  it('HandleHeartbeat_PlayModeFlagAbsent_KeepsPlayModeFromTheEvent', () => {
    // Heartbeats only ever add to what the play-mode event said.
    telemetry.handlePlayMode({ projectName: 'Game', state: 'entered' });

    telemetry.handleHeartbeat({ projectName: 'Game' });

    expect(telemetry.getTelemetry().playModeStatus).toBe('In Play Mode');
  });

  it('GetTelemetry_TwoEditorsOneCompiling_ReportsCompiling', () => {
    telemetry.handleHeartbeat({ projectName: 'A', instanceId: 'a' });
    telemetry.handleCompile({ projectName: 'B', instanceId: 'b', state: 'started' });

    const state = telemetry.getTelemetry();
    expect(state.activeProjectName).toBe('2 Unity Instances Connected');
    expect(state.compilationState).toBe('Compiling');
  });

  describe('compile, build and bake', () => {
    it('HandleCompile_WhileBuilding_LeavesTheBuildScreenUp', () => {
      // A build compiles scripts as part of itself; that must not replace the
      // build's progress screen with a bare "compiling".
      telemetry.handleCompile({ projectName: 'Game', state: 'started', type: 'build', progress: 0.4 });
      telemetry.handleCompile({ projectName: 'Game', state: 'started', type: 'compile' });
      telemetry.handleCompile({ projectName: 'Game', state: 'finished', type: 'compile' });

      expect(renderer.renderBuilding).toHaveBeenCalledWith('Game', 0.4);
      expect(renderer.renderCompilation).not.toHaveBeenCalled();
      expect(renderer.renderIdle).not.toHaveBeenCalled();
    });

    it('HandleCompile_BuildFinished_RestoresTheDisplay', () => {
      telemetry.handleCompile({ projectName: 'Game', state: 'started', type: 'build' });

      telemetry.handleCompile({ projectName: 'Game', state: 'finished', type: 'build' });

      expect(priority.releaseActiveLock).toHaveBeenCalledWith('unityCompilingPriority');
      expect(renderer.renderIdle).toHaveBeenCalled();
    });

    it('HandleCompile_Outranked_DrawsNothing', () => {
      priority.evaluateRequest.mockReturnValue({ shouldRender: false, action: 'DISPLAY', evaluatedPriority: 55 });

      telemetry.handleCompile({ projectName: 'Game', state: 'started', type: 'bake' });

      expect(renderer.renderBaking).not.toHaveBeenCalled();
    });
  });

  describe('exceptions', () => {
    it('HandleConsole_Outranked_DrawsNothing', () => {
      priority.evaluateRequest.mockReturnValue({ shouldRender: false, action: 'DISPLAY', evaluatedPriority: 60 });

      telemetry.handleConsole({ projectName: 'Game', type: 'exception', message: 'NRE' });

      expect(renderer.renderException).not.toHaveBeenCalled();
    });

    it('HandleConsole_Exception_StaysForTheConfiguredTimeThenRestores', () => {
      stored.unity_settings = { showUnityErrors: true, errorDurationSeconds: 3, enablePlayModeDnd: true };
      telemetry.handleConsole({ projectName: 'Game', type: 'exception', message: 'NRE' });

      vi.advanceTimersByTime(2999);
      expect(priority.releaseActiveLock).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);

      expect(priority.releaseActiveLock).toHaveBeenCalledWith('unityBuildFailurePriority');
      expect(renderer.renderIdle).toHaveBeenCalled();
    });

    it('HandleConsole_SecondExceptionWhileShowing_RestartsTheClock', () => {
      stored.unity_settings = { showUnityErrors: true, errorDurationSeconds: 5, enablePlayModeDnd: true };
      telemetry.handleConsole({ projectName: 'Game', type: 'exception', message: 'first' });
      vi.advanceTimersByTime(4000);

      telemetry.handleConsole({ projectName: 'Game', type: 'exception', message: 'second' });
      vi.advanceTimersByTime(4000);

      expect(priority.releaseActiveLock).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(priority.releaseActiveLock).toHaveBeenCalledTimes(1);
    });

    it('HandleConsole_PlainLog_DrawsNothing', () => {
      telemetry.handleConsole({ projectName: 'Game', type: 'log', message: 'hello' });

      expect(renderer.renderException).not.toHaveBeenCalled();
    });
  });

  describe('play mode', () => {
    it('HandlePlayMode_Outranked_DrawsNothing', () => {
      priority.evaluateRequest.mockReturnValue({ shouldRender: false, action: 'DISPLAY', evaluatedPriority: 50 });

      telemetry.handlePlayMode({ projectName: 'Game', state: 'entered' });

      expect(renderer.renderPlayMode).not.toHaveBeenCalled();
    });

    it('HandleCompile_FinishedWhileAnotherEditorPlays_ReturnsToThatPlayMode', () => {
      // Restoring means "what should be up now", and an editor still in play
      // mode outranks the idle screen.
      telemetry.handlePlayMode({ projectName: 'Player', instanceId: 'p', state: 'entered' });
      renderer.renderPlayMode.mockClear();
      telemetry.handleCompile({ projectName: 'Tools', instanceId: 't', state: 'started' });

      telemetry.handleCompile({ projectName: 'Tools', instanceId: 't', state: 'finished' });

      expect(renderer.renderPlayMode).toHaveBeenCalledWith('Player');
      expect(renderer.renderIdle).not.toHaveBeenCalled();
    });

    it('HandlePlayMode_DndDisabled_DoesNotTakeTheDisplay', () => {
      stored.unity_settings = { enablePlayModeDnd: false, showUnityErrors: false };

      telemetry.handlePlayMode({ projectName: 'Game', state: 'entered' });

      expect(renderer.renderPlayMode).not.toHaveBeenCalled();
      expect(telemetry.getTelemetry().playModeStatus).toBe('In Play Mode');
    });
  });
});
