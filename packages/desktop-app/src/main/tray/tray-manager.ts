import { app, Menu, Tray, BrowserWindow, nativeImage } from 'electron';
import path from 'path';
import fs from 'fs';
import { TimeTrackingEngine } from '../engine/time-tracking-engine';
import { MiniWindowController } from '../windows/mini-window-manager';
import { openTaskPickerInMainWindow, revealMainWindow } from '../windows/main-window-actions';
import type { LaunchAtLoginService } from '../services/launch-at-login';

/**
 * System Tray Manager handling desktop tray lifecycle, status tooltip badges,
 * native context menu actions, and minimize-to-tray window behavior.
 */
export class TrayManager {
  private tray: Tray | null = null;
  private readonly unsubscribeMiniWindow?: () => void;
  private readonly unsubscribeLaunchAtLogin?: () => void;
  private mainWindow: BrowserWindow;
  private engine: TimeTrackingEngine;

  constructor(
    mainWindow: BrowserWindow,
    engine: TimeTrackingEngine,
    private readonly miniWindow?: MiniWindowController,
    private readonly launchAtLogin?: LaunchAtLoginService
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
    this.engine.subscribe(() => {
      this.updateStatusTooltip();
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

  private updateContextMenu(): void {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open SprintTicker',
        click: () => this.restoreWindow()
      },
      { type: 'separator' },
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
        click: () => openTaskPickerInMainWindow(this.mainWindow)
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
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
