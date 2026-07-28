import { powerMonitor, BrowserWindow } from 'electron';
import { IPCChannel } from '../../shared/ipc-channels';
import { PriorityPreemptionEngine } from './priority-preemption-engine';
import { SettingsRepository } from '../db/repositories/settings-repository';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { DisplayRenderer } from '../hardware/display-renderer';
import { ScheduleSettingsDTO } from '../../shared/dtos';

/**
 * Service that automatically monitors Windows session locks/sleep events and lunch schedules,
 * switching context modes, auto-pausing active tasks during lunch, and rendering dedicated screens.
 */
export class ContextScheduleService {
  private static readonly CHECK_INTERVAL_MS = 30000; // 30 seconds

  private readonly _priorityEngine: PriorityPreemptionEngine;
  private readonly _settingsRepo: SettingsRepository;
  private readonly _engine: TimeTrackingEngine;
  private readonly _renderer: DisplayRenderer;

  private _getWindow?: () => BrowserWindow | null;
  private _lastEodPromptDateString: string | null = null;
  private _lastStandupPromptDateString: string | null = null;
  private _standupSnoozeUntilTimestamp: number | null = null;
  private _eodSnoozeUntilTimestamp: number | null = null;

  constructor(
    priorityEngine: PriorityPreemptionEngine,
    settingsRepo: SettingsRepository,
    engine: TimeTrackingEngine,
    renderer: DisplayRenderer,
    getWindow?: () => BrowserWindow | null
  ) {
    if (!priorityEngine) throw new ArgumentNullException('priorityEngine');
    if (!settingsRepo) throw new ArgumentNullException('settingsRepo');
    if (!engine) throw new ArgumentNullException('engine');
    if (!renderer) throw new ArgumentNullException('renderer');

    this._priorityEngine = priorityEngine;
    this._settingsRepo = settingsRepo;
    this._engine = engine;
    this._renderer = renderer;
    this._getWindow = getWindow;

    this.registerPowerMonitorListeners();
    this.startScheduleTimer();
  }

  /// <summary>
  /// Evaluates current local time against configured stand-up, lunch, and End-of-Day schedules.
  /// </summary>
  public evaluateSchedule(): void {
    try {
      const settings = this._settingsRepo.getSetting<ScheduleSettingsDTO>('schedule_settings', {
        standupTime: '10:00',
        enableStandupPrompt: true,
        lunchStartTime: '12:30',
        lunchEndTime: '13:30',
        enableLunchMute: true,
        eodWrapUpTime: '18:00',
        promptTimeoutSeconds: 0
      });

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const todayDateString = now.toISOString().split('T')[0];

    // 1. Evaluate Daily Stand-Up Schedule
    if (settings.enableStandupPrompt !== false) {
      const [suH, suM] = (settings.standupTime || '10:00').split(':').map(Number);
      const standupMins = suH * 60 + suM;
      const isSnoozed = this._standupSnoozeUntilTimestamp !== null && Date.now() < this._standupSnoozeUntilTimestamp;

      if (currentMinutes >= standupMins && this._lastStandupPromptDateString !== todayDateString && !isSnoozed) {
        this._lastStandupPromptDateString = todayDateString;
        this._standupSnoozeUntilTimestamp = null;
        this.triggerStandupPrompt();
      }
    }

    // 2. Evaluate Lunch Schedule
    const [startH, startM] = (settings.lunchStartTime || '12:30').split(':').map(Number);
    const [endH, endM] = (settings.lunchEndTime || '13:30').split(':').map(Number);

    const lunchStartMins = startH * 60 + startM;
    const lunchEndMins = endH * 60 + endM;

    const isLunchTime = currentMinutes >= lunchStartMins && currentMinutes < lunchEndMins;
    const currentMode = this._priorityEngine.getUserMode();

    if (isLunchTime && currentMode !== 'LUNCH' && currentMode !== 'AWAY') {
      this.enterLunchMode();
    } else if (!isLunchTime && currentMode === 'LUNCH') {
      this.exitLunchMode();
    }

    // 3. Evaluate End-of-Day Wrap-Up Schedule
    const [eodH, eodM] = (settings.eodWrapUpTime || '18:00').split(':').map(Number);
    const eodStartMins = eodH * 60 + eodM;
    const isEodSnoozed = this._eodSnoozeUntilTimestamp !== null && Date.now() < this._eodSnoozeUntilTimestamp;

      if (currentMinutes >= eodStartMins && this._lastEodPromptDateString !== todayDateString && !isEodSnoozed) {
        this._lastEodPromptDateString = todayDateString;
        this._eodSnoozeUntilTimestamp = null;
        this.triggerEodPrompt();
      }
    } catch (err) {
      console.warn('[ContextScheduleService] Skipping schedule evaluation due to closed database or system error:', err);
    }
  }

