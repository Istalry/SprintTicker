import type { WorklogSyncState } from './worklog-correction';
import type { TaskOwnershipValue } from './task-ownership';
import type { RunningInterruptionDTO } from './interruption';
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
  /**
   * An interruption not yet named nor assigned: its task is unsorted
   * (migration 13). Read from the task row, never stored on the session.
   */
  unsorted?: true;
  /**
   * An interruption runs (P6). The session is then the interruption's own
   * view -- its title, its start, TRACKING -- so every surface times it as it
   * timed an interruption before; the task it holds is in here, paused.
   */
  interruption?: RunningInterruptionDTO;
  status: 'TRACKING' | 'PAUSED' | 'COMPLETED';
  startTimeUtc: string; // ISO 8601
  totalPausedSeconds: number;
  elapsedSeconds: number; // Calculated on Main process
  lastPauseStartUtc?: string;
  /**
   * The provider the task came from, read from its project when the session
   * started; its time and status changes go there, whatever provider is
   * active by the time it ends. `local` for a project made in SprintTicker,
   * whose time stays here. Absent for ad-hoc work, and for a session from
   * before it was recorded, which falls back to the active provider.
   */
  providerId?: string;
  /**
   * The provider stopped listing this task at the last sync: reassigned,
   * closed or moved. The session goes on and its time is logged; finishing it
   * as done asks first, since the task is no longer the user's to move.
   * Absent otherwise.
   */
  taskUnlisted?: boolean;
  /**
   * Why the task left the list, once the provider has said: `closed` -- done
   * there, so finishing it moves nothing and asks nothing; `reassigned` --
   * still open, but no longer in the user's scope; `gone` -- deleted, or no
   * longer visible to them. Absent while unknown, which reads as reassigned.
   */
  taskLeftBecause?: TaskLeftReason;
  /**
   * Who the task is assigned to, when it is someone else's: reassigned
   * mid-session, started as a teammate's, or taken by someone between the
   * pick and the start. Absent when unknown or the user's.
   */
  taskOwnerName?: string;
}

/** Why a tracked task left the provider's list: see `ActiveSessionDTO.taskLeftBecause`. */
export type TaskLeftReason = 'closed' | 'reassigned' | 'gone';

/** What `session:discard` answers: whether a session was there, and how much time was thrown away. */
export interface DiscardSessionResultDTO {
  success: boolean;
  discardedSeconds: number;
}

export interface TaskDTO {
  id: string;
  projectId: string;
  key: string;
  title: string;
  status: 'todo' | 'in_progress' | 'done';
  /**
   * How urgent the provider says the task is: 0 most urgent, 4 least.
   * Absent for a local task, or a provider priority this app does not know --
   * see `priorityRankFromName`. Sorts the hardware task picker within a status.
   */
  priorityRank?: number;
  /**
   * The start of the provider's description, as plain text on one line and at
   * most `TASK_DESCRIPTION_MAX_CHARS` long. Absent for a task with none.
   */
  description?: string;
  /**
   * Whose the provider says it is. Absent means the user's: a row from before
   * ownership was stored, a local or ad-hoc task -- see `task-ownership.ts`.
   */
  ownership?: TaskOwnershipValue;
  /** The assignee's display name, on a task that is someone else's. */
  assigneeName?: string;
  /**
   * An interruption's ad-hoc task, still under the name the app made up:
   * waiting for the user to name it or move its time to a task (migration 13).
   */
  unsorted?: true;
}

export interface OpStatusDTO {
  id: string;
  name: string;
  isClosed: boolean;
}

