import { BusyBarDriver } from './busybar-driver';
import { createHash } from 'crypto';
import * as os from 'os';
import { ActiveSessionDTO, ColorThemeId, RearOledMode, LedAnimationMode, HardwareDisplayStateDTO, BitmapIconId, UserMode, DisplayElementDTO, ArgumentNullException } from '../../shared/dtos';
import { getBitmapById } from '../../shared/pixel-bitmaps';
import { AppIconBitmapProcessor } from './app-icon-bitmap-processor';
import { IPriorityPreemptionEngine, NotificationEventName } from '../services/priority-preemption-engine';
import { PixelCanvas } from './pixel-canvas';
import { DISPLAY_CONSTANTS } from '../../shared/render-constants';
import { encodeMatrixToPng } from './pixel-matrix-to-png';
import { AnimationPlayer } from './animation-player';
import { DEVICE_APPLICATION_NAME } from '../../shared/device-constants';

/**
 * Everything needed to draw a notification banner.
 *
 * An object rather than the previous six positional arguments, because the
 * argument that mattered -- which priority class the notification belongs to --
 * was not among them and had to be guessed from the priority number.
 * The number itself is no longer passed at all: the engine owns it.
 */
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

export interface NotificationBannerOptions {
  /** Text shown after the channel label; already assembled by the caller. */
  senderName: string;
  /** Short source label, e.g. the app name. */
  channelName?: string;
  /** Which priority class the source rule assigned this notification to. */
  eventName?: NotificationEventName;
  /** Fallback hand-drawn bitmap, used only when no real icon resolved. */
  iconId?: BitmapIconId;
  /** A real 16x16 app icon, which takes precedence over `iconId`. */
  customIconData?: (string | null)[][];
  /** How long the banner holds the display before releasing its lock. */
  timeoutMs?: number;
}

export interface DisplayPayload {
  frontElements: Array<Record<string, unknown>>;
  backElements: Array<Record<string, unknown>>;
  ledColorHex?: string;
}

