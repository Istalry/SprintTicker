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
  standupTime?: string; // e.g. "10:00"
  enableStandupPrompt?: boolean;
  lunchStartTime?: string; // e.g. "12:30"
  lunchEndTime?: string; // e.g. "13:30"
  lunchStart?: string; // Alias for UI compatibility
  lunchEnd?: string; // Alias for UI compatibility
  enableLunchMute?: boolean;
  eodWrapUpTime?: string; // e.g. "18:00"
  eodTime?: string; // Alias for UI compatibility
  promptTimeoutSeconds?: number; // 0 for indefinite
  autoDismissSeconds?: number; // Alias for UI compatibility
}

export type UserMode = 'WORK' | 'LUNCH' | 'AWAY';
export type PriorityAction = 'DISPLAY' | 'QUEUE' | 'SUPPRESS';

export interface PriorityRule {
  id: string;
  eventName: string;
  priority: number;
  actionOnWork: PriorityAction;
  actionOnLunch: PriorityAction;
  actionOnAway: PriorityAction;
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

export interface UnityProjectInjectionResult {
  projectName: string;
  projectPath: string;
  status: 'injected' | 'already_exists' | 'failed';
  error?: string;
}

export interface WorklogDTO {
  id: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  durationSeconds: number;
  providerId: string;
  syncStatus: 'SYNCED' | 'QUEUED' | 'FAILED';
  completedAtUtc: string;
  comment?: string;
}

export interface UnitySettingsDTO {
  buildChime: string;
  enableFailureSound: boolean;
  enablePlayModeDnd: boolean;
  showUnityErrors?: boolean;
  errorDurationSeconds?: number;
  scanFolder?: string;
}

export interface UnityInstanceDTO {
  instanceId: string;
  projectName: string;
  unityVersion?: string;
  compilationState: 'Idle' | 'Compiling';
  playModeStatus: 'Editor Idle' | 'In Play Mode';
  savePort: number;
  lastPingUtc: string;
}

export interface UnityTelemetryDTO {
  activeProjectName: string;
  isConnected: boolean;
  compilationState: 'Idle' | 'Compiling';
  playModeStatus: 'Editor Idle' | 'In Play Mode';
  lastPingUtc?: string;
  instances?: UnityInstanceDTO[];
}

export interface MessagingSettingsDTO {
  discordWebhookUrl: string;
  enableDiscordLed: boolean;
  slackWebhookUrl: string;
  enableSlackPreview: boolean;
  gmailQuery: string;
  enableGmailLed: boolean;
  notificationTimeoutSeconds?: number; // Auto-dismiss notification banner duration in seconds (default: 10)
  stealthClockIdleTimeoutMins?: number; // Idle duration before switching OLED to stealth clock (default: 15)
  enableEdgeGlow?: boolean; // Enable ambient screen edge glow effect (default: true)
  edgeGlowOpacity?: number; // Screen edge glow opacity between 0.0 and 1.0 (default: 0.3)
  edgeGlowMode?: EdgeGlowMode; // Edge glow pattern (STATIC, PULSE, BLINKING, ROTATING) (default: PULSE)
  edgeGlowTransition?: EdgeGlowTransition; // Transition style (FADE, INSTANT) (default: FADE)
}

export type NotificationPriorityMode = 'DONT_SHOW' | 'DEFAULT' | 'HIGH_PRIORITY';

export interface NotificationSourceRule {
  appId: string;
  appName: string;
  iconId: BitmapIconId;
  priorityMode: NotificationPriorityMode;
}

export interface WindowsNotificationSettingsDTO {
  enableListener: boolean;
  sourceRules: NotificationSourceRule[];
  notificationTimeoutSeconds: number;
}

export interface WindowsNotificationEventDTO {
  id?: string;
  appId: string;
  appName: string;
  title: string;
  body: string;
  iconId?: BitmapIconId;
  rawIconData?: (string | null)[][];
  timestampUtc?: string;
}

export interface MessagingTestResultDTO {
  success: boolean;
  channel: string;
  message: string;
}

export type LedAnimationMode = 'SOLID' | 'BREATHING' | 'PULSE_ALERT' | 'FLASH_BURST' | 'CONFETTI_EXPLOSION';
export type EdgeGlowMode = 'NONE' | 'STATIC' | 'PULSE' | 'BLINKING' | 'ROTATING';
export type EdgeGlowTransition = 'FADE' | 'INSTANT';
export type BitmapIconId = 'burger' | 'clock' | 'slack' | 'gmail' | 'discord' | 'unity' | 'checkmark' | 'playmode' | 'compiling' | 'error' | 'antigravity' | 'battery' | 'windows' | 'bell';
export type ColorThemeId = 'emerald' | 'cyberpunk' | 'retro_arcade' | 'nordic_cyan';
export type RearOledMode = 'DIAGNOSTICS' | 'PERFORMANCE_MONITOR' | 'STEALTH_CLOCK';

export interface DisplayElementDTO {
  type: 'text' | 'bitmap' | 'rectangle';
  x: number;
  y: number;
  text?: string;
  font?: 'small' | 'bold' | 'tiny';
  color?: string;
  iconId?: BitmapIconId;
  bitmapData?: (string | number | null)[][];
  width?: number;
  height?: number;
  fill?: string;
  scroll_rate?: number;
}

export interface HardwareDisplayStateDTO {
  frontElements: DisplayElementDTO[];
  backElements: DisplayElementDTO[];
  ledColorHex: string;
  ledMode: LedAnimationMode;
  colorTheme: ColorThemeId;
  rearOledMode: RearOledMode;
  activeWidgetId: string;
  enableEdgeGlow?: boolean;
  edgeGlowOpacity?: number;
  edgeGlowMode?: EdgeGlowMode;
  edgeGlowTransition?: EdgeGlowTransition;
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
