import { BusyBarDriver } from './busybar-driver';
import { ActiveSessionDTO, ColorThemeId, RearOledMode, LedAnimationMode, HardwareDisplayStateDTO, BitmapIconId, UserMode, ArgumentNullException } from '../../shared/dtos';
import { getBitmapById } from './pixel-bitmaps';
import { AppIconBitmapProcessor } from './app-icon-bitmap-processor';
import { IPriorityPreemptionEngine } from '../services/priority-preemption-engine';
import { PixelCanvas } from './pixel-canvas';
import { encodeMatrixToPng } from './pixel-matrix-to-png';
import { AnimationPlayer } from './animation-player';

export interface DisplayPayload {
  frontElements: Array<Record<string, unknown>>;
  backElements: Array<Record<string, unknown>>;
  ledColorHex?: string;
}

const APP_NAME = 'busybar_desktop';

/**
 * Service rendering hardware display screen payloads according to physical pixel templates.
 * Front Display (72x16 RGB LED): All content is rasterized into a pixel canvas, encoded as
 * a 72×16 PNG, and transmitted via the asset upload pipeline to avoid JSON buffer issues.
 * Rear Display (160x80 OLED): Legacy element-based rendering retained for rear OLED.
 */
export class DisplayRenderer {
  private driver: BusyBarDriver;
  private priorityEngine?: IPriorityPreemptionEngine;
  private colorTheme: ColorThemeId = 'emerald';
  private rearOledMode: RearOledMode = 'DIAGNOSTICS';
  private ledMode: LedAnimationMode = 'SOLID';
  private activeWidgetId: string = 'task_tracker';

  private lastState: HardwareDisplayStateDTO = {
    frontElements: [],
    backElements: [],
    ledColorHex: '#10B981FF',
    ledMode: 'SOLID',
    colorTheme: 'emerald',
    rearOledMode: 'DIAGNOSTICS',
    activeWidgetId: 'task_tracker'
  };

  private stateChangeCallbacks: Set<(state: HardwareDisplayStateDTO) => void> = new Set();
  private isCelebrating: boolean = false;
  private celebrationTimeout: NodeJS.Timeout | null = null;
  private lastSessionCache: ActiveSessionDTO | null = null;
  private animationPlayer: AnimationPlayer;
  private frameBufferToggle: boolean = false;

  /** The software 72×16 pixel canvas that is encoded and uploaded each frame. */
  private canvas: PixelCanvas = new PixelCanvas(72, 16);

  constructor(driver: BusyBarDriver, priorityEngine?: IPriorityPreemptionEngine) {
    if (!driver) {
      throw new ArgumentNullException('driver');
    }
    this.driver = driver;
    this.priorityEngine = priorityEngine;
    this.animationPlayer = new AnimationPlayer(driver);
    this.animationPlayer.setLedColorCallback(() => this.lastState.ledColorHex);
    this.onAnimationFrame = this.onAnimationFrame.bind(this);
  }

