import { app, Menu, Tray, BrowserWindow, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { MiniWindowController } from '../windows/mini-window-manager';
import { openTaskPickerInMainWindow, revealMainWindow } from '../windows/main-window-actions';
import type { PickerWindowController } from '../windows/picker-window-manager';
import type { LaunchAtLoginService } from '../services/launch-at-login';
import type { UserMode } from '../../shared/dtos';
import { Verb } from '../../shared/words';
import { trayBadgeOf, trayMarkOf } from '../../shared/tray-state';
import { drawTrayIcon, encodePng, TRAY_ICON_REFRESH_MS, TRAY_ICON_SIZES } from './tray-icon';

/**
 * What the tray's menu does that is not the engine's own (S26): each is the
 * command the window and the deck reach, so the tray keeps no rule of its own.
 */
export interface TrayCommands {
  /** Stop, as Today's: logs it with Undo for 10 s; during an interruption, ends it. */
  stop: () => void;
  /** The mode chip's choice: Lunch, Away, or back to work. */
  chooseMode: (mode: UserMode) => void;
  getMode: () => UserMode;
  /** Opens the window on End my day. */
  endDay: () => void;
  /** In working hours now: the icon's ! rather than ○ when nothing is timed (P12b). */
  inWorkingHours?: () => boolean;
  /** The entries not yet sent, for the icon's number (P12b). */
  countWaiting?: () => number;
}

/**
 * The tray (redesign P12a, S26): a single click opens the window, and the
 * menu holds the common actions -- Switch, Previous, Pause or Resume, Stop,
 * Interrupt or Back, Lunch, Away, End my day, the mini timer, Start with
 * Windows, Quit. The window's close hides it here (`MainWindowCloseGuard`),
 * so Quit is the one way out.
 *
 * The menu is built when it is asked for, on the right-click: what it says
 * -- Pause or Resume, the previous task, the mode, Windows' startup switch --
 * is then current, with no rebuild on every tick of the engine.
 */
export class TrayManager {
  private tray: Tray | null = null;
  private unsubscribeEngine?: () => void;
  /** The mark and number the icon shows, so it is redrawn only when they change. */
  private iconKey = '';
  private iconTimer: ReturnType<typeof setInterval> | null = null;
  private mainWindow: BrowserWindow;
  private engine: TimeTrackingEngine;

  constructor(
    mainWindow: BrowserWindow,
    engine: TimeTrackingEngine,
    private readonly miniWindow?: MiniWindowController,
    private readonly launchAtLogin?: LaunchAtLoginService,
    /** Interrupt, as the window's button does it: `ContextScheduleService.interrupt`. */
    private readonly interrupt?: () => void,
    /** The picker as its own window (P7b); without it, the main window's. */
    private readonly pickerWindow?: PickerWindowController,
    private readonly commands?: TrayCommands
  ) {
    this.mainWindow = mainWindow;
    this.engine = engine;
  }

  public initialize(): void {
    this.tray = new Tray(this.drawnIcon() ?? TrayManager.fileIcon());
    this.updateStatusTooltip();

    // A single click opens the window (S26): the tray is where the closed
    // window went, and a double-click was a second guess nobody made.
    this.tray.on('click', () => this.restoreWindow());
    this.tray.on('right-click', () => this.tray?.popUpContextMenu(this.buildMenu()));

    // Every tick while a task is timed, and every few seconds besides: the
    // mode, the hours and the queue change with no event of the engine's.
    this.unsubscribeEngine = this.engine.subscribe(() => this.refresh());
    this.iconTimer = setInterval(() => this.refresh(), TRAY_ICON_REFRESH_MS);
    this.iconTimer.unref?.();
  }

  private refresh(): void {
    this.updateStatusTooltip();
    this.updateIcon();
  }

  /** The mark and the number as things stand. */
  private iconState(): { mark: ReturnType<typeof trayMarkOf>; badge: string | null } {
    const mark = trayMarkOf({
      session: this.engine.getCurrentSession(),
      mode: this.commands?.getMode() ?? 'WORK',
      inWorkingHours: this.commands?.inWorkingHours?.() ?? false
    });
    return { mark, badge: trayBadgeOf(this.commands?.countWaiting?.() ?? 0) };
  }

  /** Redraws the icon when its mark or number changed; a failure keeps the one shown. */
  private updateIcon(): void {
    if (!this.tray) return;
    try {
      const { mark, badge } = this.iconState();
      const key = `${mark}:${badge ?? ''}`;
      if (key === this.iconKey) return;
      const image = this.drawnIcon();
      if (image) this.tray.setImage(image);
    } catch (err) {
      console.error('[TrayManager] Could not redraw the tray icon:', err);
    }
  }

  /**
   * The icon of S26 for the state now (P12b), at 16 and 32 px, or null when
   * drawing failed -- the file icon then stands in, rather than no tray.
   */
  private drawnIcon(): Electron.NativeImage | null {
    try {
      const { mark, badge } = this.iconState();
      const [small, large] = TRAY_ICON_SIZES;
      const image = nativeImage.createFromBuffer(encodePng(small, small, drawTrayIcon(mark, badge, small)), { scaleFactor: 1 });
      image.addRepresentation({ scaleFactor: large / small, buffer: encodePng(large, large, drawTrayIcon(mark, badge, large)) });
      this.iconKey = `${mark}:${badge ?? ''}`;
      return image;
    } catch (err) {
      console.error('[TrayManager] Could not draw the tray icon:', err);
      return null;
    }
  }

  /** The icon before P12b: the file the build ships, or an embedded square. */
  private static fileIcon(): Electron.NativeImage {
    const trayIconPath = path.join(__dirname, '../../build/tray-icon.png');
    if (fs.existsSync(trayIconPath)) return nativeImage.createFromPath(trayIconPath);
    return nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAuSURBVHgB7cxBDQAACAIg2v6dZg0v0gAGZpJupv7uAQgICAgICAgICAgICAgIXLg3SAE7mEomwQAAAABJRU5ErkJggg=='
    );
  }

  public restoreWindow(): void {
    revealMainWindow(this.mainWindow);
  }

  private updateStatusTooltip(): void {
    if (!this.tray) return;

    const session = this.engine.getCurrentSession();
    let tip: string;
    if (session && session.status === 'TRACKING') {
      tip = `SprintTicker: TRACKING [${session.taskKey}] - ${session.taskTitle}`;
    } else if (session && session.status === 'PAUSED') {
      tip = `SprintTicker: PAUSED [${session.taskKey}]`;
    } else {
      tip = 'SprintTicker (Idle)';
    }
    // The icon's number, said: a figure in a corner explains nothing alone.
    const waiting = this.commands?.countWaiting?.() ?? 0;
    if (waiting > 0) tip += ` · ${waiting} waiting to send`;
    this.tray.setToolTip(tip);
  }

  /** Runs a menu click; a throw from one would reach Electron's main process. */
  private guarded(what: string, action: () => unknown): () => void {
    return () => {
      try {
        action();
      } catch (err) {
        console.error(`[TrayManager] Could not ${what}:`, err);
      }
    };
  }

  /** "Previous task: PF-31", which switches back to it; none during an interruption. */
  private previousItem(interrupting: boolean): Electron.MenuItemConstructorOptions[] {
    if (interrupting) return [];
    const previous = this.engine.getPreviousTask();
    if (!previous) return [];
    return [{
      label: `${Verb.PREVIOUS} task: ${previous.key}`,
      click: this.guarded('go back to the previous task', () => this.engine.startTask(previous.id, false, previous.title))
    }];
  }

  /**
   * Interrupt; during one, Another, which main decides. Back has no item:
   * Stop takes the held task up again (2026-11-16).
   */
  private interruptItem(): Electron.MenuItemConstructorOptions[] {
    const running = this.engine.getCurrentSession()?.interruption;
    if (!this.interrupt) return [];
    return [{
      label: running ? `${Verb.ANOTHER} interruption` : Verb.INTERRUPT,
      click: this.guarded('start an interruption', () => this.interrupt?.())
    }];
  }

  /** Lunch and Away, ticked while on; clicking the one that is on goes back to work. */
  private modeItems(): Electron.MenuItemConstructorOptions[] {
    const commands = this.commands;
    if (!commands) return [];
    const mode = commands.getMode();
    const item = (label: string, target: UserMode): Electron.MenuItemConstructorOptions => ({
      label,
      type: 'checkbox',
      checked: mode === target,
      click: this.guarded(`switch to ${label}`, () => commands.chooseMode(mode === target ? 'WORK' : target))
    });
    return [
      item('Lunch', 'LUNCH'),
      item('Away', 'AWAY'),
      { label: 'End my day…', click: this.guarded('open End my day', () => commands.endDay()) }
    ];
  }

  /** The menu as things stand now (S26). Public for the tests, which cannot right-click. */
  public buildMenu(): Electron.Menu {
    const session = this.engine.getCurrentSession();
    const interrupting = Boolean(session?.interruption);

    const template: Electron.MenuItemConstructorOptions[] = [
      { label: 'Open SprintTicker', click: () => this.restoreWindow() },
      { type: 'separator' },
      // During an interruption choosing a task does nothing: it ends first
      // (the user's choice, 2026-11-12), so neither Switch nor Previous is offered.
      ...(interrupting
        ? []
        : [{
            // Switch with a task running; with nothing, there is nothing to switch from.
            label: session ? `${Verb.SWITCH} task…` : `${Verb.START} a task…`,
            click: this.guarded('open the picker', () => {
              if (this.pickerWindow) this.pickerWindow.open('start');
              else openTaskPickerInMainWindow(this.mainWindow);
            })
          }]),
      ...this.previousItem(interrupting),
      // An interruption pauses and stops as a task does (2026-11-16).
      ...(session
        ? [session.status === 'PAUSED'
            ? { label: Verb.RESUME, click: this.guarded('resume', () => this.engine.resumeSession()) }
            : { label: Verb.PAUSE, click: this.guarded('pause', () => this.engine.pauseSession()) }]
        : []),
      ...(session && this.commands
        ? [{
            label: session.interruption?.interruptedSessionId
              ? `${Verb.STOP}, ${Verb.BACK.toLowerCase()} to ${session.interruption.interruptedTaskKey ?? 'the task'}`
              : Verb.STOP,
            click: this.guarded('stop', () => this.commands?.stop())
          }]
        : []),
      ...this.interruptItem(),
      { type: 'separator' },
      ...this.modeItems(),
      { type: 'separator' },
      ...(this.miniWindow
        ? [{
            label: 'Mini timer',
            type: 'checkbox' as const,
            checked: this.miniWindow.isOpen(),
            click: () => { this.miniWindow?.toggle(); }
          }]
        : []),
      // Read from Windows each time the menu is built: the user can switch it
      // off in Windows' own Startup apps, which sends no event.
      ...(this.launchAtLogin?.getStatus().available
        ? [{
            label: 'Start with Windows',
            type: 'checkbox' as const,
            checked: this.launchAtLogin.getStatus().enabled,
            click: (menuItem: Electron.MenuItem) => {
              this.launchAtLogin?.setEnabled(menuItem.checked);
            }
          }]
        : []),
      { type: 'separator' },
      // The one way out now that the window's close hides it: clears the
      // bar and stops the socket, through will-quit.
      { label: 'Quit', click: () => app.quit() }
    ];

    return Menu.buildFromTemplate(template);
  }

  public destroy(): void {
    this.unsubscribeEngine?.();
    if (this.iconTimer) {
      clearInterval(this.iconTimer);
      this.iconTimer = null;
    }
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
