import { describe, it, expect, beforeEach } from 'vitest';
import { WidgetRegistry } from '../src/main/widgets/widget-registry';

describe('WidgetRegistry & Carousel Unit Tests', () => {
  let registry: WidgetRegistry;

  beforeEach(() => {
    registry = new WidgetRegistry();
  });

  describe('constructor & registration', () => {
    it('Constructor_DefaultWidgets_Registers4DefaultWidgets', () => {
      const active = registry.getActiveWidget();
      expect(active).toBeDefined();
      expect(active?.id).toBe('task_tracker');
    });

    it('RegisterWidget_NullWidget_ThrowsError', () => {
      expect(() => registry.registerWidget(null as unknown as any)).toThrow();
    });
  });

  describe('carousel cycling', () => {
    it('CycleNextWidget_SuccessiveCalls_CyclesThroughAllWidgets', () => {
      const first = registry.getActiveWidget()?.id;
      expect(first).toBe('task_tracker');

      const second = registry.cycleNextWidget()?.id;
      expect(second).toBe('standup_stopwatch');

      const third = registry.cycleNextWidget()?.id;
      expect(third).toBe('unity_build');

      const fourth = registry.cycleNextWidget()?.id;
      expect(fourth).toBe('notification_counter');

      const cycledBack = registry.cycleNextWidget()?.id;
      expect(cycledBack).toBe('task_tracker');
    });
  });

  describe('widget rendering & input handling', () => {
    it('RenderActiveWidget_ValidContext_ReturnsWidgetDisplayPayload', () => {
      const context = { activeSession: null, deviceConnected: true, ipAddress: '10.0.4.20' };

      // Render 1: task_tracker
      const p1 = registry.renderActiveWidget(context);
      expect(p1).toBeDefined();
      expect(registry.handleInput({ key: 'ok', type: 'press', timestamp: '' })).toBe(false);

      // Render 2: standup_stopwatch
      registry.cycleNextWidget();
      const p2 = registry.renderActiveWidget(context);
      expect(p2).toBeDefined();
      expect(registry.handleInput({ key: 'ok', type: 'press', timestamp: '' })).toBe(false);

      // Render 3: unity_build
      registry.cycleNextWidget();
      const p3 = registry.renderActiveWidget(context);
      expect(p3).toBeDefined();
      expect(registry.handleInput({ key: 'ok', type: 'press', timestamp: '' })).toBe(false);

      // Render 4: notification_counter
      registry.cycleNextWidget();
      const p4 = registry.renderActiveWidget(context);
      expect(p4).toBeDefined();
      expect(registry.handleInput({ key: 'ok', type: 'press', timestamp: '' })).toBe(false);
    });
  });
});
