import { BusyBarDriver } from './busybar-driver';
import { createHash } from 'crypto';
import * as os from 'os';
import { ActiveSessionDTO, ColorThemeId, RearOledMode, LedAnimationMode, HardwareDisplayStateDTO, BitmapIconId, UserMode, DisplayElementDTO, ArgumentException, ArgumentNullException, TaskDTO } from '../../shared/dtos';
import { getBitmapById } from '../../shared/pixel-bitmaps';
import { AppIconBitmapProcessor } from './app-icon-bitmap-processor';
import { IPriorityPreemptionEngine, NotificationEventName } from '../services/priority-preemption-engine';
import { PixelCanvas } from './pixel-canvas';
import {
  ANIMATED_ICONS, DISPLAY_CONSTANTS, FRONT_ANIMATIONS, TASK_DONE_DISPLAY_SECONDS, TASK_LOGGED_DISPLAY_SECONDS,
  TASK_STARTED_DISPLAY_SECONDS
} from '../../shared/render-constants';
import { composeNotificationBanner } from '../../shared/notification-text';
import { encodeMatrixToPng } from './pixel-matrix-to-png';
import { AnimationPlayer } from './animation-player';
import { FrameOutcome } from './device-errors';
import { IconAnimator } from './icon-animator';
import { defaultAnimationsDir, loadAnimationSequence } from './animation-sequence';
import { DEVICE_APPLICATION_NAME } from '../../shared/device-constants';
import { measureText } from '../../shared/proportional-text';
import { ROW0_FONT, ROW1_FONT, TIMER_FONT } from '../../shared/fonts/pixel-font';

/** The paused screen's STOP/FINISH bars: row 1's capitals fit inside 7px. */
const PAUSED_BAR_Y = 9;
const PAUSED_BAR_HEIGHT = 7;
/**
 * Space between the task and its time -- 2px, so an eight-character key such
 * as SPR-1428 fits beside HH:MM -- and between the two choices.
 */
const PAUSED_TIMER_GAP_PX = 2;
const PAUSED_CHOICE_GAP_PX = 3;

/** Between the task selector's row-1 label and its `3/12`. */
const SELECTION_LABEL_GAP_PX = 2;
const SELECTION_LABEL_COLOR = '#9CA3AF';
const SELECTION_POSITION_COLOR = '#E5E7EB';
/** The selector's scroll bar: the Unity progress line's track, a thumb in the selector's blue. */
const SELECTION_TRACK_COLOR = '#1E293B';
const SELECTION_THUMB_COLOR = '#3B82F6';
/** A thumb narrower than this reads as a stray pixel on the LEDs. */
const SELECTION_THUMB_MIN_PX = 3;

/** Where the selector's current item sits in its list; `index` counts from 0. */
export interface SelectionPosition {
  index: number;
  count: number;
}

/** What the task selector shows beside the item's name. */
export interface TaskSelectionOptions {
  /** Row 1's text for a task: its key. Ignored for a project, which reads "Project". */
  description?: string;
  /** Omitted for a list with nothing real in it ("No Tasks"): no number, no bar. */
  position?: SelectionPosition;
  /** A task's status, shown by its card; a project has none. */
  status?: TaskDTO['status'];
}

/** The card each task status is drawn with. */
const TASK_STATUS_ICONS: Readonly<Record<TaskDTO['status'], BitmapIconId>> = {
  todo: 'task',
  in_progress: 'task_in_progress',
  done: 'task_done'
};
/**
 * A finished task's name is dimmed, so the eye skips it -- but only so far.
 * It is still the item on screen and has to be read on the LEDs; the row-1
 * grey (#9CA3AF) is too dark for the one line that names the task.
 */
const SELECTION_DONE_TITLE_COLOR = '#CBD5E1';

/** Behaviour switches for {@link DisplayRenderer.requestRender}. */
export interface RequestRenderOptions {
  /**
   * Whether a preempted request should be replayed once the display frees.
   *
   * Defaults to true, which is right for one-shot screens such as alerts and
   * ceremony prompts. False for anything drawn on a repeating timer.
   */
  queueOnPreempt?: boolean;
}

/**
 * Everything needed to draw a notification banner.
 *
 * An object rather than the previous six positional arguments, because the
 * argument that mattered -- which priority class the notification belongs to --
 * was not among them and had to be guessed from the priority number.
 * The number itself is no longer passed at all: the engine owns it.
 */
export interface NotificationBannerOptions {
  /**
   * The three fields are passed separately, not pre-joined by the caller.
   *
   * They used to arrive as a `senderName` string the listener had already
   * built, plus a `channelName` it prefixed in brackets. Nothing on that path
   * knew the row holds eleven characters, so the label consumed ten of them and
   * the message never appeared. Composition now happens in one tested place --
   * `composeNotificationBanner` -- which needs the parts, not the sentence.
   */
  appName?: string;
  /** The toast's title, which for a chat app is the sender. */
  title?: string;
  /** The toast's message body. */
  body?: string;
  /** Which priority class the source rule assigned this notification to. */
  eventName?: NotificationEventName;
  /** Fallback hand-drawn bitmap, used only when no real icon resolved. */
  iconId?: BitmapIconId;
  /** A real 16x16 app icon, which takes precedence over `iconId`. */
  customIconData?: (string | null)[][];
  /** How long the banner holds the display before releasing its lock. */
  timeoutMs?: number;
  /**
   * Show that a message arrived without showing what it said.
   *
   * Set from the source rule's `hideMessageBody`. The sender or channel stays
   * on the top row; the body is replaced by a placeholder, on the rear preview
   * as well as the front matrix.
   */
  hideBody?: boolean;
}

export interface DisplayPayload {
  frontElements: Array<Record<string, unknown>>;
  backElements: Array<Record<string, unknown>>;
  ledColorHex?: string;
}

const APP_NAME = DEVICE_APPLICATION_NAME;

/** The emulator-only element the animated icon's current frame is shown as. */
const ICON_PREVIEW_ELEMENT_ID = 'icon_anim_preview';

/** Collaborators a test may substitute. */
export interface DisplayRendererOptions {
  iconAnimator?: IconAnimator;
  /**
   * Where the animations live. The default is derived from `__dirname`, which
   * is only right in the bundled build (`dist/main`); from source, as under
   * the test runner, it points one level short of the repository.
   */
  animationsDir?: string;
}

/**
 * Service rendering hardware display screen payloads according to physical pixel templates.
 * Front Display (72x16 RGB LED): All content is rasterized into a pixel canvas, encoded as
 * a 72×16 PNG, and transmitted via the asset upload pipeline to avoid JSON buffer issues.
 * Rear Display (160x80 OLED): Legacy element-based rendering retained for rear OLED.
 */
export class DisplayRenderer {
  private _driver: BusyBarDriver;
  /**
   * Signature of the frame the device is believed to be showing.
   *
   * Null means "unknown, transmit regardless" -- after a failure, a manual
   * clear, or a reconnect, where the device's actual contents no longer follow
   * from what we last sent.
   */
  private lastTransmittedSignature: string | null = null;
  private priorityEngine?: IPriorityPreemptionEngine;
  private colorTheme: ColorThemeId = 'emerald';
  private rearOledMode: RearOledMode = 'DIAGNOSTICS';
  private ledMode: LedAnimationMode = 'SOLID';

  private lastState: HardwareDisplayStateDTO = {
    frontElements: [],
    backElements: [],
    ledColorHex: '#10B981FF',
    ledMode: 'SOLID',
    colorTheme: 'emerald',
    rearOledMode: 'DIAGNOSTICS'
  };

  private stateChangeCallbacks: Set<(state: HardwareDisplayStateDTO) => void> = new Set();
  private isCelebrating: boolean = false;
  private celebrationTimeout: NodeJS.Timeout | null = null;
  /**
   * The session a playing scene announces, if any. Its own updates -- one a
   * second while it runs -- are held behind the scene; any other session
   * starting ends it.
   */
  private sceneSessionId: string | null = null;
  private lastSessionCache: ActiveSessionDTO | null = null;
  private animationPlayer: AnimationPlayer;
  /** Tracked so a second banner cannot be cut short by the first one's timer. */
  private _bannerReleaseTimer: NodeJS.Timeout | null = null;
  private frameBufferToggle: boolean = false;
  private iconAnimator: IconAnimator;
  /**
   * The animated icon the frame being painted carries, if any.
   *
   * Set by the paint helpers and consumed by `transmitFrame`, which resets it:
   * a screen that does not ask for an animated icon therefore removes the
   * previous screen's, rather than leaving it spinning over the wrong text.
   */
  private frameIcon: string | null = null;
  private showIdleClockFallback: boolean = false;

