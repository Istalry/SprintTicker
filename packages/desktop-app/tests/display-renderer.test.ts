import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DisplayRenderer } from '../src/main/hardware/display-renderer';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';

describe('DisplayRenderer Unit Tests', () => {
  let mockDriver: BusyBarDriver;
  let renderer: DisplayRenderer;

  beforeEach(() => {
    mockDriver = {
      sendDisplayPayload: vi.fn(),
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
      expect(mockDriver.sendDisplayPayload).toHaveBeenCalled();
    });

    it('SetColorTheme_ValidTheme_UpdatesPaletteColors', () => {
      renderer.setColorTheme('cyberpunk');
      const payload = renderer.renderActiveSession(null);
      expect(payload).toBeDefined();
    });
  });

  describe('notification & confetti rendering', () => {
    it('RenderNotificationBanner_ValidMessage_DispatchesAlertPayload', () => {
      const payload = renderer.renderNotificationBanner('Alice', 'SLACK', 40, 'slack');
      expect(payload.ledColorHex).toBe('#8B5CF6FF');
      expect(mockDriver.sendDisplayPayload).toHaveBeenCalled();
    });

    it('RenderTaskCompletionConfetti_Triggered_DispatchesConfettiPayload', () => {
      const payload = renderer.renderTaskCompletionConfetti();
      expect(payload.ledColorHex).toBe('#10B981FF');
      expect(mockDriver.sendDisplayPayload).toHaveBeenCalled();
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
