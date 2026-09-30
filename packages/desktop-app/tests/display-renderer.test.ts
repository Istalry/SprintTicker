import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { AnimationPlayer } from '../src/main/hardware/animation-player';
import { IconAnimator } from '../src/main/hardware/icon-animator';
import { ANIMATED_ICONS, FRONT_ANIMATIONS, TASK_DONE_DISPLAY_SECONDS } from '../src/shared/render-constants';
import {
  FOLDER_16X16_BITMAP, TASK_16X16_BITMAP, TASK_IN_PROGRESS_16X16_BITMAP, TASK_DONE_16X16_BITMAP, HAMMER_16X16_BITMAP, STOPWATCH_16X16_BITMAP, STOPWATCH_IDLE_16X16_BITMAP, STOPWATCH_PAUSED_16X16_BITMAP
} from '../src/shared/pixel-bitmaps';
import { measureText } from '../src/shared/proportional-text';
import { ROW0_FONT, ROW1_FONT, TIMER_FONT } from '../src/shared/fonts/pixel-font';
import { ArgumentException } from '../src/shared/dtos';
import { HardwareDisplayStateDTO } from '../src/shared/dtos';
import { PriorityPreemptionEngine } from '../src/main/services/priority-preemption-engine';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';

describe('DisplayRenderer Unit Tests', () => {
  let mockDriver: BusyBarDriver;
  let renderer: DisplayRenderer;

  beforeEach(() => {
    mockDriver = {
      sendDisplayPayload: vi.fn().mockResolvedValue('drawn'),
      sendPixelFrame: vi.fn().mockResolvedValue('sent'),
      clearDisplay: vi.fn().mockResolvedValue(undefined),
      uploadAsset: vi.fn().mockResolvedValue(undefined),
      drawOverlay: vi.fn().mockResolvedValue('drawn'),
      removeDisplayElements: vi.fn().mockResolvedValue(undefined),
      getDeviceStatus: vi.fn(() => ({
        connected: true,
        ipAddress: '10.0.4.20',
        webSocketPingMs: 4,
        batteryPercent: 95,
        connectionType: 'usb'
      }))
    } as unknown as BusyBarDriver;

    renderer = new DisplayRenderer(mockDriver);
  });

  describe('constructor', () => {
    it('Constructor_NullDriver_ThrowsException', () => {
      expect(() => new DisplayRenderer(null as unknown as BusyBarDriver)).toThrow();
    });
  });

  /**
   * The front matrix has two possible owners and only one at a time. When the
   * device is playing a `.anim` itself, `sendPixelFrame` must not run: the
   * `px_matrix_img` it draws is opaque across the whole 72x16 panel and
   * composites above `hardware_anim` regardless of which arrived first, so a
   * transmission here blacks out the animation. Every animated mode reaches
   * this, because each one clears the canvas, starts the animation and then
   * transmits the blank canvas.
   *
   * Reproduced against a real bar: upload 200, draw 200, log line saying the
   * device was playing the file, and a black display.
   */
  describe('front display ownership while an animation plays', () => {
    const deviceOwnsTheFront = (): void => {
      vi.spyOn(
        (renderer as unknown as { animationPlayer: { isHardwareAnimationActive: () => boolean } })
          .animationPlayer,
        'isHardwareAnimationActive'
      ).mockReturnValue(true);
    };

    it('TransmitFrame_DeviceIsPlayingAnAnimation_DoesNotDrawOverIt', () => {
      deviceOwnsTheFront();

      renderer.renderActiveSession(null);

      expect(mockDriver.sendPixelFrame).not.toHaveBeenCalled();
    });

    it('TransmitFrame_AnimationStops_ResumesDrawingTheFrontMatrix', () => {
      const active = vi.spyOn(
        (renderer as unknown as { animationPlayer: { isHardwareAnimationActive: () => boolean } })
          .animationPlayer,
        'isHardwareAnimationActive'
      ).mockReturnValue(true);

      renderer.renderActiveSession(null);
      expect(mockDriver.sendPixelFrame).not.toHaveBeenCalled();

      // The suppressed frame must not be remembered as transmitted, or the
      // identical frame after the animation ends is deduplicated away and the
      // bar keeps showing whatever the animation left.
      active.mockReturnValue(false);
      renderer.renderActiveSession(null);

      expect(mockDriver.sendPixelFrame).toHaveBeenCalled();
    });

    it('TransmitFrame_NoAnimation_DrawsTheFrontMatrixAsBefore', () => {
      renderer.renderActiveSession(null);

      expect(mockDriver.sendPixelFrame).toHaveBeenCalled();
    });
  });

  describe('renderActiveSession & themes', () => {
    it('RenderActiveSession_ValidSession_SendsDisplayPayloadWithBitmap', () => {
      const session = {
        taskId: 'PROJ-142',
        taskKey: 'PROJ-142',
        taskTitle: 'Implement Dash Mechanics',
        status: 'TRACKING' as const,
        elapsedSeconds: 3600,
        startedAtUtc: new Date().toISOString()
      };

      const payload = renderer.renderActiveSession(session);
      expect(payload.frontElements.length).toBeGreaterThan(0);
      // The new pixel pipeline calls sendPixelFrame (clear → upload PNG → draw image)
      expect(mockDriver.sendPixelFrame).toHaveBeenCalled();
    });

    it('RenderIdle_ReturnsActiveSessionWithNull', () => {
      const payload = renderer.renderIdle();
      expect(payload).toBeDefined();
    });

    it('SetColorTheme_ValidTheme_UpdatesPaletteColors', () => {
      renderer.setColorTheme('cyberpunk');
      const payload = renderer.renderActiveSession(null);
      expect(payload).toBeDefined();
    });
  });

  describe('schedule & ceremony rendering', () => {
    it('RenderLunchMode_DispatchesLunchScreenPayload', () => {
      const payload = renderer.renderLunchMode();
      expect(payload.ledColorHex).toBe('#F59E0BFF');
      expect(mockDriver.sendPixelFrame).toHaveBeenCalled();
    });

    it('RenderAwayMode_DispatchesAwayScreenPayload', () => {
      const payload = renderer.renderAwayMode();
      expect(payload.ledColorHex).toBe('#A855F7FF');
      expect(mockDriver.sendPixelFrame).toHaveBeenCalled();
    });

    it('RenderLunchMode_Always_PlaysOurSandwichAnimation', () => {
      const play = vi
        .spyOn((renderer as unknown as { animationPlayer: AnimationPlayer }).animationPlayer, 'play')
        .mockResolvedValue(undefined);

      renderer.renderLunchMode();

      expect(play).toHaveBeenCalledWith('lunch_sandwich_72x16', expect.objectContaining({ loop: true }));
    });

    it('RenderAwayMode_Always_PlaysOurCoffeeAnimation', () => {
      const play = vi
        .spyOn((renderer as unknown as { animationPlayer: AnimationPlayer }).animationPlayer, 'play')
        .mockResolvedValue(undefined);

      renderer.renderAwayMode();

      expect(play).toHaveBeenCalledWith('away_coffee_72x16', expect.objectContaining({ loop: true }));
    });

    it('RenderCeremonyPrompt_Standup_PlaysOurMeetingAnimation', () => {
      const play = vi
        .spyOn((renderer as unknown as { animationPlayer: AnimationPlayer }).animationPlayer, 'play')
        .mockResolvedValue(undefined);

      renderer.renderCeremonyPrompt('STANDUP', 'Daily standup');

      expect(play).toHaveBeenCalledWith('meeting_table_72x16', expect.objectContaining({ loop: true }));
    });

    it('RenderCeremonyPrompt_EODType_DispatchesCeremonyPromptPayload', () => {
      const payload = renderer.renderCeremonyPrompt('EOD', 'End-of-Day Wrap-Up');
      expect(payload.ledColorHex).toBe('#A855F7FF');
      expect(mockDriver.sendPixelFrame).toHaveBeenCalled();
    });

    it('RenderEodCompleted_ValidMessage_DispatchesCompletionPayload', () => {
      const payload = renderer.renderEodCompleted('Day Complete!');
      expect(payload.ledColorHex).toBe('#10B981FF');
      expect(mockDriver.sendPixelFrame).toHaveBeenCalled();
      expect(payload.backElements.some((e: Record<string, unknown>) => (e.text as string)?.includes('END-OF-DAY WRAP-UP COMPLETE'))).toBe(true);
    });
  });

  describe('notification & confetti rendering', () => {
    it('RenderNotificationBanner_ValidMessage_DispatchesAlertPayload', () => {
      const payload = renderer.renderNotificationBanner({
        appName: 'Slack',
        title: 'Alice',
        iconId: 'slack'
      });
      expect(payload.ledColorHex).toBe('#8B5CF6FF');
      expect(mockDriver.sendPixelFrame).toHaveBeenCalled();
    });

    it('RenderNotificationBanner_HighPriorityEvent_UsesTheHighPriorityStyling', () => {
      // Styling used to key off `priority >= 90`. Nothing produces 90, so the
      // pink accent and FLASH_BURST were unreachable for every real
      // notification, high priority or not.
      const payload = renderer.renderNotificationBanner({
        appName: 'Slack',
        title: 'Ops',
        eventName: 'highNotificationPriority',
        iconId: 'slack'
      });

      expect(payload.ledColorHex).toBe('#EC4899FF');
    });

    it('RenderNotificationBanner_HighPriorityEvent_RaisesItUnderItsOwnEventName', () => {
      const evaluateRequest = vi
        .fn()
        .mockReturnValue({ shouldRender: true, action: 'DISPLAY', evaluatedPriority: 70 });
      renderer.setPriorityEngine({
        evaluateRequest,
        releaseActiveLock: vi.fn(),
        getEventPriority: vi.fn().mockReturnValue(70),
        getRules: vi.fn().mockReturnValue([]),
        saveRules: vi.fn(),
        drainQueue: vi.fn(),
        hasActiveNotification: vi.fn().mockReturnValue(false),
        dismissNotification: vi.fn().mockReturnValue(false),
        getActiveLockEventName: vi.fn().mockReturnValue(null),
        getUserMode: vi.fn().mockReturnValue('WORK'),
        setUserMode: vi.fn()
      });

      renderer.renderNotificationBanner({
        title: 'Ops',
        eventName: 'highNotificationPriority'
      });

      expect(evaluateRequest).toHaveBeenCalledWith(
        'highNotificationPriority',
        undefined,
        expect.any(Function)
      );
    });

    it('RenderNotificationBanner_TitleAndBody_PaintsBothTextRows', () => {
      // The banner drew a single centred row and left the lower one empty, so
      // the message body never reached the display at all.
      //
      // Asserting "some pixel below y=8" does NOT catch that: the 4x6 font
      // drawn at y=5 spans y=5..10 and satisfies it. Two rows are distinguished
      // by occupying both extremes -- row 0 at y=0..5 and row 1 at y=8..12 --
      // which a single centred row cannot do.
      const payload = renderer.renderNotificationBanner({
        appName: 'Slack',
        title: 'Alice',
        body: 'ship it',
        iconId: 'slack'
      });

      const text = (payload.frontElements as Array<Record<string, number>>).filter(s => s.x >= 17);
      expect(text.some(s => s.y <= 3)).toBe(true);
      expect(text.some(s => s.y >= 10)).toBe(true);
    });

    it('RenderNotificationBanner_AnyMessage_TransmitsExactlyOneFrame', () => {
      // Every frame is an asset upload plus a draw. A banner is a static
      // screen, so it must cost exactly one of those -- this is what keeps the
      // notification path off the hardware's request budget.
      renderer.renderNotificationBanner({
        appName: 'Slack',
        title: 'Alice',
        body: 'a message long enough that it has to be truncated',
        iconId: 'slack'
      });

      expect(mockDriver.sendPixelFrame).toHaveBeenCalledTimes(1);
    });

    it('RenderNotificationBanner_SecondBannerWithinTheTimeout_DoesNotReleaseTheSecondEarly', () => {
      // The release used to be an untracked setTimeout. Two notifications of
      // the same class inside one timeout window meant the first banner's timer
      // fired during the second's and released a lock it no longer owned,
      // cutting the second banner short.
      vi.useFakeTimers();
      try {
        const settingsRepo = { getSetting: vi.fn().mockReturnValue(null), setSetting: vi.fn() };
        const engine = new PriorityPreemptionEngine(settingsRepo as unknown as SettingsRepository);
        renderer.setPriorityEngine(engine);

        renderer.renderNotificationBanner({ title: 'first', eventName: 'messagingPriority', timeoutMs: 10000 });
        vi.advanceTimersByTime(6000);
        renderer.renderNotificationBanner({ title: 'second', eventName: 'messagingPriority', timeoutMs: 10000 });

        // The first banner's original deadline passes here. The second must
        // still own the display.
        vi.advanceTimersByTime(4100);
        expect(engine.getActiveLockEventName()).toBe('messagingPriority');

        // And it must still release on its own deadline rather than never.
        vi.advanceTimersByTime(6000);
        expect(engine.getActiveLockEventName()).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('Dispose_WithABannerPending_ClearsItsTimer', () => {
      vi.useFakeTimers();
      try {
        const settingsRepo = { getSetting: vi.fn().mockReturnValue(null), setSetting: vi.fn() };
        const engine = new PriorityPreemptionEngine(settingsRepo as unknown as SettingsRepository);
        const releaseSpy = vi.spyOn(engine, 'releaseActiveLock');
        renderer.setPriorityEngine(engine);

        renderer.renderNotificationBanner({ title: 'pending', timeoutMs: 10000 });
        renderer.dispose();
        vi.advanceTimersByTime(20000);

        expect(releaseSpy).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('RequestRender_RenderThrows_ReleasesTheLockItJustTook', () => {
      // Otherwise the display stays frozen at that priority until the user
      // presses BACK, because the release timer lives inside the render that
      // never completed.
      const releaseActiveLock = vi.fn();
      renderer.setPriorityEngine({
        evaluateRequest: vi
          .fn()
          .mockReturnValue({ shouldRender: true, action: 'DISPLAY', evaluatedPriority: 70 }),
        releaseActiveLock,
        getEventPriority: vi.fn().mockReturnValue(70),
        getRules: vi.fn().mockReturnValue([]),
        saveRules: vi.fn(),
        drainQueue: vi.fn(),
        hasActiveNotification: vi.fn().mockReturnValue(false),
        dismissNotification: vi.fn().mockReturnValue(false),
        getActiveLockEventName: vi.fn().mockReturnValue(null),
        getUserMode: vi.fn().mockReturnValue('WORK'),
        setUserMode: vi.fn()
      });

      expect(() =>
        renderer.requestRender('menuPriority', () => {
          throw new Error('render blew up');
        })
      ).toThrow('render blew up');
      expect(releaseActiveLock).toHaveBeenCalledWith('menuPriority');
    });

    it('RenderTaskCompletionConfetti_Triggered_DispatchesConfettiPayload', () => {
      const payload = renderer.renderTaskCompletionConfetti();
      expect(payload.ledColorHex).toBe('#10B981FF');
      expect(mockDriver.sendPixelFrame).toHaveBeenCalled();
    });

    describe('task done scene', () => {
      const player = (): AnimationPlayer =>
        (renderer as unknown as { animationPlayer: AnimationPlayer }).animationPlayer;
      const tracking = {
        id: 's1', taskId: 't1', taskKey: 'PROJ-2', taskTitle: 'Next', status: 'TRACKING' as const,
        elapsedSeconds: 5, isAdHoc: false
      };

      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        renderer.dispose();
        vi.useRealTimers();
      });

      it('RenderTaskCompletionConfetti_Triggered_PlaysOurSceneOnce', () => {
        const play = vi.spyOn(player(), 'play').mockResolvedValue(undefined);

        renderer.renderTaskCompletionConfetti();

        expect(play).toHaveBeenCalledWith(FRONT_ANIMATIONS.TASK_DONE, expect.objectContaining({ loop: false }));
      });

      it('RenderTaskCompletionConfetti_DurationElapses_ReturnsToTheSession', () => {
        vi.spyOn(player(), 'play').mockResolvedValue(undefined);
        const stop = vi.spyOn(player(), 'stop');
        const paused = { ...tracking, status: 'PAUSED' as const };
        renderer.renderActiveSession(paused as never);

        renderer.renderTaskCompletionConfetti(2);
        // While celebrating, a session update is held rather than drawn over
        // the scene.
        const heldLed = renderer.renderActiveSession(paused as never).ledColorHex;
        expect(heldLed).toBe('#10B981FF');

        vi.advanceTimersByTime(2000);

        expect(stop).toHaveBeenCalled();
        expect(renderer.renderActiveSession(paused as never).ledColorHex).toBe('#F59E0BFF');
      });

      it('RenderActiveSession_NewTaskStartsMidCelebration_StopsTheScene', () => {
        // The device owns the front while the scene plays and transmitFrame
        // stands aside; left running, the new task would not reach the bar.
        vi.spyOn(player(), 'play').mockResolvedValue(undefined);
        const stop = vi.spyOn(player(), 'stop');
        renderer.renderTaskCompletionConfetti();

        renderer.renderActiveSession(tracking as never);

        expect(stop).toHaveBeenCalled();
        const stops = stop.mock.calls.length;
        vi.advanceTimersByTime(TASK_DONE_DISPLAY_SECONDS * 1000);
        // The cancelled timer does not fire a second return to the session.
        expect(stop).toHaveBeenCalledTimes(stops);
      });
    });
  });

  describe('baking & exceptions rendering', () => {
    it('RenderBuilding_ValidProject_DispatchesBuildingPayload', () => {
      const payload = renderer.renderBuilding('ProjectX', 45);
      expect(payload.ledColorHex).toBe('#3B82F6FF');
      expect(mockDriver.sendPixelFrame).toHaveBeenCalled();
      expect(payload.backElements.some((e: Record<string, unknown>) => (e.text as string)?.includes('Building ProjectX (45%)'))).toBe(true);
    });

    it('RenderBaking_ValidProject_DispatchesBakingPayload', () => {
      const payload = renderer.renderBaking('ProjectX', 45);
      expect(payload.ledColorHex).toBe('#FBBF24FF');
      expect(mockDriver.sendPixelFrame).toHaveBeenCalled();
      expect(payload.backElements.some((e: Record<string, unknown>) => (e.text as string)?.includes('Baking ProjectX (45%)'))).toBe(true);
    });

    it('RenderException_ValidError_DispatchesExceptionPayload', () => {
      const payload = renderer.renderException('ProjectY', 'Syntax Error');
      expect(payload.ledColorHex).toBe('#EF4444FF');
      expect(mockDriver.sendPixelFrame).toHaveBeenCalled();
      expect(payload.backElements.some((e: Record<string, unknown>) => (e.text as string)?.includes('EXCEPTION: ProjectY'))).toBe(true);
    });
  });

  /**
   * The static icon stays in the frame; an animated one is laid over it. What
   * matters to the renderer is which icon each screen asks for, and that a
   * screen asking for none takes the previous one away -- otherwise the gear
   * keeps turning over the next screen's text.
   */
  describe('animated icons', () => {
    let iconAnimator: { show: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      iconAnimator = { show: vi.fn(), reset: vi.fn(), dispose: vi.fn() };
      renderer = new DisplayRenderer(mockDriver, undefined, { iconAnimator: iconAnimator as unknown as IconAnimator });
    });

    const lastShown = (): unknown => iconAnimator.show.mock.calls[iconAnimator.show.mock.calls.length - 1][0];

    it('RenderCompilation_Always_AsksForTheTurningGear', () => {
      renderer.renderCompilation('ProjectX');

      expect(lastShown()).toBe(ANIMATED_ICONS.compiling);
      expect(lastShown()).toBe('icon_gear_16x16');
    });

    it('RenderActiveSession_AfterCompilation_TakesTheGearAway', () => {
      renderer.renderCompilation('ProjectX');
      renderer.renderActiveSession(null);

      expect(lastShown()).toBeNull();
    });

    it.each([
      ['Unity Play Mode', (r: DisplayRenderer) => r.renderPlayMode('P'), 'icon_playmode_16x16'],
      ['Unity exception', (r: DisplayRenderer) => r.renderException('P', 'NullReferenceException'), 'icon_warning_16x16'],
      ['Unity build', (r: DisplayRenderer) => r.renderBuilding('P', 40), 'icon_hammer_16x16'],
      ['Unity bake', (r: DisplayRenderer) => r.renderBaking('P', 40), 'icon_bulb_16x16'],
      ['end-of-day prompt', (r: DisplayRenderer) => r.renderCeremonyPrompt('EOD', 'Wrap up'), 'icon_clock_16x16'],
      ['lunch prompt', (r: DisplayRenderer) => r.renderCeremonyPrompt('LUNCH', 'Lunch'), 'icon_burger_16x16'],
      ['Day Complete', (r: DisplayRenderer) => r.renderEodCompleted(), 'icon_check_16x16'],
      ['notification without an app icon', (r: DisplayRenderer) => r.renderNotificationBanner({ title: 'T', body: 'B', iconId: 'bell' }), 'icon_bell_16x16'],
      ['OpenProject notification', (r: DisplayRenderer) => r.renderNotificationBanner({ appName: 'OpenProject', title: 'T', body: 'B', iconId: 'openproject' }), 'icon_openproject_16x16']
    ])('Render_%s_AsksForItsAnimatedIcon', (_screen, render, expected) => {
      render(renderer);

      expect(lastShown()).toBe(expected);
    });

    it('RenderNotificationBanner_ResolvedAppIcon_KeepsTheAppsMarkStill', () => {
      const appIcon = Array.from({ length: 16 }, () => Array(16).fill('#FF0000'));
      renderer.renderNotificationBanner({ title: 'T', body: 'B', iconId: 'bell', customIconData: appIcon });

      expect(lastShown()).toBeNull();
    });

    it('RenderNotificationBanner_OtherBrandBitmap_KeepsItStill', () => {
      renderer.renderNotificationBanner({ title: 'T', body: 'B', iconId: 'slack' });

      expect(lastShown()).toBeNull();
    });

    it('RenderActiveSession_Tracking_AsksForTheTickingStopwatch', () => {
      // Still, it read as nothing happening. The hand ticking is the device's
      // work, so the frame itself still changes once a minute.
      renderer.renderEodCompleted();
      renderer.renderActiveSession({
        taskId: 'T-1',
        taskKey: 'T-1',
        taskTitle: 'Write the tests',
        status: 'TRACKING',
        elapsedSeconds: 60,
        startedAtUtc: new Date().toISOString()
      });

      expect(lastShown()).toBe('icon_stopwatch_16x16');
    });

    it('RenderActiveSession_Paused_AsksForTheBlinkingPauseStopwatch', () => {
      renderer.renderActiveSession({
        taskId: 'T-1', taskKey: 'T-1', taskTitle: 'Write the tests', status: 'PAUSED',
        elapsedSeconds: 60, startedAtUtc: new Date().toISOString()
      });

      expect(lastShown()).toBe('icon_stopwatch_paused_16x16');
    });

    it.each([
      ['tracking', 'TRACKING', STOPWATCH_16X16_BITMAP],
      ['paused', 'PAUSED', STOPWATCH_PAUSED_16X16_BITMAP],
      ['idle', null, STOPWATCH_IDLE_16X16_BITMAP]
    ] as const)('RenderActiveSession_%s_DrawsItsOwnStopwatch', (_state, status, expected) => {
      // Tracking, paused, idle and Day Complete all used to show the same
      // checkmark, so the bar could not say whether work was running.
      renderer.renderActiveSession(status ? {
        taskId: 'T-1', taskKey: 'T-1', taskTitle: 'Write the tests', status,
        elapsedSeconds: 60, startedAtUtc: new Date().toISOString()
      } : null);
      const pixels = (renderer as unknown as { canvas: { getPixels(): (string | null)[][] } }).canvas.getPixels();

      expect(pixels.slice(0, 16).map(row => row.slice(0, 16))).toEqual(expected.map(row => [...row]));
    });

    describe('the running timer', () => {
      const tracking = (elapsedSeconds: number) => ({
        taskId: 'T-1', taskKey: 'SPR-9', taskTitle: 'Tests', status: 'TRACKING' as const,
        elapsedSeconds, startedAtUtc: new Date().toISOString()
      });
      const pixels = (): (string | null)[][] =>
        (renderer as unknown as { canvas: { getPixels(): (string | null)[][] } }).canvas.getPixels();
      /** The rows and columns holding ink right of the icon, below row 0. */
      const timerInk = (): { rows: number[]; columns: number[] } => {
        const rows = new Set<number>();
        const columns = new Set<number>();
        pixels().forEach((row, y) => row.forEach((c, x) => {
          if (y >= 8 && x >= 17 && c) { rows.add(y); columns.add(x); }
        }));
        return { rows: [...rows].sort((a, b) => a - b), columns: [...columns].sort((a, b) => a - b) };
      };

      it('RenderActiveSession_Tracking_DrawsTheTimerSevenPixelsTall', () => {
        // The condensed row-1 face was 5px; the timer is read from across a room.
        renderer.renderActiveSession(tracking(5025));

        expect(timerInk().rows).toEqual([8, 9, 10, 11, 12, 13, 14]);
      });

      it('RenderActiveSession_Tracking_DrawsHoursAndMinutesInTheTimerFont', () => {
        const drawn = vi.spyOn(
          (renderer as unknown as { canvas: { drawTextClipped: (...args: unknown[]) => void } }).canvas,
          'drawTextClipped'
        );
        renderer.renderActiveSession(tracking(5025));

        const timer = drawn.mock.calls.find(([text]) => text === '01:23');
        expect(timer?.[5]).toBe(TIMER_FONT);
        // Four 6px digits, a 2px colon and four 1px gaps: the ink is 30px.
        const { columns } = timerInk();
        expect(columns[columns.length - 1] - columns[0] + 1).toBe(30);
      });

      it('RenderActiveSession_TimeChanges_KeepsTheTimerInPlace', () => {
        // Digits share one width, so the colon does not walk as minutes turn.
        renderer.renderActiveSession(tracking(60));
        const narrow = timerInk().columns;
        renderer.renderActiveSession(tracking(8 * 3600 + 48 * 60));
        const wide = timerInk().columns;

        expect([narrow[0], narrow[narrow.length - 1]]).toEqual([wide[0], wide[wide.length - 1]]);
      });

      it('RenderActiveSession_Idle_KeepsTheStatusLineInTheRowFont', () => {
        // Bold 7 has no lowercase; "No task running" belongs in row 1's face.
        const drawn = vi.spyOn(
          (renderer as unknown as { canvas: { drawTextClipped: (...args: unknown[]) => void } }).canvas,
          'drawTextClipped'
        );
        renderer.renderActiveSession(null);

        expect(drawn.mock.calls.find(([text]) => text === 'No task running')?.[5]).toBe(ROW1_FONT);
      });
    });

    it('RenderActiveSession_Paused_ShowsTheWholeTaskKey', () => {
      // STOP and FINISH used to sit in a column beside a 26px title, which cut
      // "KEY: title" to "SPR-..." and could not fit even the key.
      const drawn = vi.spyOn(
        (renderer as unknown as { canvas: { drawTextClipped: (...args: unknown[]) => void } }).canvas,
        'drawTextClipped'
      );
      renderer.renderActiveSession({
        taskId: 'T-1', taskKey: 'SPR-1428', taskTitle: 'A long task title', status: 'PAUSED',
        elapsedSeconds: 5025, startedAtUtc: new Date().toISOString()
      });

      const keyCall = drawn.mock.calls.find(([text]) => text === 'SPR-1428');
      expect(keyCall).toBeDefined();
      expect(keyCall?.[4] as number).toBeGreaterThanOrEqual(measureText('SPR-1428', ROW0_FONT));
    });

    it('RenderBuilding_Always_DrawsOurHammerRatherThanTheUnityLogo', () => {
      renderer.renderBuilding('P', 40);
      const pixels = (renderer as unknown as { canvas: { getPixels(): (string | null)[][] } }).canvas.getPixels();
      const icon = pixels.slice(0, 16).map(row => row.slice(0, 16));

      expect(icon).toEqual(HAMMER_16X16_BITMAP.map(row => row.map(c => c)));
    });

    it('RenderCompilation_WhileAFullPanelAnimationPlays_AsksForNone', () => {
      // The device owns the whole panel then; an icon drawn over it would sit
      // on top of the lunch sandwich.
      vi.spyOn(
        (renderer as unknown as { animationPlayer: AnimationPlayer }).animationPlayer,
        'isHardwareAnimationActive'
      ).mockReturnValue(true);

      renderer.renderCompilation('ProjectX');

      expect(lastShown()).toBeNull();
    });

    it('InvalidateFrameCache_Always_ForgetsWhatTheDeviceHolds', () => {
      renderer.invalidateFrameCache();

      expect(iconAnimator.reset).toHaveBeenCalled();
    });

    it('Dispose_Always_StopsTheIconPreview', () => {
      renderer.dispose();

      expect(iconAnimator.dispose).toHaveBeenCalled();
    });

    it('RenderCompilation_EmulatorWatching_OverlaysTheIconFrameOnTheScreen', async () => {
      // A real IconAnimator reading the real exported gear, so the preview
      // path is exercised end to end rather than through a stub.
      renderer = new DisplayRenderer(mockDriver, undefined, {
        animationsDir: path.resolve(__dirname, '../../../Animations')
      });
      const states: HardwareDisplayStateDTO[] = [];
      renderer.onStateChanged(state => states.push({ ...state, frontElements: [...state.frontElements] }));

      renderer.renderCompilation('ProjectX');
      const deadline = Date.now() + 2000;
      const hasOverlay = (): boolean =>
        states.some(s => s.frontElements.some(el => el.id === 'icon_anim_preview' && el.x === 0 && el.y === 0));
      while (!hasOverlay() && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(hasOverlay()).toBe(true);

      renderer.renderActiveSession(null);
      const last = states[states.length - 1];
      expect(last.frontElements.some(el => el.id === 'icon_anim_preview')).toBe(false);
      renderer.dispose();
    });
  });

  describe('rear OLED modes', () => {
    it('SetRearOledMode_PerformanceMonitor_RendersPerformanceElements', () => {
      renderer.setRearOledMode('PERFORMANCE_MONITOR');
      const payload = renderer.renderActiveSession(null);
      expect(payload.backElements.some((e: Record<string, unknown>) => (e.text as string)?.includes('SYSTEM PERFORMANCE MONITOR'))).toBe(true);
    });

    it('SetRearOledMode_StealthClock_RendersClockElements', () => {
      renderer.setRearOledMode('STEALTH_CLOCK');
      const payload = renderer.renderActiveSession(null);
      expect(payload.backElements.some((e: Record<string, unknown>) => (e.text as string)?.includes('STEALTH'))).toBe(true);
    });
  });

  /**
   * The device schema declares `elements` as required with minItems: 1, so an
   * empty array is not "draw nothing" -- it is a validation failure, and the
   * hardware contract is that a rejected draw takes the whole frame with it.
   *
   * The idle path used to post one, believing it turned the status LED off.
   * led_notification_color only ever *starts* a blink, so there was nothing to
   * turn off; the DELETE beside it was already doing the work. Every idle
   * transition logged a 400 and nothing noticed, because the payload it failed
   * to deliver was empty anyway.
   */
  describe('draw payload validity', () => {
    it('RenderActiveSession_IdleWithClockFallback_ClearsViaDeleteWithoutAnEmptyDraw', () => {
      renderer.setShowIdleClockFallback(true);

      renderer.renderActiveSession(null);

      expect(mockDriver.clearDisplay).toHaveBeenCalled();
      const draws = vi.mocked(mockDriver.sendDisplayPayload).mock.calls;
      for (const [payload] of draws) {
        expect((payload as { elements?: unknown[] }).elements ?? []).not.toHaveLength(0);
      }
    });

    it('SendDisplayPayload_AnyRenderPath_NeverCarriesAnEmptyElementsArray', () => {
      const session = {
        taskId: 'PROJ-1',
        taskKey: 'PROJ-1',
        taskTitle: 'Something',
        status: 'TRACKING' as const,
        elapsedSeconds: 60,
        isAdHoc: false
      };

      renderer.setShowIdleClockFallback(true);
      renderer.renderActiveSession(session as never);
      renderer.renderActiveSession(null);
      renderer.renderIdle();
      renderer.renderTaskCompletionConfetti();

      const draws = vi.mocked(mockDriver.sendDisplayPayload).mock.calls;
      const empties = draws.filter(
        ([p]) => Array.isArray((p as { elements?: unknown[] }).elements) &&
                 (p as { elements: unknown[] }).elements.length === 0
      );

      expect(empties).toHaveLength(0);
    });
  });

  describe('state broadcasting', () => {
    it('OnStateChanged_CallbackRegistered_NotifiesOnStateUpdate', () => {
      const listener = vi.fn();
      const unsubscribe = renderer.onStateChanged(listener);

      renderer.renderTaskCompletionConfetti();
      expect(listener).toHaveBeenCalled();

      unsubscribe();
    });
  });

  /**
   * The hardware task selector. It used to be bare text: nothing said whether
   * the wheel was choosing a project or a task, how long the list was, or
   * whether turning it further would find anything.
   */
  describe('task selection screen', () => {
    const THUMB_BLUE = '#3B82F6';
    const TRACK = '#1E293B';
    const pixels = (): (string | null)[][] =>
      (renderer as unknown as { canvas: { getPixels(): (string | null)[][] } }).canvas.getPixels();
    /** The scroll bar under the rows: where its thumb is, and whether it is there at all. */
    const scrollBar = (): { thumbStart: number; thumbEnd: number; trackPixels: number } => {
      const row = pixels()[15];
      const thumb = row.map((c, x) => (x >= 17 && c?.toUpperCase() === THUMB_BLUE ? x : -1)).filter(x => x >= 0);
      const trackPixels = row.filter((c, x) => x >= 17 && c?.toUpperCase() === TRACK).length;
      return { thumbStart: thumb[0] ?? -1, thumbEnd: thumb[thumb.length - 1] ?? -1, trackPixels };
    };
    const textCalls = (): unknown[][] => {
      const canvas = (renderer as unknown as { canvas: { drawTextClipped: (...args: unknown[]) => void } }).canvas;
      return vi.spyOn(canvas, 'drawTextClipped').mock.calls;
    };

    it.each([
      ['PROJECT', FOLDER_16X16_BITMAP],
      ['TASK', TASK_16X16_BITMAP]
    ] as const)('RenderTaskSelection_%s_DrawsItsOwnIcon', (stage, expected) => {
      renderer.renderTaskSelection(stage, 'Alpha', { description: 'ALPHA-1', position: { index: 0, count: 3 } });

      expect(pixels().slice(0, 16).map(row => row.slice(0, 16))).toEqual(expected.map(row => [...row]));
    });

    it.each([
      ['todo', TASK_16X16_BITMAP],
      ['in_progress', TASK_IN_PROGRESS_16X16_BITMAP],
      ['done', TASK_DONE_16X16_BITMAP]
    ] as const)('RenderTaskSelection_TaskThatIs_%s_ShowsItsStatusCard', (status, expected) => {
      renderer.renderTaskSelection('TASK', 'Alpha', { description: 'A-1', position: { index: 0, count: 2 }, status });

      expect(pixels().slice(0, 16).map(row => row.slice(0, 16))).toEqual(expected.map(row => [...row]));
    });

    it('RenderTaskSelection_StatusCards_AreAllDifferent', () => {
      const cards = [TASK_16X16_BITMAP, TASK_IN_PROGRESS_16X16_BITMAP, TASK_DONE_16X16_BITMAP].map(b => JSON.stringify(b));
      expect(new Set(cards).size).toBe(3);
    });

    it.each([
      ['done', '#CBD5E1'],
      ['todo', '#FFFFFF'],
      ['in_progress', '#FFFFFF']
    ] as const)('RenderTaskSelection_TaskThatIs_%s_DrawsTheNameIn_%s', (status, color) => {
      const calls = textCalls();
      renderer.renderTaskSelection('TASK', 'Alpha', { description: 'A-1', position: { index: 0, count: 2 }, status });

      expect(calls.find(([text]) => text === 'Alpha')?.[3]).toBe(color);
    });

    it('RenderTaskSelection_Project_IgnoresAStatus', () => {
      renderer.renderTaskSelection('PROJECT', 'Alpha', { position: { index: 0, count: 2 }, status: 'done' });

      expect(pixels().slice(0, 16).map(row => row.slice(0, 16))).toEqual(FOLDER_16X16_BITMAP.map(row => [...row]));
    });

    it('RenderTaskSelection_FirstOfSeveral_PutsTheThumbAtTheLeft', () => {
      renderer.renderTaskSelection('PROJECT', 'Alpha', { position: { index: 0, count: 3 } });

      expect(scrollBar().thumbStart).toBe(17);
      expect(scrollBar().thumbEnd).toBeLessThan(71);
    });

    it('RenderTaskSelection_LastOfSeveral_PutsTheThumbAtTheRight', () => {
      renderer.renderTaskSelection('PROJECT', 'Gamma', { position: { index: 2, count: 3 } });

      expect(scrollBar().thumbEnd).toBe(71);
      expect(scrollBar().thumbStart).toBeGreaterThan(17);
    });

    it('RenderTaskSelection_ScrollingDown_MovesTheThumbRight', () => {
      const starts: number[] = [];
      for (let index = 0; index < 12; index++) {
        renderer.renderTaskSelection('TASK', 'Task', { description: 'K-1', position: { index, count: 12 } });
        starts.push(scrollBar().thumbStart);
      }

      for (let i = 1; i < starts.length; i++) expect(starts[i]).toBeGreaterThan(starts[i - 1]);
    });

    it('RenderTaskSelection_LongList_KeepsTheThumbVisible', () => {
      // 55px over 200 items rounds to nothing; a one-pixel thumb reads as a
      // stray LED.
      renderer.renderTaskSelection('TASK', 'Task', { description: 'K-1', position: { index: 100, count: 200 } });

      const { thumbStart, thumbEnd } = scrollBar();
      expect(thumbEnd - thumbStart + 1).toBeGreaterThanOrEqual(3);
    });

    it('RenderTaskSelection_OnlyItem_HasNoScrollBar', () => {
      renderer.renderTaskSelection('PROJECT', 'Alpha', { position: { index: 0, count: 1 } });

      expect(scrollBar()).toEqual({ thumbStart: -1, thumbEnd: -1, trackPixels: 0 });
    });

    it('RenderTaskSelection_NoPosition_DrawsNeitherNumberNorBar', () => {
      const calls = textCalls();
      renderer.renderTaskSelection('TASK', 'No Tasks');

      expect(scrollBar()).toEqual({ thumbStart: -1, thumbEnd: -1, trackPixels: 0 });
      expect(calls.some(([text]) => typeof text === 'string' && text.includes('/'))).toBe(false);
    });

    it('RenderTaskSelection_Position_CountsFromOne', () => {
      const calls = textCalls();
      renderer.renderTaskSelection('TASK', 'Write it', { description: 'ALPHA-3', position: { index: 2, count: 12 } });

      expect(calls.some(([text]) => text === '3/12')).toBe(true);
    });

    it('RenderTaskSelection_Position_EndsAtTheRightEdge', () => {
      const calls = textCalls();
      renderer.renderTaskSelection('TASK', 'Write it', { description: 'ALPHA-3', position: { index: 9, count: 12 } });

      const position = calls.find(([text]) => text === '10/12');
      expect((position?.[1] as number) + measureText('10/12', ROW1_FONT)).toBe(72);
    });

    it('RenderTaskSelection_FourDigitKeyAtTheEndOfALongList_ShowsTheWholeKey', () => {
      // With arrows beside the number, SPR-1428 was cut to "SPR-...".
      const calls = textCalls();
      renderer.renderTaskSelection('TASK', 'Write the tests', { description: 'SPR-1428', position: { index: 11, count: 12 } });

      const key = calls.find(([text]) => text === 'SPR-1428');
      expect(key?.[4] as number).toBeGreaterThanOrEqual(measureText('SPR-1428', ROW1_FONT));
    });

    it('RenderTaskSelection_LongKey_StopsShortOfTheNumber', () => {
      const calls = textCalls();
      renderer.renderTaskSelection('TASK', 'Write it', { description: 'VERYLONGPROJECT-12345', position: { index: 4, count: 12 } });

      const label = calls.find(([text]) => text === 'VERYLONGPROJECT-12345');
      const position = calls.find(([text]) => text === '5/12');
      expect((label?.[1] as number) + (label?.[4] as number)).toBeLessThan(position?.[1] as number);
    });

    it('RenderTaskSelection_ProjectStep_SaysSoOnRowOne', () => {
      const calls = textCalls();
      renderer.renderTaskSelection('PROJECT', 'Alpha', { position: { index: 0, count: 2 } });

      expect(calls.some(([text, , , , , font]) => text === 'Project' && font === ROW1_FONT)).toBe(true);
    });

    it.each([
      ['IndexPastTheEnd', { index: 3, count: 3 }],
      ['NegativeIndex', { index: -1, count: 3 }],
      ['EmptyList', { index: 0, count: 0 }],
      ['FractionalIndex', { index: 0.5, count: 3 }]
    ])('RenderTaskSelection_%s_ThrowsArgumentException', (_case, position) => {
      expect(() => renderer.renderTaskSelection('PROJECT', 'Alpha', { position: position })).toThrow(ArgumentException);
    });
  });
});