export interface ProjectDTO {
  id: string;
  name: string;
  key: string;
  providerId?: string;
  /**
   * The user's own tasks in the project not yet done, archived ones left
   * out -- not the unassigned ones nor a teammate's. Filled in by
   * the local cache; absent on a project straight from a provider, which
   * knows nothing of the cache. See `filterProjectsWithTasks`.
   */
  openTaskCount?: number;
  /** Open tasks nobody is assigned, counted like `openTaskCount`. */
  openUnassignedCount?: number;
  /** Open tasks assigned to someone else, counted like `openTaskCount`. */
  openOthersCount?: number;
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
  /**
   * Whether this machine has a BUSY Bar at all.
   *
   * False is the no-bar mode: the driver never dials, the app keeps time,
   * syncs and prompts exactly as before, and the screens that only describe the
   * bar step aside. Reversible by design -- a user who buys a bar later turns
   * it back on in Device Diagnostics and keeps everything else.
   *
   * Absent from rows written before it existed, which read as `true` through
   * `DEFAULT_DEVICE_CONFIG`: an upgrade must not switch anyone's bar off.
   */
  enabled: boolean;
  showIdleClockFallback: boolean;
  /**
   * Host the driver dials -- IPv4 or hostname, no scheme, port or path.
   *
   * Seeded from `DEFAULT_USB_IP`. Changing it reconnects the driver in place,
   * so it is the one setting here that can leave the app unable to see the
   * hardware; validate with `isValidDeviceHost` before saving.
   */
  ipAddress: string;
  /**
   * Token for `x-api-token`, or `''` when the device needs none.
   *
   * Empty over USB, where the bar accepts unauthenticated requests. Required
   * once the device has access protection enabled (`mode=key`), which is the
   * normal state over Wi-Fi -- without it every request comes back 401/403.
   *
   * **A secret.** It must never reach a log line or the diagnostics bundle;
   * see `redactTokenInUrl`, which exists because the StateStream URL carries
   * it as a query parameter.
   */
  apiToken: string;
}

export interface DeviceStatusDTO {
  /**
   * False in no-bar mode. Carried on the status, not only the config, because
   * the status is what the renderer is pushed live: turning the bar off or on
   * re-lays out every screen without a reload.
   */
  enabled: boolean;
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
  /** How the display side of the device is holding up; see `DisplayHealthDTO`. */
  displayHealth: DisplayHealthDTO;
}

/**
 * The figures that came before every measured hang of the bar, kept so the
 * next one shows its run-up in the diagnostics bundle.
 *
 * On firmware 1.2.4 (2026-09-30), uploads slowed from about 50 ms to 300-600
 * ms before the bar stopped answering, every time; and what hung it was
 * closing its screen. A status code says none of that.
 */
export interface DisplayHealthDTO {
  /** Median time of the recent asset uploads, in ms; null before the first. */
  uploadMedianMs: number | null;
  /** The recent upload times, oldest first, in ms. */
  recentUploadMs: number[];
  /** True while the median is at the level measured before hangs. */
  latencyWarning: boolean;
  /** The device's screen closed in the last hour: clears sent, and removals that emptied the panel. */
  screenClosesLastHour: number;
  /** Requests the driver answered without sending, since start: superseded, already absent, already empty, already playing. */
  requestsSkipped: number;
  /** Removals the device answered "not there" (400), since start. */
  removalsAlreadyGone: number;
  /** The most display requests ever waiting their turn at once, since start. */
  maxQueueLength: number;
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
  /** Ask, rather than log, about a session left running across a change of day. */
  askAboutForgottenSessions?: boolean;
  /**
   * The days worked, as `Date.getDay()` numbers (0 Sunday). Nothing is
   * prompted on the others, and the last of them in a week closes it.
   */
  workingDays?: number[];
  /**
   * A pause at least this many minutes long ends a worklog: the work after
   * it goes in as another. 0 never splits at a pause; midnight always does.
   */
  splitPauseMinutes?: number;
}

/** A week just over: Monday to its last working day, and the time logged in it. */
export interface WeekEndedDTO {
  weekStart: string;
  weekEnd: string;
  loggedSeconds: number;
}

/**
 * The question asked after lunch when the task stopped for it is no longer
 * the user's: reassigned, closed or moved over the break. Null when nothing
 * is being asked.
 */
/**
 * A ceremony waiting on the user (redesign P8c): a card on Today and a row on
 * the mini timer until it is answered -- it never closes itself, and never
 * takes the focus. The end-of-day one opens the wrap-up.
 */
