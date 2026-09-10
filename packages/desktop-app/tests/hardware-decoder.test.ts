import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { InputDecoder } from '../src/main/hardware/input-decoder';

describe('Hardware Bridge & InputDecoder Unit Tests', () => {
  let dbConn: DatabaseConnection;
  let driver: BusyBarDriver;
  let engine: TimeTrackingEngine;
  let decoder: InputDecoder;
  let renderer: DisplayRenderer;
  let taskRepo: TaskRepository;

  beforeEach(async () => {
    // Installed first, before anything that logs.
    //
    // The decoder logs a line per action, the mock driver logs every frame and
    // every connect, and this file now triggers those hundreds of times.
    // Vitest forwards each line to the main thread over rpc, and the worker was
    // tearing down with logs still in flight -- "Closing rpc while
    // onUserConsoleLog was pending", an unhandled error that failed the run
    // while all 688 tests passed. Intermittent, and more likely under coverage.
    // Nobody reads this output; the volume was the whole problem.
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    dbConn = new DatabaseConnection(':memory:');
    const sessionRepo = new SessionRepository(dbConn);
    const worklogRepo = new WorklogRepository(dbConn);
    taskRepo = new TaskRepository(dbConn);
    const settingsRepo = new SettingsRepository(dbConn);

    engine = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo, undefined, new ProjectRepository(dbConn));
    driver = new BusyBarDriver('10.0.4.20', true); // Mock Mode
    await driver.connect();

    renderer = new DisplayRenderer(driver);
    decoder = new InputDecoder(driver, engine, settingsRepo);
    decoder.setRenderer(renderer);
  });

  afterEach(() => {
    engine.dispose();
    driver.disconnect();
    dbConn.close();
    vi.restoreAllMocks();
  });

  describe('finishing a task from the bar', () => {
    /**
     * Reported from daily use: completing a task with the BUSY Bar's own
     * buttons logged the time and left the task in progress, so the same work
     * had to be closed a second time from the app.
     *
     * `stopSession(comment, markDone)` takes the flag as its second argument,
     * and the hardware paths passed only the comment -- one of which was a
     * string reading 'Completed via BUSY Bar Paused Menu' and another an action
     * named COMPLETE_AND_LOG_ACTIVE_TASK. Both said completed and neither
     * completed anything, while the FINISH branch played the completion
     * confetti on its way past.
     *
     * These go through the decoder rather than calling the engine directly:
     * the engine's flag always worked, and the defect was entirely in what the
     * button asked for.
     */
    beforeEach(() => {
      taskRepo.saveTask({
        id: 'T-1',
        projectId: 'P-1',
        key: 'SCRUM-1',
        title: 'Tache 1',
        status: 'todo'
      });
      engine.startTask('T-1');
      engine.pauseSession();
    });

    it('HandleHardwareInput_FinishFromThePausedMenu_MarksTheTaskDone', () => {
      // FINISH is where the wheel already sits, so this is the press a user
      // makes without scrolling at all -- the common path, not a corner.
      expect(renderer.getPausedSelection()).toBe('FINISH');

      decoder.handleHardwareInput({ type: 'press', key: 'ok' } as never);

      expect(taskRepo.getTaskById('T-1')?.status).toBe('done');
    });

    it('HandleHardwareInput_StopFromThePausedMenu_LeavesTheTaskOpen', () => {
      // The other half of the contract, and the reason the flag exists: STOP
      // logs the time and the task stays on the board.
      decoder.handleHardwareInput({ type: 'press', key: 'down' } as never);
      expect(renderer.getPausedSelection()).toBe('STOP');

      decoder.handleHardwareInput({ type: 'press', key: 'ok' } as never);

      expect(taskRepo.getTaskById('T-1')?.status).toBe('in_progress');
    });

    it('HandleHardwareInput_EitherChoice_StillLogsTheTime', () => {
      // Whatever else changed, the time must survive: that half was never
      // broken and is the one that cannot be recovered by hand.
      expect(engine.getCurrentSession()).not.toBeNull();

      decoder.handleHardwareInput({ type: 'press', key: 'ok' } as never);

      expect(engine.getCurrentSession()).toBeNull();
    });
  });

  it('Connect_MockMode_ReturnsConnectedDeviceStatus', () => {
    // Act
    const status = driver.getDeviceStatus();

    // Assert
    expect(status.connected).toBe(true);
    expect(status.ipAddress).toBe('10.0.4.20');
    expect(driver.getIsMockMode()).toBe(true);
  });

  it('RenderActiveSession_ValidSession_Generates72x16FrontAndOledRearPayload', () => {
    // Arrange
    const session = engine.startTask('PROJ-142', false, 'Implement Dash Mechanics');

    // Act
    const payload = renderer.renderActiveSession(session);

    // Assert: front display is now rasterized as pixel strips from PixelCanvas
    const frontEls = payload.frontElements as Record<string, unknown>[];
    expect(frontEls.length).toBeGreaterThan(0);
    // All front elements should be rectangles (pixel strips)
    expect(frontEls.every(e => e.type === 'rectangle')).toBe(true);
    // Rear display still uses legacy element format
    const rearEls = payload.backElements as Record<string, unknown>[];
    expect((rearEls[0].text as string)).toContain('BUSY BAR DIAGNOSTICS');
    expect(payload.ledColorHex).toBe('#10B981FF'); // Green LED for TRACKING
  });

  it('HandleHardwareInput_StartButtonPress_TogglesTrackingToPaused', () => {
    // Arrange
    engine.startTask('PROJ-142', false, 'Implement Dash Mechanics');
    expect(engine.getCurrentSession()?.status).toBe('TRACKING');

    // Act: Simulate physical "start" button press
    const action = decoder.handleHardwareInput({ key: 'start', type: 'press', timestamp: new Date().toISOString() });

    // Assert
    expect(action).toBe('TOGGLE_TRACK_PAUSE');
    expect(engine.getCurrentSession()?.status).toBe('PAUSED');
  });

  it('HandleHardwareInput_BackButtonLongPress_CompletesAndLogsActiveTask', () => {
    // Arrange
    engine.startTask('PROJ-142', false, 'Implement Dash Mechanics');
    expect(engine.getCurrentSession()).not.toBeNull();

    // Act: Simulate physical long press on Back button
    const action = decoder.handleHardwareInput({ key: 'back_hold', type: 'long_press', timestamp: new Date().toISOString() });

    // Assert
    expect(action).toBe('COMPLETE_AND_LOG_ACTIVE_TASK');
    expect(engine.getCurrentSession()).toBeNull();
  });

  it('RenderPlayMode_ValidProject_RendersOnAirPayload', () => {
    // Act
    const payload = renderer.renderPlayMode('MyFantasyGame');

    // Assert: front display is pixel-canvas encoded as rectangle strips
    const frontEls = payload.frontElements as Record<string, unknown>[];
    // All front elements are rectangle strips from the pixel canvas
    expect(frontEls.length).toBeGreaterThan(0);
    expect(frontEls.every(e => e.type === 'rectangle')).toBe(true);
    expect(payload.ledColorHex).toBe('#FF0000FF');
  });

  it('RenderCompilation_ValidProject_RendersCompilationPayloadWithoutProgressBar', () => {
    // Act
    const payload = renderer.renderCompilation('MyFantasyGame');

    // Assert: front display is pixel-canvas encoded as rectangle strips
    const frontEls = payload.frontElements as Record<string, unknown>[];
    expect(frontEls.length).toBeGreaterThan(0);
    expect(frontEls.every(e => e.type === 'rectangle')).toBe(true);
    // No bar_ sentinel elements (those only appear in renderBuilding)
    const sentinelBars = frontEls.filter(e => (e.id as string)?.startsWith('bar_'));
    expect(sentinelBars).toHaveLength(0);
  });

  it('RenderBuilding_ValidProject_RendersProgressBarPayload', () => {
    // Act
    const payload = renderer.renderBuilding('MyFantasyGame', 75);

    // Assert: renderBuilding adds sentinel elements for testability
    const frontEls = payload.frontElements as Record<string, unknown>[];
    const buildTitle = frontEls.find(e => e.id === 'txt_build');
    expect(buildTitle).toBeDefined();
    const activeBar = frontEls.find(e => e.id === 'bar_build_active');
    expect(activeBar).toBeDefined();
    expect((activeBar as Record<string, unknown>).x).toBe(17); // canvas icon is 15px, text starts at 17
    // 75% of 55px bar = 41px (canvas coordinates)
    expect((activeBar as Record<string, unknown>).width).toBe(41);
    expect(payload.ledColorHex).toBe('#3B82F6FF');
  });

  it('HandleHardwareInput_WheelRotationsAndClick_ExecutesMappedActions', () => {
    // Act
    const upAction = decoder.handleHardwareInput({ key: 'up', type: 'press', timestamp: new Date().toISOString() });
    const downAction = decoder.handleHardwareInput({ key: 'down', type: 'press', timestamp: new Date().toISOString() });
    const backShort = decoder.handleHardwareInput({ key: 'back', type: 'press', timestamp: new Date().toISOString() });

    // Assert
    expect(upAction).toBe('NAVIGATE_QUEUE_PREV');
    expect(downAction).toBe('NAVIGATE_QUEUE_NEXT');
    expect(backShort).toBe('DISMISS_NOTIFICATION_ALERT');
  });

  it('InputDecoder_CustomBindings_SavesAndRetrievesBindings', () => {
    // Arrange
    const customConfig = {
      startButtonPress: 'CUSTOM_START',
      wheelRotateLeft: 'CUSTOM_LEFT',
      wheelRotateRight: 'CUSTOM_RIGHT',
      wheelClick: 'CUSTOM_CLICK',
      backButtonShortPress: 'CUSTOM_BACK',
      backButtonLongPress: 'CUSTOM_LONG_BACK'
    };

    // Act
    decoder.saveBindings(customConfig);
    const bindings = decoder.getBindings();

    // Assert
    expect(bindings.startButtonPress).toBe('CUSTOM_START');
  });

  it('BusyBarDriver_WifiOptionsAndApiToken_ConfiguresHeadersAndWifiConnectionType', () => {
    // Arrange & Act
    const wifiDriver = new BusyBarDriver({
      ipAddress: '192.168.1.100',
      apiToken: 'my_secret_token',
      forceMock: true
    });

    // Assert
    expect(wifiDriver.getApiToken()).toBe('my_secret_token');
    const status = wifiDriver.getDeviceStatus();
    expect(status.connectionType).toBe('wifi');
    expect(status.ipAddress).toBe('192.168.1.100');

    // Update Token
    wifiDriver.setApiToken('new_token');
    expect(wifiDriver.getApiToken()).toBe('new_token');
  });

  it('BusyBarDriver_LiveMode_SendsPayloadWithApiTokenHeader', async () => {
    // Arrange
    const originalFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      return { ok: true, json: async () => ({ status: 'connected' }) } as Response;
    }) as typeof fetch;

    const liveDriver = new BusyBarDriver({
      ipAddress: '192.168.1.105',
      apiToken: 'secret_x_api_token',
      forceMock: false
    });

    try {
      // Act
      const connected = await liveDriver.connect();
      const payloadSuccess = await liveDriver.sendDisplayPayload({ test: 'data' });

      // Assert
      expect(connected).toBe(true);
      expect(payloadSuccess).toBe(true);
      expect(capturedUrl).toBe('http://192.168.1.105/api/display/draw');
      expect(capturedHeaders['X-API-Token']).toBe('secret_x_api_token');
    } finally {
      liveDriver.disconnect();
      globalThis.fetch = originalFetch;
    }
  });
  it('BusyBarDriver_Disconnect_SetsNotConnectedAndEmitsStatus', async () => {
    // Arrange: driver is already connected (mock mode)
    expect(driver.getDeviceStatus().connected).toBe(true);

    // Act
    driver.disconnect();

    // Assert
    expect(driver.getDeviceStatus().connected).toBe(false);
  });

  it('BusyBarDriver_SimulateInputEvent_AlwaysEmitsEvents', () => {
    // Arrange: disconnect driver
    driver.disconnect();

    let emitted = false;
    driver.on('input', () => { emitted = true; });

    // Act
    driver.simulateInputEvent({ key: 'start', type: 'press', timestamp: new Date().toISOString() });

    // Assert: event must fire even when offline or mock
    expect(emitted).toBe(true);
  });

  it('BusyBarDriver_Connect_LiveMode_FetchFails_ReportsDisconnected', async () => {
    // This test used to be `..._StillConnectsDegraded` and asserted the
    // opposite: that an unreachable device still reported `connected: true`.
    // That was the code's behaviour, so the test passed -- but it was a defect
    // being pinned in place rather than behaviour being verified. A bar that is
    // unplugged said it was connected until the ping loop silently flipped it
    // back seconds later, and nothing anywhere logged why, so a diagnostics
    // export sent in to ask "why won't it connect" contained no evidence of any
    // failure at all.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => null as unknown as Response;

    const liveDriver = new BusyBarDriver('192.168.99.99', false);
    try {
      const connected = await liveDriver.connect();

      expect(connected).toBe(false);
      expect(liveDriver.getDeviceStatus().connected).toBe(false);
    } finally {
      liveDriver.disconnect();
      globalThis.fetch = originalFetch;
    }
  });

  it('BusyBarDriver_Connect_LiveMode_ParsesBatteryAndFirmwareFromStatusEndpoint', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (url.includes('/api/status') || url.includes('/api/status')) {
        return {
          ok: true,
          json: async () => ({
            power: { battery_charge: 85 },
            firmware: { version: '2.1.0' }
          })
        } as Response;
      }
      return { ok: false } as Response;
    }) as typeof fetch;

    const liveDriver = new BusyBarDriver({
      ipAddress: '10.0.4.20',
      forceMock: false
    });

    try {
      const connected = await liveDriver.connect();
      const status = liveDriver.getDeviceStatus();

      expect(connected).toBe(true);
      expect(status.connected).toBe(true);
      expect(status.batteryPercent).toBe(85);
      expect(status.firmwareVersion).toBe('2.1.0');
    } finally {
      liveDriver.disconnect();
      globalThis.fetch = originalFetch;
    }
  });

  it('HandleHardwareInput_TaskPaused_WheelScrollTogglesStopFinishSelection', () => {
    // Arrange: Start task and pause it
    engine.startTask('PROJ-142', false, 'Implement Dash Mechanics');
    decoder.setRenderer(renderer);
    engine.pauseSession();

    expect(renderer.getPausedSelection()).toBe('FINISH');

    // Act: Scroll wheel
    const action = decoder.handleHardwareInput({ key: 'down', type: 'press', timestamp: new Date().toISOString() });

    // Assert
    expect(action).toBe('TOGGLE_PAUSED_SELECTION');
    expect(renderer.getPausedSelection()).toBe('STOP');
  });

  it('HandleHardwareInput_TaskPaused_WheelClickValidatesSelectionAndStopsTask', () => {
    // Arrange: Start task and pause it
    engine.startTask('PROJ-142', false, 'Implement Dash Mechanics');
    decoder.setRenderer(renderer);
    engine.pauseSession();

    // Act: Press wheel (selection default 'FINISH')
    const action = decoder.handleHardwareInput({ key: 'ok', type: 'press', timestamp: new Date().toISOString() });

    // Assert
    expect(action).toBe('VALIDATE_PAUSED_SELECTION');
    expect(engine.getCurrentSession()).toBeNull();
  });

  it('HandleHardwareInput_StartButtonPress_CallsWindowFocusCallbackWhenPausing', () => {
    // Arrange
    engine.startTask('PROJ-142', false, 'Implement Dash Mechanics');
    let focusCalled = false;
    decoder.setWindowFocusCallback(() => { focusCalled = true; });

    // Act: Press start button to pause task
    decoder.handleHardwareInput({ key: 'start', type: 'press', timestamp: new Date().toISOString() });

    // Assert
    expect(engine.getCurrentSession()?.status).toBe('PAUSED');
    expect(focusCalled).toBe(true);
  });
  it('HandleHardwareInput_StartButtonPress_ResumesPausedSession', () => {
    // Arrange: Start and pause
    engine.startTask('PROJ-200', false, 'Resume Test');
    decoder.handleHardwareInput({ key: 'start', type: 'press', timestamp: new Date().toISOString() });
    expect(engine.getCurrentSession()?.status).toBe('PAUSED');

    // Act: Press start again to resume
    decoder.handleHardwareInput({ key: 'start', type: 'press', timestamp: new Date().toISOString() });

    // Assert
    expect(engine.getCurrentSession()?.status).toBe('TRACKING');
  });

  it('HandleHardwareInput_NavigateQueueAction_CallsWindowFocusCallback', () => {
    // Arrange: bind navigate_queue to up key via custom bindings (up → NAVIGATE_QUEUE_PREV by default)
    let focusCalled = false;
    decoder.setWindowFocusCallback(() => { focusCalled = true; });

    // Act: 'up' maps to wheelRotateLeft which is NAVIGATE_QUEUE_PREV by default
    decoder.handleHardwareInput({ key: 'up', type: 'press', timestamp: new Date().toISOString() });

    // Assert
    expect(focusCalled).toBe(true);
  });

  it('HandleHardwareInput_ActionHandlerThrows_DoesNotPropagateError', () => {
    // Arrange: register a failing action handler
    decoder.registerActionHandler(() => { throw new Error('handler boom'); });

    // Act & Assert: handleHardwareInput should not throw
    expect(() =>
      decoder.handleHardwareInput({ key: 'start', type: 'press', timestamp: new Date().toISOString() })
    ).not.toThrow();
  });

  it('HandleHardwareInput_NoEventType_RoutesOkKeyToWheelClickAction', () => {
    // Arrange: REST-injected key has no event type
    engine.startTask('PROJ-300', false, 'No-Type Key Test');
    decoder.setRenderer(renderer);
    engine.pauseSession();

    // Act: ok key without event type (simulates REST /api/input?key=ok)
    const action = decoder.handleHardwareInput({ key: 'ok', timestamp: new Date().toISOString() } as never);

    // Assert: paused selection validated → session stopped
    expect(action).toBe('VALIDATE_PAUSED_SELECTION');
  });

  it('HandleHardwareInput_EodPromptActive_FirstStartPress_AdvancesToStep1Confirmation', () => {
    // Arrange
    const priorityEngine = {
      getActiveLockEventName: () => 'eodWrapUpPriority',
      releaseActiveLock: () => {},
      dismissNotification: () => false
    };
    decoder.setPriorityEngine(priorityEngine as never);
    decoder.setRenderer(renderer);

    let focusCalled = false;
    decoder.setWindowFocusCallback(() => { focusCalled = true; });

    // Act: 1st press
    const action = decoder.handleHardwareInput({ key: 'start', type: 'press', timestamp: new Date().toISOString() });

    // Assert
    expect(action).toBe('CONFIRM_EOD_WRAP_UP_STEP_1');
    expect(decoder.getEodConfirmStep()).toBe(1);
    expect(focusCalled).toBe(true);
  });

  it('HandleHardwareInput_EodPromptActive_SecondStartPress_ExecutesEodWrapUp', () => {
    // Arrange
    const priorityEngine = {
      getActiveLockEventName: () => 'eodWrapUpPriority',
      releaseActiveLock: () => {},
      dismissNotification: () => false
    };
    decoder.setPriorityEngine(priorityEngine as never);
    decoder.setRenderer(renderer);

    // 1st press -> step 1
    decoder.handleHardwareInput({ key: 'start', type: 'press', timestamp: new Date().toISOString() });
    expect(decoder.getEodConfirmStep()).toBe(1);

    // Act: 2nd press -> execute
    const action = decoder.handleHardwareInput({ key: 'start', type: 'press', timestamp: new Date().toISOString() });

    // Assert
    expect(action).toBe('EXECUTE_EOD_WRAP_UP');
    expect(decoder.getEodConfirmStep()).toBe(0);
  });

  it('HandleHardwareInput_EodPromptActive_BackPress_DismissesEodPrompt', () => {
    // Arrange
    let lockReleased = false;
    const priorityEngine = {
      getActiveLockEventName: () => 'eodWrapUpPriority',
      releaseActiveLock: (lock: string) => { if (lock === 'eodWrapUpPriority') lockReleased = true; },
      dismissNotification: () => false
    };
    decoder.setPriorityEngine(priorityEngine as never);
    decoder.setRenderer(renderer);

    // Act: back press
    const action = decoder.handleHardwareInput({ key: 'back', type: 'press', timestamp: new Date().toISOString() });

    // Assert
    expect(action).toBe('DISMISS_EOD_WRAP_UP');
    expect(lockReleased).toBe(true);
    expect(decoder.getEodConfirmStep()).toBe(0);
  });

  it('HandleHardwareInput_StandupPromptActive_ConfirmPress_AcknowledgesStandupPrompt', () => {
    // Arrange
    let lockReleased = false;
    const priorityEngine = {
      getActiveLockEventName: () => 'standupPromptPriority',
      releaseActiveLock: (lock: string) => { if (lock === 'standupPromptPriority') lockReleased = true; },
      dismissNotification: () => false
    };
    decoder.setPriorityEngine(priorityEngine as never);
    decoder.setRenderer(renderer);

    // Act: click / start press
    const action = decoder.handleHardwareInput({ key: 'ok', type: 'press', timestamp: new Date().toISOString() });

    // Assert
    expect(action).toBe('CONFIRM_STANDUP_PROMPT');
    expect(lockReleased).toBe(true);
  });

  it('HandleHardwareInput_StandupPromptActive_BackPress_DismissesWithoutAnswering', () => {
    // The confirm half is covered above; this is the half where the user
    // declines, which must still release the lock or the prompt holds the
    // display until something higher-priority overwrites it.
    const released: string[] = [];
    decoder.setPriorityEngine({
      getActiveLockEventName: () => 'standupPromptPriority',
      releaseActiveLock: (lock: string) => released.push(lock),
      dismissNotification: () => false
    } as never);

    const action = decoder.handleHardwareInput({
      key: 'back',
      type: 'press',
      timestamp: new Date().toISOString()
    });

    expect(action).toBe('DISMISS_STANDUP_PROMPT');
    expect(released).toContain('standupPromptPriority');
  });

  /**
   * The hardware task picker.
   *
   * None of this was covered, and it is the one screen a user drives entirely
   * from the bar -- wheel to scroll, click to descend, back to leave. The lock
   * assertions are the point: `renderTaskSelection` acquires `menuPriority` on
   * every redraw, and every exit from the menu has to release it. When nothing
   * did, the lock outlived the menu and the bar stayed on the picker until some
   * unrelated higher-priority event happened to overwrite it (F-15).
   */
  describe('task selection from the bar', () => {
    let released: string[];
    let projectRepo: ProjectRepository;

    /** A picker whose lock releases are observable. */
    function withPriorityEngine(): void {
      released = [];
      decoder.setPriorityEngine({
        // No ceremony holds the display, so input reaches the selection branch.
        getActiveLockEventName: () => undefined,
        releaseActiveLock: (lock: string) => released.push(lock),
        dismissNotification: () => false
      } as never);
    }

    /** Opens the picker the way the wheel click does, with no active session. */
    function openPicker(): void {
      decoder.handleHardwareInput({
        key: 'ok',
        type: 'press',
        timestamp: new Date().toISOString()
      });
    }

    function press(key: string): string {
      return decoder.handleHardwareInput({
        key,
        type: 'press',
        timestamp: new Date().toISOString()
      });
    }

    beforeEach(() => {
      projectRepo = new ProjectRepository(dbConn);
      withPriorityEngine();
    });

    it('HandleHardwareInput_BackWhileSelecting_CancelsAndReleasesTheMenuLock', () => {
      projectRepo.saveProject({ id: 'P1', key: 'P1', name: 'Alpha' });
      openPicker();

      const action = press('back');

      expect(action).toBe('CANCEL_SELECTION');
      // The lock this test exists for.
      expect(released).toContain('menuPriority');
    });

    it('HandleHardwareInput_ConfirmingATask_StartsItAndReleasesTheMenuLock', () => {
      projectRepo.saveProject({ id: 'P1', key: 'P1', name: 'Alpha' });
      taskRepo.saveTask({ id: 'T1', projectId: 'P1', key: 'ALPHA-1', title: 'Write the thing', status: 'todo' });
      openPicker();

      press('ok'); // PROJECT stage -> TASK stage
      const action = press('ok'); // confirm the task

      expect(action).toBe('START_TASK_FROM_SELECTION');
      expect(released).toContain('menuPriority');
      const session = engine.getCurrentSession();
      expect(session?.taskId).toBe('T1');
    });

    it('HandleHardwareInput_DescendingIntoAProject_ShowsTheTaskKeyOnTheSecondRow', () => {
      // TaskDTO carries no description. The second row used to read
      // `t.description`, which was always undefined, so every row said
      // "No description"; it shows the key, which is real data.
      projectRepo.saveProject({ id: 'P1', key: 'P1', name: 'Alpha' });
      taskRepo.saveTask({ id: 'T1', projectId: 'P1', key: 'ALPHA-1', title: 'Write the thing', status: 'todo' });
      const rendered: Array<[string, string, string | undefined]> = [];
      renderer.renderTaskSelection = ((stage: string, label: string, sub?: string) => {
        rendered.push([stage, label, sub]);
      }) as never;
      openPicker();

      press('ok');

      const taskRow = rendered.find(([stage]) => stage === 'TASK');
      expect(taskRow?.[1]).toBe('Write the thing');
      expect(taskRow?.[2]).toBe('ALPHA-1');
    });

    it('HandleHardwareInput_RotatingPastEitherEnd_ClampsInsteadOfLeavingTheList', () => {
      projectRepo.saveProject({ id: 'P1', key: 'P1', name: 'Alpha' });
      projectRepo.saveProject({ id: 'P2', key: 'P2', name: 'Beta' });
      const rendered: string[] = [];
      renderer.renderTaskSelection = ((_stage: string, label: string) => {
        rendered.push(label);
      }) as never;
      openPicker();

      // Up from the first entry, then down past the last.
      press('rotate_left');
      const atTop = rendered[rendered.length - 1];
      press('rotate_right');
      press('rotate_right');
      press('rotate_right');
      const atBottom = rendered[rendered.length - 1];

      expect(atTop).toBe('Alpha');
      expect(atBottom).toBe('Beta');
    });

    it('HandleHardwareInput_NoProjectsCached_OffersTheDefaultProjectRow', () => {
      // An empty picker is a dead end on hardware: there is no keyboard to add
      // a project with, so the fallback row is what keeps the menu usable.
      const rendered: string[] = [];
      renderer.renderTaskSelection = ((_stage: string, label: string) => {
        rendered.push(label);
      }) as never;

      openPicker();

      expect(rendered[0]).toBe('Default Project');
    });

    it('HandleHardwareInput_ProjectWithNoTasks_ShowsNoTasksAndStartsNothing', () => {
      projectRepo.saveProject({ id: 'P1', key: 'P1', name: 'Empty' });
      const rendered: Array<[string, string]> = [];
      renderer.renderTaskSelection = ((stage: string, label: string) => {
        rendered.push([stage, label]);
      }) as never;
      openPicker();

      press('ok'); // descend into the empty project
      const action = press('ok'); // confirm the placeholder row

      expect(rendered.some(([stage, label]) => stage === 'TASK' && label === 'No Tasks')).toBe(true);
      // The menu closes, but the placeholder is not a task and must not start
      // a session.
      expect(action).toBe('START_TASK_FROM_SELECTION');
      expect(engine.getCurrentSession()).toBeNull();
      expect(released).toContain('menuPriority');
    });
  });

  it('InputDecoder_ListenerThrows_LogsWithoutTerminatingTheProcess', async () => {
    // Driven through the driver's own event, not by calling handleHardwareInput
    // directly, because the guard under test lives in the listener the
    // constructor registers. A throw inside an EventEmitter listener with no
    // error handler terminates the main process -- so a button press could take
    // the whole app down.
    // console.error is already stubbed by the fixture; reuse that spy rather
    // than installing a second one and restoring the real console mid-file.
    const errors = vi.mocked(console.error);
    errors.mockClear();
    decoder.setPriorityEngine({
      getActiveLockEventName: () => {
        throw new Error('priority engine exploded');
      },
      releaseActiveLock: () => undefined,
      dismissNotification: () => false
    } as never);

    expect(() =>
      driver.simulateInputEvent({ key: 'start', type: 'press', timestamp: new Date().toISOString() })
    ).not.toThrow();
    expect(errors).toHaveBeenCalled();
  });
});
