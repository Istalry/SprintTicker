import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BrowserWindow } from 'electron';
import { DiagnosticExporter } from '../src/main/diagnostics/diagnostic-exporter';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';

describe('Diagnostics Unit Tests', () => {
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

  it('DiagnosticExporter_GenerateBundle_ReturnsIntegrityAndSystemTelemetry', async () => {
    const exporter = new DiagnosticExporter(driver, dbConn);
    const bundle = await exporter.generateDiagnosticBundle();

    expect(bundle.appVersion).toBe('1.0.0');
    expect(bundle.databaseIntegrity).toBe('OK');
    expect(bundle.webhookServerStatus.listening).toBe(true);
    expect(bundle.hardwareStatus.connected).toBe(true);
  });

});
