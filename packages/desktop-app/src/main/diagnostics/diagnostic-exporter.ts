import { app } from 'electron';
import { DatabaseConnection } from '../db/database-connection';
import { BusyBarDriver } from '../hardware/busybar-driver';
import { LoggerInterceptor } from './logger-interceptor';

export interface DiagnosticBundle {
  timestampUtc: string;
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  databaseIntegrity: 'OK' | 'CORRUPTED';
  hardwareStatus: Record<string, unknown>;
  /** `port` is null when no webhook server was wired in, i.e. the state is unknown. */
  webhookServerStatus: { listening: boolean; port: number | null };
  applicationLogs: string[];
}

/** What the exporter needs to report a fact instead of asserting one. */
export interface DiagnosticSources {
  /** The running application's version. Defaults to Electron's `app.getVersion()`. */
  appVersion?: () => string;
  /** The live webhook listener state. Omitted when no server was wired in. */
  webhookStatus?: () => { listening: boolean; port: number };
}

/**
 * Service exporting structured system diagnostic bundle containing DB integrity status,
 * webhook telemetry, and physical BUSY Bar driver health metrics.
 *
 * **Every field here has to be measured, not assumed.** This bundle is what a
 * user attaches to a bug report, so a value invented by the exporter sends
 * whoever reads it after the wrong problem. Three fields used to be invented:
 * `appVersion` was the literal `'1.0.0'` (wrong from the 1.1.0 release
 * onwards), `electronVersion` fell back to `'30.0.0'` for a build running
 * Electron 44, and `webhookServerStatus.listening` was hardcoded `true` —
 * asserting the server was up in exactly the bundle a user sends when it is
 * not. Anything that cannot be determined is now reported as unknown, which is
 * a fact; a confident wrong answer is not.
 */
export class DiagnosticExporter {
  private dbConn: DatabaseConnection;
  private driver: BusyBarDriver;
  private sources: DiagnosticSources;

  constructor(driver: BusyBarDriver, dbConn?: DatabaseConnection, sources: DiagnosticSources = {}) {
    this.driver = driver;
    this.dbConn = dbConn || DatabaseConnection.getInstance();
    this.sources = sources;
  }

  /**
   * The running version, from Electron when it is there.
   *
   * `app` is unavailable outside an Electron main process -- a test, or a
   * script -- so this degrades to `'unknown'` rather than throwing and taking
   * the whole bundle down with it. Reporting the version as unknown is honest;
   * reporting a hardcoded one is not.
   */
  private resolveAppVersion(): string {
    if (this.sources.appVersion) return this.sources.appVersion();
    try {
      return app?.getVersion?.() ?? 'unknown';
    } catch {
      return 'unknown';
    }
  }

  public async generateDiagnosticBundle(): Promise<DiagnosticBundle> {
    let dbStatus: 'OK' | 'CORRUPTED' = 'OK';
    try {
      const stmt = this.dbConn.getDb().prepare('PRAGMA integrity_check');
      const result = stmt.get() as { integrity_check?: string };
      if (result && result.integrity_check !== 'ok') {
        dbStatus = 'CORRUPTED';
      }
    } catch {
      dbStatus = 'CORRUPTED';
    }

    return {
      timestampUtc: new Date().toISOString(),
      appVersion: this.resolveAppVersion(),
      // No fallback version. Outside Electron this is genuinely absent, and
      // naming a release that is not running is worse than saying so.
      electronVersion: process.versions.electron || 'not running under Electron',
      nodeVersion: process.version,
      databaseIntegrity: dbStatus,
      hardwareStatus: this.driver.getDeviceStatus() as unknown as Record<string, unknown>,
      webhookServerStatus: this.sources.webhookStatus?.() ?? { listening: false, port: null },
      applicationLogs: LoggerInterceptor.getInstance().getLogs()
    };
  }
}
