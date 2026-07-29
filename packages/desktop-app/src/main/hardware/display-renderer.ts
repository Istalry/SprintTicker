import { BusyBarDriver } from './busybar-driver';
import { ActiveSessionDTO, ColorThemeId, RearOledMode, LedAnimationMode, HardwareDisplayStateDTO, BitmapIconId } from '../../shared/dtos';
import { getBitmapById } from './pixel-bitmaps';

export interface DisplayPayload {
  frontElements: Array<Record<string, unknown>>;
  backElements: Array<Record<string, unknown>>;
  ledColorHex?: string;
}

/**
 * Service rendering hardware display screen payloads according to physical pixel templates.
 * Front Display (72x16 RGB LED): Active task tracking, compilation progress, pixel icons, confetti FX.
 * Rear Display (160x80 OLED): Debug information, system metrics, performance monitoring, stealth clock.
 */
export class DisplayRenderer {
  private driver: BusyBarDriver;
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

  constructor(driver: BusyBarDriver) {
    if (!driver) {
      throw new ArgumentNullException('driver');
    }
    this.driver = driver;
  }

  /// <summary>
  /// Registers a listener for real-time hardware display state updates for the screen emulator.
  /// </summary>
  public onStateChanged(cb: (state: HardwareDisplayStateDTO) => void): () => void {
    this.stateChangeCallbacks.add(cb);
    return () => this.stateChangeCallbacks.delete(cb);
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

  /// <summary>
  /// Retrieves current display state snapshot.
  /// </summary>
  public getDisplayState(): HardwareDisplayStateDTO {
    return { ...this.lastState };
  }

  private getThemeColors(): { keyColor: string; primaryColor: string } {
    switch (this.colorTheme) {
      case 'cyberpunk':
        return { keyColor: '#EC4899FF', primaryColor: '#8B5CF6FF' };
      case 'retro_arcade':
        return { keyColor: '#FBBF24FF', primaryColor: '#F59E0BFF' };
      case 'nordic_cyan':
        return { keyColor: '#38BDF8FF', primaryColor: '#06B6D4FF' };
      case 'emerald':
      default:
        return { keyColor: '#AAFF00FF', primaryColor: '#10B981FF' };
    }
  }

  private formatTime(totalSec: number): string {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  private buildRearElements(session: ActiveSessionDTO | null, isIdleOver15Mins: boolean): Array<Record<string, unknown>> {
    if (this.rearOledMode === 'STEALTH_CLOCK' || isIdleOver15Mins) {
      return [
        { type: 'text', font: 'bold', x: 20, y: 15, color: '#FFFFFF', text: new Date().toLocaleTimeString() },
        { type: 'text', font: 'tiny', x: 25, y: 45, color: '#888888', text: 'BUSY BAR STEALTH MODE' }
      ];
    }

    if (this.rearOledMode === 'PERFORMANCE_MONITOR') {
      return [
        { type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFF', text: 'SYSTEM PERFORMANCE MONITOR' },
        { type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCC', text: 'CPU Load  : 14% [████░░░░░░]' },
        { type: 'text', font: 'tiny', x: 0, y: 32, color: '#CCCCCC', text: 'RAM Usage : 42% (6.8 / 16 GB)' },
        { type: 'text', font: 'tiny', x: 0, y: 48, color: '#CCCCCC', text: `Active    : ${session ? session.taskKey : 'IDLE'}` }
      ];
    }

    // Default DIAGNOSTICS Mode
    const status = this.driver.getDeviceStatus();
    return [
      { type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFF', text: 'BUSY BAR DIAGNOSTICS [USB Ethernet]' },
      { type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCC', text: `IP: ${status.ipAddress} | Ping: ${status.webSocketPingMs}ms` },
      { type: 'text', font: 'tiny', x: 0, y: 32, color: '#CCCCCC', text: `Active Task: ${session ? session.taskKey : 'NONE'} (${session ? session.status : 'IDLE'})` }
    ];
  }

  /**
   * Renders Idle View on Front Display.
   */
  public renderIdle(): DisplayPayload {
    return this.renderActiveSession(null);
  }

  /**
   * Renders LUNCH MUTE screen on Front Display with Burger Icon and warm amber LED.
   */
  public renderLunchMode(): DisplayPayload {
    const payload: DisplayPayload = {
      frontElements: [
        { type: 'bitmap', iconId: 'burger' as BitmapIconId, bitmapData: getBitmapById('burger'), x: 0, y: 0 },
        { type: 'text', font: 'bold', x: 16, y: 0, color: '#F59E0BFF', text: 'LUNCH MUTE' },
        { type: 'text', font: 'small', x: 16, y: 8, color: '#FFFFFFFF', text: 'Task Paused' }
      ],
      backElements: [
        { type: 'text', font: 'tiny', x: 0, y: 0, color: '#F59E0BFF', text: 'LUNCH BREAK IN PROGRESS' },
        { type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCC', text: 'Notifications Muted | Session Paused' }
      ],
      ledColorHex: '#F59E0BFF'
    };

    this.ledMode = 'BREATHING';
    this.updateStateAndDispatch(payload);
    return payload;
  }

  /**
   * Renders AWAY / STEALTH screen on Front Display with Clock Icon and dim purple LED.
   */
  public renderAwayMode(): DisplayPayload {
    const payload: DisplayPayload = {
      frontElements: [
        { type: 'bitmap', iconId: 'clock' as BitmapIconId, bitmapData: getBitmapById('clock'), x: 0, y: 0 },
        { type: 'text', font: 'bold', x: 16, y: 0, color: '#A855F7FF', text: 'AWAY MODE' },
        { type: 'text', font: 'small', x: 16, y: 8, color: '#888888FF', text: 'PC Locked' }
      ],
      backElements: [
        { type: 'text', font: 'tiny', x: 0, y: 0, color: '#A855F7FF', text: 'SYSTEM LOCKED / AWAY' },
        { type: 'text', font: 'tiny', x: 0, y: 16, color: '#888888', text: 'Stealth Display Active' }
      ],
      ledColorHex: '#A855F7FF'
    };

    this.ledMode = 'SOLID';
    this.updateStateAndDispatch(payload);
    return payload;
  }

  /**
   * Renders Agile Ceremony Prompt on Front Display with Attention-Grabbing Pulsing LED & Scrolling Text.
   */
  public renderCeremonyPrompt(type: 'STANDUP' | 'LUNCH' | 'EOD', title: string): DisplayPayload {
    const isEod = type === 'EOD';
    const isLunch = type === 'LUNCH';
    const iconId: BitmapIconId = isLunch ? 'burger' : 'clock';
    const accentColor = isEod ? '#A855F7FF' : isLunch ? '#F59E0BFF' : '#3B82F6FF';

    const payload: DisplayPayload = {
      frontElements: [
        {
          type: 'bitmap',
          iconId,
          bitmapData: getBitmapById(iconId),
          x: 0,
          y: 0
        },
        {
          type: 'text',
          font: 'bold',
          x: 16,
          y: 0,
          color: accentColor,
          text: isEod ? 'EOD WRAP-UP' : isLunch ? 'LUNCH TIME' : 'DAILY STANDUP'
        },
        {
          type: 'text',
          font: 'small',
          x: 16,
          y: 8,
          width: 56,
          color: '#FFFFFFFF',
          text: title || 'Press Wheel or Click UI to Start',
          scroll_rate: 60
        }
      ],
      backElements: [
        { type: 'text', font: 'tiny', x: 0, y: 0, color: accentColor, text: `CEREMONY PROMPT: ${type}` },
        { type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCC', text: 'Press Scroll Wheel to Open Wizard' }
      ],
      ledColorHex: accentColor
    };

    this.ledMode = 'PULSE_ALERT';
    this.updateStateAndDispatch(payload);
    return payload;
  }

  /**
   * Renders Template A: Active Task Tracker View on Front Display, with Pixel Icon & OLED Rear layout.
   */
  public renderActiveSession(session: ActiveSessionDTO | null, isIdleOver15Mins: boolean = false): DisplayPayload {
    this.lastSessionCache = session;

    // If a active session starts tracking, cancel celebration immediately
    if (session && session.status === 'TRACKING' && this.isCelebrating) {
      this.isCelebrating = false;
      if (this.celebrationTimeout) {
        clearTimeout(this.celebrationTimeout);
        this.celebrationTimeout = null;
      }
    }

    // Lock display output during confetti celebration
    if (this.isCelebrating) {
      return {
        frontElements: this.lastState.frontElements as unknown as Array<Record<string, unknown>>,
        backElements: this.lastState.backElements as unknown as Array<Record<string, unknown>>,
        ledColorHex: this.lastState.ledColorHex
      };
    }

    const colors = this.getThemeColors();
    const elapsedText = session ? this.formatTime(session.elapsedSeconds) : '00:00:00';
    const row1Text = session ? `${session.taskKey} ${elapsedText}` : 'IDLE 00:00:00';
    const row2Text = session ? session.taskTitle : 'No Active Task Selected';

    const ledColor = session
      ? session.status === 'TRACKING'
        ? colors.primaryColor
        : '#F59E0BFF'
      : '#2D3440FF';

    this.ledMode = session ? (session.status === 'TRACKING' ? 'SOLID' : 'BREATHING') : 'SOLID';

    const payload: DisplayPayload = {
      frontElements: [
        {
          type: 'bitmap',
          iconId: 'checkmark' as BitmapIconId,
          bitmapData: getBitmapById('checkmark'),
          x: 0,
          y: 0
        },
        {
          type: 'text',
          font: 'small',
          x: 16,
          y: 0,
          width: 56,
          color: colors.keyColor,
          text: row1Text
        },
        {
          type: 'text',
          font: 'small',
          x: 16,
          y: 8,
          width: 56,
          color: '#FFFFFFFF',
          text: row2Text,
          scroll_rate: 60
        }
      ],
      backElements: this.buildRearElements(session, isIdleOver15Mins),
      ledColorHex: ledColor
    };

    this.updateStateAndDispatch(payload);
    return payload;
  }

  /**
   * Renders Notification Banner with multi-color animated icon (Slack, Discord, Gmail).
   * Displays icon on left (x=0..15) and masked scrolling text on right (x=16..71).
   */
  public renderNotificationBanner(
    senderName: string,
    channelName: string = 'SLACK',
    priority: number = 40,
    iconId: BitmapIconId = 'slack'
  ): DisplayPayload {
    const payload: DisplayPayload = {
      frontElements: [
        {
          type: 'bitmap',
          iconId,
          bitmapData: getBitmapById(iconId, 1),
          x: 0,
          y: 0
        },
        {
          type: 'text',
          font: 'small',
          x: 16,
          y: 0,
          width: 56,
          color: '#8B5CF6FF',
          text: `[${channelName}]`
        },
        {
          type: 'text',
          font: 'small',
          x: 16,
          y: 8,
          width: 56,
          color: '#FFFFFFFF',
          text: senderName,
          scroll_rate: 60
        }
      ],
      backElements: [
        { type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFF', text: `NOTIFICATION (Priority ${priority})` },
        { type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCC', text: `[${channelName.toUpperCase()}] ${senderName}` }
      ],
      ledColorHex: '#8B5CF6FF'
    };

    this.ledMode = 'PULSE_ALERT';
    this.updateStateAndDispatch(payload);
    return payload;
  }

  /**
   * Renders Task Completion Confetti explosion animation sequence with multi-color particle elements.
   */
  public renderTaskCompletionConfetti(durationSeconds: number = 4): DisplayPayload {
    this.isCelebrating = true;
    if (this.celebrationTimeout) {
      clearTimeout(this.celebrationTimeout);
      this.celebrationTimeout = null;
    }

    const confettiColors = ['#10B981FF', '#FBBF24FF', '#38BDF8FF', '#EC4899FF', '#AAFF00FF'];
    const particles = [
      { x: 2, y: 2 }, { x: 5, y: 12 }, { x: 12, y: 1 }, { x: 18, y: 14 },
      { x: 25, y: 3 }, { x: 32, y: 13 }, { x: 40, y: 2 }, { x: 48, y: 11 },
      { x: 55, y: 4 }, { x: 62, y: 12 }, { x: 68, y: 3 }, { x: 70, y: 14 }
    ];

    const particleElements = particles.map((p, idx) => ({
      type: 'rectangle',
      x: p.x,
      y: p.y,
      width: 1,
      height: 1,
      fill: confettiColors[idx % confettiColors.length]
    }));

    const payload: DisplayPayload = {
      frontElements: [
        { type: 'bitmap', iconId: 'checkmark' as BitmapIconId, bitmapData: getBitmapById('checkmark'), x: 0, y: 0 },
        { type: 'text', font: 'bold', x: 17, y: 3, color: '#10B981FF', text: 'TASK DONE 🎉' },
        ...particleElements
      ],
      backElements: [
        { type: 'text', font: 'tiny', x: 0, y: 0, color: '#10B981FF', text: 'TASK COMPLETED SUCCESSFULLY!' }
      ],
      ledColorHex: '#10B981FF'
    };

    this.ledMode = 'CONFETTI_EXPLOSION';
    this.updateStateAndDispatch(payload);

    // Hold celebration sequence on display for durationSeconds (default 4 seconds)
    this.celebrationTimeout = setTimeout(() => {
      this.isCelebrating = false;
      this.celebrationTimeout = null;
      this.renderActiveSession(this.lastSessionCache);
    }, Math.max(1, durationSeconds) * 1000);

    return payload;
  }

  /**
   * Renders Template C: Unity Play Mode "ON AIR" Alert with Gamepad Controller Icon.
   */
  public renderPlayMode(projectName: string): DisplayPayload {
    const payload: DisplayPayload = {
      frontElements: [
        { type: 'bitmap', iconId: 'playmode' as BitmapIconId, bitmapData: getBitmapById('playmode'), x: 0, y: 0 },
        { type: 'text', font: 'bold', x: 16, y: 0, color: '#FF0000FF', text: 'ON AIR' },
        { type: 'text', font: 'tiny', x: 16, y: 8, color: '#3B82F6FF', text: projectName }
      ],
      backElements: [
        { type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFF', text: 'UNITY PLAY MODE ACTIVE' }
      ],
      ledColorHex: '#FF0000FF'
    };

    this.ledMode = 'PULSE_ALERT';
    this.updateStateAndDispatch(payload);
    return payload;
  }

  /**
   * Renders C# Script Compilation View with Compiling Gear Icon and text (NO progress bar).
   */
  public renderCompilation(projectName: string): DisplayPayload {
    const colors = this.getThemeColors();
    const payload: DisplayPayload = {
      frontElements: [
        { type: 'bitmap', iconId: 'compiling' as BitmapIconId, bitmapData: getBitmapById('compiling'), x: 0, y: 0 },
        { type: 'text', font: 'small', x: 16, y: 0, width: 56, color: colors.keyColor, text: 'COMPILING:' },
        { type: 'text', font: 'small', x: 16, y: 8, width: 56, color: '#FFFFFFFF', text: projectName }
      ],
      backElements: [
        { type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFF', text: `Compiling ${projectName}` }
      ],
      ledColorHex: colors.keyColor
    };

    this.ledMode = 'SOLID';
    this.updateStateAndDispatch(payload);
    return payload;
  }

  /**
   * Renders Standalone Game Build View with Unity Icon and progress bar restrained to text container (x=16, width=56).
   */
  public renderBuilding(projectName: string, progress: number = 50): DisplayPayload {
    const barWidth = Math.floor((progress * 56) / 100);
    const progressColor = progress >= 80 ? '#10B981FF' : progress >= 40 ? '#3B82F6FF' : '#FBBF24FF';
    const endCapX = 16 + Math.max(0, barWidth - 1);

    const payload: DisplayPayload = {
      frontElements: [
        { type: 'bitmap', iconId: 'unity' as BitmapIconId, bitmapData: getBitmapById('unity'), x: 0, y: 0 },
        { type: 'text', font: 'small', x: 16, y: 0, width: 56, color: progressColor, text: `BUILDING: ${projectName}` },
        { type: 'rectangle', x: 16, y: 11, width: barWidth, height: 4, fill: progressColor },
        { type: 'rectangle', x: 16 + barWidth, y: 11, width: Math.max(0, 56 - barWidth), height: 4, fill: '#1E293BFF' },
        { type: 'rectangle', x: endCapX, y: 10, width: 2, height: 6, fill: '#FFFFFFFF' }
      ],
      backElements: [
        { type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFF', text: `Building ${projectName} (${progress}%)` }
      ],
      ledColorHex: progressColor
    };

    this.ledMode = 'FLASH_BURST';
    this.updateStateAndDispatch(payload);
    return payload;
  }

  /**
   * Renders Lightmap Baking View with Unity Icon and progress bar restrained to text container (x=16, width=56).
   */
  public renderBaking(projectName: string, progress: number = 50): DisplayPayload {
    const barWidth = Math.floor((progress * 56) / 100);
    const progressColor = '#FBBF24FF';
    const endCapX = 16 + Math.max(0, barWidth - 1);

    const payload: DisplayPayload = {
      frontElements: [
        { type: 'bitmap', iconId: 'unity' as BitmapIconId, bitmapData: getBitmapById('unity'), x: 0, y: 0 },
        { type: 'text', font: 'small', x: 16, y: 0, width: 56, color: progressColor, text: `BAKING: ${projectName}` },
        { type: 'rectangle', x: 16, y: 11, width: barWidth, height: 4, fill: progressColor },
        { type: 'rectangle', x: 16 + barWidth, y: 11, width: Math.max(0, 56 - barWidth), height: 4, fill: '#1E293BFF' },
        { type: 'rectangle', x: endCapX, y: 10, width: 2, height: 6, fill: '#FFFFFFFF' }
      ],
      backElements: [
        { type: 'text', font: 'tiny', x: 0, y: 0, color: '#FFFFFF', text: `Baking ${projectName} (${progress}%)` }
      ],
      ledColorHex: progressColor
    };

    this.ledMode = 'FLASH_BURST';
    this.updateStateAndDispatch(payload);
    return payload;
  }

  /**
   * Renders Unity Exception / Error Alert View with Orange Error Icon.
   */
  public renderException(projectName: string, message: string): DisplayPayload {
    const payload: DisplayPayload = {
      frontElements: [
        { type: 'bitmap', iconId: 'error' as BitmapIconId, bitmapData: getBitmapById('error'), x: 0, y: 0 },
        { type: 'text', font: 'small', x: 16, y: 0, width: 56, color: '#EF4444FF', text: 'EXCEPTION:' },
        { type: 'text', font: 'small', x: 16, y: 8, width: 56, color: '#FFFFFFFF', text: message, scroll_rate: 60 }
      ],
      backElements: [
        { type: 'text', font: 'tiny', x: 0, y: 0, color: '#EF4444FF', text: `EXCEPTION: ${projectName}` },
        { type: 'text', font: 'tiny', x: 0, y: 16, color: '#CCCCCC', text: message }
      ],
      ledColorHex: '#EF4444FF'
    };

    this.ledMode = 'PULSE_ALERT';
    this.updateStateAndDispatch(payload);
    return payload;
  }

  private updateStateAndDispatch(payload: DisplayPayload): void {
    this.driver.sendDisplayPayload(payload as unknown as Record<string, unknown>);

    this.lastState = {
      frontElements: payload.frontElements as unknown as DisplayElementDTO[],
      backElements: payload.backElements as unknown as DisplayElementDTO[],
      ledColorHex: payload.ledColorHex || '#10B981FF',
      ledMode: this.ledMode,
      colorTheme: this.colorTheme,
      rearOledMode: this.rearOledMode,
      activeWidgetId: this.activeWidgetId
    };

    for (const callback of this.stateChangeCallbacks) {
      callback(this.lastState);
    }
  }
}

class ArgumentNullException extends Error {
  constructor(paramName: string) {
    super(`Argument cannot be null or undefined: ${paramName}`);
    this.name = 'ArgumentNullException';
  }
}
