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

export interface OpStatusDTO {
  id: string;
  name: string;
  isClosed: boolean;
}

export interface OpenProjectNotificationDTO {
  id: string;
  subject: string;
  action: string;
  actorName: string;
  readIAN: boolean;
  reason: string;
  createdAt: string;
}

export interface ProjectDTO {
  id: string;
  name: string;
  key: string;
  providerId?: string;
}

export interface HardwareBindingConfig {
  startButtonPress: string;
  wheelRotateLeft: string;
  wheelRotateRight: string;
  wheelClick: string;
  backButtonShortPress: string;
  backButtonLongPress: string;
}

export interface DeviceConfigDTO {
  showIdleClockFallback: boolean;
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
  framesSent: number;
  framesFailed: number;
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
  shutdownByDefault?: boolean; // Default checkbox state in EOD wrap-up wizard
  eodShutdownByDefault?: boolean; // Alias for UI compatibility
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
  enableOpenProjectNotifications?: boolean;
  openProjectPollingIntervalSeconds?: number;
  notificationTimeoutSeconds?: number; // Auto-dismiss notification banner duration in seconds (default: 10)
  stealthClockIdleTimeoutMins?: number; // Idle duration before switching OLED to stealth clock (default: 15)
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
  pollingIntervalSeconds: number;
}

export interface WindowsNotificationEventDTO {
  id?: string;
  appId: string;
  appName: string;
  title: string;
  body: string;
  iconId?: BitmapIconId;
  rawIconData?: (string | null)[][];
  iconPath?: string;
  iconBase64?: string;
  timestampUtc?: string;
}

export type NotificationLogLevel = 'info' | 'warn' | 'error' | 'notification';

export interface NotificationLogEntryDTO {
  timestamp: string;
  level: NotificationLogLevel;
  message: string;
}

export interface NotificationListenerStatusDTO {
  isListening: boolean;
  strategy: 'DB_POLLING' | 'WINRT' | 'NONE';
  hasSqlite3: boolean;
  hasNotifDb: boolean;
  lastPollTimestamp?: string;
  totalCaptured: number;
  totalSuppressed: number;
  errorMessage?: string;
}


export interface MessagingTestResultDTO {
  success: boolean;
  channel: string;
  message: string;
}

export type LedAnimationMode = 'SOLID' | 'BREATHING' | 'PULSE_ALERT' | 'FLASH_BURST' | 'CONFETTI_EXPLOSION';
export type BitmapIconId = 'burger' | 'clock' | 'slack' | 'gmail' | 'discord' | 'unity' | 'checkmark' | 'playmode' | 'compiling' | 'error' | 'antigravity' | 'battery' | 'windows' | 'bell' | 'openproject';
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
}

// OpenAPI v25 System Status & Power Telemetry DTOs
export interface StatusPowerDTO {
  state: string;
  battery_charge: number;
  battery_voltage: number;
  battery_current: number;
  usb_voltage: number;
}

export interface StatusFirmwareDTO {
  version: string;
  build_date?: string;
  git_hash?: string;
}

export interface StatusSystemDTO {
  uptime_seconds?: number;
  free_heap_bytes?: number;
  cpu_frequency_mhz?: number;
}

export interface StatusDeviceDTO {
  serial_number?: string;
  mac_address?: string;
  model?: string;
}

export interface AccessSettingsDTO {
  mode: 'disabled' | 'enabled' | 'key';
  has_key?: boolean;
}

export interface BrightnessDTO {
  value: number | 'auto';
  display?: 'front' | 'back' | 'all';
}

export interface AudioVolumeDTO {
  volume: number; // 0..100
  silent?: number; // 1 suppresses volume chime
}

export interface RtcTimeDTO {
  timestamp: string; // ISO 8601 with timezone offset
}

// Official DisplayElements OpenAPI v25 Schemas
export type ElementAnchor =
  | 'top_left'
  | 'top_mid'
  | 'top_right'
  | 'mid_left'
  | 'center'
  | 'mid_right'
  | 'bottom_left'
  | 'bottom_mid'
  | 'bottom_right';

export interface BaseElementSchemaDTO {
  id: string;
  type: 'text' | 'image' | 'animation' | 'countdown' | 'rectangle';
  x?: number;
  y?: number;
  align?: ElementAnchor;
  display?: 'front' | 'back';
  timeout?: number;
  display_until?: string;
}

export interface TextElementSchemaDTO extends BaseElementSchemaDTO {
  type: 'text';
  text: string;
  font?: 'small' | 'medium' | 'medium_condensed' | 'big' | 'tiny' | 'normal' | 'condensed' | 'bold' | 'large' | 'extra_large' | 'global';
  color?: string; // #RRGGBBAA hex
  width?: number;
  scroll_rate?: number;
  scroll_start_delay?: number;
  scroll_repeat_delay?: number;
}

export interface ImageElementSchemaDTO extends BaseElementSchemaDTO {
  type: 'image';
  path?: string;
  stock_path?: string;
  opacity?: number; // 0..100
}

export interface AnimationElementSchemaDTO extends BaseElementSchemaDTO {
  type: 'animation';
  path?: string;
  builtin_anim?: string;
  loop?: boolean;
  section?: string;
  await_previous_end?: boolean;
  opacity?: number;
}

export interface CountdownElementSchemaDTO extends BaseElementSchemaDTO {
  type: 'countdown';
  timestamp: string; // Unix UTC in seconds
  direction: 'time_left' | 'time_since';
  show_hours: 'when_non_zero' | 'always';
  color?: string;
}

export interface RectangleElementSchemaDTO extends BaseElementSchemaDTO {
  type: 'rectangle';
  width: number;
  height: number;
  radius?: number;
  fill?: 'none' | 'solid' | 'gradient_h' | 'gradient_v';
  fill_colors?: string[]; // Strictly 1 color for solid, strictly 2 for gradients
  border_width?: number;
  border_color?: string;
}

export interface HardwareDrawPayloadDTO {
  application_name: string;
  priority?: number; // 1..100 (95-100 recommended for custom apps)
  led_notification_color?: string;
  elements: BaseElementSchemaDTO[];
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

export class ArgumentNullException extends Error {
  constructor(paramName: string) {
    super(`Argument cannot be null or undefined: ${paramName}`);
    this.name = 'ArgumentNullException';
  }
}

export class ArgumentException extends Error {
  constructor(message: string, paramName?: string) {
    super(paramName ? `${message} (Parameter '${paramName}')` : message);
    this.name = 'ArgumentException';
  }
}