const APP_NAME = DEVICE_APPLICATION_NAME;

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
  private lastSessionCache: ActiveSessionDTO | null = null;
  private animationPlayer: AnimationPlayer;
  private frameBufferToggle: boolean = false;
  private showIdleClockFallback: boolean = false;

  /** The software 72×16 pixel canvas that is encoded and uploaded each frame. */
  private canvas: PixelCanvas = new PixelCanvas(
    DISPLAY_CONSTANTS.FRONT_GRID_WIDTH,
    DISPLAY_CONSTANTS.FRONT_GRID_HEIGHT
  );

  constructor(driver: BusyBarDriver, priorityEngine?: IPriorityPreemptionEngine) {
    if (!driver) {
      throw new ArgumentNullException('driver');
    }
    this._driver = driver;
    this.priorityEngine = priorityEngine;
    this.animationPlayer = new AnimationPlayer(driver);
    this.animationPlayer.setLedColorCallback(() => this.lastState.ledColorHex);
    this.onAnimationFrame = this.onAnimationFrame.bind(this);
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
      this.animationPlayer.stop();
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
  /// Toggles interactive paused task option selection between STOP and FINISH.
  /// </summary>
  public togglePausedSelection(): 'STOP' | 'FINISH' {
    this.pausedSelection = this.pausedSelection === 'STOP' ? 'FINISH' : 'STOP';
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
    row1Color: string
  ): void {
    this.canvas.clear();
    // Draw 16×16 icon, centered vertically in the 16px display height
    const layout = DISPLAY_CONSTANTS.LAYOUT_OFFSETS;
    this.canvas.drawBitmap(iconBitmap, 0, 0, layout.ICON_SIZE, layout.ICON_SIZE);
    // Row 0: main label (task key + elapsed, or status)
    this.canvas.drawTextClipped(row0Text, layout.TEXT_X, layout.ROW0_Y, row0Color, layout.TEXT_FIELD_WIDTH);
    // Row 1: secondary label (task title or status detail)
    this.canvas.drawSmallText(row1Text, layout.TEXT_X, layout.ROW1_Y, row1Color, layout.TEXT_FIELD_WIDTH);
  }

  /**
   * Paints the icon + 1 text row + progress bar layout.
   * Progress bar occupies y=11..15 (5px tall), x=17..72.
   */
  private paintIconProgressBar(
    iconBitmap: (string | null)[][],
    titleText: string,
    titleColor: string,
    progressPercent: number,
    barColor: string
  ): void {
    this.canvas.clear();
    this.canvas.drawBitmap(iconBitmap, 0, 0, 16, 16);
    this.canvas.drawTextClipped(titleText, 17, 1, titleColor, 55);

    // Progress bar: x=17, y=9, width=55 total
    const barTotalW = 55;
    const barFillW = Math.max(1, Math.floor((progressPercent * barTotalW) / 100));

    // Track (background)
    this.canvas.drawRect(17, 10, barTotalW, 4, '#1E293B');
    // Fill
    this.canvas.drawRect(17, 10, barFillW, 4, barColor);
    // End-cap white pixel
    const capX = 17 + barFillW - 1;
    this.canvas.drawRect(capX, 9, 2, 6, '#FFFFFF');
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

    if (frameSignature !== this.lastTransmittedSignature) {
      this.lastTransmittedSignature = frameSignature;
      this.frameBufferToggle = !this.frameBufferToggle;
      const dynamicFilename = `frame_${this.frameBufferToggle ? '0' : '1'}.png`;

      // Fire-and-forget hardware transmission (non-blocking for render callers)
      void this._driver
        .sendPixelFrame(pngBuffer, ledColorHex, APP_NAME, dynamicFilename)
        .catch(err => {
          console.error('[DisplayRenderer] sendPixelFrame failed:', err);
          // The device may or may not have taken the frame. Forget the
          // signature so the next render transmits rather than assuming the
          // display already shows this.
          this.lastTransmittedSignature = null;
        });
    }

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
      void this.animationPlayer.play('lunch_72x16', { loop: true, onFrame: this.onAnimationFrame })
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
      void this.animationPlayer.play('back_soon_72x16', { loop: true, onFrame: this.onAnimationFrame })
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
        void this.animationPlayer.play('meeting_72x16', { loop: true, onFrame: this.onAnimationFrame })
          .catch(err => console.error('[DisplayRenderer] animationPlayer.play failed:', err));
      } else {
        this.paintIconAndTwoRows(
          getBitmapById(iconId),
          label,
          title || 'Click to Start',
          accentColor,
          '#FFFFFF'
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
        '#FFFFFF'
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
   *  - Left (x=0..15): Icon (checkmark)
   *  - Row 0 (y=0): Task title (TASK-KEY: Title)
   *  - Row 1 (y=8): Task timer (HH:MM:SS)
   *  - When PAUSED: Text & LED turn ORANGE (#F59E0B), and right side (x=47..71) displays
   *    interactive STOP vs FINISH controls selectable via scroll wheel.
   */
  public renderActiveSession(session: ActiveSessionDTO | null): DisplayPayload {
    this.lastSessionCache = session;

    if (session && session.status === 'TRACKING' && this.isCelebrating) {
      this.isCelebrating = false;
      if (this.celebrationTimeout) {
        clearTimeout(this.celebrationTimeout);
        this.celebrationTimeout = null;
      }
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

      // We explicitly clear display and turn off the LED, and do not transmit a frame
      void this._driver.sendDisplayPayload({
        application_name: APP_NAME,
        priority: 95,
        elements: [],
        led_notification_color: '#00000000'
      })
        .catch(err => console.error('[DisplayRenderer] _driver.sendDisplayPayload failed:', err));

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

      const titleText = session ? `${session.taskKey}: ${session.taskTitle}` : 'No Active Task';
      const timerText = session ? this.formatTime(session.elapsedSeconds, false) : '00:00';

      const row0Color = isPaused ? '#F59E0B' : session ? colors.keyColor : '#888888';
      const row1Color = isPaused ? '#F59E0B' : session ? '#FFFFFF' : '#888888';
      // Remove edge glow during active tracking tasks by modifying ledMode if needed, but LED must remain green
      const ledColor = isPaused ? '#F59E0BFF' : session ? '#10B981FF' : '#2D3440FF';

      this.ledMode = session ? (isTracking ? 'SOLID' : 'BREATHING') : 'SOLID';

      this.canvas.clear();
      if (isStandup && isTracking) {
        void this.animationPlayer.play('meeting_72x16', { loop: true, onFrame: this.onAnimationFrame })
          .catch(err => console.error('[DisplayRenderer] animationPlayer.play failed:', err));
      } else {
        this.animationPlayer.stop();
        this.canvas.drawBitmap(getBitmapById('checkmark'), 0, 0, 16, 16);
      }

      if (isPaused) {
        // Clipped title & timer on left, interactive STOP/FINISH selection on right
        this.canvas.drawTextClipped(titleText, 17, 0, row0Color, 26);
        this.canvas.drawSmallText(timerText, 17, 8, row1Color, 26);

        // Render STOP vs FINISH controls moved down 1px to y=1 and y=9
        if (this.pausedSelection === 'STOP') {
          this.canvas.drawRect(44, 1, 27, 7, '#F59E0B');
          this.canvas.drawSmallText('STOP', 45, 2, '#000000', 26);
          this.canvas.drawSmallText('FINISH', 45, 10, '#888888', 26);
        } else {
          this.canvas.drawSmallText('STOP', 45, 2, '#888888', 26);
          this.canvas.drawRect(44, 9, 27, 7, '#F59E0B');
          this.canvas.drawSmallText('FINISH', 45, 10, '#000000', 26);
        }
      } else {
        // Row 0: Task Title
        this.canvas.drawTextClipped(titleText, 17, 0, row0Color, 55);
        // Row 1: Task Timer (HH:MM:SS)
        this.canvas.drawSmallText(timerText, 17, 8, row1Color, 55);
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
   * Renders the hardware Task Selection Menu directly on the front display.
   */
  public renderTaskSelection(stage: 'PROJECT' | 'TASK', itemName: string, description?: string): DisplayPayload {
    return this.requestRender('menuPriority', () => {
      this.canvas.clear();
      if (stage === 'PROJECT') {
        this.canvas.drawTextClipped(itemName, 0, 4, '#FFFFFF', 72);
      } else {
        this.canvas.drawTextClipped(itemName, 0, 0, '#FFFFFF', 72);
        if (description) {
          this.canvas.drawSmallText(description, 0, 8, '#888888', 72);
        }
      }

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
      senderName,
      channelName = 'SLACK',
      eventName = 'messagingPriority',
      iconId = 'slack',
      customIconData,
      timeoutMs = 10000
    } = options;

    const isHighPriority = eventName === 'highNotificationPriority';
    const priority = this.priorityEngine?.getEventPriority(eventName) ?? 0;

    return this.requestRender(eventName, () => {
      const bitmapData = customIconData
        ? customIconData
        : AppIconBitmapProcessor.processAppIcon(iconId);

      const accentColor = isHighPriority ? '#EC4899' : '#8B5CF6';
      const headerText = `[${channelName}] ${senderName}`;

      this.canvas.clear();
      // Draw 16x16 icon data (which contains the 15x15 icon perfectly centered)
      this.canvas.drawBitmap(bitmapData, 0, 0, 16, 16);
      this.canvas.drawTextClipped(headerText, 17, 5, accentColor, 55);

      const backElements = [
        { id: 'rear_notif_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFFFF', text: `NOTIFICATION (Priority ${priority})`, align: 'top_left' },
        { id: 'rear_notif_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCCFF', text: headerText, align: 'top_left' }
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

      if (timeoutMs > 0 && this.priorityEngine) {
        setTimeout(() => {
          this.priorityEngine?.releaseActiveLock(eventName);
        }, timeoutMs);
      }

      return payload;
    });
  }

  public renderTaskCompletionConfetti(durationSeconds: number = 4): DisplayPayload {
    this.isCelebrating = true;
    if (this.celebrationTimeout) {
      clearTimeout(this.celebrationTimeout);
      this.celebrationTimeout = null;
    }
    this.ledMode = 'CONFETTI_EXPLOSION';

    const backElements = [
      { id: 'rear_confetti_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#10B981FF', text: 'TASK COMPLETED SUCCESSFULLY!', align: 'top_left' }
    ];

    const confettiColors = ['#10B981', '#FBBF24', '#38BDF8', '#EC4899', '#AAFF00'];
    const activeParticles = Array.from({length: 30}).map(() => ({
      x: 16 + Math.random() * 56,
      y: -2 - Math.random() * 10,
      vx: (Math.random() - 0.5) * 2,
      vy: Math.random() * 1.5 + 0.5,
      color: confettiColors[Math.floor(Math.random() * confettiColors.length)]
    }));

    let frames = 0;
    const maxFrames = durationSeconds * 10; // 10 fps

    const renderFrame = () => {
      if (!this.isCelebrating || frames >= maxFrames) {
        this.isCelebrating = false;
        if (this.celebrationTimeout) clearInterval(this.celebrationTimeout);
        this.celebrationTimeout = null;
        this.renderActiveSession(this.lastSessionCache);
        return;
      }

      this.canvas.clear();
      this.canvas.drawBitmap(getBitmapById('checkmark'), 0, 1, 15, 14);
      this.canvas.drawTextClipped('TASK DONE!', 17, 5, '#10B981', 55);

      for (const p of activeParticles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.y > 16) {
          p.y = -2;
          p.x = 16 + Math.random() * 56;
        }

        const drawX = Math.floor(p.x);
        const drawY = Math.floor(p.y);
        if (drawX >= 16 && drawX < 72 && drawY >= 0 && drawY < 16) {
          this.canvas.setPixel(drawX, drawY, p.color);
        }
      }

      const frontEls = this.canvasToEmulatorElements();
      void this.transmitFrame('#10B981FF', backElements, frontEls)
        .catch(err => console.error('[DisplayRenderer] transmitFrame failed:', err));
      frames++;
    };

    // First frame sync
    renderFrame();

    // Loop rest async
    this.celebrationTimeout = setInterval(renderFrame, 100);

    return {
      frontElements: this.lastState.frontElements as unknown as Array<Record<string, unknown>>,
      backElements,
      ledColorHex: '#10B981FF'
    };
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
        '#3B82F6'
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
        'COMPILING:',
        projectName,
        colors.keyColor,
        '#FFFFFF'
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

      this.paintIconProgressBar(
        getBitmapById('unity'),
        `BUILDING: ${projectName}`,
        barColor,
        progress,
        barColor
      );

      // Overlay bar_build_active as identifiable element for tests (virtual — real data is in canvas)
      const barTotalW = 55;
      const barFillW = Math.max(1, Math.floor((progress * barTotalW) / 100));

      const backElements = [
        { id: 'rear_build_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFFFF', text: `Building ${projectName} (${progress}%)`, align: 'top_left' }
      ];

      // Build test-queryable elements alongside the canvas pixels for the emulator
      const canvasEls = this.canvasToEmulatorElements();
      const testEls: Array<Record<string, unknown>> = [
        ...canvasEls,
        // Sentinel elements so tests can find by id — not sent to hardware
        { id: 'txt_build', type: 'text', text: `BUILDING: ${projectName}`, x: 17, y: 1 },
        { id: 'bar_build_active', type: 'rectangle', x: 17, y: 10, width: barFillW, height: 4 }
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

      this.paintIconProgressBar(
        getBitmapById('unity'),
        `BAKING: ${projectName}`,
        barColor,
        progress,
        barColor
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
        'EXCEPTION:',
        message,
        '#EF4444',
        '#FFFFFF'
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
