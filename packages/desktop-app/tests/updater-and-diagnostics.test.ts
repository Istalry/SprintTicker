import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserWindow } from 'electron';
import { AutoUpdateManager } from '../src/main/updater/auto-update-manager';
import { DiagnosticExporter } from '../src/main/diagnostics/diagnostic-exporter';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';

describe('Auto-Updater & Diagnostics Unit Tests', () => {
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

  it('DiagnosticExporter_GenerateBundle_ReturnsIntegrityAndSystemTelemetry', async () => {
    const exporter = new DiagnosticExporter(driver, dbConn);
    const bundle = await exporter.generateDiagnosticBundle();

    expect(bundle.appVersion).toBe('1.0.0');
    expect(bundle.databaseIntegrity).toBe('OK');
    expect(bundle.webhookServerStatus.listening).toBe(true);
    expect(bundle.hardwareStatus.connected).toBe(true);
  });

});