  /** The software 72×16 pixel canvas that is encoded and uploaded each frame. */
  private canvas: PixelCanvas = new PixelCanvas(
    DISPLAY_CONSTANTS.FRONT_GRID_WIDTH,
    DISPLAY_CONSTANTS.FRONT_GRID_HEIGHT
  );

  constructor(driver: BusyBarDriver, priorityEngine?: IPriorityPreemptionEngine, options: DisplayRendererOptions = {}) {
    if (!driver) {
      throw new ArgumentNullException('driver');
    }
    this._driver = driver;
    this.priorityEngine = priorityEngine;
    const animationsDir = options.animationsDir ?? defaultAnimationsDir();
    this.animationPlayer = new AnimationPlayer(driver, animationsDir);
    this.animationPlayer.setLedColorCallback(() => this.lastState.ledColorHex);
    this.onAnimationFrame = this.onAnimationFrame.bind(this);
    this.iconAnimator =
      options.iconAnimator ??
      new IconAnimator(driver, name => loadAnimationSequence(animationsDir, name), {
        onPreviewFrame: frame => this.onIconPreviewFrame(frame)
      });
  }

  /**
   * Lays the animated icon's current frame over the emulator's copy of the
   * screen. Emulator only: the device animates the icon itself.
   */
  private onIconPreviewFrame(frame: Buffer | null): void {
    if (this.stateChangeCallbacks.size === 0) return;
    const base = this.lastState.frontElements.filter(el => el.id !== ICON_PREVIEW_ELEMENT_ID);
    const overlay = frame
      ? [{ id: ICON_PREVIEW_ELEMENT_ID, type: 'image', x: 0, y: 0, data: `data:image/png;base64,${frame.toString('base64')}` }]
      : [];
    this.lastState.frontElements = [...base, ...(overlay as unknown as DisplayElementDTO[])];
    for (const callback of this.stateChangeCallbacks) {
      callback(this.lastState);
    }
  }

  private onAnimationFrame(frameBuffer: Buffer, _frameIndex: number) {
    this.lastTransmittedSignature = null;

    // Nobody is watching the emulator, so there is nothing to encode. This ran
    // per frame for the whole of a looping animation -- base64 of every frame
    // of a 1,080-frame lunch screen -- whether or not the window was even open.
    if (this.stateChangeCallbacks.size === 0) return;

    const base64 = frameBuffer.toString('base64');
    const imgElement = { id: 'anim_frame', type: 'image', x: 0, y: 0, data: `data:image/png;base64,${base64}` };
    this.lastState.frontElements = [imgElement as unknown as DisplayElementDTO];
    for (const callback of this.stateChangeCallbacks) {
      callback(this.lastState);
    }
  }

  public setPriorityEngine(engine: IPriorityPreemptionEngine): void {
    this.priorityEngine = engine;
  }

  /**
   * Forgets what the device is believed to be showing.
   *
   * Call after anything that changes the display outside `transmitFrame` -- a
   * clear, a reconnect, an animation taking over the panel -- otherwise the
   * next identical frame is deduplicated against a device that is no longer
   * showing it, and the display stays blank.
   */
  public invalidateFrameCache(): void {
    this.lastTransmittedSignature = null;
    this.iconAnimator.reset();
  }

  /// <summary>
  /// Mandatorily evaluates the requested display draw against the Priority Preemption Engine.
  /// If evaluated as suppressed or preempted, hardware transmission is strictly blocked.
  /// </summary>
  public requestRender(
    eventName: string,
    renderFn: () => DisplayPayload,
    options: RequestRenderOptions = {}
  ): DisplayPayload {
    if (!eventName) throw new ArgumentNullException('eventName');
    if (!renderFn) throw new ArgumentNullException('renderFn');

    if (this.priorityEngine) {
      // A screen that redraws on a timer must not be queued for replay: by the
      // time the lock frees, every queued frame is stale, and the tracker is
      // redrawn anyway when `releaseActiveLock` restores the context mode.
      const queueCallback = options.queueOnPreempt === false ? undefined : renderFn;
      const evalResult = this.priorityEngine.evaluateRequest(eventName, undefined, queueCallback);
      if (!evalResult || !evalResult.shouldRender) {
        // Suppressed or queued. `evaluateRequest` does not take the lock on
        // either path, so there is nothing to release here.
        return {
          frontElements: this.lastState.frontElements as unknown as Array<Record<string, unknown>>,
          backElements: this.lastState.backElements as unknown as Array<Record<string, unknown>>,
          ledColorHex: this.lastState.ledColorHex
        };
      }

      // The lock is held by this event from here on. If the render throws, no
      // other code path releases it, and the display stays frozen at this
      // priority until the user presses BACK.
      try {
        return renderFn();
      } catch (err) {
        this.priorityEngine.releaseActiveLock(eventName);
        throw err;
      }
    }

    return renderFn();
  }

  /// <summary>
  /// Registers a listener for real-time hardware display state updates for the screen emulator.
  /// </summary>
  public onStateChanged(cb: (state: HardwareDisplayStateDTO) => void): () => void {
    this.stateChangeCallbacks.add(cb);
    return () => this.stateChangeCallbacks.delete(cb);
  }

  private _contextMode: UserMode = 'WORK';

  /// <summary>
  /// Sets active user context mode (WORK, LUNCH, AWAY) and updates persistent display layout.
  /// </summary>
  public setContextMode(mode: UserMode): void {
    this._contextMode = mode;
    if (mode === 'LUNCH') {
      this.renderLunchMode();
    } else if (mode === 'AWAY') {
      this.renderAwayMode();
    } else if (mode === 'WORK') {
      // A one-shot scene keeps the panel until its own timer ends. Every lock
      // release lands here -- the picker handing the display back right after
      // GO!, a banner ending during DONE! -- and stopping unconditionally cut
      // the scene off the moment it started.
      if (!this.isCelebrating) this.animationPlayer.stop();
      this.renderActiveSession(this.lastSessionCache);
    }
  }

  /// <summary>
  /// Sets active visual color theme palette for front display text elements.
  /// </summary>
  public setColorTheme(themeId: ColorThemeId): void {
    this.colorTheme = themeId;
  }

  /// <summary>
  /// Sets active view mode for rear 160x80 OLED display.
  /// </summary>
  public setRearOledMode(mode: RearOledMode): void {
    this.rearOledMode = mode;
  }

  /// <summary>
  /// Sets whether the hardware display should fallback to its native clock when idle.
  /// </summary>
  public setShowIdleClockFallback(enabled: boolean): void {
    this.showIdleClockFallback = enabled;
  }

  private pausedSelection: 'STOP' | 'FINISH' = 'FINISH';

  /// <summary>
  /// Moves the paused screen's selection to STOP or FINISH.
  /// </summary>
  /**
   * Sets rather than toggles: STOP is on the left and FINISH on the right, so
   * turning the wheel left picks STOP and right picks FINISH, and a further
   * turn the same way stays put. A toggle flipped on every notch, which let
   * one notch too many land on the other choice just before the click.
   *
   * Redraws only on a change, so turning against an end costs nothing.
   */
  public selectPausedChoice(choice: 'STOP' | 'FINISH'): 'STOP' | 'FINISH' {
    if (choice === this.pausedSelection) return choice;
    this.pausedSelection = choice;
    if (this.lastSessionCache && this.lastSessionCache.status === 'PAUSED') {
      this.renderActiveSession(this.lastSessionCache);
    }
    return this.pausedSelection;
  }

