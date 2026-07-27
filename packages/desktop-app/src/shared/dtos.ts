/**
 * Data Transfer Objects (DTOs) for IPC bridge and Local Fastify Webhook endpoints.
 */

export interface ActiveSessionDTO {
  sessionId: string;
  projectId: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  isAdHoc: boolean;
  status: 'TRACKING' | 'PAUSED' | 'COMPLETED';
  startTimeUtc: string; // ISO 8601
  totalPausedSeconds: number;
  elapsedSeconds: number; // Calculated on Main process
  lastPauseStartUtc?: string;
}

export interface TaskDTO {
  id: string;
  projectId: string;
  key: string;
  title: string;
  status: 'todo' | 'in_progress' | 'done';
}

export interface ProjectDTO {
  id: string;
  name: string;
  key: string;
}

export interface HardwareBindingConfig {
  startButtonPress: string;
  wheelRotateLeft: string;
  wheelRotateRight: string;
  wheelClick: string;
  backButtonShortPress: string;
  backButtonLongPress: string;
}

export interface DeviceStatusDTO {
  connected: boolean;
  ipAddress: string;
  connectionType: 'usb' | 'wifi';
  frontBrightness: number;
  backBrightness: number;
  batteryPercent: number;
  firmwareVersion: string;
  webSocketPingMs: number;
}

export interface ScheduleSettingsDTO {
  standupTime: string; // e.g. "10:00"
  enableStandupPrompt: boolean;
  lunchStartTime: string; // e.g. "12:30"
  lunchEndTime: string; // e.g. "13:30"
  enableLunchMute: boolean;
  eodWrapUpTime: string; // e.g. "18:00"
  promptTimeoutSeconds: number; // 0 for indefinite
}

export interface PriorityRule {
  id: string;
  eventName: string;
  priority: number;
  actionOnWork: 'DISPLAY' | 'QUEUE' | 'SUPPRESS';
  actionOnLunch: 'DISPLAY' | 'QUEUE' | 'SUPPRESS';
  actionOnAway: 'DISPLAY' | 'QUEUE' | 'SUPPRESS';
}

export interface PriorityMatrixConfig {
  rules: PriorityRule[];
}

// Local Unity HTTP Webhook DTOs
export interface UnityCompileStartDTO {
  project: string;
  unityVersion: string;
  timestampUtc: string;
}

export interface UnityCompileFinishDTO {
  project: string;
  success: boolean;
  elapsedSeconds: number;
  errorCount: number;
  warningCount: number;
}

export interface UnityPlayModeDTO {
  project: string;
  state: 'EnteredPlayMode' | 'ExitedPlayMode';
}

export interface UnityExceptionDTO {
  project: string;
  exceptionType: string;
  message: string;
  stackTrace: string;
}

/**
 * Validation helpers for incoming API payloads
 */
export class DTOValidator {
  public static isValidCompileStart(data: unknown): data is UnityCompileStartDTO {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    return (
      typeof obj.project === 'string' &&
      typeof obj.unityVersion === 'string' &&
      typeof obj.timestampUtc === 'string'
    );
  }

  public static isValidCompileFinish(data: unknown): data is UnityCompileFinishDTO {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    return (
      typeof obj.project === 'string' &&
      typeof obj.success === 'boolean' &&
      typeof obj.elapsedSeconds === 'number' &&
      typeof obj.errorCount === 'number' &&
      typeof obj.warningCount === 'number'
    );
  }

  public static isValidPlayMode(data: unknown): data is UnityPlayModeDTO {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    return (
      typeof obj.project === 'string' &&
      (obj.state === 'EnteredPlayMode' || obj.state === 'ExitedPlayMode')
    );
  }

  public static isValidException(data: unknown): data is UnityExceptionDTO {
    if (typeof data !== 'object' || data === null) return false;
    const obj = data as Record<string, unknown>;
    return (
      typeof obj.project === 'string' &&
      typeof obj.exceptionType === 'string' &&
      typeof obj.message === 'string' &&
      typeof obj.stackTrace === 'string'
    );
  }
}