export interface CeremonyPromptDTO {
  /** `LUNCH` is asked only when lunch's hour finds an interruption running (S25). */
  type: 'STANDUP' | 'EOD' | 'LUNCH';
  title: string;
  /** When it is due, HH:MM, as the schedule says it. */
  at: string;
  /** For `LUNCH`: the interruption that starting lunch ends ("Call with Marc"). */
  endsInterruption?: string;
}

/**
 * A "still...?" question (redesign P8d), asked once per occurrence in working
 * hours: on Today, the mini timer, and a toast while the window is hidden.
 */
export interface ReminderDTO {
  /** The occurrence: dismissing it is final for this one, never for the next. */
  id: string;
  kind: 'nothing-timing' | 'long-pause' | 'interruption-running' | 'standup-running';
  /** Since when the state has lasted (the later of idle and the day's start, for nothing timing). */
  sinceUtc: string;
  minutes: number;
  /** The paused task, or the stand-up's. */
  taskKey?: string;
  /** The interruption's name. */
  name?: string;
  /** The task an interruption holds, which Back returns to; absent when it holds none. */
  heldTaskKey?: string;
}

/** A task as the morning card names it. */
export interface MorningTaskDTO {
  id: string;
  key: string;
  title: string;
}

/**
 * The morning card (S4b, redesign P8e2): the first look at Today on a
 * working day. Null from `morning:get` once the day has begun or the card
 * was seen.
 */
export interface MorningDTO {
  /** The local day it is for. */
  dateKey: string;
  /** The last task timed, still open and the user's, and when its last entry ended. */
  lastTask: (MorningTaskDTO & { stoppedAtUtc: string }) | null;
  /** The stand-up's time while it is still to come today ("09:30"); null when off or past. */
  standupAt: string | null;
  /** The user's tasks in progress, the last task left out. */
  inProgress: MorningTaskDTO[];
}

/**
 * The task the stand-up is timed on and sent to (D3, redesign P8c2); none
 * keeps it on the local "Daily Standup", never sent. Its key and title are
 * as they were when chosen, for Settings to name it.
 */
export interface StandupTaskDTO {
  taskId: string;
  taskKey: string;
  title: string;
}

export interface ResumePromptDTO {
  taskKey: string;
  taskTitle: string;
  /**
   * What stopped the task: lunch, the stand-up it was switched away for, or
   * an interruption -- which asks every time, not only for a task that left
   * the user's lists.
   */
  after: 'lunch' | 'away' | 'standup' | 'interruption';
  /**
   * After an interruption, the task has also left the user's lists. Lunch
   * and the stand-up ask only then, so for them it goes without saying.
   */
  unlisted?: true;
  /**
   * After an interruption: when it ended. The time since is the gap "Back,
   * add the 6 min" counts as work on the task.
   */
  interruptionEndedAtUtc?: string;
  /**
   * After Lunch or Away (P8b): the task is paused, not stopped -- "Back at
   * your desk?". Resume ends the pause; "I worked through it" takes it back,
   * so the break counts as work.
   */
  held?: true;
}

/** A pause of a session, closed: from when to when. */
export interface PauseIntervalDTO {
  fromUtc: string;
  toUtc: string;
}

/**
 * A session left running across a change of day while the user was away. It
 * has been paused at their last activity, and nothing is logged until they
 * say when they stopped working on it.
 */
export interface ForgottenSessionReviewDTO {
  sessionId: string;
  taskKey: string;
  taskTitle: string;
  startTimeUtc: string;
  /** When the user was last at the machine: where the session was paused. */
  lastPresenceUtc: string;
  /** The end-of-day hour of that day, when it falls between the start and now. */
  endOfDayUtc: string | null;
  /** The pauses before, for the time each end would log. */
  pauses: PauseIntervalDTO[];
  /** The task has left the user's list: restarting it asks first. */
  taskUnlisted: boolean;
}

/**
 * The answer: log up to `endUtc` and stop; the same, then start the task again
 * now; throw the session away; or count the whole absence as work.
 */
export type ForgottenSessionAction = 'stop' | 'restart' | 'discard' | 'keep';

