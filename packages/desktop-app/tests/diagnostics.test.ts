import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DiagnosticExporter } from '../src/main/diagnostics/diagnostic-exporter';
import { DatabaseConnection } from '../src/main/db/database-connection';
import { BusyBarDriver } from '../src/main/hardware/busybar-driver';

describe('Diagnostics Unit Tests', () => {
  let dbConn: DatabaseConnection;
  let driver: BusyBarDriver;

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    dbConn = new DatabaseConnection(':memory:');
    driver = new BusyBarDriver('10.0.4.20', true);
    await driver.connect();
  });

  afterEach(() => {
    driver.disconnect();
    dbConn.close();
    vi.restoreAllMocks();
  });

  it('GenerateDiagnosticBundle_HealthyDatabase_ReportsIntegrityAndHardware', async () => {
    const exporter = new DiagnosticExporter(driver, dbConn);
    const bundle = await exporter.generateDiagnosticBundle();

    expect(bundle.databaseIntegrity).toBe('OK');
    expect(bundle.hardwareStatus.connected).toBe(true);
    expect(bundle.nodeVersion).toBe(process.version);
    expect(bundle.timestampUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('GenerateDiagnosticBundle_VersionSourceProvided_ReportsTheRunningVersion', async () => {
    const exporter = new DiagnosticExporter(driver, dbConn, { appVersion: () => '1.1.0' });
    const bundle = await exporter.generateDiagnosticBundle();

    // This field was the literal '1.0.0' for every release after 1.0.0, so every
    // bug report named the wrong version. The assertion that replaced it is that
    // the bundle reports what it was told, not a constant.
    expect(bundle.appVersion).toBe('1.1.0');
  });

  it('GenerateDiagnosticBundle_NoElectron_ReportsVersionsAsUnknownRatherThanInventingThem', async () => {
    const exporter = new DiagnosticExporter(driver, dbConn);
    const bundle = await exporter.generateDiagnosticBundle();

    // Under vitest there is no Electron. The old code answered '30.0.0' for a
    // build running Electron 44; saying so is the only honest option.
    expect(bundle.electronVersion).toBe('not running under Electron');
    expect(bundle.appVersion).toBe('unknown');
  });

  it('GenerateDiagnosticBundle_WebhookServerListening_ReportsItsRealPort', async () => {
    const exporter = new DiagnosticExporter(driver, dbConn, {
      webhookStatus: () => ({ listening: true, port: 39123 })
    });
    const bundle = await exporter.generateDiagnosticBundle();

    expect(bundle.webhookServerStatus).toEqual({ listening: true, port: 39123 });
  });

  it('GenerateDiagnosticBundle_WebhookServerDown_ReportsNotListening', async () => {
    const exporter = new DiagnosticExporter(driver, dbConn, {
      webhookStatus: () => ({ listening: false, port: 39123 })
    });
    const bundle = await exporter.generateDiagnosticBundle();

    // The whole point of the change: `listening` was hardcoded `true`, so the
    // bundle asserted the server was up in exactly the case a user sends one
    // because it is not.
    expect(bundle.webhookServerStatus.listening).toBe(false);
  });

  it('GenerateDiagnosticBundle_NoWebhookServerWired_ReportsUnknownRatherThanUp', async () => {
    const exporter = new DiagnosticExporter(driver, dbConn);
    const bundle = await exporter.generateDiagnosticBundle();

    expect(bundle.webhookServerStatus).toEqual({ listening: false, port: null });
  });

  it('GenerateDiagnosticBundle_IntegrityCheckReportsProblem_MarksDatabaseCorrupted', async () => {
    const failing = {
      getDb: () => ({ prepare: () => ({ get: () => ({ integrity_check: 'row 4 missing from index' }) }) })
    } as unknown as DatabaseConnection;

    const bundle = await new DiagnosticExporter(driver, failing).generateDiagnosticBundle();

    expect(bundle.databaseIntegrity).toBe('CORRUPTED');
  });

  it('GenerateDiagnosticBundle_IntegrityCheckThrows_MarksCorruptedInsteadOfFailing', async () => {
    const throwing = {
      getDb: () => {
        throw new Error('database disk image is malformed');
      }
    } as unknown as DatabaseConnection;

    // A database too broken to answer the query is the case a diagnostic bundle
    // matters most for, so the export has to survive it and say so rather than
    // throwing and producing nothing at all.
    const bundle = await new DiagnosticExporter(driver, throwing).generateDiagnosticBundle();

    expect(bundle.databaseIntegrity).toBe('CORRUPTED');
    expect(bundle.hardwareStatus.connected).toBe(true);
  });
});
