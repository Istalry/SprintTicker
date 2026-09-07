/**
 * Data Transfer Objects (DTOs) for the IPC bridge and the local webhook endpoints.
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
  /**
   * Front matrix brightness as reported by the device, or null if not known.
   *
   * Null rather than a number, because these were fixed literals -- 80 and 100
   * -- presented in the diagnostics panel as live readings. A figure the device
   * never sent is worse than no figure.
   */
  frontBrightness: number | null;
  /**
   * Rear panel brightness, or null.
   *
   * Always null in this build: nothing drives the rear OLED, so there is no
   * brightness of ours to report.
   */
  backBrightness: number | null;
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

export interface UnityProjectInjectionResult {
  projectName: string;
  projectPath: string;
  status: 'injected' | 'already_exists' | 'failed';
  error?: string;
}

/**
 * A completed worklog as sent to the renderer.
 *
 * This mirrors the `worklogs` table, which is what GET_WORKLOGS actually
 * returns. The previous declaration promised taskKey, taskTitle, providerId,
 * syncStatus and completedAtUtc -- none of which that channel populates -- while
 * omitting `startedAtUtc`, the one field the history view reads. Anything
 * consuming the aspirational fields would have rendered `undefined`.
 *
 * Enriching this with task metadata and sync state is a feature, not a typo;
 * it needs a join in the repository first.
 */
/**
 * Task-provider configuration as exchanged over IPC.
 *
 * The preload contract previously described this inline with a `jiraDomain`
 * field left over from an earlier Jira integration. The main handler has long
 * returned the OpenProject fields instead, so the settings screen's correct code
 * failed to compile against its own API.
 */
export interface ProviderSettingsDTO {
  activeProviderId: string;
  fallbackTicketKey: string;
  opDomain: string;
  opApiKey: string;
  opStatusInProgress: string;
  opStatusToTest: string;
  opStatusToReview: string;
  opCompletionAction: string;
  providers: Array<{ id: string; name: string }>;
}

/** Partial update; every field is optional and only supplied keys are written. */
export interface ProviderSettingsUpdateDTO {
  providerId?: string;
  fallbackTicketKey?: string;
  opDomain?: string;
  opApiKey?: string;
  opStatusInProgress?: string;
  opStatusToTest?: string;
  opStatusToReview?: string;
  opCompletionAction?: string;
}

export interface WorklogDTO {
  id: string;
  sessionId: string;
  taskId: string;
  durationSeconds: number;
  startedAtUtc: string;
  comment: string;
  createdAtUtc: string;
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
  enableOpenProjectNotifications?: boolean;
  openProjectPollingIntervalSeconds?: number;
  notificationTimeoutSeconds?: number; // Auto-dismiss notification banner duration in seconds (default: 10)
}

export type NotificationPriorityMode = 'DONT_SHOW' | 'DEFAULT' | 'HIGH_PRIORITY';

export interface NotificationSourceRule {
  appId: string;
  appName: string;
  iconId: BitmapIconId;
  priorityMode: NotificationPriorityMode;
  /**
   * Optional path to a hand-made 16x16 image that pins this app's icon.
   *
   * Outranks both the resolved system icon and `iconId`, so an app whose real
   * icon reduces badly at 15x15 -- or that resolves to the wrong executable --
   * can be corrected without code. Produce one with `pnpm editor`.
   */
  iconImagePath?: string;
  /**
   * Show that a message arrived, without showing what it said.
   *
   * The bar sits on a desk in view of whoever walks past, so the body of a
   * direct message is the one part of a notification that should not be
   * readable from across a room. With this set the banner keeps the sender or
   * channel on the top row -- which is what makes it worth glancing at -- and
   * replaces the body with a fixed placeholder.
   *
   * Per-app rather than a global switch or a hardcoded list of chat apps:
   * which sources are sensitive is the user's judgement, the same way the
   * priority panel owns which sources may interrupt.
   */
  hideMessageBody?: boolean;
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
/**
 * Ids accepted by `getBitmapById`.
 *
 * The union previously omitted wave, pause, play, resume and stop, all of which
 * the resolver has always handled and the debug panel dispatches -- so passing
 * one was a type error against a call that works.
 */
export type BitmapIconId =
  | 'burger' | 'clock' | 'slack' | 'gmail' | 'discord' | 'unity' | 'checkmark'
  | 'playmode' | 'compiling' | 'error' | 'antigravity' | 'battery' | 'windows'
  | 'bell' | 'openproject' | 'wave' | 'pause' | 'play' | 'resume' | 'stop';
export type ColorThemeId = 'emerald' | 'cyberpunk' | 'retro_arcade' | 'nordic_cyan';
export type RearOledMode = 'DIAGNOSTICS' | 'PERFORMANCE_MONITOR' | 'STEALTH_CLOCK';

export interface DisplayElementDTO {
  /**
   * 'image' is what the driver emits for uploaded assets and what the emulator
   * already branches on; it was missing here, so those comparisons were flagged
   * as having no overlap.
   */
  type: 'text' | 'bitmap' | 'rectangle' | 'image';
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
  /**
   * Hardware fill colours. Exactly one entry for a solid fill, exactly two for
   * a gradient -- any other count reboots the device (Guide section 8).
   */
  fill_colors?: string[];
  /** Image source for `type: 'image'` -- a device asset path or data URL. */
  data?: string;
  scroll_rate?: number;
}

export interface HardwareDisplayStateDTO {
  frontElements: DisplayElementDTO[];
  backElements: DisplayElementDTO[];
  ledColorHex: string;
  ledMode: LedAnimationMode;
  colorTheme: ColorThemeId;
  rearOledMode: RearOledMode;
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
/**
 * Screens the debug panel can ask the renderer to draw.
 *
 * Only screens with no live source of their own are listed. Notifications,
 * Lunch, Away, confetti and pause/resume already have real IPC that drives them
 * through their normal path, and should keep using it.
 */
export type PreviewScreenId =
  | 'CEREMONY_STANDUP'
  | 'CEREMONY_EOD'
  | 'EOD_COMPLETE'
  | 'UNITY_PLAY_MODE'
  | 'UNITY_COMPILING'
  | 'UNITY_BUILDING'
  | 'UNITY_BAKING'
  | 'UNITY_EXCEPTION'
  | 'TASK_SELECTION';

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

/**
 * The result of one update check.
 *
 * `failed` carries the reason and is produced by whoever catches
 * `UpdateCheckError`, not by the checker: a check that did not happen must not
 * be reported as "up to date". The service it replaced claimed to check and
 * never did (audit F-18), so the failure case is deliberately a first-class
 * state here rather than something the UI infers from silence.
 */
export type UpdateStatusDTO =
  | { status: 'disabled'; currentVersion: string }
  | { status: 'up-to-date'; currentVersion: string }
  | { status: 'failed'; currentVersion: string; reason: string }
  | {
      status: 'update-available';
      currentVersion: string;
      latestVersion: string;
      releaseUrl: string;
    };

/**
 * Outcome of a provider projects/tasks sync pass.
 *
 * Reported rather than inferred: the Projects view reads the local cache, so
 * "no projects" and "not synced yet" look identical there. Saving credentials
 * used to leave the user staring at the second while assuming the first.
 */
export interface ProviderSyncResult {
  status: 'synced' | 'skipped' | 'not_configured' | 'failed';
  /** Present for every status except `synced`. */
  reason?: string;
  projects: number;
  tasks: number;
}

/** Broadcast alongside {@link ProviderSyncResult} when the project cache changes. */
export interface ProjectsUpdatedPayload {
  result: ProviderSyncResult;
  projects: ProjectDTO[];
}