  /// <summary>
  /// Retrieves current paused option selection ('STOP' or 'FINISH').
  /// </summary>
  public getPausedSelection(): 'STOP' | 'FINISH' {
    return this.pausedSelection;
  }

  /// <summary>
  /// Retrieves current display state snapshot.
  /// </summary>
  public getDisplayState(): HardwareDisplayStateDTO {
    return { ...this.lastState };
  }

  /**
   * Normalizes hex color string to 8-character #RRGGBBAA format per BUSY Bar OpenAPI spec.
   */
  public static normalizeHexColor(color: string): string {
    if (!color) return '#FFFFFFFF';
    let clean = color.trim().toUpperCase();
    if (!clean.startsWith('#')) {
      clean = '#' + clean;
    }
    if (clean.length === 7) {
      clean = clean + 'FF';
    }
    return clean;
  }

  /**
   * Converts a 2D pixel matrix into hardware-compliant horizontal rectangle strip elements.
   * Retained for backward-compatibility with tests and rear OLED element generation.
   */
  public static matrixToRectangleStrips(
    matrix: (string | null)[][],
    originX: number = 0,
    originY: number = 0,
    display: 'front' | 'back' = 'front',
    idPrefix: string = 'strip'
  ): Array<Record<string, unknown>> {
    const strips: Array<Record<string, unknown>> = [];
    if (!matrix || matrix.length === 0) return strips;

    for (let r = 0; r < matrix.length; r++) {
      const row = matrix[r];
      if (!row) continue;

      let c = 0;
      while (c < row.length) {
        const pixelColor = row[c];
        if (!pixelColor) {
          c++;
          continue;
        }

        const startC = c;
        const colorHex = DisplayRenderer.normalizeHexColor(pixelColor);

        while (c < row.length && row[c] && DisplayRenderer.normalizeHexColor(row[c]!) === colorHex) {
          c++;
        }

        const stripWidth = c - startC;
        strips.push({
          id: `${idPrefix}_r${r}_c${startC}`,
          type: 'rectangle',
          x: originX + startC,
          y: originY + r,
          width: stripWidth,
          height: 1,
          radius: 0,
          fill: 'solid',
          fill_colors: [colorHex],
          border_width: 0,
          align: 'top_left',
          display
        });
      }
    }

    return strips;
  }

  /**
   * Palette for the active colour theme.
   *
   * The switch previously handled 'neon_night' and 'default', neither of which
   * is a ColorThemeId. The two real themes it failed to name -- 'emerald' and
   * 'nordic_cyan' -- both fell through to the same branch, so selecting Nordic
   * Cyan rendered exactly like Emerald.
   *
   * The exhaustiveness check makes adding a theme to ColorThemeId a compile
   * error here rather than a silent fallthrough.
   */
  private getThemeColors(): { keyColor: string } {
    switch (this.colorTheme) {
      case 'cyberpunk':
        return { keyColor: '#EC4899FF' };
      case 'retro_arcade':
        return { keyColor: '#FBBF24FF' };
      case 'nordic_cyan':
        return { keyColor: '#88C0D0FF' };
      case 'emerald':
        return { keyColor: '#3B82F6FF' };
      default: {
        const unhandled: never = this.colorTheme;
        console.warn(`[DisplayRenderer] Unhandled colour theme: ${String(unhandled)}`);
        return { keyColor: '#3B82F6FF' };
      }
    }
  }

  /**
   * Formats elapsed time for the front display.
   *
   * Seconds are omitted while tracking. The front display is a rasterised PNG
   * uploaded in full on every change, so a ticking seconds digit meant a fresh
   * upload and draw every second for as long as a session ran -- around 28,800
   * requests a day doing nothing but advancing one character. At minute
   * resolution the frame is identical for 59 of every 60 ticks and the dedupe in
   * `transmitFrame` drops them.
   *
   * The paused screen does not keep seconds either, though for a different
   * reason: it shares the row with the STOP/FINISH controls, leaving 26 pixels
   * for the timer, and the 3x5 font fits six characters in that. `01:02:05`
   * rendered as `01:02:` -- a trailing colon and nothing after it. Rather than
   * drop the hours or shrink the controls, both screens read HH:MM.
   */
  private formatTime(totalSec: number, includeSeconds: boolean = true): string {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    const hh = hrs.toString().padStart(2, '0');
    const mm = mins.toString().padStart(2, '0');
    if (!includeSeconds) return `${hh}:${mm}`;
    return `${hh}:${mm}:${secs.toString().padStart(2, '0')}`;
  }

  private lastInputKey: string = 'NONE';
  private lastInputTime: string = 'N/A';

  public logLastInputKey(key: string): void {
    this.lastInputKey = key.toUpperCase();
    this.lastInputTime = new Date().toLocaleTimeString();
    // Force a re-render of the active session to update the diagnostics panel immediately
    if (this.lastSessionCache) {
      this.renderActiveSession(this.lastSessionCache);
    }
  }

