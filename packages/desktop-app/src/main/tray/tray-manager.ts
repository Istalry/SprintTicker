import { app, Menu, Tray, BrowserWindow, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { MiniWindowController } from '../windows/mini-window-manager';
import { openTaskPickerInMainWindow, revealMainWindow } from '../windows/main-window-actions';
import type { PickerWindowController } from '../windows/picker-window-manager';
import type { LaunchAtLoginService } from '../services/launch-at-login';
import { Verb } from '../../shared/words';

/**
 * System Tray Manager handling desktop tray lifecycle, status tooltip badges,
 * native context menu actions, and minimize-to-tray window behavior.
 */
export class TrayManager {
  private tray: Tray | null = null;
  private readonly unsubscribeMiniWindow?: () => void;
  private readonly unsubscribeLaunchAtLogin?: () => void;
  private unsubscribeEngine?: () => void;
  /**
   * The interruption the menu was built for, and the task it holds: the menu
   * is rebuilt when they change, never on every tick of the engine.
   */
  private menuInterruption = '';
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
    private readonly pickerWindow?: PickerWindowController
  ) {
    this.mainWindow = mainWindow;
    this.engine = engine;
    // The checkbox mirrors the window however it was opened or closed.
    this.unsubscribeMiniWindow = this.miniWindow?.subscribe(() => this.updateContextMenu());
    // And the startup one follows the switch in the window.
    this.unsubscribeLaunchAtLogin = this.launchAtLogin?.subscribe(() => this.updateContextMenu());
  }

  public initialize(): void {
    const trayIconPath = path.join(__dirname, '../../build/tray-icon.png');
    let image: Electron.NativeImage;
    if (fs.existsSync(trayIconPath)) {
      image = nativeImage.createFromPath(trayIconPath);
    } else {
      const iconData =
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAuSURBVHgB7cxBDQAACAIg2v6dZg0v0gAGZpJupv7uAQgICAgICAgICAgICAgIXLg3SAE7mEomwQAAAABJRU5ErkJggg==';
      image = nativeImage.createFromDataURL(iconData);
    }

    this.tray = new Tray(image);
    this.tray.setToolTip('SprintTicker (Idle)');

    this.updateContextMenu();

    // Double-click tray icon to restore and bring dashboard to front
    this.tray.on('double-click', () => {
      this.restoreWindow();
    });

    // Window close event triggers standard exit
    this.mainWindow.on('close', () => {
      (app as unknown as { isQuitting?: boolean }).isQuitting = true;
    });

    // Subscribe to engine state updates to adjust tray tooltip and context menu
    this.unsubscribeEngine = this.engine.subscribe(() => {
      this.updateStatusTooltip();
      if (this.interruptionKey() !== this.menuInterruption) this.updateContextMenu();
    });
  }

  public restoreWindow(): void {
    revealMainWindow(this.mainWindow);
  }

  private updateStatusTooltip(): void {
    if (!this.tray) return;

    const session = this.engine.getCurrentSession();
    if (session && session.status === 'TRACKING') {
      this.tray.setToolTip(`SprintTicker: TRACKING [${session.taskKey}] - ${session.taskTitle}`);
    } else if (session && session.status === 'PAUSED') {
      this.tray.setToolTip(`SprintTicker: PAUSED [${session.taskKey}]`);
    } else {
      this.tray.setToolTip('SprintTicker (Idle)');
    }
  }

  private interruptionKey(): string {
    const running = this.engine.getCurrentSession()?.interruption;
    return running ? `${running.id}:${running.interruptedTaskKey ?? ''}` : '';
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

  /**
   * During an interruption (P6): Back to the task it holds, and Stop. The
   * engine's own commands, which every surface reaches, so the tray holds no
   * rule of its own.
   */
  private interruptionItems(): Electron.MenuItemConstructorOptions[] {
    const running = this.engine.getCurrentSession()?.interruption;
    if (!running) return [];
    return [
      ...(running.interruptedSessionId
        ? [{
            label: `${Verb.BACK} to ${running.interruptedTaskKey ?? 'the task'}`,
            click: this.guarded('go back from the interruption', () => this.engine.backFromInterruption())
          }]
        : []),
      {
        label: 'Stop the Interruption',
        click: this.guarded('stop the interruption', () => this.engine.stopInterruption())
      }
    ];
  }

  private updateContextMenu(): void {
    if (!this.tray) return;
    this.menuInterruption = this.interruptionKey();
    const interrupting = this.menuInterruption !== '';

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open SprintTicker',
        click: () => this.restoreWindow()
      },
      { type: 'separator' },
      // First: an interruption is the moment there is no time to look for it.
      ...this.interruptionItems(),
      ...(this.interrupt
        ? [{
            // During one, the same press is Another: main decides.
            label: interrupting ? `${Verb.ANOTHER} Interruption` : 'Start an Interruption',
            click: this.guarded('start an interruption', () => this.interrupt?.())
          }]
        : []),
      {
        label: 'Start / Pause Active Tracking',
        click: () => {
          const session = this.engine.getCurrentSession();
          if (!session) {
            this.restoreWindow();
          } else if (session.status === 'TRACKING') {
            this.engine.pauseSession();
          } else {
            this.engine.resumeSession();
          }
        }
      },
      {
        label: 'Trigger Task Selector Modal',
        click: () => {
          if (this.pickerWindow) this.pickerWindow.open('start');
          else openTaskPickerInMainWindow(this.mainWindow);
        }
      },
      ...(this.miniWindow
        ? [{
            label: 'Show Mini Timer',
            type: 'checkbox' as const,
            checked: this.miniWindow.isOpen(),
            click: () => { this.miniWindow?.toggle(); }
          }]
        : []),
      { type: 'separator' },
      // Read from Windows each time the menu is built: the user can switch it
      // off in Windows' own Startup apps, which sends no event.
      ...(this.launchAtLogin?.getStatus().available
        ? [
            {
              label: 'Start with Windows',
              type: 'checkbox' as const,
              checked: this.launchAtLogin.getStatus().enabled,
              click: (menuItem: Electron.MenuItem) => {
                this.launchAtLogin?.setEnabled(menuItem.checked);
              }
            },
            { type: 'separator' as const }
          ]
        : []),
      {
        label: 'Quit Application',
        click: () => {
          (app as unknown as { isQuitting?: boolean }).isQuitting = true;
          app.quit();
        }
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  public destroy(): void {
    this.unsubscribeMiniWindow?.();
    this.unsubscribeLaunchAtLogin?.();
    this.unsubscribeEngine?.();
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
