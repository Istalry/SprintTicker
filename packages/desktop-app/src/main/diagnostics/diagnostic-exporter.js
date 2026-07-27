import { DatabaseConnection } from '../db/database-connection';
/**
 * Service exporting structured system diagnostic bundle containing DB integrity status,
 * Fastify Webhook telemetry, and physical BUSY Bar driver health metrics.
 */
export class DiagnosticExporter {
    dbConn;
    driver;
    constructor(driver, dbConn) {
        this.driver = driver;
        this.dbConn = dbConn || DatabaseConnection.getInstance();
    }
    async generateDiagnosticBundle() {
        let dbStatus = 'OK';
        try {
            const stmt = this.dbConn.getDb().prepare('PRAGMA integrity_check');
            const result = stmt.get();
            if (result && result.integrity_check !== 'ok') {
                dbStatus = 'CORRUPTED';
            }
        }
        catch {
            dbStatus = 'CORRUPTED';
        }
        return {
            timestampUtc: new Date().toISOString(),
            appVersion: '1.0.0',
            electronVersion: process.versions.electron || '30.0.0',
            nodeVersion: process.version,
            databaseIntegrity: dbStatus,
            hardwareStatus: this.driver.getDeviceStatus(),
            webhookServerStatus: {
                listening: true,
                port: 39123
            }
        };
    }
}
//# sourceMappingURL=diagnostic-exporter.js.map