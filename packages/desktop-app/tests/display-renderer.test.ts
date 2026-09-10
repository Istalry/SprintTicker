import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';
import { PriorityPreemptionEngine } from '../src/main/services/priority-preemption-engine';
import { SettingsRepository } from '../src/main/db/repositories/settings-repository';

describe('DisplayRenderer Unit Tests', () => {
  let mockDriver: BusyBarDriver;
  let renderer: DisplayRenderer;

  beforeEach(() => {
    mockDriver = {
      sendDisplayPayload: vi.fn().mockResolvedValue(true),
      sendPixelFrame: vi.fn().mockResolvedValue(true),
      clearDisplay: vi.fn().mockResolvedValue(true),
      uploadAsset: vi.fn().mockResolvedValue(true),
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
