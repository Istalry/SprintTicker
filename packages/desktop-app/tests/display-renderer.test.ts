import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';

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
        senderName: 'Alice',
        channelName: 'SLACK',
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
        senderName: 'Ops',
        channelName: 'SLACK',
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
        senderName: 'Ops',
        eventName: 'highNotificationPriority'
      });

      expect(evaluateRequest).toHaveBeenCalledWith(
        'highNotificationPriority',
        undefined,
        expect.any(Function)
      );
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
