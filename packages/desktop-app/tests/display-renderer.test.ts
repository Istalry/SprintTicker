import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { AnimationPlayer } from '../src/main/hardware/animation-player';
import { IconAnimator } from '../src/main/hardware/icon-animator';
import { ANIMATED_ICONS, FRONT_ANIMATIONS, TASK_DONE_DISPLAY_SECONDS } from '../src/shared/render-constants';
import { HAMMER_16X16_BITMAP } from '../src/shared/pixel-bitmaps';
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

    it('RenderActiveSession_Tracking_KeepsItsIconStill', () => {
      // On screen all day: a moving icon there would be a distraction.
      renderer.renderEodCompleted();
      renderer.renderActiveSession({
        taskId: 'T-1',
        taskKey: 'T-1',
        taskTitle: 'Write the tests',
        status: 'TRACKING',
        elapsedSeconds: 60,
        startedAtUtc: new Date().toISOString()
      });

      expect(lastShown()).toBeNull();
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
});
