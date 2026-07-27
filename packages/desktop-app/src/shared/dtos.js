/**
 * Data Transfer Objects (DTOs) for IPC bridge and Local Fastify Webhook endpoints.
 */
/**
 * Validation helpers for incoming API payloads
 */
export class DTOValidator {
    static isValidCompileStart(data) {
        if (typeof data !== 'object' || data === null)
            return false;
        const obj = data;
        return (typeof obj.project === 'string' &&
            typeof obj.unityVersion === 'string' &&
            typeof obj.timestampUtc === 'string');
    }
    static isValidCompileFinish(data) {
        if (typeof data !== 'object' || data === null)
            return false;
        const obj = data;
        return (typeof obj.project === 'string' &&
            typeof obj.success === 'boolean' &&
            typeof obj.elapsedSeconds === 'number' &&
            typeof obj.errorCount === 'number' &&
            typeof obj.warningCount === 'number');
    }
    static isValidPlayMode(data) {
        if (typeof data !== 'object' || data === null)
            return false;
        const obj = data;
        return (typeof obj.project === 'string' &&
            (obj.state === 'EnteredPlayMode' || obj.state === 'ExitedPlayMode'));
    }
    static isValidException(data) {
        if (typeof data !== 'object' || data === null)
            return false;
        const obj = data;
        return (typeof obj.project === 'string' &&
            typeof obj.exceptionType === 'string' &&
            typeof obj.message === 'string' &&
            typeof obj.stackTrace === 'string');
    }
}
//# sourceMappingURL=dtos.js.map