  /**
   * Builds the 160x80 rear-panel content.
   *
   * PREVIEW ONLY. `transmitFrame` sends the front matrix PNG to the device and
   * nothing else, so these elements never reach the hardware -- they are
   * published in the display state and drawn by the on-screen emulator, and
   * that is currently their only destination.
   *
   * Colours are still written as 8-digit #RRGGBBAA because the hardware
   * contract requires exactly 8 and rejects the whole draw otherwise. Keeping
   * them valid means wiring this to the device later cannot take the working
   * front display down with it.
   */
  private buildRearElements(session: ActiveSessionDTO | null): Array<Record<string, unknown>> {
    if (this.rearOledMode === 'STEALTH_CLOCK') {
      return [
        { id: 'rear_clock_0', type: 'text', font: 'bold', x: 20, y: 15, color: '#FFFFFFFF', text: new Date().toLocaleTimeString(), align: 'top_left' },
        { id: 'rear_clock_1', type: 'text', font: 'tiny', x: 25, y: 45, color: '#888888FF', text: 'BUSY BAR STEALTH MODE', align: 'top_left' }
      ];
    }

    if (this.rearOledMode === 'PERFORMANCE_MONITOR') {
      // Previously this printed "CPU Load : 14%" and "RAM Usage : 42% (6.8 /
      // 16 GB)" as string literals -- invented numbers that never changed.
      // These are read from the OS. CPU load is omitted rather than faked:
      // deriving it needs two os.cpus() samples over an interval, which is a
      // feature rather than a display concern.
      const totalBytes = os.totalmem();
      const usedBytes = totalBytes - os.freemem();
      const usedPct = Math.round((usedBytes / totalBytes) * 100);
      const toGb = (bytes: number): string => (bytes / 1024 ** 3).toFixed(1);
      const uptimeMins = Math.floor(os.uptime() / 60);

      return [
        { id: 'rear_perf_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFFFF', text: 'SYSTEM PERFORMANCE MONITOR', align: 'top_left' },
        { id: 'rear_perf_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCCFF', text: `RAM Usage : ${usedPct}% (${toGb(usedBytes)} / ${toGb(totalBytes)} GB)`, align: 'top_left' },
        { id: 'rear_perf_2', type: 'text', font: 'tiny', x: 0, y: 32, color: '#CCCCCCFF', text: `Uptime    : ${Math.floor(uptimeMins / 60)}h ${uptimeMins % 60}m`, align: 'top_left' },
        { id: 'rear_perf_3', type: 'text', font: 'tiny', x: 0, y: 48, color: '#CCCCCCFF', text: `Active    : ${session ? session.taskKey : 'IDLE'}`, align: 'top_left' }
      ];
    }

    // Default DIAGNOSTICS Mode
    const status = this._driver.getDeviceStatus();
    return [
      { id: 'rear_diag_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFFFF', text: 'BUSY BAR DIAGNOSTICS [USB/WiFi]', align: 'top_left' },
      { id: 'rear_diag_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCCFF', text: `IP: ${status.ipAddress} | Ping: ${status.webSocketPingMs}ms`, align: 'top_left' },
      { id: 'rear_diag_2', type: 'text', font: 'tiny', x: 0, y: 32, color: '#CCCCCCFF', text: `Frames: ${status.framesSent} OK, ${status.framesFailed} FAIL`, align: 'top_left' },
      { id: 'rear_diag_3', type: 'text', font: 'tiny', x: 0, y: 48, color: '#CCCCCCFF', text: `Last Input: ${this.lastInputKey} @ ${this.lastInputTime}`, align: 'top_left' },
      { id: 'rear_diag_4', type: 'text', font: 'tiny', x: 0, y: 64, color: '#CCCCCCFF', text: `Task: ${session ? session.taskKey : 'NONE'} (${session ? session.status : 'IDLE'})`, align: 'top_left' }
    ];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Pixel Canvas Rendering Helpers
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Paints the standard icon + 2-row text layout onto the pixel canvas.
   * Icon occupies x=0..15 (16px wide), text occupies x=17..71 (55px wide).
   */
  private paintIconAndTwoRows(
    iconBitmap: (string | null)[][],
    row0Text: string,
    row1Text: string,
    row0Color: string,
    row1Color: string,
    animatedIcon?: BitmapIconId
  ): void {
    this.canvas.clear();
    this.frameIcon = animatedIcon ? ANIMATED_ICONS[animatedIcon] ?? null : null;
    // Draw 16×16 icon, centered vertically in the 16px display height
    const layout = DISPLAY_CONSTANTS.LAYOUT_OFFSETS;
    this.canvas.drawBitmap(iconBitmap, 0, 0, layout.ICON_SIZE, layout.ICON_SIZE);
    // Row 0: main label (task key + elapsed, or status)
    this.canvas.drawTextClipped(row0Text, layout.TEXT_X, layout.ROW0_Y, row0Color, layout.TEXT_FIELD_WIDTH);
    // Row 1: secondary label (task title or status detail)
    this.canvas.drawSmallText(row1Text, layout.TEXT_X, layout.ROW1_Y, row1Color, layout.TEXT_FIELD_WIDTH);
  }

  /**
   * The paused screen's text: the task and its time on row 0, STOP and FINISH
   * side by side on row 1, the chosen one inside a 7px highlight bar.
   *
   * The two used to be stacked in a column on the right, which left the task
   * 26px: "KEY: title" came out as "SPR-..." and even the key alone did not
   * fit. Side by side they also follow the wheel, which turns left and right.
   */
  private paintPausedRows(taskText: string, timerText: string, color: string): void {
    const layout = DISPLAY_CONSTANTS.LAYOUT_OFFSETS;
    const right = layout.TEXT_X + layout.TEXT_FIELD_WIDTH;
    const timerWidth = measureText(timerText, ROW0_FONT);
    this.canvas.drawTextClipped(timerText, right - timerWidth, layout.ROW0_Y, color, timerWidth);
    this.canvas.drawTextClipped(
      taskText, layout.TEXT_X, layout.ROW0_Y, color, layout.TEXT_FIELD_WIDTH - timerWidth - PAUSED_TIMER_GAP_PX
    );

    let x = layout.TEXT_X;
    for (const choice of ['STOP', 'FINISH'] as const) {
      const width = measureText(choice, ROW1_FONT) + 1;       // a pixel of bar each side
      const chosen = this.pausedSelection === choice;
      if (chosen) this.canvas.drawRect(x, PAUSED_BAR_Y, width, PAUSED_BAR_HEIGHT, '#F59E0B');
      this.canvas.drawSmallText(choice, x + 1, PAUSED_BAR_Y + 1, chosen ? '#000000' : '#888888', width);
      x += width + PAUSED_CHOICE_GAP_PX;
    }
  }

  /**
   * Paints the icon + two rows layout with a one-pixel progress bar under row 1.
   *
   * The same layout as every other Unity screen -- state in row 0, project in
   * row 1 -- where the bar used to take row 1 and push the project into row 0
   * beside the label, cut to "BUILDING: M...".
   */
  private paintIconTwoRowsAndBar(
    iconBitmap: (string | null)[][],
    row0Text: string,
    row1Text: string,
    row0Color: string,
    progressPercent: number,
    barColor: string,
    animatedIcon?: BitmapIconId
  ): number {
    this.paintIconAndTwoRows(iconBitmap, row0Text, row1Text, row0Color, '#FFFFFF', animatedIcon);
    const layout = DISPLAY_CONSTANTS.LAYOUT_OFFSETS;
    const barFillW = Math.max(1, Math.floor((progressPercent * layout.TEXT_FIELD_WIDTH) / 100));
    this.canvas.drawRect(layout.TEXT_X, layout.PROGRESS_BAR_Y, layout.TEXT_FIELD_WIDTH, 1, '#1E293B');
    this.canvas.drawRect(layout.TEXT_X, layout.PROGRESS_BAR_Y, barFillW, 1, barColor);
    return barFillW;
  }

  /**
   * Encodes the current canvas to PNG and transmits it via the asset pipeline.
   * Also dispatches the state update to emulator subscribers.
   */
  private async transmitFrame(
    ledColorHex: string,
    backElements: Array<Record<string, unknown>>,
    frontElementsForEmulator: Array<Record<string, unknown>>
  ): Promise<void> {
    const pngBuffer = encodeMatrixToPng(
      this.canvas.getPixels(),
      DISPLAY_CONSTANTS.FRONT_GRID_WIDTH,
      DISPLAY_CONSTANTS.FRONT_GRID_HEIGHT
    );

    // Every transmission is an asset upload plus a draw -- two HTTP requests --
    // and the tracker redraws once a second whether or not anything changed.
    // Comparing what we are about to send with what the device already has
    // costs one hash of a 72x16 PNG.
    const frameSignature = createHash('sha1')
      .update(pngBuffer)
      .update(ledColorHex)
      .update(this.ledMode)
      .digest('hex');

    // While the device is playing a `.anim` itself, the front matrix is not
    // ours to draw. `sendPixelFrame` puts down `px_matrix_img`, which
    // composites above `hardware_anim` and is opaque across the whole 72x16
    // panel -- so transmitting here blacks out the animation the player just
    // started. Every animated mode hits this: the branch clears the canvas,
    // starts the animation and then transmits the blank canvas.
    //
    // The rear elements and the emulator callbacks below still run, because
    // those are what feed the on-screen preview -- which is exactly why this
    // was invisible in development for so long.
    const frontOwnedByAnimation = this.animationPlayer.isHardwareAnimationActive();

    // Consumed here, whatever the frame, so the next screen starts without one.
    const animatedIcon = frontOwnedByAnimation ? null : this.frameIcon;
    this.frameIcon = null;

    if (frontOwnedByAnimation) {
      // Forget the signature rather than record one that was never sent, so the
      // first frame after the animation stops always transmits.
      this.lastTransmittedSignature = null;
    } else if (frameSignature !== this.lastTransmittedSignature) {
      this.lastTransmittedSignature = frameSignature;
      this.frameBufferToggle = !this.frameBufferToggle;
      const dynamicFilename = `frame_${this.frameBufferToggle ? '0' : '1'}.png`;

      // Fire-and-forget hardware transmission (non-blocking for render callers)
      void this.sendFrameToDevice(pngBuffer, ledColorHex, dynamicFilename);
    }

    // After the frame, though the order does not matter on the device: with
    // `z_index` the icon composites above the frame whichever lands first.
    this.iconAnimator.show(animatedIcon);

    this.lastState = {
      frontElements: frontElementsForEmulator as unknown as DisplayElementDTO[],
      backElements: backElements as unknown as DisplayElementDTO[],
      ledColorHex,
      ledMode: this.ledMode,
      colorTheme: this.colorTheme,
      rearOledMode: this.rearOledMode
    };

    for (const callback of this.stateChangeCallbacks) {
      callback(this.lastState);
    }
  }

  /**
   * Sends one frame and forgets its signature when it did not land.
   *
   * The deduplication in `transmitFrame` assumes the device shows the last
   * frame recorded. When it does not, the next identical render has to go out
   * again, or the bar stays wrong until the picture happens to change -- which
   * for an `HH:MM` timer is up to a minute, and for a static screen is never.
   * This used to be a `.catch` on a call that reported failure by returning
   * `false`, so the reset below could not run for the one failure that
   * actually happens.
   *
   * A `409` keeps the signature on purpose. Another application holds the
   * display, and forgetting would re-upload the same frame on every render
   * for as long as it does; our last accepted frame is what the device shows
   * when it lets go.
   */
  private async sendFrameToDevice(pngBuffer: Buffer, ledColorHex: string, filename: string): Promise<void> {
    let outcome: FrameOutcome;
    try {
      outcome = await this._driver.sendPixelFrame(pngBuffer, ledColorHex, APP_NAME, filename);
    } catch (err) {
      console.error('[DisplayRenderer] sendPixelFrame failed:', err);
      this.lastTransmittedSignature = null;
      return;
    }
    if (outcome === 'superseded') {
      this.lastTransmittedSignature = null;
      return;
    }
    // A finished scene is still on the panel, under this frame. It goes only
    // now that the frame is known to have landed above it: removed any earlier,
    // the panel would be left empty, which closes the device's screen -- and
    // that, after an image and an animation shared it, is what hangs the bar.
    if (outcome === 'sent' && !this.animationPlayer.isHardwareAnimationActive()) {
      await this.animationPlayer.retireScene();
    }
  }

  /**
   * Converts the current PixelCanvas pixels into rectangle strip elements for the emulator.
   * This allows the HardwareDisplayEmulator to show exactly what will be sent to hardware.
   */
  private canvasToEmulatorElements(): Array<Record<string, unknown>> {
    return DisplayRenderer.matrixToRectangleStrips(this.canvas.getPixels(), 0, 0, 'front', 'px');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public Render Methods
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Renders Idle View on Front Display.
   */
  public renderIdle(): DisplayPayload {
    return this.renderActiveSession(null);
  }

  /**
   * Renders LUNCH MUTE animation screen on Front Display with warm amber LED.
   */
  public renderLunchMode(): DisplayPayload {
    return this.requestRender('lunchModePriority', () => {
      const frontElements: Array<Record<string, unknown>> = [];
      this.canvas.clear();
      void this.animationPlayer.play(FRONT_ANIMATIONS.LUNCH, { loop: true, onFrame: this.onAnimationFrame })
        .catch(err => console.error('[DisplayRenderer] animationPlayer.play failed:', err));

      const backElements = [
        { id: 'rear_lunch_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#F59E0BFF', text: 'LUNCH BREAK IN PROGRESS', align: 'top_left' },
        { id: 'rear_lunch_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCCFF', text: 'Notifications Muted | Session Paused', align: 'top_left' }
      ];

      this.ledMode = 'BREATHING';
      const payload: DisplayPayload = {
        frontElements,
        backElements,
        ledColorHex: '#F59E0BFF'
      };

      void this.transmitFrame('#F59E0BFF', backElements, frontElements)
        .catch(err => console.error('[DisplayRenderer] transmitFrame failed:', err));
      return payload;
    });
  }

  /**
   * Renders AWAY / STEALTH animation screen on Front Display with dim purple LED.
   */
  public renderAwayMode(): DisplayPayload {
    return this.requestRender('awayModePriority', () => {
      const frontElements: Array<Record<string, unknown>> = [];
      this.canvas.clear();
      void this.animationPlayer.play(FRONT_ANIMATIONS.AWAY, { loop: true, onFrame: this.onAnimationFrame })
        .catch(err => console.error('[DisplayRenderer] animationPlayer.play failed:', err));

      const backElements = [
        { id: 'rear_away_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#A855F7FF', text: 'SYSTEM LOCKED / AWAY', align: 'top_left' },
        { id: 'rear_away_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#888888FF', text: 'Stealth Display Active', align: 'top_left' }
      ];

      this.ledMode = 'SOLID';
      const payload: DisplayPayload = {
        frontElements,
        backElements,
        ledColorHex: '#A855F7FF'
      };

      void this.transmitFrame('#A855F7FF', backElements, frontElements)
        .catch(err => console.error('[DisplayRenderer] transmitFrame failed:', err));
      return payload;
    });
  }

  /**
   * Renders Agile Ceremony Prompt on Front Display with Attention-Grabbing Pulsing LED & Scrolling Text.
   */
  public renderCeremonyPrompt(type: 'STANDUP' | 'LUNCH' | 'EOD', title: string): DisplayPayload {
    const priorityEvent = type === 'EOD' ? 'eodWrapUpPriority' : 'standupPromptPriority';
    return this.requestRender(priorityEvent, () => {
      const isEod = type === 'EOD';
      const isLunch = type === 'LUNCH';
      const iconId: BitmapIconId = isLunch ? 'burger' : 'clock';
      const accentColor = isEod ? '#A855F7' : isLunch ? '#F59E0B' : '#3B82F6';
      const label = isEod ? 'EOD WRAP-UP' : isLunch ? 'LUNCH TIME' : 'DAILY STANDUP';

      if (type === 'STANDUP') {
        this.canvas.clear();
        void this.animationPlayer.play(FRONT_ANIMATIONS.MEETING, { loop: true, onFrame: this.onAnimationFrame })
          .catch(err => console.error('[DisplayRenderer] animationPlayer.play failed:', err));
      } else {
        this.paintIconAndTwoRows(
          getBitmapById(iconId),
          label,
          title || 'Click to Start',
          accentColor,
          '#FFFFFF',
          iconId
        );
      }

      const backElements = [
        { id: 'rear_ceremony_0', type: 'text', font: 'tiny', x: 0, y: 0, color: `${accentColor}FF`, text: `CEREMONY PROMPT: ${type}`, align: 'top_left' },
        { id: 'rear_ceremony_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCCFF', text: 'Press Scroll Wheel or START', align: 'top_left' }
      ];

      this.ledMode = 'PULSE_ALERT';
      const payload: DisplayPayload = {
        frontElements: this.canvasToEmulatorElements(),
        backElements,
        ledColorHex: `${accentColor}FF`
      };
      void this.transmitFrame(`${accentColor}FF`, backElements, payload.frontElements)
        .catch(err => console.error('[DisplayRenderer] transmitFrame failed:', err));
      return payload;
    });
  }

  /**
   * Renders End-of-Day completion screen on Front Display with green checkmark and emerald LED.
   */
  public renderEodCompleted(message: string = 'Day Complete!'): DisplayPayload {
    return this.requestRender('eodWrapUpPriority', () => {
      this.paintIconAndTwoRows(
        getBitmapById('checkmark'),
        'EOD COMPLETE',
        message,
        '#10B981',
        '#FFFFFF',
        'checkmark'
      );

      const backElements = [
        { id: 'rear_eod_done_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#10B981FF', text: 'END-OF-DAY WRAP-UP COMPLETE', align: 'top_left' },
        { id: 'rear_eod_done_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCCFF', text: 'All tasks logged & scenes saved.', align: 'top_left' }
      ];

      this.ledMode = 'SOLID';
      const payload: DisplayPayload = {
        frontElements: this.canvasToEmulatorElements(),
        backElements,
        ledColorHex: '#10B981FF'
      };
      void this.transmitFrame('#10B981FF', backElements, payload.frontElements)
        .catch(err => console.error('[DisplayRenderer] transmitFrame failed:', err));
      return payload;
    });
  }

  /**
   * Renders Active Task Tracker View on Front Display:
   *  - Left (x=0..15): the stopwatch, ticking while tracking
   *  - Row 0 (y=0): Task title (TASK-KEY: Title)
   *  - Row 1 (y=8): Task timer (HH:MM, in TIMER_FONT)
   *  - When PAUSED: Text & LED turn ORANGE (#F59E0B), the time moves to row 0
   *    and row 1 offers STOP and FINISH, chosen with the wheel.
   */
  public renderActiveSession(session: ActiveSessionDTO | null): DisplayPayload {
    this.lastSessionCache = session;

    if (session && session.status === 'TRACKING' && this.isCelebrating && session.sessionId !== this.sceneSessionId) {
      this.isCelebrating = false;
      this.sceneSessionId = null;
      this.clearCelebrationTimer();
    }

    if (this.isCelebrating || this._contextMode === 'LUNCH' || this._contextMode === 'AWAY') {
      return {
        frontElements: this.lastState.frontElements as unknown as Array<Record<string, unknown>>,
        backElements: this.lastState.backElements as unknown as Array<Record<string, unknown>>,
        ledColorHex: this.lastState.ledColorHex
      };
    }

    if (!session && this.showIdleClockFallback) {
      this.invalidateFrameCache();
      void this._driver.clearDisplay(APP_NAME)
        .catch(err => console.error('[DisplayRenderer] _driver.clearDisplay failed:', err));
      
      const payload: DisplayPayload = {
        frontElements: [],
        backElements: [],
        ledColorHex: '#00000000'
      };

      this.lastState = {
        frontElements: [],
        backElements: [],
        ledColorHex: '#00000000',
        ledMode: 'SOLID',
        colorTheme: this.colorTheme,
        rearOledMode: this.rearOledMode
      };

      for (const callback of this.stateChangeCallbacks) {
        callback(this.lastState);
      }

      // The clearDisplay() above is the whole of it. A draw used to follow it,
      // carrying no elements and led_notification_color '#00000000', on the
      // theory that this turned the LED off.
      //
      // It could not. The device schema declares `elements` required with
      // minItems: 1, so an empty array fails validation and the request was
      // rejected 400 on every idle transition -- the "display payload: device
      // returned 400" in the log.
      //
      // There was also nothing for it to do had it been accepted:
      // led_notification_color is documented as the colour to *blink* the
      // status LED, and "if not specified, the LED will not blink". There is no
      // off colour -- not asking for a blink is how the LED stays dark, and the
      // DELETE has already withdrawn this application's draw.
      return payload;
    }

    // The one screen that used to bypass the priority engine. Because it
    // redraws every second, it overwrote any notification banner within a
    // second of it appearing -- a 10-second alert was visible for one -- and the
    // "Active Session Tracker" row in the priority panel governed nothing.
    //
    // Not queued on preemption: a tracker frame held for the length of an alert
    // is stale by the time it would replay, and releasing the lock restores the
    // context mode, which redraws this anyway.
    return this.requestRender(
      'activeTrackerPriority',
      () => {
      const colors = this.getThemeColors();
      const isPaused = session?.status === 'PAUSED';
      const isTracking = session?.status === 'TRACKING';
      const isStandup = session?.taskTitle?.toLowerCase().includes('standup');

      const titleText = !session
        ? 'Ready'
        : isPaused
          ? session.taskKey || session.taskTitle
          : `${session.taskKey}: ${session.taskTitle}`;
      const timerText = session ? this.formatTime(session.elapsedSeconds, false) : 'No task running';

      const row0Color = isPaused ? '#F59E0B' : session ? colors.keyColor : '#888888';
      const row1Color = isPaused ? '#F59E0B' : session ? '#FFFFFF' : '#888888';
      // Remove edge glow during active tracking tasks by modifying ledMode if needed, but LED must remain green
      const ledColor = isPaused ? '#F59E0BFF' : session ? '#10B981FF' : '#2D3440FF';

      this.ledMode = session ? (isTracking ? 'SOLID' : 'BREATHING') : 'SOLID';

      this.canvas.clear();
      if (isStandup && isTracking) {
        void this.animationPlayer.play(FRONT_ANIMATIONS.MEETING, { loop: true, onFrame: this.onAnimationFrame })
          .catch(err => console.error('[DisplayRenderer] animationPlayer.play failed:', err));
      } else {
        this.animationPlayer.stop();
        // One stopwatch in three states, where all three -- and Day Complete --
        // used to share the checkmark.
        const icon: BitmapIconId = isPaused ? 'stopwatch_paused' : session ? 'stopwatch' : 'stopwatch_idle';
        this.canvas.drawBitmap(getBitmapById(icon), 0, 0, 16, 16);
        this.frameIcon = ANIMATED_ICONS[icon] ?? null;
      }

      if (isPaused) {
        this.paintPausedRows(titleText, timerText, row0Color);
      } else {
        const layout = DISPLAY_CONSTANTS.LAYOUT_OFFSETS;
        this.canvas.drawTextClipped(titleText, layout.TEXT_X, layout.ROW0_Y, row0Color, layout.TEXT_FIELD_WIDTH);
        if (session) {
          // Large, because it is the one thing read from across the room.
          // Still HH:MM: the seconds are the stopwatch's hand, animated by the
          // device, so the frame changes once a minute rather than every
          // second (two HTTP requests and a flash write each).
          this.canvas.drawTextClipped(
            timerText, layout.TEXT_X, layout.ROW1_Y, row1Color, layout.TEXT_FIELD_WIDTH, TIMER_FONT
          );
        } else {
          this.canvas.drawSmallText(timerText, layout.TEXT_X, layout.ROW1_Y, row1Color, layout.TEXT_FIELD_WIDTH);
        }
      }

      const backElements = this.buildRearElements(session);
      const frontEls = this.canvasToEmulatorElements();

      const payload: DisplayPayload = {
        frontElements: frontEls,
        backElements,
        ledColorHex: ledColor
      };

      void this.transmitFrame(ledColor, backElements, frontEls)
        .catch(err => console.error('[DisplayRenderer] transmitFrame failed:', err));
      return payload;
        },
      { queueOnPreempt: false }
    );
  }

  /**
   * Renders the hardware task selector: pick a project, then a task.
   *
   * Laid out like every other screen -- icon, then two rows -- where it used
   * to be bare text with nothing saying which of the two steps it was, how
   * long the list was, or whether turning the wheel would find anything.
   *
   * - The icon names the step: a folder for projects, a checklist for tasks.
   * - Row 0 is the item; row 1 says what kind, or gives the task's key.
   * - Row 1 ends with the position, `3/12`, and a one-pixel scroll bar under
   *   the rows shows where that is in the list.
   *
   * Arrows either side of the number were tried first and do not fit: with
   * them, `SPR-1428` beside `12/12` needs 62px of a 55px field, and the key
   * would be cut -- the fault the paused screen had just been rid of. Without
   * them it takes 54.
   *
   * A task's card shows its status -- grey to do, amber in progress, green
   * done -- and a finished task's name is dimmed.
   *
   * @throws ArgumentException for a position outside its list.
   */
  public renderTaskSelection(
    stage: 'PROJECT' | 'TASK',
    itemName: string,
    options: TaskSelectionOptions = {}
  ): DisplayPayload {
    const { description, position, status } = options;
    if (position) {
      const { index, count } = position;
      if (!Number.isInteger(count) || count < 1) {
        throw new ArgumentException(`Selection count must be a positive integer, got ${count}.`, 'position');
      }
      if (!Number.isInteger(index) || index < 0 || index >= count) {
        throw new ArgumentException(`Selection index ${index} is outside a list of ${count}.`, 'position');
      }
    }

    return this.requestRender('menuPriority', () => {
      const isProject = stage === 'PROJECT';
      const iconId: BitmapIconId = isProject ? 'folder' : TASK_STATUS_ICONS[status ?? 'todo'] ?? 'task';
      const label = isProject ? 'Project' : description || 'Task';
      const titleColor = !isProject && status === 'done' ? SELECTION_DONE_TITLE_COLOR : '#FFFFFF';

      this.paintIconAndTwoRows(getBitmapById(iconId), itemName, '', titleColor, SELECTION_LABEL_COLOR);
      const layout = DISPLAY_CONSTANTS.LAYOUT_OFFSETS;
      const labelWidth = position
        ? this.paintSelectionPosition(position) - layout.TEXT_X - SELECTION_LABEL_GAP_PX
        : layout.TEXT_FIELD_WIDTH;
      this.canvas.drawSmallText(label, layout.TEXT_X, layout.ROW1_Y, SELECTION_LABEL_COLOR, labelWidth);

      const backElements = [
        { id: 'rear_menu_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#3B82F6FF', text: `SELECTION: ${stage}`, align: 'top_left' },
        { id: 'rear_menu_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCCFF', text: 'Scroll to pick, click to select', align: 'top_left' }
      ];

      this.ledMode = 'SOLID';
      const frontEls = this.canvasToEmulatorElements();
      const payload: DisplayPayload = {
        frontElements: frontEls,
        backElements,
        ledColorHex: '#3B82F6FF'
      };

      void this.transmitFrame('#3B82F6FF', backElements, frontEls)
        .catch(err => console.error('[DisplayRenderer] transmitFrame failed:', err));
      return payload;
    });
  }

  /**
   * Draws `3/12` flush right on row 1, and a scroll bar under the rows.
   * Returns the x where the number starts.
   *
   * The bar is the one-pixel line the Unity screens use for progress: a thumb
   * at the item's place in the list, on a dark track. At the far left there is
   * nothing before; at the far right, nothing after. A single-item list gets no
   * bar, since there is nowhere to scroll.
   */
  private paintSelectionPosition({ index, count }: SelectionPosition): number {
    const layout = DISPLAY_CONSTANTS.LAYOUT_OFFSETS;
    const text = `${index + 1}/${count}`;
    const textWidth = measureText(text, ROW1_FONT);
    const textX = layout.TEXT_X + layout.TEXT_FIELD_WIDTH - textWidth;
    this.canvas.drawSmallText(text, textX, layout.ROW1_Y, SELECTION_POSITION_COLOR, textWidth);

    if (count > 1) {
      const track = layout.TEXT_FIELD_WIDTH;
      const thumb = Math.max(SELECTION_THUMB_MIN_PX, Math.round(track / count));
      const thumbX = layout.TEXT_X + Math.round((index * (track - thumb)) / (count - 1));
      this.canvas.drawRect(layout.TEXT_X, layout.PROGRESS_BAR_Y, track, 1, SELECTION_TRACK_COLOR);
      this.canvas.drawRect(thumbX, layout.PROGRESS_BAR_Y, thumb, 1, SELECTION_THUMB_COLOR);
    }
    return textX;
  }

  /**
   * Renders Notification Banner with icon on left and vertically centered header on right (y=5).
   * Message body text is excluded per user specification.
   *
   * The caller supplies `eventName` because only the caller knows which priority
   * class the matched source rule assigned. Deriving it here from a number was
   * the defect: no notification rule reaches 90, so a `HIGH_PRIORITY` alert
   * raised at 70 was re-raised as `messagingPriority` at 65 and refused by the
   * lock its own first request had just taken.
   *
   * Whether a notification outranks Lunch or Away is a separate question, and
   * one the priority panel answers. In the shipped ordering both break screens
   * sit above both notification classes, so a break is not interrupted -- that
   * is configuration working, and this method must not second-guess it.
   */
  public renderNotificationBanner(options: NotificationBannerOptions): DisplayPayload {
    const {
      appName,
      title,
      body,
      eventName = 'messagingPriority',
      iconId = 'slack',
      customIconData,
      timeoutMs = 10000,
      hideBody = false
    } = options;

    const isHighPriority = eventName === 'highNotificationPriority';
    const priority = this.priorityEngine?.getEventPriority(eventName) ?? 0;

    // Composed outside the render callback because it is pure and cheap, and
    // because the callback only runs if the priority engine grants the lock.
    const text = composeNotificationBanner({
      appName,
      title,
      body,
      // A resolved app icon, or a brand bitmap, already says which application
      // this came from. The generic bell says nothing, so in that case the
      // text has to spend a row on the identity instead.
      iconIdentifiesApp: Boolean(customIconData) || iconId !== 'bell',
      hideBody
    });

    return this.requestRender(eventName, () => {
      const bitmapData = customIconData
        ? customIconData
        : AppIconBitmapProcessor.processAppIcon(iconId);

      const accentColor = isHighPriority ? '#EC4899' : '#8B5CF6';

      // The same two-row template every other screen uses. This was the only
      // screen drawing a single centred row, which left the lower row -- and
      // with it the message body -- permanently blank.
      // Only our own fallback bitmap can animate. A resolved icon is the
      // application's own mark, and stays as it is.
      this.paintIconAndTwoRows(
        bitmapData,
        text.row0,
        text.row1,
        accentColor,
        '#FFFFFF',
        customIconData ? undefined : iconId
      );

      const backElements = [
        { id: 'rear_notif_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFFFF', text: `NOTIFICATION (Priority ${priority})`, align: 'top_left' },
        // Untruncated: the rear panel is 160x80 and has room for what the
        // front had to cut.
        { id: 'rear_notif_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCCFF', text: text.fullText, align: 'top_left' }
      ];

      const ledColorHex = `${accentColor}FF`;
      this.ledMode = isHighPriority ? 'FLASH_BURST' : 'PULSE_ALERT';
      const payload: DisplayPayload = {
        frontElements: this.canvasToEmulatorElements(),
        backElements,
        ledColorHex
      };
      void this.transmitFrame(ledColorHex, backElements, payload.frontElements)
        .catch(err => console.error('[DisplayRenderer] transmitFrame failed:', err));

      // Cleared here, inside the callback, and never at method entry: a request
      // the engine suppresses or queues never reaches this point, and cancelling
      // the *running* banner's release timer on its behalf would leave that
      // lock held until the user pressed BACK.
      this.clearBannerTimers();

      if (timeoutMs > 0 && this.priorityEngine) {
        const timer = setTimeout(() => {
          // Null the field before releasing, so a release that renders
          // something else does not then clear its successor's timer.
          this._bannerReleaseTimer = null;
          this.priorityEngine?.releaseActiveLock(eventName);
        }, timeoutMs);
        // A pending banner must not hold the process open at will-quit.
        timer.unref?.();
        this._bannerReleaseTimer = timer;
      }

      return payload;
    });
  }

  /**
   * Cancels a pending banner release.
   *
   * The timer used to be an untracked `setTimeout`. Two notifications of the
   * same class inside the timeout window meant the first banner's timer fired
   * partway through the second's, releasing a lock it no longer owned and
   * cutting the second banner short.
   */
  private clearBannerTimers(): void {
    if (this._bannerReleaseTimer) {
      clearTimeout(this._bannerReleaseTimer);
      this._bannerReleaseTimer = null;
    }
  }

  /**
   * Stops everything holding a timer, for shutdown.
   *
   * Electron does not await an async `will-quit`, so teardown has to be
   * synchronous; all three of these are.
   */
  public dispose(): void {
    this.clearBannerTimers();
    this.iconAnimator.dispose();
    this.clearCelebrationTimer();
    this.animationPlayer.stop();
  }

  /**
   * Celebrates a finished task, then returns to the session.
   *
   * Plays our task-done scene once, on the device, like Lunch and Away. This
   * used to be confetti drawn here and streamed at 10 fps -- an asset upload
   * and a draw for every frame, for four seconds. The device holds a one-shot's
   * last frame (measured on firmware 1.2.4), so `durationSeconds` can outlast
   * the scene and the bar rests on the finished badge rather than going blank.
   * If the device refuses the `.anim`, `AnimationPlayer` streams its frames.
   */
  public renderTaskCompletionConfetti(durationSeconds: number = TASK_DONE_DISPLAY_SECONDS): DisplayPayload {
    return this.playOneShotScene(
      FRONT_ANIMATIONS.TASK_DONE, durationSeconds, '#10B981FF', 'CONFETTI_EXPLOSION', 'TASK COMPLETED SUCCESSFULLY!'
    );
  }

  /**
   * Acknowledges STOP, then returns to the session -- which is now none.
   *
   * Stopping used to go straight to the idle screen, which on the bar looked
   * the same as the stop not having worked, or as the display dropping out.
   * LOGGED says the time was kept and the task left open; amber, the paused
   * screen's colour, where finishing is green.
   */
  public renderTaskLogged(durationSeconds: number = TASK_LOGGED_DISPLAY_SECONDS): DisplayPayload {
    return this.playOneShotScene(FRONT_ANIMATIONS.TASK_LOGGED, durationSeconds, '#F59E0BFF', 'SOLID', 'TIME LOGGED');
  }

  /**
   * Acknowledges a task started from the bar, then shows it running.
   *
   * Clicking a task in the picker used to drop straight to the tracking
   * screen, so the menu vanished with nothing to say the click had landed.
   * The scene ends on the tracking screen's own icon, so the hand-over is
   * seamless. The session's per-second updates do not end it; another task
   * starting does.
   */
  public renderTaskStarted(
    session: ActiveSessionDTO, durationSeconds: number = TASK_STARTED_DISPLAY_SECONDS
  ): DisplayPayload {
    if (!session) throw new ArgumentNullException('session');
    this.lastSessionCache = session;
    return this.playOneShotScene(
      FRONT_ANIMATIONS.TASK_STARTED, durationSeconds, '#10B981FF', 'SOLID', 'GO!', session.sessionId
    );
  }

  /**
   * Plays a full-panel scene once and holds the display for `durationSeconds`,
   * then renders the session as it then stands.
   *
   * A session update that arrives meanwhile is held rather than drawn over the
   * scene, except another task starting, which ends it (see
   * `renderActiveSession`). `sessionId` names the session the scene announces,
   * whose own updates are held too.
   */
  private playOneShotScene(
    scene: string, durationSeconds: number, ledColorHex: string, ledMode: LedAnimationMode, rearText: string,
    sessionId: string | null = null
  ): DisplayPayload {
    this.isCelebrating = true;
    this.sceneSessionId = sessionId;
    this.clearCelebrationTimer();
    this.ledMode = ledMode;

    const backElements = [
      { id: 'rear_scene_0', type: 'text', font: 'tiny', x: 0, y: 0, color: ledColorHex, text: rearText, align: 'top_left' }
    ];

    this.canvas.clear();
    void this.animationPlayer.play(scene, { loop: false, onFrame: this.onAnimationFrame })
      .catch(err => console.error('[DisplayRenderer] animationPlayer.play failed:', err));
    void this.transmitFrame(ledColorHex, backElements, [])
      .catch(err => console.error('[DisplayRenderer] transmitFrame failed:', err));

    this.celebrationTimeout = setTimeout(() => this.endCelebration(), durationSeconds * 1000);

    return {
      frontElements: this.lastState.frontElements as unknown as Array<Record<string, unknown>>,
      backElements,
      ledColorHex
    };
  }

  private endCelebration(): void {
    this.celebrationTimeout = null;
    if (!this.isCelebrating) return;
    this.isCelebrating = false;
    this.sceneSessionId = null;
    this.animationPlayer.stop();
    this.renderActiveSession(this.lastSessionCache);
  }

  private clearCelebrationTimer(): void {
    if (this.celebrationTimeout) {
      clearTimeout(this.celebrationTimeout);
      this.celebrationTimeout = null;
    }
  }

  /**
   * Renders Template C: Unity Play Mode "ON AIR" Alert with Gamepad Controller Icon.
   */
  public renderPlayMode(projectName: string): DisplayPayload {
    return this.requestRender('unityPlayModePriority', () => {
      this.paintIconAndTwoRows(
        getBitmapById('playmode'),
        'ON AIR',
        projectName,
        '#FF0000',
        '#3B82F6',
        'playmode'
      );

      const backElements = [
        { id: 'rear_play_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFFFF', text: 'UNITY PLAY MODE ACTIVE', align: 'top_left' }
      ];

      const payload: DisplayPayload = {
        frontElements: this.canvasToEmulatorElements(),
        backElements,
        ledColorHex: '#FF0000FF'
      };
      this.ledMode = 'PULSE_ALERT';
      void this.transmitFrame('#FF0000FF', backElements, payload.frontElements)
        .catch(err => console.error('[DisplayRenderer] transmitFrame failed:', err));
      return payload;
    });
  }

  /**
   * Renders C# Script Compilation View with Compiling Gear Icon and text (NO progress bar).
   */
  public renderCompilation(projectName: string): DisplayPayload {
    return this.requestRender('unityCompilingPriority', () => {
      const colors = this.getThemeColors();
      this.paintIconAndTwoRows(
        getBitmapById('compiling'),
        'COMPILING',
        projectName,
        colors.keyColor,
        '#FFFFFF',
        'compiling'
      );

      const backElements = [
        { id: 'rear_compile_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFFFF', text: `Compiling ${projectName}`, align: 'top_left' }
      ];

      const payload: DisplayPayload = {
        frontElements: this.canvasToEmulatorElements(),
        backElements,
        ledColorHex: colors.keyColor
      };
      this.ledMode = 'SOLID';
      void this.transmitFrame(colors.keyColor, backElements, payload.frontElements)
        .catch(err => console.error('[DisplayRenderer] transmitFrame failed:', err));
      return payload;
    });
  }

  /**
   * Renders Standalone Game Build View with Unity Icon and progress bar (x=16, width=56).
   */
  public renderBuilding(projectName: string, progress: number = 50): DisplayPayload {
    return this.requestRender('unityCompilingPriority', () => {
      const barColor = progress >= 80 ? '#10B981' : progress >= 40 ? '#3B82F6' : '#FBBF24';
      const progressColorHex = `${barColor}FF`;

      const barFillW = this.paintIconTwoRowsAndBar(
        getBitmapById('hammer'),
        `BUILDING ${progress}%`,
        projectName,
        barColor,
        progress,
        barColor,
        'hammer'
      );

      const backElements = [
        { id: 'rear_build_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFFFF', text: `Building ${projectName} (${progress}%)`, align: 'top_left' }
      ];

      // Build test-queryable elements alongside the canvas pixels for the emulator
      const canvasEls = this.canvasToEmulatorElements();
      const testEls: Array<Record<string, unknown>> = [
        ...canvasEls,
        // Sentinel elements so tests can find by id — not sent to hardware
        { id: 'txt_build', type: 'text', text: `BUILDING ${progress}%`, x: 17, y: 0 },
        {
          id: 'bar_build_active', type: 'rectangle', x: 17,
          y: DISPLAY_CONSTANTS.LAYOUT_OFFSETS.PROGRESS_BAR_Y, width: barFillW, height: 1
        }
      ];

      const payload: DisplayPayload = {
        frontElements: testEls,
        backElements,
        ledColorHex: progressColorHex
      };
      this.ledMode = 'FLASH_BURST';
      void this.transmitFrame(progressColorHex, backElements, canvasEls)
        .catch(err => console.error('[DisplayRenderer] transmitFrame failed:', err));
      return payload;
    });
  }

  /**
   * Renders Lightmap Baking View with Unity Icon and amber progress bar.
   */
  public renderBaking(projectName: string, progress: number = 50): DisplayPayload {
    return this.requestRender('unityCompilingPriority', () => {
      const barColor = '#FBBF24';

      this.paintIconTwoRowsAndBar(
        getBitmapById('bulb'),
        `BAKING ${progress}%`,
        projectName,
        barColor,
        progress,
        barColor,
        'bulb'
      );

      const backElements = [
        { id: 'rear_bake_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFFFF', text: `Baking ${projectName} (${progress}%)`, align: 'top_left' }
      ];

      const payload: DisplayPayload = {
        frontElements: this.canvasToEmulatorElements(),
        backElements,
        ledColorHex: '#FBBF24FF'
      };
      this.ledMode = 'FLASH_BURST';
      void this.transmitFrame('#FBBF24FF', backElements, payload.frontElements)
        .catch(err => console.error('[DisplayRenderer] transmitFrame failed:', err));
      return payload;
    });
  }

  /**
   * Renders Unity Exception / Error Alert View with Orange Error Icon.
   */
  public renderException(projectName: string, message: string): DisplayPayload {
    return this.requestRender('unityBuildFailurePriority', () => {
      this.paintIconAndTwoRows(
        getBitmapById('error'),
        'EXCEPTION',
        message,
        '#EF4444',
        '#FFFFFF',
        'error'
      );

      const backElements = [
        { id: 'rear_err_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#EF4444FF', text: `EXCEPTION: ${projectName}`, align: 'top_left' },
        { id: 'rear_err_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCCFF', text: message, align: 'top_left' }
      ];

      const payload: DisplayPayload = {
        frontElements: this.canvasToEmulatorElements(),
        backElements,
        ledColorHex: '#EF4444FF'
      };
      this.ledMode = 'PULSE_ALERT';
      void this.transmitFrame('#EF4444FF', backElements, payload.frontElements)
        .catch(err => console.error('[DisplayRenderer] transmitFrame failed:', err));
      return payload;
    });
  }
}
