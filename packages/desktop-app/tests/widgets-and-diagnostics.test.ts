import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserWindow } from 'electron';
import { AutoUpdateManager } from '../src/main/updater/auto-update-manager';
import { WidgetRegistry } from '../src/main/widgets/widget-registry';
import { PomodoroWidget } from '../src/main/widgets/pomodoro-widget';
import { BuildMonitorWidget } from '../src/main/widgets/build-monitor-widget';
import { TextTickerWidget } from '../src/main/widgets/text-ticker-widget';
import { DiagnosticExporter } from '../src/main/diagnostics/diagnostic-exporter';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';

describe('Phase 6 Widgets, Auto-Updater & Diagnostics Unit Tests', () => {
  let dbConn: DatabaseConnection;
  let driver: BusyBarDriver;

  beforeEach(async () => {
    dbConn = new DatabaseConnection(':memory:');
    driver = new BusyBarDriver('10.0.4.20', true);
    await driver.connect();
  });

  afterEach(() => {
    driver.disconnect();
    dbConn.close();
  });

  it('AutoUpdateManager_CheckForUpdates_ReturnsStatusAndBroadcastsIPC', async () => {
    const mockWindow = {
      isDestroyed: vi.fn().mockReturnValue(false),
      webContents: { send: vi.fn() }
    } as unknown as BrowserWindow;

    const updater = new AutoUpdateManager(() => mockWindow);
    updater.initialize('stable');
    updater.setChannel('beta');

    const status = await updater.checkForUpdates();
    expect(status.checking).toBe(false);
    expect(mockWindow.webContents.send).toHaveBeenCalledWith('updater:status-changed', expect.any(Object));

    updater.destroy();
  });

  it('WidgetRegistry_RegisterAndCycleWidgets_RendersAndHandlesInput', () => {
    const registry = new WidgetRegistry();
    const pomodoro = new PomodoroWidget();
    const buildMon = new BuildMonitorWidget();
    const ticker = new TextTickerWidget('Custom Marquee');

    registry.registerWidget(pomodoro);
    registry.registerWidget(buildMon);
    registry.registerWidget(ticker);

    expect(registry.getActiveWidget()?.id).toBe('task_tracker');

    // Test input handling
    registry.setActiveWidget('pomodoro');
    const handled = registry.handleInput({ key: 'ok', type: 'press', timestamp: new Date().toISOString() });
    expect(handled).toBe(true);

    // Test rendering
    const payload = registry.renderActiveWidget({ activeSession: null });
    expect(payload).not.toBeNull();
    expect(payload?.frontElements[0].text).toContain('POMODORO');

    // Test cycling
    const nextWidget = registry.cycleNextWidget();
    expect(nextWidget?.id).toBe('build-monitor');

    const buildPayload = nextWidget?.render({ activeSession: null, compilingProject: 'MyFantasyGame', compilingProgress: 80 });
    expect(buildPayload?.frontElements[0].text).toContain('MyFantasyGame');
    expect(nextWidget?.onInput({ key: 'up', type: 'press', timestamp: '' })).toBe(false);

    registry.setActiveWidget('text-ticker');
    expect(registry.getActiveWidget()?.id).toBe('text-ticker');

    const tickerPayload = registry.renderActiveWidget({ activeSession: null });
    expect(tickerPayload?.frontElements[0].text).toBe('Custom Marquee');
    expect(registry.getActiveWidget()?.onInput({ key: 'down', type: 'press', timestamp: '' })).toBe(false);
  });

  it('DiagnosticExporter_GenerateBundle_ReturnsIntegrityAndSystemTelemetry', async () => {
    const exporter = new DiagnosticExporter(driver, dbConn);
    const bundle = await exporter.generateDiagnosticBundle();

    expect(bundle.appVersion).toBe('1.0.0');
    expect(bundle.databaseIntegrity).toBe('OK');
    expect(bundle.webhookServerStatus.listening).toBe(true);
    expect(bundle.hardwareStatus.connected).toBe(true);
  });

  it('WidgetRegistry_GetActiveWidget_ReturnsInitialDefaultWidget', () => {
    const registry = new WidgetRegistry();
    expect(registry.getActiveWidget()?.id).toBe('task_tracker');
  });

  it('WidgetRegistry_CycleNextWidget_CyclesToSecondWidget', () => {
    const registry = new WidgetRegistry();
    expect(registry.cycleNextWidget()?.id).toBe('standup_stopwatch');
  });

  it('WidgetRegistry_SetActiveWidget_InvalidId_DoesNotChangeActiveWidget', () => {
    const registry = new WidgetRegistry();
    registry.setActiveWidget('non-existent-widget');
    expect(registry.getActiveWidget()?.id).toBe('task_tracker');
  });
});