export interface ForgottenSessionResolutionDTO {
  action: ForgottenSessionAction;
  /** Required for `stop` and `restart`: between the start and now. */
  endUtc?: string;
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
  /** A {@link TaskScopeValue}; typed as string because DTOs stay dependency-free. */
  opTaskScope: string;
  /** The raw provider-native query, meaningful only when the scope is `custom`. */
  opTaskQuery: string;
  jiraSite: string;
  jiraEmail: string;
  jiraApiToken: string;
  jiraTaskScope: string;
  /** Raw JQL, meaningful only when the scope is `custom`. */
  jiraTaskQuery: string;
  /** Transition name or id; empty means SprintTicker does not move the issue. */
  jiraTransitionInProgress: string;
  jiraTransitionToTest: string;
  jiraTransitionToReview: string;
  jiraCompletionAction: string;
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
  opTaskScope?: string;
  opTaskQuery?: string;
  jiraSite?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  jiraTaskScope?: string;
  jiraTaskQuery?: string;
  jiraTransitionInProgress?: string;
  jiraTransitionToTest?: string;
  jiraTransitionToReview?: string;
  jiraCompletionAction?: string;
}

export interface WorklogDTO {
  id: string;
  sessionId: string;
  taskId: string;
  durationSeconds: number;
  startedAtUtc: string;
  comment: string;
  createdAtUtc: string;
  /** The task's key, e.g. `SCRUM-2`. Absent only for a worklog whose task row is missing. */
  taskKey?: string;
  /** The task's title. Absent only for a worklog whose task row is missing. */
  taskTitle?: string;
  /** Where it stands with its provider: sent, on its way, parked, or kept here only. */
  syncState?: WorklogSyncState;
  /** The key of the earlier entry this one overlaps, while that holds it back (`held-overlap`). */
  overlapsTaskKey?: string;
  /** Whether its task has a page on a provider to open (`hasTaskPage`). */
  hasTaskPage?: boolean;
  /** Logged on ad-hoc work: named in SprintTicker, sent to no provider. */
  adHoc?: true;
  /** An interruption not yet named or assigned. */
  unsorted?: true;
  /** Time that started as an interruption, placed on this task: Today marks it ⚡ (P8e). */
  fromInterruption?: true;
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


export type LedAnimationMode = 'SOLID' | 'BREATHING' | 'PULSE_ALERT' | 'FLASH_BURST' | 'CONFETTI_EXPLOSION';
/**
 * Ids accepted by `getBitmapById`.
 *
 * The union previously omitted wave, pause, play, resume and stop, all of which
 * the resolver has always handled and the debug panel dispatches -- so passing
 * one was a type error against a call that works.
 */
export type BitmapIconId =
  | 'burger' | 'clock' | 'slack' | 'gmail' | 'discord' | 'checkmark'
  | 'antigravity' | 'battery' | 'windows'
  | 'bell' | 'openproject' | 'jira' | 'wave' | 'pause' | 'play' | 'resume' | 'stop'
  | 'stopwatch' | 'stopwatch_paused' | 'stopwatch_idle'
  | 'folder' | 'task' | 'task_in_progress' | 'task_done' | 'meeting'
  | 'coffee' | 'moon';
export type ColorThemeId = 'emerald' | 'cyberpunk' | 'retro_arcade' | 'nordic_cyan';

export interface DisplayElementDTO {
  /**
   * 'image' is what the driver emits for uploaded assets and what the emulator
   * already branches on; it was missing here, so those comparisons were flagged
   * as having no overlap.
   */
  type: 'text' | 'bitmap' | 'rectangle' | 'image';
  /** Every element main builds carries one; the emulator's overlays are found by it. */
  id?: string;
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

/**
 * What the app is showing, for the on-screen emulator.
 *
 * Front only. The rear 160x80 display is left to the firmware, which mirrors
 * the front there at twice the size and shows its own clock when the front is
 * empty -- the user chose that over anything the app would draw (2026-09-30).
 * An app draw on the rear would replace the mirror.
 */
/**
 * The icon of the screen the bar is showing, for the mini timer.
 *
 * The 16x16 bitmap a screen draws at the left of its frame, or, for a
 * full-panel scene, the icon that stands for it (`SCENE_ICONS`). `label`
 * names the screen -- its top row, or the scene's title -- for a tooltip.
 * Static: the bar animates its icons, the mini timer does not.
 */
export interface ScreenIconDTO {
  pixels: (string | null)[][];
  label: string;
  /**
   * The `.anim` the bar plays over these pixels (`ANIMATED_ICONS`), when the
   * icon moves: the Stream Deck plays the same motion from its frames.
   */
  animation?: string;
}

export interface HardwareDisplayStateDTO {
  frontElements: DisplayElementDTO[];
  ledColorHex: string;
  ledMode: LedAnimationMode;
  colorTheme: ColorThemeId;
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
  | 'TASK_SELECTION'
  | 'TASK_LOGGED';

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
/**
 * Starting SprintTicker with Windows, as Windows reports it. Unavailable in
 * `pnpm dev`, whose executable is a bare Electron, and off Windows.
 */
export interface LaunchAtLoginStatusDTO {
  enabled: boolean;
  available: boolean;
  reason: 'not-windows' | 'not-packaged' | null;
}

/**
 * The global shortcut for Interrupt. `enabled` is the user's choice and
 * `registered` Windows' answer: on but not registered is a chord another
 * app holds (`taken`), which Settings says rather than showing it working.
 */
export interface InterruptShortcutStatusDTO {
  enabled: boolean;
  accelerator: string;
  registered: boolean;
  problem: 'taken' | null;
}

/**
 * What the active provider can do, read off the adapter's optional methods.
 * A control for something the provider cannot do is hidden, never greyed
 * (the redesign's rule): no assignment, no Done transition, no Fetch by key
 * where its API has none.
 */
export interface ProviderCapabilitiesDTO {
  providerId: string;
  /** Takes an unassigned task for the user at Start (`assignToMe`). */
  canAssign: boolean;
  /** Moves a task's status: In Progress at Start, the done state at Done. */
  canTransition: boolean;
  /** Finds a worklog it may already hold before a resend (`findWorklog`). */
  canFindWorklog: boolean;
  /** Fetches a task by its key, for the picker's Fetch (`getTaskByKey`). */
  canFetchByKey: boolean;
  /** Reads non-working days for the working calendar (`getNonWorkingDays`). */
  hasHolidays: boolean;
}

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

/** Delivery state of one queued worklog. Mirrors the sync queue table. */
export type SyncQueueItemStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED';

/** One queued worklog, as the sync panel shows it. */
export interface SyncQueueItemDTO {
  id: string;
  providerId: string;
  taskId: string;
  /** The task's own key when it is still in the local cache, else its id. */
  taskKey: string;
  durationSeconds: number;
  startedAtUtc: string;
  comment: string;
  status: SyncQueueItemStatus;
  /** What the row asks of the provider: a worklog, or a correction or deletion of one. */
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  retryCount: number;
  /** Earliest time this row may be retried; null means immediately. */
  nextAttemptAtUtc: string | null;
  /** What the provider or the network actually said, verbatim. */
  lastError: string | null;
}

/**
 * The sync queue at a glance.
 *
 * Exists because a worklog that never reached the provider used to be
 * indistinguishable from one that was never queued: the rows carried their own
 * `lastError` and `retryCount` and nothing displayed them.
 */
export interface SyncQueueSnapshotDTO {
  counts: { pending: number; syncing: number; synced: number; failed: number };
  items: SyncQueueItemDTO[];
  /** Attempts before a row parks, so the panel can say "3 of 8". */
  maxAttempts: number;
}

/** What an undo puts back (P5). */
export type UndoKind = 'stop' | 'discard' | 'correct' | 'move' | 'delete' | 'place' | 'end-day';

/**
 * The one action that can still be undone, for the window's bar and the
 * mini timer: until `expiresAtUtc`, when its sends leave (UNDO_WINDOW_MS).
 */
export interface UndoStateDTO {
  kind: UndoKind;
  /** What was done, as the bar says it: "Stopped MG-12 · 1h 05m". */
  label: string;
  expiresAtUtc: string;
}
