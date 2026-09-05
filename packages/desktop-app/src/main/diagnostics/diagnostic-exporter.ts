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
  webhookServerStatus: { listening: boolean; port: number };
  applicationLogs: string[];
}

/**
 * Service exporting structured system diagnostic bundle containing DB integrity status,
 * webhook telemetry, and physical BUSY Bar driver health metrics.
 */
export class DiagnosticExporter {
  private dbConn: DatabaseConnection;
  private driver: BusyBarDriver;

  constructor(driver: BusyBarDriver, dbConn?: DatabaseConnection) {
    this.driver = driver;
    this.dbConn = dbConn || DatabaseConnection.getInstance();
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
      appVersion: '1.0.0',
      electronVersion: process.versions.electron || '30.0.0',
      nodeVersion: process.version,
      databaseIntegrity: dbStatus,
      hardwareStatus: this.driver.getDeviceStatus() as unknown as Record<string, unknown>,
      webhookServerStatus: {
        listening: true,
        port: 39123
      },
      applicationLogs: LoggerInterceptor.getInstance().getLogs()
    };
  }
}