  private onAnimationFrame(frameBuffer: Buffer, _frameIndex: number) {
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

  /// <summary>
  /// Mandatorily evaluates the requested display draw against the Priority Preemption Engine.
  /// If evaluated as suppressed or preempted, hardware transmission is strictly blocked.
  /// </summary>
  public requestRender(eventName: string, renderFn: () => DisplayPayload): DisplayPayload {
    if (!eventName) throw new ArgumentNullException('eventName');
    if (!renderFn) throw new ArgumentNullException('renderFn');

    if (this.priorityEngine) {
      const evalResult = this.priorityEngine.evaluateRequest(eventName, undefined, renderFn);
      if (!evalResult || !evalResult.shouldRender) {
        return {
          frontElements: this.lastState.frontElements as unknown as Array<Record<string, unknown>>,
          backElements: this.lastState.backElements as unknown as Array<Record<string, unknown>>,
          ledColorHex: this.lastState.ledColorHex
        };
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
  /// Sets current active widget ID.
  /// </summary>
  public setActiveWidgetId(widgetId: string): void {
    this.activeWidgetId = widgetId;
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

  private getThemeColors(): { keyColor: string; primaryColor: string } {
    switch (this.colorTheme) {
      case 'cyberpunk':
        return { keyColor: '#EC4899FF', primaryColor: '#8B5CF6' };
      case 'retro_arcade':
        return { keyColor: '#FBBF24FF', primaryColor: '#F59E0B' };
      case 'neon_night':
        return { keyColor: '#00FFCCFF', primaryColor: '#FF00FF' };
      case 'default':
      default:
        return { keyColor: '#3B82F6FF', primaryColor: '#10B981' };
    }
  }

  private formatTime(totalSec: number): string {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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

  private buildRearElements(session: ActiveSessionDTO | null, isIdleOver15Mins: boolean): Array<Record<string, unknown>> {
    if (this.rearOledMode === 'STEALTH_CLOCK' || isIdleOver15Mins) {
      return [
        { id: 'rear_clock_0', type: 'text', font: 'bold', x: 20, y: 15, color: '#FFFFFFFF', text: new Date().toLocaleTimeString(), align: 'top_left' },
        { id: 'rear_clock_1', type: 'text', font: 'tiny', x: 25, y: 45, color: '#888888FF', text: 'BUSY BAR STEALTH MODE', align: 'top_left' }
      ];
    }

    if (this.rearOledMode === 'PERFORMANCE_MONITOR') {
      return [
        { id: 'rear_perf_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFFFF', text: 'SYSTEM PERFORMANCE MONITOR', align: 'top_left' },
        { id: 'rear_perf_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCCCCFF', text: 'CPU Load  : 14% [████░░░░░░]', align: 'top_left' },
        { id: 'rear_perf_2', type: 'text', font: 'tiny', x: 0, y: 32, color: '#CCCCCCCCFF', text: 'RAM Usage : 42% (6.8 / 16 GB)', align: 'top_left' },
        { id: 'rear_perf_3', type: 'text', font: 'tiny', x: 0, y: 48, color: '#CCCCCCCCFF', text: `Active    : ${session ? session.taskKey : 'IDLE'}`, align: 'top_left' }
      ];
    }

    // Default DIAGNOSTICS Mode
    const status = this.driver.getDeviceStatus();
    return [
      { id: 'rear_diag_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFFFF', text: 'BUSY BAR DIAGNOSTICS [USB/WiFi]', align: 'top_left' },
      { id: 'rear_diag_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCCCCFF', text: `IP: ${status.ipAddress} | Ping: ${status.webSocketPingMs}ms`, align: 'top_left' },
      { id: 'rear_diag_2', type: 'text', font: 'tiny', x: 0, y: 32, color: '#CCCCCCCCFF', text: `Frames: ${status.framesSent} OK, ${status.framesFailed} FAIL`, align: 'top_left' },
      { id: 'rear_diag_3', type: 'text', font: 'tiny', x: 0, y: 48, color: '#CCCCCCCCFF', text: `Last Input: ${this.lastInputKey} @ ${this.lastInputTime}`, align: 'top_left' },
      { id: 'rear_diag_4', type: 'text', font: 'tiny', x: 0, y: 64, color: '#CCCCCCCCFF', text: `Task: ${session ? session.taskKey : 'NONE'} (${session ? session.status : 'IDLE'})`, align: 'top_left' }
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
    this.canvas.drawBitmap(iconBitmap, 0, 0, 16, 16);
    // Row 0: main label (task key + elapsed, or status)
    this.canvas.drawTextClipped(row0Text, 17, 0, row0Color, 55);
    // Row 1: secondary label (task title or status detail)
    this.canvas.drawSmallText(row1Text, 17, 8, row1Color, 55);
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
    const pngBuffer = encodeMatrixToPng(this.canvas.getPixels(), 72, 16);
    this.frameBufferToggle = !this.frameBufferToggle;
    const dynamicFilename = `frame_${this.frameBufferToggle ? '0' : '1'}.png`;

    // Fire-and-forget hardware transmission (non-blocking for render callers)
    this.driver.sendPixelFrame(pngBuffer, ledColorHex, APP_NAME, dynamicFilename).catch(err => {
      console.error('[DisplayRenderer] sendPixelFrame failed:', err);
    });

    this.lastState = {
      frontElements: frontElementsForEmulator as unknown as DisplayElementDTO[],
      backElements: backElements as unknown as DisplayElementDTO[],
      ledColorHex,
      ledMode: this.ledMode,
      colorTheme: this.colorTheme,
      rearOledMode: this.rearOledMode,
      activeWidgetId: this.activeWidgetId
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
      this.animationPlayer.play('lunch_72x16', { loop: true, onFrame: this.onAnimationFrame });

      const backElements = [
        { id: 'rear_lunch_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#F59E0BFF', text: 'LUNCH BREAK IN PROGRESS', align: 'top_left' },
        { id: 'rear_lunch_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCCCCFF', text: 'Notifications Muted | Session Paused', align: 'top_left' }
      ];

      this.ledMode = 'BREATHING';
      const payload: DisplayPayload = {
        frontElements,
        backElements,
        ledColorHex: '#F59E0BFF'
      };

      this.transmitFrame('#F59E0BFF', backElements, frontElements);
      return payload;
    });
  }

  /**
   * Renders AWAY / STEALTH animation screen on Front Display with dim purple LED.
   */
  public renderAwayMode(): DisplayPayload {
    return this.requestRender('awayModePriority', () => {
      const frontElements: Array<Record<string, unknown>> = [];
      this.animationPlayer.play('back_soon_72x16', { loop: true, onFrame: this.onAnimationFrame });

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

      this.transmitFrame('#A855F7FF', backElements, frontElements);
      return payload;
    });
  }

  /**
   * Renders Agile Ceremony Prompt on Front Display with Attention-Grabbing Pulsing LED & Scrolling Text.
   */
  public renderCeremonyPrompt(type: 'STANDUP' | 'LUNCH' | 'EOD', title: string): DisplayPayload {
    return this.requestRender('standupPromptPriority', () => {
      const isEod = type === 'EOD';
      const isLunch = type === 'LUNCH';
      const iconId: BitmapIconId = isLunch ? 'burger' : 'clock';
      const accentColor = isEod ? '#A855F7' : isLunch ? '#F59E0B' : '#3B82F6';
      const label = isEod ? 'EOD WRAP-UP' : isLunch ? 'LUNCH TIME' : 'DAILY STANDUP';

      if (type === 'STANDUP') {
        this.animationPlayer.play('meeting_72x16', { loop: true, onFrame: this.onAnimationFrame });
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
        { id: 'rear_ceremony_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCCCCFF', text: 'Press Scroll Wheel to Open Wizard', align: 'top_left' }
      ];

      this.ledMode = 'PULSE_ALERT';
      const payload: DisplayPayload = {
        frontElements: this.canvasToEmulatorElements(),
        backElements,
        ledColorHex: `${accentColor}FF`
      };
      this.transmitFrame(`${accentColor}FF`, backElements, payload.frontElements);
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
  public renderActiveSession(session: ActiveSessionDTO | null, isIdleOver15Mins: boolean = false): DisplayPayload {
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

    const colors = this.getThemeColors();
    const isPaused = session?.status === 'PAUSED';
    const isTracking = session?.status === 'TRACKING';
    const isStandup = session?.taskTitle?.toLowerCase().includes('standup');

    const titleText = session ? `${session.taskKey}: ${session.taskTitle}` : 'No Active Task';
    const timerText = session ? this.formatTime(session.elapsedSeconds) : '00:00:00';

    const row0Color = isPaused ? '#F59E0B' : session ? colors.keyColor : '#888888';
    const row1Color = isPaused ? '#F59E0B' : session ? '#FFFFFF' : '#888888';
    // Remove edge glow during active tracking tasks by modifying ledMode if needed, but LED must remain green
    const ledColor = isPaused ? '#F59E0BFF' : session ? '#10B981FF' : '#2D3440FF';

    this.ledMode = session ? (isTracking ? 'SOLID' : 'BREATHING') : 'SOLID';

    this.canvas.clear();
    if (isStandup && isTracking) {
      this.animationPlayer.play('meeting_72x16', { loop: true, onFrame: this.onAnimationFrame });
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

    const backElements = this.buildRearElements(session, isIdleOver15Mins);
    const frontEls = this.canvasToEmulatorElements();

    const payload: DisplayPayload = {
      frontElements: frontEls,
      backElements,
      ledColorHex: ledColor
    };

    this.transmitFrame(ledColor, backElements, frontEls);
    return payload;
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
        { id: 'rear_menu_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCCCCFF', text: 'Scroll to pick, click to select', align: 'top_left' }
      ];

      this.ledMode = 'SOLID';
      const frontEls = this.canvasToEmulatorElements();
      const payload: DisplayPayload = {
        frontElements: frontEls,
        backElements,
        ledColorHex: '#3B82F6FF'
      };

      this.transmitFrame('#3B82F6FF', backElements, frontEls);
      return payload;
    });
  }

  /**
   * Renders Notification Banner with icon on left and vertically centered header on right (y=5).
   * Message body text is excluded per user specification.
   */
  public renderNotificationBanner(
    senderName: string,
    channelName: string = 'SLACK',
    priority: number = 40,
    iconId: BitmapIconId = 'slack',
    customIconData?: (string | null)[][],
    timeoutMs: number = 10000
  ): DisplayPayload {
    const eventName = priority >= 90 ? 'highNotificationPriority' : 'messagingPriority';
    return this.requestRender(eventName, () => {
      const bitmapData = customIconData
        ? AppIconBitmapProcessor.processAppIcon(customIconData)
        : AppIconBitmapProcessor.processAppIcon(iconId);

      const isHighPriority = priority >= 90;
      const accentColor = isHighPriority ? '#EC4899' : '#8B5CF6';
      const headerText = `[${channelName}] ${senderName}`;

      this.canvas.clear();
      // Draw 15x15 icon centered (roughly) in the 16x16 space, offset by x=1, y=1 to avoid top/left edge glow
      this.canvas.drawBitmap(bitmapData, 1, 1, 15, 15);
      this.canvas.drawTextClipped(headerText, 17, 5, accentColor, 55);

      const backElements = [
        { id: 'rear_notif_0', type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFFFF', text: `NOTIFICATION (Priority ${priority})`, align: 'top_left' },
        { id: 'rear_notif_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCCCCFF', text: headerText, align: 'top_left' }
      ];

      const ledColorHex = `${accentColor}FF`;
      this.ledMode = isHighPriority ? 'FLASH_BURST' : 'PULSE_ALERT';
      const payload: DisplayPayload = {
        frontElements: this.canvasToEmulatorElements(),
        backElements,
        ledColorHex
      };
      this.transmitFrame(ledColorHex, backElements, payload.frontElements);

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
      this.transmitFrame('#10B981FF', backElements, frontEls);
      frames++;
    };

    // First frame sync
    renderFrame();

    // Loop rest async
    this.celebrationTimeout = setInterval(renderFrame, 100);

    return {
      frontElements: this.lastState.frontElements as unknown as DisplayElementDTO[],
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
      this.transmitFrame('#FF0000FF', backElements, payload.frontElements);
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
      this.transmitFrame(colors.keyColor, backElements, payload.frontElements);
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
      this.transmitFrame(progressColorHex, backElements, canvasEls);
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
      this.transmitFrame('#FBBF24FF', backElements, payload.frontElements);
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
        { id: 'rear_err_1', type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCCCCFF', text: message, align: 'top_left' }
      ];

      const payload: DisplayPayload = {
        frontElements: this.canvasToEmulatorElements(),
        backElements,
        ledColorHex: '#EF4444FF'
      };
      this.ledMode = 'PULSE_ALERT';
      this.transmitFrame('#EF4444FF', backElements, payload.frontElements);
      return payload;
    });
  }


}

class ArgumentNullException extends Error {
  constructor(paramName: string) {
    super(`Argument cannot be null or undefined: ${paramName}`);
    this.name = 'ArgumentNullException';
  }
}
