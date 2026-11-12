import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { SessionRepository } from '../src/main/db/repositories/session-repository';
import { WorklogRepository } from '../src/main/db/repositories/worklog-repository';
import { TaskRepository } from '../src/main/db/repositories/task-repository';
import { ProjectRepository } from '../src/main/db/repositories/project-repository';
import { TimeTrackingEngine } from '../src/main/engine/time-tracking-engine';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { InputDecoder } from '../src/main/hardware/input-decoder';
import { BAR_MENU_EVENT, RESUME_PROMPT_EVENT } from '../src/shared/priority-defaults';
import { BAR_ANSWER_SETTLE_MS, BAR_INTERRUPTION_AGAIN_MS, BAR_MENU_IDLE_MS, BAR_STOP_AGAIN_MS } from '../src/shared/render-constants';
import { WORKLOG_COMMENTS } from '../src/shared/worklog-comments';
import type { TaskDTO } from '../src/shared/dtos';
import { BarWord } from '../src/shared/words';

/** Starting a task takes it up at once: the two-minute wait is not this suite's subject. */
const TAKE_UP_AT_ONCE = () => ({ enabled: true, afterSeconds: 0 });

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

    engine = new TimeTrackingEngine(sessionRepo, worklogRepo, taskRepo, undefined, new ProjectRepository(dbConn), undefined, TAKE_UP_AT_ONCE);
    driver = new BusyBarDriver('10.0.4.20', true); // Mock Mode
    await driver.connect();

    renderer = new DisplayRenderer(driver);
    decoder = new InputDecoder(driver, engine);
    decoder.setRenderer(renderer);
    // The panel has shown what it shows for a while: no answer is settling.
    vi.spyOn(renderer, 'msSinceScreenChange').mockReturnValue(60_000);
  });

  afterEach(() => {
    decoder.dispose();
    renderer.dispose();
    engine.dispose();
    driver.disconnect();
    dbConn.close();
    vi.restoreAllMocks();
  });

  it('Connect_MockMode_ReturnsConnectedDeviceStatus', () => {
    // Act
    const status = driver.getDeviceStatus();

    // Assert
    expect(status.connected).toBe(true);
    expect(status.ipAddress).toBe('10.0.4.20');
    expect(driver.getIsMockMode()).toBe(true);
  });

  it('RenderActiveSession_ValidSession_Generates72x16FrontPayload', () => {
    // Arrange
    const session = engine.startTask('PROJ-142', false, 'Implement Dash Mechanics');

    // Act
    const payload = renderer.renderActiveSession(session);

    // Assert: front display is now rasterized as pixel strips from PixelCanvas
    const frontEls = payload.frontElements as Record<string, unknown>[];
    expect(frontEls.length).toBeGreaterThan(0);
    // All front elements should be rectangles (pixel strips)
    expect(frontEls.every(e => e.type === 'rectangle')).toBe(true);
    expect(payload.ledColorHex).toBe('#10B981FF'); // Green LED for TRACKING
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
      const payloadOutcome = await liveDriver.sendDisplayPayload({ test: 'data' });

      // Assert
      expect(connected).toBe(true);
      expect(payloadOutcome).toBe('drawn');
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

  it('HandleHardwareInput_ActionHandlerThrows_DoesNotPropagateError', () => {
    // Arrange: register a failing action handler
    decoder.registerActionHandler(() => { throw new Error('handler boom'); });

    // Act & Assert: handleHardwareInput should not throw
    expect(() =>
      decoder.handleHardwareInput({ key: 'start', type: 'press', timestamp: new Date().toISOString() })
    ).not.toThrow();
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

  it('HandleHardwareInput_EodPromptActive_WheelClick_DismissesEodPrompt', () => {
    // Arrange
    let lockReleased = false;
    const priorityEngine = {
      getActiveLockEventName: () => 'eodWrapUpPriority',
      releaseActiveLock: (lock: string) => { if (lock === 'eodWrapUpPriority') lockReleased = true; },
      dismissNotification: () => false
    };
    decoder.setPriorityEngine(priorityEngine as never);
    decoder.setRenderer(renderer);

    // Act: the wheel's click says no
    const action = decoder.handleHardwareInput({ key: 'ok', type: 'press', timestamp: new Date().toISOString() });

    // Assert
    expect(action).toBe('DISMISS_EOD_WRAP_UP');
    expect(lockReleased).toBe(true);
    expect(decoder.getEodConfirmStep()).toBe(0);
  });

  it('HandleHardwareInput_StandupPromptActive_ConfirmPress_LeavesTheJoinToTheSchedule', () => {
    // Joining switches the timer under the prompt's lock and releases it
    // there, which draws once (ContextScheduleService.joinStandup, reached
    // through the action handlers). Released here, the old session was drawn
    // and then the stand-up over it.
    let lockReleased = false;
    const priorityEngine = {
      getActiveLockEventName: () => 'standupPromptPriority',
      releaseActiveLock: (lock: string) => { if (lock === 'standupPromptPriority') lockReleased = true; },
      dismissNotification: () => false
    };
    decoder.setPriorityEngine(priorityEngine as never);
    decoder.setRenderer(renderer);

    // Act: Pause says yes
    const action = decoder.handleHardwareInput({ key: 'start', type: 'press', timestamp: new Date().toISOString() });

    // Assert
    expect(action).toBe('CONFIRM_STANDUP_PROMPT');
    expect(lockReleased).toBe(false);
  });

  it('HandleHardwareInput_StandupPromptActive_WheelClick_DismissesWithoutAnswering', () => {
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
      key: 'ok',
      type: 'press',
      timestamp: new Date().toISOString()
    });

    expect(action).toBe('DISMISS_STANDUP_PROMPT');
    expect(released).toContain('standupPromptPriority');
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

  describe('resuming after lunch a task that is no longer the user\'s', () => {
    // ContextScheduleService owns the question; the decoder only hands it the
    // answer, through the action handlers the IPC registry routes.
    const press = (key: string) => decoder.handleHardwareInput({ key, type: 'press', timestamp: new Date().toISOString() });
    let heard: string[];

    beforeEach(() => {
      heard = [];
      decoder.registerActionHandler(action => heard.push(action));
      decoder.setPriorityEngine({
        getActiveLockEventName: () => RESUME_PROMPT_EVENT,
        releaseActiveLock: () => undefined,
        dismissNotification: () => false
      } as never);
    });

    it('HandleHardwareInput_PauseOnTheQuestion_AnswersYes', () => {
      expect(press('start')).toBe('CONFIRM_RESUME_PROMPT');

      expect(heard).toEqual(['CONFIRM_RESUME_PROMPT']);
    });

    it('HandleHardwareInput_WheelClickOnTheQuestion_AnswersNo', () => {
      expect(press('ok')).toBe('DISMISS_RESUME_PROMPT');
      expect(heard).toEqual(['DISMISS_RESUME_PROMPT']);
    });

    it('HandleHardwareInput_BackOnTheQuestion_AnswersNothing', () => {
      // Back is no answer any more (P14b): it does nothing anywhere.
      expect(press('back')).toBe('AWAIT_RESUME_PROMPT');
      expect(heard).toEqual([]);
    });

    it('HandleHardwareInput_AnswerJustAfterTheScreenChanged_Settles', () => {
      // A press meant for what was on the panel a moment before -- a pause, an
      // interruption -- must not answer the question that came up under it.
      vi.mocked(renderer.msSinceScreenChange).mockReturnValue(BAR_ANSWER_SETTLE_MS - 1);

      expect(press('start')).toBe('ANSWER_SETTLING');
      expect(press('ok')).toBe('ANSWER_SETTLING');
      expect(heard).toEqual([]);
    });

    it.each([true, false])('AnswerQuestion_FromTheDeck_%s_IsTheBarsAnswer_WithoutTheSettle', yes => {
      // The deck answers by meaning, never by key, and keeps its own settle.
      vi.mocked(renderer.msSinceScreenChange).mockReturnValue(0);

      expect(decoder.answerQuestion(yes)).toBe(yes ? 'CONFIRM_RESUME_PROMPT' : 'DISMISS_RESUME_PROMPT');
    });

    it('HandleHardwareInput_WheelTurnedOnTheQuestion_AnswersNothing', () => {
      // Turning the wheel is not an answer, and must not reach the session.
      engine.startTask('T-9', false, 'Running');

      expect(press('rotate_left')).toBe('AWAIT_RESUME_PROMPT');
      expect(heard).toEqual([]);
      expect(engine.getCurrentSession()?.status).toBe('TRACKING');
    });
  });

  /**
   * The bar's buttons (redesign P14b, the user's layout of 2026-11-12, revised
   * the same day): Pause is yes and Pause again stops, the wheel's click
   * interrupts or says no, Back does nothing, and turning does nothing until
   * the menu (P14c).
   */
  describe('the buttons', () => {
    const at = () => new Date().toISOString();
    const press = (key: string) => decoder.handleHardwareInput({ key, type: 'press', timestamp: at() });
    let heard: string[];
    let notificationUp: boolean;
    let dismissed: boolean[];

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      heard = [];
      notificationUp = false;
      dismissed = [];
      decoder.registerActionHandler(action => heard.push(action));
      decoder.setPriorityEngine({
        getActiveLockEventName: () => null,
        releaseActiveLock: () => undefined,
        hasActiveNotification: () => notificationUp,
        dismissNotification: (explicit: boolean) => {
          dismissed.push(explicit);
          const was = notificationUp;
          notificationUp = false;
          return was;
        }
      } as never);
      taskRepo.saveTask({ id: 'T-1', projectId: 'P-1', key: 'SCRUM-1', title: 'Tache 1', status: 'todo' });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** What row 1 of the bar shows, read from the frame the renderer drew. */
    const row1Says = (text: string): boolean => {
      const drawn = vi.mocked(renderer['canvas'].drawSmallText);
      return drawn.mock.calls.some(([t]) => t === text);
    };

    describe('Pause', () => {
      it('Pause_Timing_Pauses_AndSaysAgainStop', () => {
        engine.startTask('T-1');
        vi.spyOn(renderer['canvas'], 'drawSmallText');

        expect(press('start')).toBe('PAUSE_SESSION');

        expect(engine.getCurrentSession()?.status).toBe('PAUSED');
        renderer.renderActiveSession(engine.getCurrentSession());
        expect(row1Says(BarWord.AGAIN_STOP)).toBe(true);
      });

      it('Pause_Twice_StopsWithLogged_TheTaskStaysOpen', () => {
        engine.startTask('T-1');
        const logged = vi.spyOn(renderer, 'renderTaskLogged');
        press('start');
        vi.advanceTimersByTime(BAR_STOP_AGAIN_MS - 1);

        expect(press('start')).toBe('STOP_SESSION');

        expect(engine.getCurrentSession()).toBeNull();
        expect(logged).toHaveBeenCalledTimes(1);
        expect(taskRepo.getTaskById('T-1')?.status).not.toBe('done');
      });

      it('Pause_AgainAfterTheWindow_Resumes_AndTheTimeComesBack', () => {
        engine.startTask('T-1');
        press('start');
        vi.advanceTimersByTime(BAR_STOP_AGAIN_MS);
        const small = vi.spyOn(renderer['canvas'], 'drawSmallText');
        renderer.renderActiveSession(engine.getCurrentSession());
        expect(small.mock.calls.some(([t]) => t === BarWord.AGAIN_STOP)).toBe(false);

        expect(press('start')).toBe('RESUME_SESSION');
        expect(engine.getCurrentSession()?.status).toBe('TRACKING');
      });

      it('Pause_OnASessionPausedElsewhere_Resumes_NeverStops', () => {
        // Only the bar's own pause arms the stop: one paused in the app, or by
        // lunch, resumes on the first press.
        engine.startTask('T-1');
        engine.pauseSession();

        expect(press('start')).toBe('RESUME_SESSION');
        expect(engine.getCurrentSession()?.status).toBe('TRACKING');
      });

      it('Pause_ResumedThenPausedAgain_ArmsAfresh', () => {
        engine.startTask('T-1');
        press('start');
        vi.advanceTimersByTime(BAR_STOP_AGAIN_MS);
        press('start');

        expect(press('start')).toBe('PAUSE_SESSION');
        expect(press('start')).toBe('STOP_SESSION');
      });

      it('Pause_NothingRunning_OpensThePickerOnTheComputer', () => {
        const open = vi.fn();
        decoder.setOpenPickerCallback(open);

        expect(press('start')).toBe('OPEN_TASK_PICKER');
        expect(open).toHaveBeenCalledTimes(1);
        expect(engine.getCurrentSession()).toBeNull();
      });

      it('Pause_ANotificationShown_DismissesItAndLeavesTheSessionRunning', () => {
        // Pause on a notification means "seen", not "pause my work".
        engine.startTask('T-1');
        notificationUp = true;

        expect(press('start')).toBe('DISMISS_NOTIFICATION_ALERT');
        expect(dismissed).toEqual([false]);
        expect(engine.getCurrentSession()?.status).toBe('TRACKING');
      });

      it('Pause_ANotificationJustArrived_Settles', () => {
        engine.startTask('T-1');
        notificationUp = true;
        vi.mocked(renderer.msSinceScreenChange).mockReturnValue(BAR_ANSWER_SETTLE_MS - 1);

        expect(press('start')).toBe('ANSWER_SETTLING');
        expect(dismissed).toEqual([]);
        expect(engine.getCurrentSession()?.status).toBe('TRACKING');
      });

      it('Pause_LeavesTheWindowWhereItIs', () => {
        // P8c: the bar answers by itself; the window is not brought forward.
        const focus = vi.fn();
        decoder.setWindowFocusCallback(focus);
        engine.startTask('T-1');

        press('start');
        press('start');

        expect(focus).not.toHaveBeenCalled();
      });
    });

    describe('Pause during an interruption', () => {
      it('Pause_Once_GoesBackToTheTask_WhenTheWaitIsOver', () => {
        engine.startTask('T-1');
        engine.startInterruption(new Date(), 'bar');

        expect(press('start')).toBe('AWAIT_SECOND_PRESS');
        expect(engine.isInterrupted()).toBe(true);

        vi.advanceTimersByTime(BAR_INTERRUPTION_AGAIN_MS);

        expect(heard).toEqual(['BACK_FROM_INTERRUPTION']);
        expect(engine.getCurrentSession()).toMatchObject({ taskId: 'T-1', status: 'TRACKING' });
        expect(engine.getCurrentSession()?.interruption).toBeUndefined();
      });

      it('Pause_Once_SaysAgainStopWhileItWaits', () => {
        engine.startTask('T-1');
        engine.startInterruption(new Date(), 'bar');
        vi.spyOn(renderer['canvas'], 'drawSmallText');

        press('start');

        expect(row1Says(BarWord.AGAIN_STOP)).toBe(true);
      });

      it('Pause_Twice_StopsTheInterruptionWhereTheFirstWasPressed', () => {
        // Nothing is logged for an interruption: it waits to be placed, and
        // the task it held stays paused. Its end is the first press, not the
        // second, so the wait is no one's time.
        engine.startTask('T-1');
        engine.startInterruption(new Date(), 'bar');
        vi.advanceTimersByTime(60_000);
        const firstPress = Date.now();
        press('start');
        vi.advanceTimersByTime(BAR_INTERRUPTION_AGAIN_MS - 1);

        expect(press('start')).toBe('STOP_INTERRUPTION');

        expect(engine.isInterrupted()).toBe(false);
        const placed = engine.getInterruptionsToPlace();
        expect(placed).toHaveLength(1);
        expect(Date.parse(placed[0].endedAtUtc)).toBe(firstPress);
        expect(engine.getCurrentSession()).toMatchObject({ taskId: 'T-1', status: 'PAUSED' });
        vi.advanceTimersByTime(BAR_INTERRUPTION_AGAIN_MS);
        expect(heard).toEqual(['STOP_INTERRUPTION']);
      });

      it('Pause_InterruptionHoldingNothing_StopsIt', () => {
        engine.startInterruption(new Date(), 'bar');

        expect(press('start')).toBe('STOP_INTERRUPTION');
        expect(engine.isInterrupted()).toBe(false);
      });

      it('Click_WhileTheReturnWaits_GoesBackFirst_ThenInterrupts', () => {
        // The first press is honoured: back to the task, then the click is
        // Interrupt as anywhere.
        engine.startTask('T-1');
        engine.startInterruption(new Date(), 'bar');
        press('start');

        expect(press('ok')).toBe('START_INTERRUPTION');
        expect(heard).toEqual(['BACK_FROM_INTERRUPTION', 'START_INTERRUPTION']);
      });

      it('Pause_TheInterruptionEndedElsewhereMeanwhile_NothingHappens', () => {
        engine.startTask('T-1');
        engine.startInterruption(new Date(), 'bar');
        press('start');
        engine.stopInterruption();

        vi.advanceTimersByTime(BAR_INTERRUPTION_AGAIN_MS);

        expect(heard).toEqual([]);
        expect(engine.getCurrentSession()?.status).toBe('PAUSED');
      });

      it('Dispose_DropsTheWaitingReturn', () => {
        engine.startTask('T-1');
        engine.startInterruption(new Date(), 'bar');
        press('start');

        decoder.dispose();
        vi.advanceTimersByTime(BAR_INTERRUPTION_AGAIN_MS);

        expect(heard).toEqual([]);
        expect(engine.isInterrupted()).toBe(true);
      });

      it('Pause_TheReturnThrows_IsLoggedNotThrown', () => {
        engine.startTask('T-1');
        engine.startInterruption(new Date(), 'bar');
        press('start');
        vi.spyOn(engine, 'backFromInterruption').mockImplementation(() => { throw new Error('boom'); });

        expect(() => vi.advanceTimersByTime(BAR_INTERRUPTION_AGAIN_MS)).not.toThrow();
        expect(vi.mocked(console.error)).toHaveBeenCalled();
      });
    });

    describe('Back', () => {
      it.each(['back', 'back_hold', 'cancel'])('Back_%s_DoesNothing_EvenTiming', key => {
        // The user does not want Back (2026-11-12); on the bar's own screen
        // the firmware takes it anyway.
        engine.startTask('T-1');

        expect(press(key)).toBe('NONE');
        expect(heard).toEqual([]);
        expect(engine.getCurrentSession()?.status).toBe('TRACKING');
      });

      it('Back_DuringAnInterruption_DoesNothing', () => {
        engine.startTask('T-1');
        engine.startInterruption(new Date(), 'bar');

        expect(press('back')).toBe('NONE');
        expect(engine.isInterrupted()).toBe(true);
      });

      it('Back_ANotificationShown_LeavesIt', () => {
        notificationUp = true;

        expect(press('back')).toBe('NONE');
        expect(dismissed).toEqual([]);
      });
    });

    describe('the wheel', () => {
      it.each(['ok', 'click'])('Click_%s_Interrupts_ThroughTheSchedule', key => {
        // Interrupt is ContextScheduleService's, through the action handlers;
        // the decoder starts nothing itself.
        engine.startTask('T-1');

        expect(press(key)).toBe('START_INTERRUPTION');
        expect(heard).toEqual(['START_INTERRUPTION']);
        expect(engine.isInterrupted()).toBe(false);
      });

      it('Click_NoEventType_StillInterrupts', () => {
        // A key injected over REST (/api/input?key=ok) carries no type.
        expect(decoder.handleHardwareInput({ key: 'ok', timestamp: at() } as never)).toBe('START_INTERRUPTION');
      });

      it('Click_NothingRunning_Interrupts', () => {
        expect(press('ok')).toBe('START_INTERRUPTION');
      });

      it('Click_ANotificationShown_SaysNo_AndDismissesIt', () => {
        engine.startTask('T-1');
        notificationUp = true;

        expect(press('ok')).toBe('DISMISS_NOTIFICATION_ALERT');
        expect(dismissed).toEqual([false]);
        expect(engine.isInterrupted()).toBe(false);
      });
    });
    /**
     * The wheel's menu (P14c): turning opens it, one entry per screen, Pause
     * picks, the click or BAR_MENU_IDLE_MS untouched closes it, and DONE and
     * DISCARD ask a second Pause.
     */
    describe('the menu', () => {
      let released: string[];
      let ending: { complete: ReturnType<typeof vi.fn>; discard: ReturnType<typeof vi.fn> };
      let openApp: ReturnType<typeof vi.fn>;
      let recent: TaskDTO[];
      const drawn = () => vi.mocked(renderer.renderBarMenu).mock.calls.map(([screen]) => screen);
      const last = () => drawn()[drawn().length - 1];

      beforeEach(() => {
        released = [];
        recent = [];
        ending = { complete: vi.fn(() => ({ success: true, loggedSeconds: 60 })), discard: vi.fn(() => ({ success: true, discardedSeconds: 60 })) };
        openApp = vi.fn();
        decoder.setPriorityEngine({
          getActiveLockEventName: () => null,
          releaseActiveLock: (lock: string) => released.push(lock),
          hasActiveNotification: () => notificationUp,
          dismissNotification: () => false
        } as never);
        decoder.setMenuDeps({ sessionEnding: ending, recentTasks: () => recent, openApp });
        vi.spyOn(renderer, 'renderBarMenu');
        for (const n of [2, 3]) {
          taskRepo.saveTask({ id: `T-${n}`, projectId: 'P-1', key: `SCRUM-${n}`, title: `Tache ${n}`, status: 'todo' });
        }
      });

      it('Turn_Timing_OpensOnDone_ThenDiscard_ThenOpenApp', () => {
        engine.startTask('T-1');

        expect(press('rotate_right')).toBe('OPEN_MENU');
        expect(last()).toMatchObject({ label: 'SCRUM-1', detail: BarWord.DONE, position: { index: 0, count: 3 } });
        press('rotate_right');
        expect(last()).toMatchObject({ detail: BarWord.DISCARD, position: { index: 1 } });
        press('rotate_right');
        expect(last()).toMatchObject({ label: BarWord.OPEN_APP, position: { index: 2 } });
      });

      it('Turn_Left_OpensOnTheLastEntry_AndStopsAtEitherEnd', () => {
        engine.startTask('T-1');

        press('rotate_left');
        expect(last()).toMatchObject({ label: BarWord.OPEN_APP });
        expect(press('rotate_right')).toBe('NONE');
        press('rotate_left');
        press('rotate_left');
        expect(press('rotate_left')).toBe('NONE');
        expect(last()).toMatchObject({ detail: BarWord.DONE });
      });

      it('Done_AsksASecondPause_ThenFinishesThroughTheSessionEnding', () => {
        engine.startTask('T-1');
        press('rotate_right');

        expect(press('start')).toBe('ASK_DONE');
        expect(last()).toMatchObject({ confirm: 'DONE' });
        expect(ending.complete).not.toHaveBeenCalled();

        expect(press('start')).toBe('FINISH_SESSION');
        expect(ending.complete).toHaveBeenCalledWith(WORKLOG_COMMENTS.BAR_FINISH, true);
        expect(decoder.isMenuOpen()).toBe(false);
        expect(released).toContain(BAR_MENU_EVENT);
      });

      it('Done_OnATaskNoLongerTheUsers_AsksNotYours_AndSaysSoInTheWorklog', () => {
        engine.startTask('T-1');
        vi.spyOn(engine, 'getCurrentSession').mockReturnValue({ ...engine.getCurrentSession()!, taskUnlisted: true });
        press('rotate_right');

        press('start');
        expect(last()).toMatchObject({ confirm: 'DONE_UNLISTED' });
        press('start');

        expect(ending.complete).toHaveBeenCalledWith(WORKLOG_COMMENTS.BAR_FINISH_CONFIRMED, true);
      });

      it('Done_TheClickSaysNo_BackToTheEntry_NothingEnds', () => {
        engine.startTask('T-1');
        press('rotate_right');
        press('start');

        expect(press('ok')).toBe('MENU_CONFIRM_REFUSED');

        expect(last()).toMatchObject({ detail: BarWord.DONE });
        expect(last().confirm).toBeUndefined();
        expect(decoder.isMenuOpen()).toBe(true);
        expect(ending.complete).not.toHaveBeenCalled();
      });

      it('Done_ATurnDropsTheQuestion', () => {
        engine.startTask('T-1');
        press('rotate_right');
        press('start');
        press('rotate_right');

        expect(press('start')).toBe('ASK_DISCARD');
        expect(ending.complete).not.toHaveBeenCalled();
      });

      it('Discard_AsksASecondPause_ThenDiscards', () => {
        engine.startTask('T-1');
        press('rotate_right');
        press('rotate_right');

        expect(press('start')).toBe('ASK_DISCARD');
        expect(last()).toMatchObject({ confirm: 'DISCARD' });
        expect(press('start')).toBe('DISCARD_SESSION');
        expect(ending.discard).toHaveBeenCalledTimes(1);
      });

      it('Interruption_OffersDiscardAndOpenApp_NoTask', () => {
        // No task is chosen during an interruption (2026-11-12).
        engine.startTask('T-2');
        engine.stopSession();
        engine.startTask('T-1');
        engine.startInterruption(new Date(), 'bar');
        recent = [taskRepo.getTaskById('T-3')!];

        press('rotate_right');

        expect(last()).toMatchObject({ detail: BarWord.DISCARD, position: { count: 2 } });
        press('rotate_right');
        expect(last()).toMatchObject({ label: BarWord.OPEN_APP });
      });

      it('NothingRunning_OffersThePrevious_TheRecent_AndOpenApp_EachOnce', () => {
        engine.startTask('T-2');
        engine.stopSession();
        recent = ['T-2', 'T-3', 'T-1'].map(id => taskRepo.getTaskById(id)!);

        press('rotate_right');

        expect(last()).toMatchObject({ label: 'SCRUM-2', detail: BarWord.PREVIOUS, position: { index: 0, count: 4 } });
        press('rotate_right');
        expect(last()).toMatchObject({ label: 'SCRUM-3', detail: BarWord.RECENT });
        press('rotate_right');
        expect(last()).toMatchObject({ label: 'SCRUM-1', detail: BarWord.RECENT });
      });

      it('Previous_Picked_StartsIt_AndTheMenuLetsGo', () => {
        engine.startTask('T-2');
        engine.stopSession();
        press('rotate_right');

        expect(press('start')).toBe('START_PREVIOUS');

        expect(engine.getCurrentSession()).toMatchObject({ taskId: 'T-2', status: 'TRACKING' });
        expect(decoder.isMenuOpen()).toBe(false);
        expect(released).toEqual([BAR_MENU_EVENT]);
      });

      it('Recent_Picked_WhileTiming_SwitchesToIt', () => {
        engine.startTask('T-1');
        recent = [taskRepo.getTaskById('T-3')!];
        press('rotate_left');
        press('rotate_left');

        expect(press('start')).toBe('START_RECENT');
        expect(engine.getCurrentSession()?.taskId).toBe('T-3');
      });

      it('OpenApp_Picked_RaisesTheApp_AndCloses', () => {
        press('rotate_left');

        expect(press('start')).toBe('OPEN_APP');
        expect(openApp).toHaveBeenCalledTimes(1);
        expect(decoder.isMenuOpen()).toBe(false);
      });

      it('Click_ClosesTheMenu_LettingGoOfTheDisplay', () => {
        engine.startTask('T-1');
        press('rotate_right');

        expect(press('ok')).toBe('CLOSE_MENU');
        expect(decoder.isMenuOpen()).toBe(false);
        expect(released).toEqual([BAR_MENU_EVENT]);
        expect(engine.isInterrupted()).toBe(false);
      });

      it('Untouched_ClosesOnItsOwn_ATurnWaitsAgain', () => {
        engine.startTask('T-1');
        press('rotate_right');
        vi.advanceTimersByTime(BAR_MENU_IDLE_MS - 1);
        press('rotate_right');
        vi.advanceTimersByTime(BAR_MENU_IDLE_MS - 1);
        expect(decoder.isMenuOpen()).toBe(true);

        vi.advanceTimersByTime(1);

        expect(decoder.isMenuOpen()).toBe(false);
        expect(released).toEqual([BAR_MENU_EVENT]);
      });

      it('ASessionEndedElsewhere_ClosesTheMenu', () => {
        // The window's Stop while the menu offers DONE on the task it ended.
        engine.startTask('T-1');
        press('rotate_right');

        engine.stopSession();

        expect(decoder.isMenuOpen()).toBe(false);
      });

      it('APauseElsewhere_LeavesTheMenuOpen', () => {
        // Its entries are the same, timing or paused.
        engine.startTask('T-1');
        press('rotate_right');

        engine.pauseSession();

        expect(decoder.isMenuOpen()).toBe(true);
      });

      it('Back_InTheMenu_DoesNothing', () => {
        engine.startTask('T-1');
        press('rotate_right');

        expect(press('back')).toBe('NONE');
        expect(decoder.isMenuOpen()).toBe(true);
      });

      it('ANotificationOverTheMenu_TakesThePress', () => {
        engine.startTask('T-1');
        press('rotate_right');
        notificationUp = true;

        expect(press('ok')).toBe('DISMISS_NOTIFICATION_ALERT');
        expect(decoder.isMenuOpen()).toBe(true);
      });

      it('TheDisplayFrees_TheOpenMenuIsDrawnAgain', () => {
        // A state, not an alert (CLAUDE.md §5): refused under Away, it comes
        // back when the display frees, as long as it is open.
        let reclaim: (() => void) | undefined;
        decoder.setPriorityEngine({
          getActiveLockEventName: () => null,
          releaseActiveLock: () => undefined,
          hasActiveNotification: () => false,
          dismissNotification: () => false,
          addBackgroundScreen: (_names: string[], cb: () => void) => { reclaim = cb; return () => { reclaim = undefined; }; }
        } as never);
        engine.startTask('T-1');
        press('rotate_right');
        const before = drawn().length;

        reclaim?.();
        expect(drawn().length).toBe(before + 1);

        press('ok');
        reclaim?.();
        expect(drawn().length).toBe(before + 1);
        decoder.dispose();
        expect(reclaim).toBeUndefined();
      });

      it('Untouched_TheCloseThrows_IsLoggedNotThrown', () => {
        engine.startTask('T-1');
        press('rotate_right');
        decoder.setPriorityEngine({
          getActiveLockEventName: () => null,
          releaseActiveLock: () => { throw new Error('boom'); },
          hasActiveNotification: () => false,
          dismissNotification: () => false
        } as never);

        expect(() => vi.advanceTimersByTime(BAR_MENU_IDLE_MS)).not.toThrow();
        expect(vi.mocked(console.error)).toHaveBeenCalled();
      });
    });
  });

  describe('presses that defer to something else', () => {
    const at = () => new Date().toISOString();
    let dismissed: boolean[];
    let showing: string | undefined;
    let notificationUp: boolean;

    beforeEach(() => {
      dismissed = [];
      showing = undefined;
      notificationUp = false;
      decoder.setPriorityEngine({
        getActiveLockEventName: () => showing,
        releaseActiveLock: () => undefined,
        hasActiveNotification: () => notificationUp,
        dismissNotification: (explicit: boolean) => {
          dismissed.push(explicit);
          return notificationUp;
        }
      } as never);
    });

    it('HandleHardwareInput_StartWhileANotificationIsShown_DismissesItAndLeavesTheSessionRunning', () => {
      // START on a notification means "seen", not "pause my work": the press
      // is spent on the notification and the stopwatch keeps going.
      engine.startTask('T-9', false, 'Running');
      notificationUp = true;

      decoder.handleHardwareInput({ key: 'start', type: 'press', timestamp: at() });

      expect(dismissed).toEqual([false]);
      expect(engine.getCurrentSession()?.status).toBe('TRACKING');
    });

    it('HandleHardwareInput_StandupConfirmed_LeavesTheWindowWhereItIs', () => {
      // P8c: no prompt takes the focus. Joining needs nothing from the
      // window; the user is on their way to the meeting.
      showing = 'standupPromptPriority';
      const focus = vi.fn();
      decoder.setWindowFocusCallback(focus);

      const action = decoder.handleHardwareInput({ key: 'start', type: 'press', timestamp: at() });

      expect(action).toBe('CONFIRM_STANDUP_PROMPT');
      expect(focus).not.toHaveBeenCalled();
    });

    it('HandleHardwareInput_EodPromptGoneAndBack_StartsTheConfirmationOver', () => {
      // The wrap-up takes two presses. A first press left armed while the
      // prompt was away would let a single press run the wrap-up next time.
      showing = 'eodWrapUpPriority';
      decoder.handleHardwareInput({ key: 'start', type: 'press', timestamp: at() });
      showing = undefined;
      decoder.handleHardwareInput({ key: 'up', type: 'press', timestamp: at() });
      showing = 'eodWrapUpPriority';

      const action = decoder.handleHardwareInput({ key: 'start', type: 'press', timestamp: at() });

      expect(action).toBe('CONFIRM_EOD_WRAP_UP_STEP_1');
    });

    it.each(['apps', 'settings', 'off'])('HandleHardwareInput_%sKey_IsReportedAsTheSystemMode', key => {
      // The firmware's own keys: reported so the app can follow the bar, never
      // bound to an action of ours.
      const seen: string[] = [];
      decoder.registerActionHandler(action => seen.push(action));

      decoder.handleHardwareInput({ key, type: 'press', timestamp: at() });

      expect(seen).toEqual([`SYSTEM_MODE_${key.toUpperCase()}`]);
    });

    it('RegisterActionHandler_Unsubscribed_HearsNothingMore', () => {
      const seen: string[] = [];
      const unsubscribe = decoder.registerActionHandler(action => seen.push(action));
      unsubscribe();

      decoder.handleHardwareInput({ key: 'up', type: 'press', timestamp: at() });

      expect(seen).toEqual([]);
    });

  });
});