  /// <summary>
  /// Broadcasts Stand-Up ceremony prompt to hardware display and renderer window.
  /// </summary>
  public triggerStandupPrompt(): void {
    this._renderer.renderCeremonyPrompt('STANDUP', 'Daily Stand-Up');

    if (this._getWindow) {
      const win = this._getWindow();
      if (win && !win.isDestroyed()) {
        if (typeof win.isMinimized === 'function' && win.isMinimized()) {
          win.restore();
        }
        if (typeof win.show === 'function') win.show();
        if (typeof win.focus === 'function') win.focus();

        win.webContents.send(IPCChannel.ON_CEREMONY_PROMPT, {
          type: 'STANDUP',
          title: 'Daily Stand-Up'
        });
      }
    }
  }

  /// <summary>
  /// Postpones ceremony prompt evaluation by specified minutes.
  /// </summary>
  public snoozeCeremony(type: 'STANDUP' | 'EOD', minutes: number = 10): void {
    const until = Date.now() + minutes * 60 * 1000;
    if (type === 'STANDUP') {
      this._standupSnoozeUntilTimestamp = until;
      this._lastStandupPromptDateString = null;
    } else {
      this._eodSnoozeUntilTimestamp = until;
      this._lastEodPromptDateString = null;
    }
  }

  /// <summary>
  /// Broadcasts EOD Wrap-Up ceremony prompt to renderer window.
  /// </summary>
  public triggerEodPrompt(): void {
    this._renderer.renderCeremonyPrompt('EOD', 'End-of-Day Wrap-Up');

    if (this._getWindow) {
      const win = this._getWindow();
      if (win && !win.isDestroyed()) {
        if (typeof win.isMinimized === 'function' && win.isMinimized()) {
          win.restore();
        }
        if (typeof win.show === 'function') win.show();
        if (typeof win.focus === 'function') win.focus();

        win.webContents.send(IPCChannel.ON_CEREMONY_PROMPT, {
          type: 'EOD',
          title: 'End-of-Day Wrap-Up'
        });
      }
    }
  }

  /// <summary>
  /// Manually or automatically triggers transition into LUNCH mode, auto-pausing active tasks.
  /// </summary>
  public enterLunchMode(): void {
    const session = this._engine.getCurrentSession();
    if (session && session.status === 'in_progress') {
      this._wasTaskAutoPausedForLunch = true;
      this._engine.pauseSession();
    }

    this._priorityEngine.setUserMode('LUNCH');
    this._renderer.renderLunchMode();
  }

  /// <summary>
  /// Exits LUNCH mode and resumes work mode.
  /// </summary>
  public exitLunchMode(): void {
    this._priorityEngine.setUserMode('WORK');

    if (this._wasTaskAutoPausedForLunch) {
      this._wasTaskAutoPausedForLunch = false;
      const session = this._engine.getCurrentSession();
      if (session && session.status === 'paused') {
        this._engine.resumeSession();
      }
    } else {
      const session = this._engine.getCurrentSession();
      this._renderer.renderActiveSession(session);
    }
  }

  /// <summary>
  /// Manually or automatically triggers transition into AWAY mode.
  /// </summary>
  public enterAwayMode(): void {
    this._priorityEngine.setUserMode('AWAY');
    this._renderer.renderAwayMode();
  }

  /// <summary>
  /// Exits AWAY mode when Windows unlocks or resumes.
  /// </summary>
  public exitAwayMode(): void {
    this._priorityEngine.setUserMode('WORK');
    const session = this._engine.getCurrentSession();
    this._renderer.renderActiveSession(session);
  }

  /// <summary>
  /// Disposes background timers and unregisters powerMonitor listeners.
  /// </summary>
  public dispose(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
  }

  private registerPowerMonitorListeners(): void {
    try {
      if (typeof powerMonitor !== 'undefined' && powerMonitor && typeof powerMonitor.on === 'function') {
        powerMonitor.on('lock-screen', () => this.enterAwayMode());
        powerMonitor.on('suspend', () => this.enterAwayMode());
        powerMonitor.on('unlock-screen', () => this.exitAwayMode());
        powerMonitor.on('resume', () => this.exitAwayMode());
      }
    } catch {
      // Suppress when running in headless test environments without powerMonitor
    }
  }

  private startScheduleTimer(): void {
    this._timer = setInterval(() => this.evaluateSchedule(), ContextScheduleService.CHECK_INTERVAL_MS);
  }
}

class ArgumentNullException extends Error {
  constructor(paramName: string) {
    super(`Argument cannot be null or undefined: ${paramName}`);
    this.name = 'ArgumentNullException';
  }
}
